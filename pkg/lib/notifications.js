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

import cockpit from "cockpit";

class PageStatus {
    constructor() {
        cockpit.event_target(this);
        window.addEventListener("storage", event => {
            if (event.key == "cockpit:page_status")
                this.dispatchEvent("changed");
        });
    }

    get(page, host) {
        let page_status;
        if (host === undefined)
            host = cockpit.transport.host;

        try {
            page_status = JSON.parse(sessionStorage.getItem("cockpit:page_status"));
        } catch {
            return null;
        }

        if (page_status && page_status[host])
            return page_status[host][page] || null;
        return null;
    }

    set_own(status) {
        cockpit.transport.control("notify", { "page_status": status });
    }
}

export const page_status = new PageStatus();
