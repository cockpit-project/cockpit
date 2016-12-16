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

    var client = require("./client");
    var jobs = require("./jobs");
    var overview = require("./overview");
    var details = require("./details");
    var utils = require("./utils");

    require("page.css");
    require("table.css");
    require("plot.css");
    require("journal.css");
    require("./storage.css");

    var _ = cockpit.gettext;

    /* INITIALIZATION AND NAVIGATION
     */

    function init() {
        var jobs_manager;
        var overview_page;
        var details_page;

        $('body').on('click', '[data-goto-block]', function () {
            cockpit.location.go([ $(this).attr('data-goto-block') ]);
        });

        $('body').on('click', '[data-goto-mdraid]', function () {
            cockpit.location.go([ 'mdraid', $(this).attr('data-goto-mdraid') ]);
        });

        $('body').on('click', '[data-goto-vgroup]', function () {
            cockpit.location.go([ 'vg', $(this).attr('data-goto-vgroup') ]);
        });

        utils.init_arming_zones($('body'));

        function navigate() {
            var path = cockpit.location.path;

            if (path.length === 0) {
                details_page.hide();
                overview_page.show();
            } else if (path.length == 1) {
                overview_page.hide();
                details_page.show('block', path[0]);
            } else if (path.length == 2 && path[0] == 'mdraid') {
                overview_page.hide();
                details_page.show('mdraid', path[1]);
            } else if (path.length == 2 && path[0] == 'vg') {
                overview_page.hide();
                details_page.show('vgroup', path[1]);
            } else { /* redirect */
                console.warn("not a init location: " + path);
                cockpit.location = '';
            }
            $("body").show();
        }

        client.init(function () {
            cockpit.translate();
            if (client.features === false) {
                $('#unsupported').show();
                $("body").show();
            } else {
                jobs_manager = jobs.init(client);
                overview_page = overview.init(client, jobs_manager);
                details_page = details.init(client, jobs_manager);
                $(cockpit).on("locationchanged", navigate);
                navigate();
            }
        });

        // Watching multipath for brokeness

        var multipathd_service = utils.get_multipathd_service();

        function update_multipath_broken() {
            // When in doubt, assume everything is alright
            var multipathd_running = !multipathd_service.state || multipathd_service.state === "running";
            var multipath_broken = client.broken_multipath_present === true;
            $('#multipath-broken').toggle(multipath_broken && !multipathd_running);
        }

        $(multipathd_service).on('changed', update_multipath_broken);
        $(client).on('changed', update_multipath_broken);
        update_multipath_broken();

        $('#activate-multipath').on('click', function () {
            cockpit.spawn([ "mpathconf", "--enable", "--with_multipathd", "y" ],
                          { superuser: "try"
                          }).
                fail(function (error) {
                    $('#error-popup-title').text(_("Error"));
                    $('#error-popup-message').text(error.toString());
                    $('#error-popup').modal('show');
                });
        });
    }

    $(init);
}());
