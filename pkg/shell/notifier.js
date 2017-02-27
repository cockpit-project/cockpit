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

    var buffer = "";

    var channel = cockpit.channel(cockpit.extend({
        payload: "tty",
    }, options));

    channel.addEventListener("message", function(ev, data) {
        buffer += data;

        /*
         * When sudo or polkit ask for a prompt on the tty it looks like this:
         * @authorize@user:self@authorize@
         */
        var i, parts = buffer.split("@authorize@");
        for (i = 0; i < parts.length; i += 2) {
            if (i + 2 < parts.length) {
                if (authorize.apply(null, parts[i + 1].split(":"))) {
                    parts[i + 1] = "";
                    while (parts[i + 2].charAt(0) == ' ')
                        parts[i + 2] = parts[i + 2].substr(1);
                }
            }
        }
        buffer = parts.join("");

        /* Now print out the remaining lines */
        var lines = buffer.split("\n");
        buffer = lines.pop();
        for (i = 0; i < lines.length; i++)
            console.log(lines[i]);
    });

    function authorize(user, who) {
        if (user == who) {
            channel.control({ "command": "authorize", "credential": "inject" });
            channel.send("\n");
            return true;
        }
        console.warn("Not reauthorizing due to user mismatch: ", user, who);
        return false;
    }
}

module.exports = {
    tty: function(options) {
        return new TtyChannel(options);
    }
};
