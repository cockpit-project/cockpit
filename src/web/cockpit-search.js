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

function cockpit_search_init (element) {
    element.on('keydown', function (e) {
        if (e.which == 13)
            cockpit_search (element.val());
    });
    element.on('change', function (e) {
        cockpit_search (element.val());
    });
}

function cockpit_search (string) {
    function startsWith(str, prefix) {
        return str.substring(str, prefix.length) == prefix;
    }

    var prio = 3, start = 'oldest', loc;
    if (cockpit_get_page_param ('page') == 'journal') {
        prio = cockpit_get_page_param ('prio');
        start = cockpit_get_page_param ('start');
    }

    if (startsWith (string, "service:"))
        loc = { page: "journal", prio: prio, start: start, service: string.substring(8) };
    else
        loc = { page: "journal", prio: prio, start: start, search: string };

    cockpit_go ([ { page: "dashboard" },
                  { page: "server", machine: cockpit_dbus_client.target },
                  loc
                ]);
}
