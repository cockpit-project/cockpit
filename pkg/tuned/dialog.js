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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var dialog_view = require("cockpit-components-dialog.jsx");
    var service = require("service");
    var React = require("react");

    var change_profile = require("./change-profile.jsx");

    var _ = cockpit.gettext;

    function setup() {

        var tuned_service = service.proxy('tuned.service');

        var element = $(require("raw!./link.html"));

        var button = element.find(".action-trigger");
        var popover = element.find("[data-toggle=popover]");

        /* Tuned doesn't implement the DBus.Properties interface, so
         * we occasionally poll for what we need.
         *
         * Tuned doesn't auto-activate on the bus, so we have to start
         * it explicitly when opening the dialog.
         */

        function poll(tuned) {
            var dfd = cockpit.defer();

            cockpit.all(tuned.call('/Tuned', 'com.redhat.tuned.control', 'is_running', []),
                        tuned.call('/Tuned', 'com.redhat.tuned.control', 'active_profile', []),
                        tuned.call('/Tuned', 'com.redhat.tuned.control', 'recommend_profile', []))
                .done(function(is_running_result, active_result, recommended_result) {
                    var is_running = is_running_result[0];
                    var active = is_running? active_result[0] : "none";
                    var recommended = recommended_result[0];

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

                    button.text(state == "running"? active : _("none"));
                    button.prop('disabled', state == "not-installed");
                    button.toggleClass('disabled', state == "not-installed");
                    set_status(status);
                })
                .fail(function (ex) {
                    console.warn("failed to poll tuned", ex);
                    button.text("error");
                    button.prop('disabled', true);
                    button.toggleClass('disabled', true);
                    set_status(_("Communication with tuned has failed"));
                });
        }

        function open_dialog() {
            var tuned;
            var dialog_selected;

            function set_profile() {
                // no need to check input here, all states are valid
                var profile = dialog_selected;
                var promise;

                if (profile == "none") {
                    promise = tuned.call("/Tuned", 'com.redhat.tuned.control', 'disable', [])
                        .then(function(results) {
                            /* Yup this is how tuned returns failures */
                            if (!results[0]) {
                                console.warn("Failed to disable tuned profile:", results);
                                return cockpit.reject(_("Failed to disable tuned profile"));
                            }

                            update_button();
                        });
                } else {
                    promise = tuned.call('/Tuned', 'com.redhat.tuned.control', 'switch_profile', [ profile ])
                        .then(function(results) {

                            /* Yup this is how tuned returns failures */
                            if (!results[0][0]) {
                                console.warn("Failed to switch profile:", results);
                                return cockpit.reject(results[0][1] || _("Failed to switch profile"));
                            }

                            update_button();
                        });
                }

                return promise.then(set_service);
            }

            function set_service() {
                /* When the profile is none we disable tuned */
                var enable = (dialog_selected != "none");
                var action = enable ? "start" : "stop";
                return tuned.call('/Tuned', 'com.redhat.tuned.control', action, [])
                    .then(function(results) {
                        var msg;

                        /* Yup this is how tuned returns failures */
                        if (!results[0]) {
                            console.warn("Failed to " + action + " tuned:", results);
                            if (results[1])
                                return cockpit.reject(results[1]);
                            else if (enable)
                                return cockpit.reject(cockpit.format(_("Failed to enable tuned")));
                            else
                                return cockpit.reject(cockpit.format(_("Failed to disable tuned")));
                        }

                        /* Now tell systemd about this change */
                        if (enable && !tuned_service.enabled)
                            return tuned_service.enable();
                        else if (!enable && tuned_service.enabled)
                            return tuned_service.disable();
                        else
                            return null;
                    });
            }

            function update_selected_item(selected) {
                dialog_selected = selected;
            }

            function create_dialog(profiles, active_profile, primary_disabled, static_error) {
                dialog_selected = active_profile;
                var dialog_props = {
                    'title': _("Change Performance Profile"),
                    'body': React.createElement(change_profile.dialog, {
                            'active_profile': active_profile,
                            'change_selected': update_selected_item,
                            'profiles': profiles,
                        }),
                };
                var footer_props = {
                    'actions': [ { 'clicked': set_profile,
                                   'caption': _("Change Profile"),
                                   'style': 'primary',
                                  }
                                ],
                    'static_error': static_error,
                };
                dialog_view.show_modal_dialog(dialog_props, footer_props);
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
                            name: name,
                            title: name,
                            description: desc,
                            active: name == active,
                            recommended: name == recommended,
                        });
                    }
                });

                model.unshift({
                    name: "none",
                    title: _("None"),
                    description: _("Disable tuned"),
                    active: "none" == active,
                    recommended: "none" == recommended,
                });

                create_dialog(model, active);
            }

            function show_error(error) {
                create_dialog([ ], "none", true, error);
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
        }

        button.on('click', open_dialog);

        popover.popover().on('click', update_button);
        update_button();

        return element[0];
    }

    /* Hook this in when loaded */
    $(function() {
        var placeholder = $("#system-info-performance");
        if (placeholder.length) {
            placeholder.find(".button-location").append(setup());
            placeholder.removeAttr('hidden');
        }
    });

}());
