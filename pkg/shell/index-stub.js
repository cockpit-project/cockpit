/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

    var machis = require("machines");
    var mdialogs = require("machine-dialogs");

    var indexes = require("./indexes");

    var default_title = "Cockpit";
    var manifest = cockpit.manifests["shell"] || { };
    if (manifest.title)
        default_title = manifest.title;

    var options = {
        brand_sel: "#index-brand",
        logout_sel: "#go-logout",
        oops_sel: "#navbar-oops",
        language_sel: "#display-language",
        about_sel: "#about-version",
        default_title: default_title
    };
    var machines = machis.instance();
    machines.overlay("localhost", { "label": default_title,
                                    "static_hostname": true });

    var loader = machis.loader(machines, true);
    var dialogs = mdialogs.new_manager(machines, {
        "no-cockpit": "not-supported",
        "not-supported": "not-supported",
        "protocol-error": "not-supported",
        "authentication-not-supported": "change-auth",
        "authentication-failed": "change-auth",
        "no-forwarding": "change-auth",
        "unknown-hostkey": "unknown-hostkey",
        "invalid-hostkey": "invalid-hostkey",
        "no-host": "change-port",
    });

    indexes.machines_index(options, machines, loader, dialogs);

    var login_data = cockpit.localStorage.getItem('login-data', true);
    if (login_data) {
        var data = JSON.parse(login_data);
        $("#content-user-name").text(data["displayName"]);
    }
}());
