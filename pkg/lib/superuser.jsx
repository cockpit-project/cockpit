/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

/* import { superuser } from "superuser.jsx";
 *
 * The "superuser" object indicates whether or not the current page
 * can open superuser channels.
 *
 * - superuser.allowed
 *
 * This is true when the page can open superuser channels, and false
 * otherwise.  Right after page load, this field might be "null" until
 * the real value has been received.
 *
 * - superuser.addEventListener("changed", () => ...)
 *
 * The event handler is called whenever superuser.allowed has changed.
 * A page should update its appearance according to superuser.allowed,
 * and it should also re-initialize itself by opening all "superuser"
 * channels again that are currently open.
 *
 * - superuser.reload_on_change()
 *
 * Calling this function instructs the "superuser" object to reload
 * the page whenever "superuser.allowed" changes. This is a (bad)
 * alternative to re-initializing the page and intended to be used
 * only to help with the transition.
 *
 * Even if you are using "superuser.reload_on_change" to avoid having
 * to re-initialize your page dynamically, you should still use the
 * "changed" event to update the page appearance since
 * "superuser.allowed" might still change a couple of times right
 * after page.
 */

function Superuser() {
    const proxy = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser", "/superuser");
    let reload_on_change = false;

    const self = {
        allowed: proxy.valid ? proxy.Current != "none" : null,

        reload_page_on_change: reload_page_on_change
    };

    cockpit.event_target(self);

    proxy.addEventListener("changed", () => {
        if (proxy.valid) {
            const allowed = proxy.Current != "none";
            if (self.allowed != allowed) {
                if (self.allowed != null && reload_on_change) {
                    window.location.reload(true);
                } else {
                    self.allowed = allowed;
                    self.dispatchEvent("changed");
                }
            }
        }
    });

    function reload_page_on_change() {
        reload_on_change = true;
    }

    return self;
}

export const superuser = Superuser();
