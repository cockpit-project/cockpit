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

import $ from "jquery";
import cockpit from "cockpit";

import { machines } from "machines";
import { new_machine_dialog_manager } from "machine-dialogs";

import * as indexes from "./indexes";

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
    default_title: default_title,
    skip_brand_title: true
};

/* When alt is held down we display debugging menu items */
document.addEventListener("click", function(ev) {
    var i;
    var visible = !!ev.altKey;
    var advanced = document.querySelectorAll(".navbar-advanced");
    for (i = 0; i < advanced.length; i++)
        advanced[i].style.display = visible ? "block" : "none";
}, true);

var machines_inst = machines.instance();
var loader = machines.loader(machines_inst, true);
var dialogs = new_machine_dialog_manager(machines_inst, {
    "no-cockpit": "not-supported",
    "not-supported": "not-supported",
    "protocol-error": "not-supported",
    "authentication-not-supported": "change-auth",
    "authentication-failed": "change-auth",
    "no-forwarding": "change-auth",
    "unknown-hostkey": "unknown-hostkey",
    "unknown-host": "unknown-host",
    "invalid-hostkey": "invalid-hostkey",
    "no-host": "change-port",
});

indexes.machines_index(options, machines_inst, loader, dialogs);

var login_data = cockpit.localStorage.getItem('login-data', true);
if (login_data) {
    var data = JSON.parse(login_data);
    $("#content-user-name").text(data["displayName"]);
}
