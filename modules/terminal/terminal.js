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

    var term = null;
    var channel = null;

    function show() {
        term = new Terminal({
            cols: 80,
            rows: 24,
            screenKeys: true
        });

        /* term.js wants the parent element to build its terminal inside of */
        term.open($("#rescue-terminal")[0]);

        channel = cockpit.channel({
            /* TODO: */
            "host": "localhost",
            "payload": "text-stream",
            "spawn": ["/bin/bash", "-i"],
            "environ": [
                "TERM=xterm-256color",
                "PATH=/sbin:/bin:/usr/sbin:/usr/bin"
            ],
            "pty": true
        });

        $(channel).
            on("close", function(ev, options) {
                if (term) {
                    var problem = options.reason || "disconnected";
                    term.write('\x1b[31m' + problem + '\x1b[m\r\n');
                    /* There's no term.hideCursor() function */
                    term.cursorHidden = true;
                    term.refresh(term.y, term.y);
                }
            }).
            on("message", function(ev, payload) {
                /* Output from pty to terminal */
                if (term)
                    term.write(payload);
            });

        term.on('data', function(data) {
            /* Output from terminal to pty */
            if (channel && channel.valid)
                channel.send(data);
        });
    }

    function hide() {
        if (term) {
            term.destroy();
            term = null;
        }
        if (channel) {
            if (channel.valid)
                channel.close(null);
            channel = null;
        }
    }

    $(show);

}(cockpit, jQuery));
