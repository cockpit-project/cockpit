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

PageTerminal.prototype = {
    _init: function() {
        this.id = "terminal";
        this.history = [ "" ];
        this.history_pos = 0;
        this.term = null;
        this.channel = null;
    },

    getTitle: function() {
        return C_("page-title", "Rescue Terminal");
    },

    show: function() {
    },

    enter: function() {
        var self = this;
        self.term = new Terminal({
            cols: 80,
            rows: 24,
            screenKeys: true
        });

        /* term.js wants the parent element to build its terminal inside of */
        self.term.open($("#rescue-terminal")[0]);

        self.channel = cockpit.channel({
            "host": cockpit.get_page_param("machine", "server"),
            "payload": "text-stream",
            "spawn": ["/bin/bash", "-i"],
            "environ": [
                "TERM=xterm-256color",
                "PATH=/sbin:/bin:/usr/sbin:/usr/bin"
            ],
            "pty": true
        });

        $(self.channel).
            on("close", function(ev, options) {
                if (self.term) {
                    var problem = options.reason || "disconnected";
                    self.term.write('\x1b[31m' + problem + '\x1b[m\r\n');
                    /* There's no term.hideCursor() function */
                    self.term.cursorHidden = true;
                    self.term.refresh(self.term.y, self.term.y);
                }
            }).
            on("message", function(ev, payload) {
                /* Output from pty to terminal */
                if (self.term)
                    self.term.write(payload);
            });

        self.term.on('data', function(data) {
            /* Output from terminal to pty */
            if (self.channel && self.channel.valid)
                self.channel.send(data);
        });
    },

    leave: function() {
        if (this.term) {
            this.term.destroy();
            this.term = null;
        }
        if (this.channel) {
            if (this.channel.valid)
                this.channel.close(null);
            this.channel = null;
        }
    }
};

function PageTerminal() {
    this._init();
}

cockpit.pages.push(new PageTerminal());

}(cockpit, jQuery));
