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
 * A page should update its appearance according to superuser.allowed.
 *
 * - superuser.addEventListener("reconnect", () => ...)
 *
 * The event handler is called whenever channels should be re-opened
 * that use the "superuser" option.
 *
 * The difference between "reconnect" and "connect" is that the
 * "reconnect" signal does not trigger when superuser.allowed goes
 * from "null" to its first real value.  You don't need to re-open
 * channels in this case, and it happens on every page load, so this
 * is important to avoid.
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
        reload_page_on_change
    };

    cockpit.event_target(self);

    function changed(allowed) {
        if (self.allowed != allowed) {
            if (self.allowed != null && reload_on_change) {
                window.location.reload(true);
            } else {
                const prev = self.allowed;
                self.allowed = allowed;
                self.dispatchEvent("changed");
                if (prev != null)
                    self.dispatchEvent("reconnect");
            }
        }
    }

    proxy.wait(() => {
        if (!proxy.valid) {
            // Fall back to cockpit.permissions
            const permission = cockpit.permission({ admin: true });
            const update = () => {
                changed(permission.allowed);
            };
            permission.addEventListener("changed", update);
            update();
        }
    });

    proxy.addEventListener("changed", () => {
        changed(compute_allowed());
    });

    function reload_page_on_change() {
        reload_on_change = true;
    }

    return self;
}

export const superuser = Superuser();
