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
import $ from "jquery";
import cockpit from "cockpit";

/*
 * INITIALIZATION AND NAVIGATION
 *
 * The code above still uses the legacy 'Page' abstraction for both
 * pages and dialogs, and expects page.setup, page.enter, page.show,
 * and page.leave to be called at the right times.
 *
 * We cater to this with a little compatability shim consisting of
 * 'dialog_setup', 'page_show', and 'page_hide'.
 */

export function page_show(p, arg) {
    if (!p._entered_) {
        p.enter(arg);
    }
    p._entered_ = true;
    $('#' + p.id)
            .show()
            .removeAttr("hidden");
    p.show();
}

export function set_page_link(element_sel, page, text) {
    if (cockpit.manifests[page]) {
        var link = document.createElement("a");
        link.innerHTML = text;
        link.tabIndex = 0;
        link.addEventListener("click", function() { cockpit.jump("/" + page) });
        $(element_sel).html(link);
    } else {
        $(element_sel).text(text);
    }
}

export function dialog_setup(d) {
    d.setup();
    $('#' + d.id)
            .on('show.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.enter();
            })
            .on('shown.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.show();
            })
            .on('hidden.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.leave();
            });
}

export function page_hide(p) {
    $('#' + p.id).hide();
}
