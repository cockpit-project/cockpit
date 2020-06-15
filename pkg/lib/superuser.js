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

/* import { superuser } from "superuser";
 *
 * The "superuser" object indicates whether or not the current page
 * can open superuser channels.
 *
 * - superuser.allowed
 *
 * This is true when the page can open superuser channels, and false
 * otherwise. This field might be "null" while the page or the Cockpit
 * session itself is still initializing.
 *
 * UI elements that trigger actions that need administrative access
 * should be hidden when the "allowed" field is false or null.  (If
 * those elements also show information, such as with checkboxes or
 * toggle buttons, disable them instead of hiding.)
 *
 * UI elements that alert the user that they don't have administrative
 * access should be shown when the "allowed" field is exactly false,
 * but not when it is null.
 *
 * - superuser.addEventListener("changed", () => ...)
 *
 * The event handler is called whenever superuser.allowed has changed.
 * A page should update its appearance according to superuser.allowed,
 * and it should also re-initialize itself by opening all "superuser"
 * channels again that are currently open.
 *
 * - superuser.reload_page_on_change()
 *
 * Calling this function instructs the "superuser" object to reload
 * the page whenever "superuser.allowed" changes. This is a (bad)
 * alternative to re-initializing the page and intended to be used
 * only to help with the transition.
 *
 * Even if you are using "superuser.reload_page_on_change" to avoid having
 * to re-initialize your page dynamically, you should still use the
 * "changed" event to update the page appearance since
 * "superuser.allowed" might still change a couple of times right
 * after page reload.
 */

function Superuser() {
    const proxy = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser", "/superuser");
    let reload_on_change = false;

    const compute_allowed = () => {
        if (!proxy.valid || proxy.Current == "init")
            return null;
        return proxy.Current != "none";
    };

    const self = {
        allowed: compute_allowed(),
        reload_page_on_change: reload_page_on_change
    };

    cockpit.event_target(self);

    proxy.wait(() => {
        if (!proxy.valid) {
            // Fall back to cockpit.permissions
            const permission = cockpit.permission({ admin: true });
            const changed = () => {
                self.allowed = permission.allowed;
                self.dispatchEvent("changed");
            };
            permission.addEventListener("changed", changed);
            changed();
        }
    });

    proxy.addEventListener("changed", () => {
        const allowed = compute_allowed();
        if (self.allowed != allowed) {
            if (self.allowed != null && reload_on_change) {
                window.location.reload(true);
            } else {
                self.allowed = allowed;
                self.dispatchEvent("changed");
            }
        }
    });

    function reload_page_on_change() {
        reload_on_change = true;
    }

    return self;
}

export const superuser = Superuser();
