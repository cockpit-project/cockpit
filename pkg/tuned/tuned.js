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

require([
    "jquery",
    "base1/cockpit",
    "system/service",
    "translated!base1/po",
    "base1/patterns",
    "base1/bootstrap-select",
], function($, cockpit, service, po) {
    "use strict";

    cockpit.locale(po);
    cockpit.translate();
    var _ = cockpit.gettext;

    function debug() {
        if (window.debugging == "all" || window.debugging == "tuned")
            console.debug.apply(console, arguments);
    }

    var tuned = cockpit.dbus('com.redhat.tuned');

    /* The current profile */
    var profile = null;
    var failure = null;

    function update() {
        $("body").show();
        $("div.curtains").toggle(!profile);
        $("div.panel").toggle(!!profile);
        $("div.curtains .spinner").toggle(!failure);
        $("div.curtains i").toggle(!!failure);
        $("#tuned-profile-button").text(profile || "");

        if (!failure) {
            $("div.curtains h1").text(_("Connecting to tuned..."));
            $("div.curtains p").text("");
            return;
        }

        var notfound = failure.problem === "not-found";
        $("div.curtains h1").text(_("Failed to connect to tuned"));
        $("div.curtains p").text(notfound ? "" : cockpit.message(failure));
        $("div.curtains button").toggle(notfound);
    }

    /* Tuned doesn't provide GetAll(), so we can't introspect */

    function get_profiles() {
        tuned.call('/Tuned', 'com.redhat.tuned.control', 'profiles', [])
            .done(function(result) {
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
            })
            .fail(function(ex) {
                $("#tuned-change-profile").dialog("failure", ex);
                console.warn(ex);
            });
    }

    function get_profile() {
        tuned.call('/Tuned', 'com.redhat.tuned.control', 'active_profile', [])
            .done(function(result) {
                profile = result[0];
                update();
            })
            .fail(function(ex) {
                failure = ex;
                update();
            });
    }

    $('#tuned-start').on('click', function() {
        failure = null;
        update();
        var proxy = service.proxy("tuned");
        proxy.start()
            .done(function() {
                get_profile();
            })
            .fail(function(ex) {
                failure = ex;
                update();
            })
            .always(function() {
                proxy.close();
                proxy = null;
            });
    });

    $('#tuned-profile-button').on('click', function () {
        get_profiles();
    });

    $('#tuned-recommend-button').on('click', function () {
        tuned.call('/Tuned', 'com.redhat.tuned.control', 'recommend_profile', [])
            .done(function(result) {
                $('#recommend').show();
                $('#recommended-profile').text(result);
            })
            .fail(function(ex) {
                $("#tuned-change-profile").dialog("failure", ex);
            });
    });

    $('#tuned-change-button').on('click', function() {
        var args = [$('#change-tuned').val()];
        var dlg = $("#tuned-change-profile");
        var promise = tuned.call('/Tuned', 'com.redhat.tuned.control', 'switch_profile', args)
            .done(function(result) {
                console.log(result[0]);
                if (!result[0][0])
                    $('#tuned-change-profile').dialog('failure', new Error("Problem applying tuned profile"));
                else
                    dlg.modal('hide');
            })
            .fail(function(ex) {
                dlg.dialog("failure", ex);
            })
            .always(function() {
                get_profile();
            });
        dlg.dialog("wait", promise);
    });

    get_profile();
    window.setTimeout(update, 2000);
});
