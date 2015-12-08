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
    "base1/bootstrap-select",
    "base1/cockpit",
    "translated!base1/po",
    "base1/mustache",
    "base1/patterns"
], function($, cockpit, po, Mustache) {
    "use strict";

    cockpit.locale(po);
    cockpit.translate();
    var _ = cockpit.gettext;

    function debug() {
        if (window.debugging == "all" || window.debugging == "tuned")
            console.debug.apply(console, arguments);
    }

    /*
     * gather and display information regarding tuned profiles
     *
     * update_info: if true, trigger an immediate update of the information
     */
    function tuned(update_info) {
        var service = cockpit.dbus('com.redhat.tuned');
        var profile;

        /* we trigger status update via dbus
         * if we don't get a timely reply, tuned is probably not running
         */
        var update_timeout;

        /* The promise for the last operation */
        var last_promise;

        /* Tuned doesn't provide GetAll(), so we can't introspect */

        //TODO: implement fail() and other bits to make this nicer
        function wrapper(method, args, cb) {
            if (args === null)
                args = []
            var call = service.call(
                '/Tuned',
                'com.redhat.tuned.control',
                method,
                args).
                done(function(result) { cb(result);});
        }

        function get_profiles() {
            wrapper('profiles', [], function(result) {
                var profiles = result.toString().split(',');
                $('#change-tuned').empty();
                for (var i = 0; i < profiles.length; i++) {
                    $('#change-tuned').append($('<option>', {
                        value: profiles[i],
                        text: profiles[i],
                        selected: profiles[i] === profile
                    }));
                }
                $('.selectpicker').selectpicker('refresh');
            });
        }

        function get_profile() {
            var call = service.call(
                '/Tuned',
                'com.redhat.tuned.control',
                'active_profile',
                []).
                    done(function(result) {
                        update_timeout = null,
                        $('#tuned-profile-button').text(result);
                        profile = result[0];
                        $('#tuned-system-status').show();
                    });
            update_timeout = window.setTimeout(status_update_failed, 10000);
        }

        function status_update_failed() {
            if (update_timeout !== null) {
                $('#tuned-not-found').show();
            }
            update_timeout = null;
        }

        function remove_notifications() {
            $('div.container-fluid.alert').remove();
        }

        $('#tuned-start').on('click', function() {

            var proc = cockpit.spawn(["systemctl", "restart", "tuned.service"]).
                    done(function() {});
        });

        $('#tuned-profile-button').on('click', function () {
            get_profiles();
        });

        $('#tuned-recommend-button').on('click', function () {
            wrapper('recommend_profile', [], function(result) {
                $('#recommended-profile').text(result);
            });
            $('#recommend').show();
        });

        $('#tuned-change-button').on('click', function() {
            wrapper('switch_profile', [$('#change-tuned').val()], function cb(result) {
                console.warn(result[0]);
                if (!result[0][0]) {
                    $('#tuned-change-profile').dialog('failure', new Error("Problem applying tuned profile"));
                    //TODO: log errors
                }
                $('#tuned-change-profile').modal('hide');
            });
        });

        if (update_info) {
            get_profile();
        }

        return {
            'get_profiles': get_profiles,
        };
    }

    tuned.register = function() {
        $('#subscriptions-register-dialog').modal('show');
    };

    tuned.init = function(retrieve_current) {
        if (retrieve_current === undefined)
            retrieve_current = true;

        var profile_selector = $('#subscription-register-url');
        profile_selector.on('change', function() {
            if (url_selector.val() === 'Default') {
                custom_url.hide();
            } else {
                custom_url.show();
                custom_url.focus();
                custom_url.select();
            }
        });
        profile_selector.selectpicker('refresh');
        tuned.profile = tuned(retrieve_current);
    };

    return tuned;
});
