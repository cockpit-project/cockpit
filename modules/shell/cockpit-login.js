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
        /* Ensure Channel.transport is not null */
        var channel = new Channel({ "payload": "null" });
        Channel.transport.logout(false);
        channel.close();
        $(".cockpit-deauthorize-item").addClass("disabled");
        $(".cockpit-deauthorize-item a").off("click");

        /* TODO: We need a better indicator for deauthorized state */
        $(".cockpit-deauthorize-status").text("deauthorized");
        ev.preventDefault();
    });

    var is_root = cockpit.connection_config.user == "root";
    $('#cockpit-go-account').toggle(!is_root);
    $('#cockpit-change-passwd').toggle(is_root);
});

}(cockpit, jQuery));

function cockpit_logout (reason)
{
    var channel = new Channel({ "payload": "null" });
    $(channel).on("close", function() {
        window.location.reload(true);
    });
    cockpit.set_watched_client(null);
    Channel.transport.logout(true);
}

function cockpit_go_login_account ()
{
    cockpit.go_server("localhost",
                       [ { page: "accounts" },
                         { page: "account", id: cockpit.connection_config.user }
                       ]);
}
