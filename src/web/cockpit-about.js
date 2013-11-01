/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

PageAbout.prototype = {
    _init: function() {
        this.id = "about";
    },

    getTitle: function() {
        return C_("page-title", "About Cockpit");
    },

    enter: function(first_visit) {
        // Note: we may not have D-Bus connection available (could be invoked from
        // the login page) so we need to use the cockpitdyn.js mechanism to obtain
        // info to display

        $("#about-version").empty();
        $("#about-version").append(document.createTextNode(cockpitdyn_version));
        $("#about-build-info").empty();
        $("#about-build-info").append(document.createTextNode(cockpitdyn_build_info));
    },

    show: function() {
    },

    leave: function() {
    }
};

function PageAbout() {
    this._init();
}

cockpit_pages.push(new PageAbout());
