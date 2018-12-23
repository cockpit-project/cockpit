/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import cockpit from "cockpit";

function Privileges() {
    var self = this;
    var locked = null;

    function clicked(ev) {
        cockpit.drop_privileges(false);
        ev.preventDefault();
    }

    function display() {
        var i;
        var locks = document.querySelectorAll(".credential-lock");
        for (i = 0; i < locks.length; i++) {
            var lock = locks[i];
            if (locked !== true)
                lock.classList.remove("credential-locked");
            else if (locked === true)
                lock.classList.add("credential-locked");
            if (locked !== false)
                lock.classList.remove("credential-unlocked");
            else if (locked === false)
                lock.classList.add("credential-unlocked");
        }

        var clear = document.querySelectorAll(".credential-clear");
        for (i = 0; i < clear.length; i++)
            clear[i].onclick = clicked;
    }

    self.update = function update(hint) {
        if (hint.credential == "password") {
            locked = false;
        } else if (hint.credential == "request") {
            if (locked === null)
                locked = true;
        } else if (hint.credential == "none") {
            locked = null;
        }
        display();
    };

    /* No op authorize command to poke about state */
    cockpit.transport.control("authorize");
}

var privileges = null;

export function instance() {
    if (!privileges)
        privileges = new Privileges();
    return privileges;
}
