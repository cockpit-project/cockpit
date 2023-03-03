/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

/* NOTIFICATIONS

A page can broadcast notifications to the rest of Cockpit.  For
example, the "Software updates" page can send out a notification when
it detects that software updates are available.  The shell will then
highlight the menu entry for "Software updates" and the "System"
overview page will also mention it in its "Operating system" section.

The details are all still experimental and subject to change.

As a first step, there are only simple "page status" notifications.
When we address "event" style notifications, page status notifications
might become a special case of them.  Or not.

A page status is either null, or a JSON value with the following
fields:

 - type (string, optional)

 If specified, one of "info", "warning", "error".  The shell will put
 an appropriate icon next to the navigation entry for this page, for
 example.

 Omitting 'type' means that the page has no special status and is the
 same as using "null" as the whole status value.  This can be used to
 broadcast values in the 'details' field to other pages without
 forcing an icon into the navigation menu.

 - title (string, optional)

 A short, human readable, localized description of the status,
 suitable for a tooltip.

 - details (JSON value, optional)

 An arbitrary value.  The "System" overview page might monitor a
 couple of pages for their status and it will use 'details' to display
 a richer version of the status than possible with just type and
 title. The recognized properties are:

   * icon: custom icon name (defaults to standard icon corresponding to type)
   * pficon: PatternFly icon name; e.g. "enhancement", "bug", "security", "spinner", "check";
     see get_pficon() in pkg/systemd/page-status.jsx
   * link: custom link target (defaults to page name); if false, the
     notification will not be a link

Usage:

 import { page_status } from "notifications";

 - page_status.set_own(STATUS)

 Sets the status of the page making the call, completely overwriting
 the current status.  For example,

    page_status.set_own({
      type: "info",
      title: _("Software updates available"),
      details: {
        num_updates: 10,
        num_security_updates: 5
      }
    });

    page_status.set_own({
      type: null
      title: _("System is up to date"),
      details: {
        last_check: 81236457
      }
    });

 Calling this function with the same STATUS value multiple times is
 cheap: only the first call will actually broadcast the new status.

 - page_status.get(PAGE, [HOST])

 Retrieves the current status of page PAGE of HOST.  When HOST is
 omitted, it defaults to the default host of the calling page.

 PAGE is the same string that Cockpit uses in its URLs to identify a
 page, such as "system/terminal" or "storage".

 Until the page_status object is fully initialized (see 'valid'
 below), this function will return 'undefined'.

 - page_status.addEventListener("changed", event => { ... })

 The "changed" event is emitted whenever any page status changes.

 - page_status.valid

 The page_status objects needs to initialize itself asynchronously and
 'valid' is false until this is done.  When 'valid' changes to true, a
 "changed" event is emitted.

*/

import cockpit from "cockpit";
import deep_equal from "deep-equal";

class PageStatus {
    constructor() {
        cockpit.event_target(this);
        window.addEventListener("storage", event => {
            if (event.key == "cockpit:page_status") {
                this.dispatchEvent("changed");
            }
        });

        this.cur_own = null;

        this.valid = false;
        cockpit.transport.wait(() => {
            this.valid = true;
            this.dispatchEvent("changed");
        });
    }

    get(page, host) {
        let page_status;

        if (!this.valid)
            return undefined;

        if (host === undefined)
            host = cockpit.transport.host;

        try {
            page_status = JSON.parse(sessionStorage.getItem("cockpit:page_status"));
        } catch {
            return null;
        }

        if (page_status?.[host])
            return page_status[host][page] || null;
        return null;
    }

    set_own(status) {
        if (!deep_equal(status, this.cur_own)) {
            this.cur_own = status;
            cockpit.transport.control("notify", { page_status: status });
        }
    }
}

export const page_status = new PageStatus();
