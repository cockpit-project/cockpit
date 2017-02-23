/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

var cockpit = require("cockpit");

function TtyChannel(opts) {

    /* Options to access the right host and auth */
    var options = {
        host: opts.host,
        user: opts.user,
        password: opts.password,
    };

    var channel = cockpit.channel(cockpit.extend({
        payload: "tty",
    }, options));

    channel.addEventListener("message", function(ev, data) {
        console.log(data);
    });
}

module.exports = {
    tty: function(options) {
        return new TtyChannel(options);
    }
};
