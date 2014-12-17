/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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
    "latest/cockpit",
    "latest/po"
], function($, cockpit, po) {
    "use strict";

    var _ = cockpit.locale(po).gettext;

    var rolekit = { };

    function debug() {
        if (window.debugging == "all" || window.debugging == "rolekit")
            console.debug.apply(console, arguments);
    }

    function name_to_label(name) {
        return name;
    }

    rolekit.discover = function discover(address, callback) {
        var self = this;

        var client;
        var waiting = true;
        var objects = { };
        var store = { };

        store[address] = { address: address, objects: objects };

        var result = {
            close: function() {
                if (client)
                    client.close();
            }
        };

        function send() {
            if (!waiting) {
                console.log("rolekit disco", store);
                callback(store);
            }
        }

        client = cockpit.dbus("org.fedoraproject.rolekit1", { host: address });

        /*
         * TODO: As a demo we're just showing all the roles, really we want to just
         * discover roles that are enrolled here. This is throw away code.
         */

        var roles = client.proxies("org.fedoraproject.rolekit1.role");
        $(roles).on("added changed", function(event, proxy) {
            var name = proxy.data.name;
            if (event.type == "added") {
                objects[proxy.path] = {
                    location: "role/" + name,
                    internal: proxy.data,
                    state: "running" /* TODO: A bold faced lie */
                };
            }
            if (name === "domaincontroller")
                objects[proxy.path].label = _("IPA Domain Controller");
            else
                objects[proxy.path].label = name;
            send();
        });
        $(roles).on("removed", function(event, proxy) {
            delete objects[proxy.path];
            send();
        });

        roles.wait(function() {
            waiting = false;
            send();
        });

        return result;
    };

    return rolekit;
});
