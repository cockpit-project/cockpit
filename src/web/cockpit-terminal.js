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

PageTerminal.prototype = {
    _init: function() {
        this.id = "terminal";
        this.history = [ "" ];
        this.history_pos = 0;
    },

    getTitle: function() {
        return C_("page-title", "Rescue Terminal");
    },

    show: function() {
    },

    enter: function(first_visit) {
        var me = this;
        if (first_visit) {
            $('#terminal-in').on('keydown', function(event) {
                if (event.which === 38)
                    me.history_up();
                else if (event.which === 40)
                    me.history_down();
                else if (event.which === 13)
                    me.run ();
            });
            $('#terminal-clear').on('click', $.proxy (this, 'clear'));
        }
    },

    leave: function() {
    },

    run: function() {
        if (!cockpit_check_role ('wheel'))
            return;

        var cmd = $('#terminal-in').val();
        $('#terminal-in').val("");
        $('#terminal-out').append('# ' + cockpit_esc(cmd) + '\n');

        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager", "com.redhat.Cockpit.Manager");

        this.history_pos = 0;
        this.history[this.history_pos] = cmd;
        this.history.unshift("");

        manager.call('Run', cmd,
                     function (error, output) {
                         if (error)
                             cockpit_show_unexpected_error (error);
                         else
                             $('#terminal-out').append(cockpit_esc(output));
                     });
    },

    history_up: function() {
        if (this.history_pos < this.history.length-1) {
            this.history[this.history_pos] = $('#terminal-in').val();
            this.history_pos += 1;
            $('#terminal-in').val(this.history[this.history_pos]);
        }
    },

    history_down: function() {
        if (this.history_pos > 0) {
            this.history[this.history_pos] = $('#terminal-in').val();
            this.history_pos -= 1;
            $('#terminal-in').val(this.history[this.history_pos]);
        }
    },

    clear: function() {
        $('#terminal-out').empty();
    }
};

function PageTerminal() {
    this._init();
}

cockpit_pages.push(new PageTerminal());
