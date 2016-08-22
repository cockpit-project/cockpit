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

    var machis = require("machines");
    var credentials = require("credentials");
    var mdialogs = require("machine-dialogs");

    var indexes = require("./indexes");

    var shell_embedded = window.location.pathname.indexOf(".html") !== -1;

    var machines = machis.instance();
    var loader = machis.loader(machines);
    var dialogs = mdialogs.new_manager(machines);

    credentials.setup();

    var options = {
        brand_sel: "#index-brand",
        logout_sel: "#go-logout",
        oops_sel: "#navbar-oops",
        language_sel: "#display-language",
        about_sel: "#about-version",
        account_sel: "#go-account",
        user_sel: "#content-user-name",
        default_title: "Cockpit"
    };

    indexes.machines_index(options, machines, loader, dialogs);
}());
