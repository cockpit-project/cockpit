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

(function(cockpit, $) {

PageAbout.prototype = {
    _init: function() {
        this.id = "about";
    },

    enter: function() {
        $("#about-version").empty();
        $("#about-version").append(document.createTextNode(cockpit.info["version"]));
        $("#about-build-info").empty();
        $("#about-build-info").append(document.createTextNode(cockpit.info["build"]));
    },

    show: function() {
    },

    leave: function() {
    }
};

function PageAbout() {
    this._init();
}

cockpit.dialogs.push(new PageAbout());

})(cockpit, jQuery);
