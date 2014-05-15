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

PageSystemInformation.prototype = {
    _init: function() {
        this.id = "system_information";
    },

    getTitle: function() {
        return C_("page-title", "System Information");
    },

    setup: function() {
        var self = this;

        $('#system_information_change_hostname_button').on('click', function () {
            if (!cockpit_check_role ('wheel', self.client))
                return;
            PageSystemInformationChangeHostname.client = self.client;
            $('#system_information_change_hostname').modal('show');
        });
    },

    enter: function() {
        var self = this;

        self.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        self.client = cockpit.dbus(self.address, { protocol: 'dbus-json1' });

        self.manager = self.client.get("/com/redhat/Cockpit/Manager",
                                       "com.redhat.Cockpit.Manager");

        function bindf(sel, object, prop, func) {
            function update() {
                $(sel).text(func(object[prop]));
            }
            $(object).on('notify:' + prop + '.system-information', update);
            update();
        }

        function bind(sel, object, prop) {
            bindf(sel, object, prop, function (s) { return s; });
        }

        bind("#system_information_hardware_text", self.manager, "System");
        bind("#system_information_asset_tag_text", self.manager, "SystemSerial");
        bind("#system_information_bios_text", self.manager, "BIOS");
        bind("#system_information_os_text", self.manager, "OperatingSystem");

        function hostname_text() {
            var pretty_hostname = self.manager.PrettyHostname;
            var hostname = self.manager.Hostname;
            var str;
            if (!pretty_hostname || pretty_hostname == hostname)
                str = hostname;
            else
                str = pretty_hostname + " (" + hostname + ")";
	    return str;
        }

        bindf("#system_information_hostname_text", self.manager, "Hostname", hostname_text);
        bindf("#system_information_hostname_text", self.manager, "PrettyHostname", hostname_text);

        function realms_text(val) {
            if (!val)
                return "?";

            var res = [ ];
            for (var i = 0; i < val.length; i++)
                res.push(val[i][0]);
            return res.join (", ");
        }

        self.realms = self.client.get("/com/redhat/Cockpit/Realms", "com.redhat.Cockpit.Realms");
        bindf("#system_information_realms", self.realms, "Joined", realms_text);
    },

    show: function() {
    },

    leave: function() {
        var self = this;

        function unbind(object) {
            $(object).off('.system-information');
        }

        unbind(self.manager);
        unbind(self.realms);

        self.client.release();
        self.client = null;
        self.manager = null;
        self.realms = null;
    }
};

function PageSystemInformation() {
    this._init();
}

cockpit_pages.push(new PageSystemInformation());

PageSystemInformationChangeHostname.prototype = {
    _init: function() {
        this.id = "system_information_change_hostname";
    },

    getTitle: function() {
        return C_("page-title", "Change Hostname");
    },

    setup: function() {
        $("#sich-pretty-hostname").on("keyup", $.proxy(this._on_full_name_changed, this));
        $("#sich-hostname").on("keyup", $.proxy(this._on_name_changed, this));
        $("#sich-apply-button").on("click", $.proxy(this._on_apply_button, this));
    },

    enter: function() {
        var self = this;

        self.manager = PageSystemInformationChangeHostname.client.get("/com/redhat/Cockpit/Manager",
                                                                      "com.redhat.Cockpit.Manager");
        self._initial_hostname = self.manager.Hostname || "";
        self._initial_pretty_hostname = self.manager.PrettyHostname || self._initial_hostname;
        $("#sich-pretty-hostname").val(self._initial_pretty_hostname);
        $("#sich-hostname").val(self._initial_hostname);

        this._always_update_from_pretty = false;
        this._update();
    },

    show: function() {
        $("#sich-pretty-hostname").focus();
    },

    leave: function() {
    },

    _on_apply_button: function(event) {
        var self = this;

        var new_full_name = $("#sich-pretty-hostname").val();
        var new_name = $("#sich-hostname").val();
        self.manager.call("SetHostname",
                          new_full_name, new_name, {},
                          function(error, reply) {
                              $("#system_information_change_hostname").modal('hide');
                              if(error) {
                                  cockpit_show_unexpected_error(error);
                              }
                          });
    },

    _on_full_name_changed: function(event) {
        /* Whenever the pretty hostname has changed (e.g. the user has edited it), we compute a new
         * simple hostname (e.g. 7bit ASCII, no special chars/spaces, lower case) from it...
         */
        var pretty_hostname = $("#sich-pretty-hostname").val();
        if (this._always_update_from_pretty || this._initial_pretty_hostname != pretty_hostname) {
            var new_hostname = pretty_hostname.toLowerCase().replace(/['"]+/g, "").replace(/[^a-zA-Z0-9]+/g, "-");
            $("#sich-hostname").val(new_hostname);
            this._always_update_from_pretty = true; // make sure we always update it from now-on
        }
        this._update();
    },

    _on_name_changed: function(event) {
        this._update();
    },

    _update: function() {
        var apply_button = $("#sich-apply-button");
        var note = $("#sich-note");
        var changed = false;
        var valid = false;
        var can_apply = false;

        var hostname = $("#sich-hostname").val();
        var pretty_hostname = $("#sich-pretty-hostname").val();

        if (hostname != this._initial_hostname ||
            pretty_hostname != this._initial_pretty_hostname)
            changed = true;

        if (hostname.match(/[a-z0-9-]*/) == hostname)
            valid = true;

        if (changed && valid)
            can_apply = true;

        if (valid)
            note.hide();
        else
            note.show();

        apply_button.prop('disabled', !can_apply);
    }
};

function PageSystemInformationChangeHostname() {
    this._init();
}

cockpit_pages.push(new PageSystemInformationChangeHostname());
