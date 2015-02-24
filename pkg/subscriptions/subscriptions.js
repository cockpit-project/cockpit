/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

/* global jQuery   */

define([
    "jquery",
    "base1/cockpit",
    "base1/po",
    "base1/mustache"
], function($, cockpit, po, Mustache) {
    "use strict";

    cockpit.locale(po);
    cockpit.translate();
    var _ = cockpit.gettext;

    function debug() {
        if (window.debugging == "all" || window.debugging == "subscriptions")
            console.debug.apply(console, arguments);
    }

    var subscriptions = { };

    function register_system() {
        var url = null;
        register_dialog_remove_errors();
        if ($('#subscription-register-url').val() === 'Custom URL')
          url = $('#subscription-register-url-custom').val().trim();
        var username = $('#subscription-register-username').val();
        var has_errors = false;
        if (username === '') {
            $('#subscriptions-register-username-empty').show();
            $('#subscription-register-username').parent().addClass('has-error');
            has_errors = true;
        }
        var password = $('#subscription-register-password').val();
        if (password === '') {
            $('#subscriptions-register-password-empty').show();
            $('#subscription-register-password').parent().addClass('has-error');
            has_errors = true;
        }
        if (!has_errors)
          subscriptions.manager.register_system(url, username, password);
    }

    function register_dialog_remove_errors() {
        $('#subscriptions-register-password-note').hide();
        $('#subscriptions-register-password-note-details').hide();
        $('#subscriptions-register-username-empty').hide();
        $('#subscriptions-register-password-empty').hide();
        $('#subscription-register-username').parent().removeClass('has-error');
        $('#subscription-register-password').parent().removeClass('has-error');
        $('#subscriptions-register-url-note').hide();
        $('#subscription-register-url-custom').parent().removeClass('has-error');
        $('#subscriptions-register-general-error').parent().hide();
    }

    function register_dialog_initialize() {
        var dlg = $('#subscriptions-register-dialog');
        var btn = $('#account-register-start');
        btn.on('click', function() {
            register_system();
        });

        /* only clear password on show, everything else might be necessary again
         * if an earlier call to register the system failed
         */
        dlg.on('show.bs.modal', function() {
            $('#subscription-register-password').val("");
            register_dialog_remove_errors();
        });
        dlg.on('shown.bs.modal', function() {
            $('#subscription-register-username').focus();
        });

        dlg.on('keypress', function(e) {
            if (e.keyCode === 13)
              btn.trigger('click');
        });
    }

    /*
     * gather and display information regarding system subscriptions
     *
     * update_info: if true, trigger an immediate update of the information
     */
    function subscription_manager(update_info, overall_status_change_callback) {
        var subscription_template = $("#subscription-template").html();
        Mustache.parse(subscription_template);

        var service = cockpit.dbus('com.redhat.SubscriptionManager');

        var subscription_info = $('#subscriptions-subscribed');
        var system_unregistered = $('#subscriptions-unregistered');
        var is_updating = $('#subscriptions-updating');

        var subcription_notification_success = $('#subscription-notification-success-template').html();
        var subcription_notification_failure = $('#subscription-notification-failure-template').html();
        Mustache.parse(subcription_notification_success);
        Mustache.parse(subcription_notification_failure);

        /* keep track of calls to subscription-manager in progress so we don't call it concurrently
         * status_update_requested: refresh necessary after current action has finished
         */
        var status_update_requested = false;

        var overall_status = null;
        var change_callback = overall_status_change_callback;

        /* we trigger status update via dbus
         * if we don't get a timely reply, consider subscription-manager failure
         */
        var update_timeout;

        function status_update_failed() {
            if (update_timeout !== null)
                $('#subscription-manager-not-found').show();
            update_timeout = null;
        }

        function get_overall_status() {
            return overall_status;
        }

        function render_subscriptions(info) {
            /* clear old subscription details */
            subscription_info.empty();

            /* show subscription info only if there is visible information */
            if (info.length > 0) {
                subscription_info.show();
                /* render and add the new ones */
                for (var i = 0; i < info.length; ++i)
                    subscription_info.append( $(Mustache.render(subscription_template, info[i])) );
            } else {
                subscription_info.hide();
            }
        }

        /*
         * Parses lines like:
         *
         * id:  text
         */
        function parse_single_subscription(text) {
            var ret = { };
            $.each(text.split('\n'), function(i, line) {
                var pos = line.indexOf(':');
                if (pos !== -1)
                    ret[line.substring(0, pos)] = line.substring(pos + 1).trim();
            });
            return ret;
        }

        function parse_multiple_subscriptions(text) {
            var ret = [ ];
            var parts = text.split('\n\n');
            for (var i = 0; i < parts.length; ++i) {
                var segment = parts[i];
                if (segment.indexOf('Product Name:') === -1)
                    continue;

                var segment_info = parse_single_subscription(segment);

                var status = segment_info['Status'];

                /* if we have status details, add those to the status */
                if (segment_info['Status Details'] !== '')
                    status = status + ' (' + segment_info['Status Details'] + ')';

                /* convert text output to mustache template variables */
                ret.push({
                    'product_name': segment_info['Product Name'],
                    'product_id': segment_info['Product ID'],
                    'version': segment_info['Version'],
                    'arch': segment_info['Arch'],
                    'status': status,
                    'starts': segment_info['Starts'],
                    'ends': segment_info['Ends'],
                });
            }
            return ret;
        }

        /*
         * Display information about an action in progress
         * Make sure we only have one subscription-manager instance at a time
         */
        var subscription_manager_running = false;
        function show_progress_message(message) {
            is_updating.show();
            $('#subscriptions-update-message').text(message);
        }

        function hide_progress_message() {
            is_updating.hide();
        }

        /* since we only call subscription_manager, we only need to check the update message visibility */
        function action_in_progress() {
            return (is_updating.is(':visible') || $('#subscriptions-registering').is(':visible'));
        }

        /* get subscription details using 'subscription-manager list' */
        function get_subscription_details() {
            if (action_in_progress()) {
                status_update_requested = true;
                return;
            }
            status_update_requested = false;

            /* we got a message from dbus, so subscription-manager seems to work */
            $('#subscription-manager-not-found').hide();
            $('#subscription-manager-not-accessible').hide();

            show_progress_message('Retrieving current subscription details.');

            /* TODO DBus API doesn't deliver what we need, so we call subscription manager
             * without translations and parse the output
             */
            cockpit.spawn(['subscription-manager', 'list'],
                    { directory: '/', superuser: true, environ: ['LC_ALL=C'] })
                .done(function(output) {
                    hide_progress_message();

                    var subscriptions = parse_multiple_subscriptions(output);
                    if ((subscriptions.length > 0)  && (output.indexOf('Subscribed') > -1))
                        render_subscriptions(subscriptions);
                    else
                        subscription_info.hide();

                    /* if we have no subscriptions, tell user this */
                    if (subscription_info.children().length === 0)
                        $('#subscriptions-system-status').show();
                    else
                        $('#subscriptions-system-status').hide();

                    /* if refresh was requested, try again - otherwise get details */
                    if (status_update_requested)
                        update_subscriptions();

                })
                .fail(function(ex) {
                    hide_progress_message();
                    if (status_update_requested)
                        update_subscriptions();
                    /* calling subscription manager failed, display warning */
                    $('#subscription-manager-not-found').show();
                    console.warn("Subscriptions [get_subscription_details]: couldn't get details: " + ex);
                });
        }

        function remove_notifications() {
            $('div.container-fluid.alert').remove();
            register_dialog_remove_errors();
        }

        function process_status_output(text, exit_details) {
            hide_progress_message();

            if (exit_details.problem === 'not-authorized') {
                $('#subscription-manager-not-found').hide();
                $('#subscription-manager-not-accessible').show();
                return;
            }
            /* if output isn't as expected, maybe not properly installed? */
            if (text.indexOf('Overall Status:') === -1) {
                $('#subscription-manager-not-found').show();
                $('#subscription-manager-not-accessible').hide();
                return;
            }

            /* clear old subscription details */
            subscription_info.empty();

            var status = parse_single_subscription(text);
            var current_system_status = status['Overall Status'];

            if ((overall_status !== null) && (current_system_status !== overall_status)) {
                /* status changed, notify depending on actual change
                 * hide other message in case it's still visible
                 */
                remove_notifications();
                if (current_system_status === 'Current')
                    system_unregistered.parent().prepend( $(Mustache.render(subcription_notification_success)) );

                if (typeof(change_callback) === typeof(Function))
                    change_callback(overall_status);
            }
            overall_status = current_system_status;

            $('#subscriptions-system-status').hide();

            /* only allow registration if system state is unknown
             * subscriptions might also be invalid (e.g. expired), but we don't handle that currently
             */
            if (overall_status !== 'Unknown') {
                system_unregistered.hide();
            }
            else {
                /* no valid subscription: hide output and present user with the option to register system */
                subscription_info.hide();
                system_unregistered.show();
            }

            /* if refresh was requested, try again - otherwise get details */
            if (status_update_requested)
                update_subscriptions();
            else if (current_system_status !== 'Unknown')
                get_subscription_details();
        }

        /* get subscription summary using 'subscription-manager status'*/
        function get_subscription_status() {
            if (action_in_progress()) {
                status_update_requested = true;
                return;
            }
            status_update_requested = false;

            show_progress_message('Retrieving current system subscription status.');

            /* we need a buffer for 'subscription-manager status' output, since that can fail with a return code != 0
             * even if we need its output (no valid subscription)
             */
            var status_buffer = '';
            /* TODO DBus API doesn't deliver what we need, so we call subscription manager
             * without translations and parse the output
             *
             * 'subscription-manager status' will only return with exit code 0 if all is well (and subscriptions current)
             */
            cockpit.spawn(['subscription-manager', 'status'],
                    { directory: '/', superuser: true, environ: ['LC_ALL=C'], error: "output" })
                .stream(function(text) {
                    status_buffer += text;
                    return text.length;
                }).done(function(text) {
                    process_status_output(status_buffer + text, '');
                }).fail(function(ex) {
                    process_status_output(status_buffer, ex);
                });
        }

        /* request update via DBus */
        function update_subscriptions() {
            status_update_requested = false;
            var call = service.call(
                '/EntitlementStatus',
                'com.redhat.SubscriptionManager.EntitlementStatus',
                'check_status',
                []);
            update_timeout = window.setTimeout(status_update_failed, 10000);
        }

        function register_system(url, username, password) {
            if (action_in_progress()) {
                console.log(_('Unable to register at this time because a call to subscription manager ' +
                  'is already in progress. Please try again.'));
                return;
            }
            /* remove old errors */
            remove_notifications();

            system_unregistered.hide();
            var registering_system = $('#subscriptions-registering');
            registering_system.show();
            var btn = $('#account-register-start');
            btn.prop("disabled", true);

            var args = ['subscription-manager', 'register', '--auto-attach'];
            if (url !== null)
                args.push('--serverurl=' + url);
            /* if username or password are empty, subscription-manager will prompt for them
             * so we always need to pass them
             */
            args.push('--username=' + username);
            args.push('--password=' + password);

            /* TODO DBus API doesn't deliver what we need, so we call subscription manager
             * without translations and parse the output
             */
            var buffer = '';
            var process = cockpit.spawn(args, { directory: '/', superuser: true, environ: ['LC_ALL=C'], error: "output" })
                .stream(function(text) {
                    buffer += text;
                    return text.length;
                }).done(function(output) {
                    registering_system.hide();
                    btn.prop("disabled", false);

                    $('#subscriptions-register-dialog').modal('hide');
                    /* trigger update just in case */
                    update_subscriptions();
                })
                .fail(function(ex) {
                    registering_system.hide();
                    btn.prop("disabled", false);

                    /* detect error types we recognize, fall back is generic error */
                    var invalid_username_string = 'Invalid username or password.';
                    var invalid_credentials_string = 'Invalid Credentials';
                    var details = $('#subscriptions-register-password-note-details');
                    if (buffer.indexOf(invalid_username_string) === 0) {
                        $('#subscriptions-register-password-note').show();
                        $('#subscription-register-username').parent().addClass('has-error');
                        $('#subscription-register-password').parent().addClass('has-error');
                        details.text(buffer.substring(invalid_username_string.length).trim());
                        details.show();
                    } else if (buffer.indexOf(invalid_credentials_string) === 0) {
                        $('#subscriptions-register-password-note').show();
                        $('#subscription-register-username').parent().addClass('has-error');
                        $('#subscription-register-password').parent().addClass('has-error');
                        /* if there is more to the message, show that */
                        var remainder = buffer.substring(invalid_username_string.length).trim();
                        if (remainder !== '') {
                          details.text(remainder);
                          details.show();
                        }
                    } else if (buffer.indexOf('Unable to reach the server at') === 0) {
                        $('#subscriptions-register-url-note').show();
                        $('#subscription-register-url-custom').parent().addClass('has-error');
                        $('#subscriptions-register-url-message').text(buffer.trim());
                    } else if (buffer.indexOf('The system has been registered') === 0) {
                        /* currently we don't separate registration & subscription
                         * our auto-attach may have failed, but message tells us that registration was successful
                         * close the dialog and update status!
                         */
                        registering_system.hide();
                        btn.prop("disabled", false);

                        $('#subscriptions-register-dialog').modal('hide');
                        /* trigger update just in case */
                        update_subscriptions();
                    } else {
                        var note = $('#subscriptions-register-general-error');
                        note.text(buffer.trim());
                        note.parent().show();
                    }

                    system_unregistered.show();
                });

            /* make sure it doesn't ask us for input */
            process.input('');
        }

        /* we want to get notified if subscription status of the system changes */
        service.subscribe(
            { path: '/EntitlementStatus',
              interface: 'com.redhat.SubscriptionManager.EntitlementStatus',
              member: 'entitlement_status_changed'
            },
            function(path, dbus_interface, signal, args) {
                update_timeout = null;
                /*
                 * status has changed, now get actual status via command line
                 * since older versions of subscription-manager don't deliver this via DBus
                 * note: subscription-manager needs superuser privileges
                 */

                /* if we're already waiting for a result, don't call again */
                if (action_in_progress()) {
                    status_update_requested = true;
                    return;
                }
                get_subscription_status();

            });

        /* ideally we could get detailed subscription info via DBus, but we
         * can't rely on this being present on all systems we work on
         */
        /*service.subscribe(
            { path: "/EntitlementStatus",
              interface: "org.freedesktop.DBUS.Properties",
              member: "PropertiesChanged"
            }, function(path, interface, signal, args) {
            current.text('got properties');
        });*/

        $('#subscriptions-register').on('click', function() {
            $('#subscriptions-register-dialog').modal('show');
        });

        /* once we have a proper DBus API, we can trigger an update via DBus - update_subscriptions()
         * for now, read the relevant information directly to avoid delay
         */
        if (update_info) {
            get_subscription_status();
        }

        return {
            'update_subscriptions': update_subscriptions,
            'get_status':           get_overall_status,
            'register_system':      register_system
        };
    }

    register_dialog_initialize();

    subscriptions.register = function() {
        $('#subscriptions-register-dialog').modal('show');
    };

    subscriptions.init = function(retrieve_current) {
        if (retrieve_current === undefined)
            retrieve_current = true;

        var custom_url = $('#subscription-register-url-custom');
        var url_selector = $('#subscription-register-url');
        var note = $('#subscriptions-register-url-message');
        custom_url.hide();
        url_selector.on('change', function() {
            if (url_selector.val() === 'Default') {
                custom_url.hide();
                note.hide();
            } else {
                custom_url.show();
                custom_url.focus();
                custom_url.select();
                if (custom_url.parent().hasClass('has-error'))
                  note.show();
            }
        });
        url_selector.selectpicker('refresh');
        subscriptions.manager = subscription_manager(retrieve_current);
    };

    return subscriptions;
});
