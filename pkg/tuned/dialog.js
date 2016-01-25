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

define([
    "jquery",
    "base1/cockpit",
    "base1/mustache",
    "system/service",
    "data!./button.html",
    "data!./dialog.html",
    "base1/patterns",
    "base1/bootstrap-select",
], function($, cockpit, mustache, service, button_html, dialog_tmpl) {
    "use strict";

    var module = { };

    var _ = cockpit.gettext;

    function debug() {
        if (window.debugging == "all" || window.debugging == "tuned")
            console.debug.apply(console, arguments);
    }

    module.button = function button() {
        var tuned_service = service.proxy('tuned.service');
        var element = $(button_html);

        var button = element.find("button");
        var popover = element.find("[data-toggle=popover]");

        /* Tuned doesn't implement the DBus.Properties interface, so
         * we occasionally poll for what we need.
         *
         * Tuned doesn't auto-activate on the bus, so we have to start
         * it explicitly when opening the dialog.
         */

        function poll(tuned) {
            var dfd = $.Deferred();

            $.when(tuned.call('/Tuned', 'com.redhat.tuned.control', 'is_running', []),
                   tuned.call('/Tuned', 'com.redhat.tuned.control', 'active_profile', []),
                   tuned.call('/Tuned', 'com.redhat.tuned.control', 'recommend_profile', []))
                .done(function(is_running_result, active_result, recommended_result) {
                    var is_running = is_running_result[0][0];
                    var active = is_running? active_result[0][0] : "none";
                    var recommended = recommended_result[0][0];

                    dfd.resolve("running", active, recommended);
                })
                .fail(function(ex) {
                    tuned_service.wait(function () {
                        if (!tuned_service.exists)
                            dfd.resolve("not-installed");
                        else if (tuned_service.state != "running")
                            dfd.resolve("not-running");
                        else
                            dfd.reject(ex);
                    });
                });

            return dfd.promise();
        }

        function update_button() {
            var tuned = cockpit.dbus('com.redhat.tuned', { superuser: true });

            function set_status(text) {
                if (text != popover.attr('data-content')) {
                    popover.attr('data-content', text);
                    // Refresh the popover if it is open
                    if (popover.data('bs.popover').tip().hasClass('in'))
                        popover.popover('show');
                }
            }

            poll(tuned)
                .done(function (state, active, recommended) {
                    var status;

                    if (state == "not-installed")
                        status = _("Tuned is not available");
                    else if (state == "not-running")
                        status = _("Tuned is not running");
                    else if (active == "none")
                        status = _("Tuned is off");
                    else if (active == recommended)
                        status = _("This system is using the recommended profile");
                    else
                        status = _("This system is using a custom profile");

                    button.text(state == "running"? active : "none");
                    button.prop('disabled', state == "not-installed");
                    set_status(status);
                })
                .fail(function (ex) {
                    console.warn("failed to poll tuned", ex);
                    button.text("error");
                    button.prop('disabled', true);
                    set_status(_("Communication with tuned has failed"));
                });
        }

        var dialog = null;

        function create_dialog(profiles) {
            if (dialog)
                dialog.remove();
            dialog = $(mustache.render(dialog_tmpl, { Profiles: profiles }));
            dialog.appendTo("body");
            dialog.on('hide.bs.modal', function() {
                dialog.remove();
                dialog = null;
            });
            return dialog;
        }

        function open_dialog() {
            var tuned;

            function set_profile(profile) {
                if (profile == "none") {
                    return tuned.call('/Tuned', 'com.redhat.tuned.control', 'stop', []);
                } else {
                    return (tuned.call('/Tuned', 'com.redhat.tuned.control', 'switch_profile',
                                       [ profile ])
                            .then(function (results) {
                                if (!results[0][0])
                                    return [ false, results[0][1] ];
                                else
                                    return tuned.call('/Tuned', 'com.redhat.tuned.control', 'start', []);
                            }));
                }
            }

            function with_info(active, recommended, profiles) {
                var model = [];
                profiles.forEach(function(p) {
                    var name, desc;
                    if (typeof p === "string") {
                        name = p;
                        desc = "";
                    } else {
                        name = p[0];
                        desc = p[1];
                    }
                    if (name != "none") {
                        model.push({
                            profile: name,
                            Title: name,
                            Description: desc,
                            recommended: name == recommended
                        });
                    }
                });

                model.unshift({ profile: "none", Title: _("None"), Description: _("Disable tuned") });

                dialog = create_dialog(model);
                dialog.find('[data-profile="' + active + '"]').addClass('active');
                dialog.find('[data-profile]').on('click', function () {
                    dialog.dialog('failure', null);
                    dialog.find('[data-profile]').removeClass('active');
                    $(this).addClass('active');
                });

                dialog.find('.cancel').on('click', function () {
                    dialog.modal('hide');
                });

                dialog.find('.apply').on('click', function () {
                    var requested_profile = dialog.find('[data-profile].active').attr('data-profile');
                    var promise = set_profile(requested_profile)
                        .done(function (results) {
                            if (!results[0])
                                dialog.dialog('failure', results[1] || "Failed to switch profile");
                            else {
                                update_button();
                                dialog.modal('hide');
                            }
                        })
                        .fail(function (ex) {
                            dialog.dialog('failure', ex);
                        });
                    dialog.dialog('wait', promise);
                });

                dialog.modal('show');
            }

            function show_error(error) {
                dialog = create_dialog([ ]);
                dialog.dialog('failure', error);

                dialog.find('.cancel').on('click', function () {
                    dialog.modal('hide');
                });

                dialog.find('.apply').prop('disabled', true);
                dialog.modal('show');
            }

            function tuned_profiles() {
                return tuned.call('/Tuned', 'com.redhat.tuned.control', 'profiles2', [])
                    .then(function(result) {
                        return result[0];
                    }, function() {
                        return tuned.call('/Tuned', 'com.redhat.tuned.control', 'profiles', [])
                            .then(function(result) {
                                return result[0];
                            });
                    });
            }

            function with_tuned() {
                poll(tuned)
                    .done(function (state, active, recommended) {
                        if (state != "running") {
                            show_error(_("Tuned has failed to start"));
                            return;
                        }
                        tuned_profiles().then(function(profiles) {
                            with_info(active, recommended, profiles);
                        }, show_error);
                    })
                    .fail(show_error);
            }

            tuned_service.start()
                .done(function () {
                    update_button();
                    tuned = cockpit.dbus('com.redhat.tuned', { superuser: true });
                    with_tuned();
                })
                .fail(show_error);

            if (!tuned_service.enabled)
                tuned_service.enable();
        }

        button.on('click', open_dialog);

        popover.popover().on('click', update_button);
        update_button();

        return element;
    };

    return module;
});
