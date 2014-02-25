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

    enter: function(first_visit) {
        if (first_visit) {
            var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager", "com.redhat.Cockpit.Manager");
            cockpit_bind_dbus_property("#system_information_hardware_text", manager, "System");
            cockpit_bind_dbus_property("#system_information_asset_tag_text", manager, "SystemSerial");
            cockpit_bind_dbus_property("#system_information_bios_text", manager, "BIOS");
            cockpit_bind_dbus_property("#system_information_os_text", manager, "OperatingSystem");

            var realms = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Realms", "com.redhat.Cockpit.Realms");
            cockpit_bind_dbus_property_func("#system_information_realms", realms,
                                            function () {
                                                var res = [ ];
                                                var joined = realms.Joined;
                                                for (var i = 0; i < joined.length; i++)
                                                    res.push(joined[i][0]);
                                                return res.join (", ");
                                            });

            var si_on_hostname_changed = function() {
                var pretty_hostname = manager.PrettyHostname;
                var hostname = manager.Hostname;
                var str;
                if (!pretty_hostname || pretty_hostname == hostname)
                    str = hostname;
                else
                    str = pretty_hostname + " (" + hostname + ")";
	        $("#system_information_hostname_text").empty();
	        $("#system_information_hostname_text").append(document.createTextNode(str));
            };
            $(manager).on("notify:Hostname", si_on_hostname_changed);
            $(manager).on("notify:PrettyHostname", si_on_hostname_changed);
            si_on_hostname_changed();

            $('#system_information_change_hostname_button').on('click', function () {
                if (!cockpit_check_role ('wheel'))
                    return;
                $('#system_information_change_hostname').modal('show');
            });
        }
    },

    show: function() {
    },

    leave: function() {
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

    enter: function(first_visit) {
        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager", "com.redhat.Cockpit.Manager");
        var hostname = manager.Hostname;
        var pretty_hostname = manager.PrettyHostname;
        // If there is no pretty hostname, just set it to the hostname
        if (!pretty_hostname)
            pretty_hostname = hostname;
        $("#sich-pretty-hostname").val(pretty_hostname);
        $("#sich-hostname").val(hostname);

        this._always_update_from_pretty = false;
        this._initial_hostname = $("#sich-hostname").val();
        this._initial_pretty_hostname = $("#sich-pretty-hostname").val();
        $("#sich-pretty-hostname").on("keyup", $.proxy(this._on_full_name_changed, this));
        $("#sich-hostname").on("keyup", $.proxy(this._on_name_changed, this));
        $("#sich-apply-button").on("click", $.proxy(this._on_apply_button, this));

        this._update();
    },

    show: function() {
        $("#sich-pretty-hostname").focus();
    },

    leave: function() {
        $("#sich-apply-button").off("click");
        $("#sich-pretty-hostname").off("keyup");
    },

    _on_apply_button: function(event) {
        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager", "com.redhat.Cockpit.Manager");
        var new_full_name = $("#sich-pretty-hostname").val();
        var new_name = $("#sich-hostname").val();
        manager.call("SetHostname",
                     new_full_name, new_name, {},
                     function(error, reply) {
                         $("#system_information_change_hostname").modal('hide');
                         if(error) {
                             cockpit_show_error_dialog("Error changing hostname",
                                                       "The error " + error.name + " occured: " + error.message);
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
        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager", "com.redhat.Cockpit.Manager");
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

        if (can_apply)
            apply_button.removeClass("ui-disabled");
        else
            apply_button.addClass("ui-disabled");
    }
};

function PageSystemInformationChangeHostname() {
    this._init();
}

cockpit_pages.push(new PageSystemInformationChangeHostname());
