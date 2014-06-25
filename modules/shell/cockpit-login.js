/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

var cockpit = cockpit || { };

(function(cockpit, $) {

$(function() {
    $(".cockpit-deauthorize-item a").on("click", function(ev) {
        var req = new XMLHttpRequest();
        var loc = window.location.protocol + "//" + window.location.host + "/deauthorize";
        req.open("POST", loc, true);
        req.onreadystatechange = function (event) {
            if (req.readyState == 4) {
                $(".cockpit-deauthorize-item").addClass("disabled");
                $(".cockpit-deauthorize-item a").off("click");

                /* TODO: We need a better indicator for deauthorized state */
                $(".cockpit-deauthorize-status").text("deauthorized");
            }
        };
        req.send();
        ev.preventDefault();
    });
});

}(cockpit, jQuery));

function cockpit_logout (reason)
{
    var req = new XMLHttpRequest();
    var loc = window.location.protocol + "//" + window.location.host + "/logout";
    req.open("POST", loc, true);
    req.onreadystatechange = function (event) {
	if (req.readyState == 4) {
            cockpit.set_watched_client(null);
            window.location.reload(true);
        }
    };
    req.send();
}

function cockpit_go_login_account ()
{
    cockpit_go_server ("localhost",
                       [ { page: "accounts" },
                         { page: "account", id: cockpit.connection_config.user }
                       ]);
}
