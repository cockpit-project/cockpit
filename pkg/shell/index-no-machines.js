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

var phantom_checkpoint = phantom_checkpoint || function () { };

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var indexes = require("./indexes");

    var default_title = "Cockpit";
    var manifest = cockpit.manifests["shell"] || { };
    if (manifest.title)
        default_title = manifest.title;

    indexes.simple_index({
        brand_sel: "#index-brand",
        logout_sel: "#go-logout",
        oops_sel: "#navbar-oops",
        language_sel: "#display-language",
        about_sel: "#about-version",
        default_title: default_title
    });

    var login_data = cockpit.localStorage.getItem('login-data', true);
    if (login_data) {
        var data = JSON.parse(login_data);
        $("#content-user-name").text(data["displayName"]);
    }
}());
