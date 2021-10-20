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

import '../lib/patternfly/patternfly-cockpit.scss';

import { machines } from "./machines/machines";
import * as indexes from "./indexes";

const machines_inst = machines.instance();
const loader = machines.loader(machines_inst);

/* When alt is held down we display debugging menu items */
document.addEventListener("click", function(ev) {
    const visible = !!ev.altKey;
    const advanced = document.querySelectorAll(".navbar-advanced");
    for (let i = 0; i < advanced.length; i++)
        if (visible)
            advanced[i].removeAttribute("hidden");
        else
            advanced[i].setAttribute("hidden", "");
}, true);

const options = {
    logout_sel: "#go-logout",
    oops_sel: "#navbar-oops",
    killer_sel: "#active-pages",
    default_title: "Cockpit",
};

indexes.machines_index(options, machines_inst, loader);
