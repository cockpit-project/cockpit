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

PageServer.prototype = {
    _init: function() {
        this.id = "server";
    },

    getTitle: function() {
        return null;
    },

    setup: function() {
        var self = this;

        $('#server-avatar').on('click', $.proxy (this, "trigger_change_avatar"));
        $('#server-avatar-uploader').on('change', $.proxy (this, "change_avatar"));

        $("#realms-join").click (function () {
            if (!cockpit.check_admin(self.client))
                return;

            if(self.realms.Joined[0] === undefined) {
                cockpit.realms_op_set_parameters(self.realms, 'join', '', { });
                $('#realms-op').modal('show');
            }
        });

        $("#realms-leave").click(function () {
            if (!cockpit.check_admin(self.client))
                return;

            self.leave_realm();
        });

        $('#system_information_change_hostname_button').on('click', function () {
            if (!cockpit.check_admin(self.client))
                return;
            PageSystemInformationChangeHostname.client = self.client;
            $('#system_information_change_hostname').modal('show');
        });
    },

    enter: function() {
        var self = this;

        self.address = cockpit.get_page_machine();
        /* TODO: This code needs to be migrated away from dbus-json1 */
        self.client = cockpit.dbus(self.address, { payload: 'dbus-json1' });
        cockpit.set_watched_client(self.client);

        self.manager = self.client.get("/com/redhat/Cockpit/Manager",
                                       "com.redhat.Cockpit.Manager");
        $(self.manager).on('AvatarChanged.server', $.proxy (this, "update_avatar"));

        $('#server-avatar').attr('src', "/cockpit/@@shell@@/images/server-large.png");

        function network_setup_hook(plot) {
            var axes = plot.getAxes();
            if (axes.yaxis.datamax < 100000)
                axes.yaxis.options.max = 100000;
            else
                axes.yaxis.options.max = null;
            axes.yaxis.options.min = 0;
        }

        var monitor = self.client.get("/com/redhat/Cockpit/CpuMonitor",
                                      "com.redhat.Cockpit.ResourceMonitor");
        self.cpu_plot =
            cockpit.setup_simple_plot("#server_cpu_graph",
                                      "#server_cpu_text",
                                      monitor,
                                      { yaxis: { ticks: 5 } },
                                      function(values) { // Combines the series into a single plot-value
                                          return values[1] + values[2] + values[3];
                                      },
                                      function(values) { // Combines the series into a textual string
                                          var total = values[1] + values[2] + values[3];
                                          return total.toFixed(1) + "%";
                                      });

        monitor = self.client.get("/com/redhat/Cockpit/MemoryMonitor",
                                  "com.redhat.Cockpit.ResourceMonitor");
        self.memory_plot =
            cockpit.setup_simple_plot("#server_memory_graph",
                                      "#server_memory_text",
                                      monitor,
                                      { },
                                      function(values) { // Combines the series into a single plot-value
                                          return values[1] + values[2] + values[3];
                                      },
                                      function(values) { // Combines the series into a textual string
                                          var total = values[1] + values[2] + values[3];
                                          return cockpit.format_bytes(total);
                                      });

        monitor = self.client.get("/com/redhat/Cockpit/NetworkMonitor",
                                  "com.redhat.Cockpit.ResourceMonitor");
        self.network_traffic_plot =
            cockpit.setup_simple_plot("#server_network_traffic_graph",
                                      "#server_network_traffic_text",
                                      monitor,
                                      { setup_hook: network_setup_hook },
                                      function(values) { // Combines the series into a single plot-value
                                          return values[0] + values[1];
                                      },
                                      function(values) { // Combines the series into a textual string
                                          var total = values[0] + values[1];
                                          return cockpit.format_bits_per_sec(total * 8);
                                      });

        monitor = self.client.get("/com/redhat/Cockpit/DiskIOMonitor",
                                  "com.redhat.Cockpit.ResourceMonitor");
        self.disk_io_plot =
            cockpit.setup_simple_plot("#server_disk_io_graph",
                                      "#server_disk_io_text",
                                      monitor,
                                      { },
                                      function(values) { // Combines the series into a single plot-value
                                          return values[0] + values[1];
                                      },
                                      function(values) { // Combines the series into a textual string
                                          var total = values[0] + values[1];
                                          return cockpit.format_bytes_per_sec(total);
                                      });


        cockpit.util.machine_info(this.address).
            done(function (info) {
                // TODO - round memory to something nice and/or adjust
                //        the ticks.
                self.cpu_plot.set_yaxis_max(info.cpus*100);
                self.memory_plot.set_yaxis_max(info.memory);
            });

        self.update_avatar ();

        function bindf(sel, object, prop, func) {
            function update() {
                $(sel).text(func(object[prop]));
            }
            $(object).on('notify:' + prop + '.server', update);
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
            var static_hostname = self.manager.StaticHostname;
            var str;
            if (!pretty_hostname || pretty_hostname == static_hostname)
                str = static_hostname;
            else
                str = pretty_hostname + " (" + static_hostname + ")";
	    return str;
        }

        bindf("#system_information_hostname_text", self.manager, "StaticHostname", hostname_text);
        bindf("#system_information_hostname_text", self.manager, "PrettyHostname", hostname_text);

        self.realms = self.client.get("/com/redhat/Cockpit/Realms", "com.redhat.Cockpit.Realms");

        $(self.realms).on('notify:Joined.server',
                          $.proxy(self, "update_realms"));

        $("#realms-leave-error").text("");
        $("#realms-leave-spinner").hide();
        self.update_realms();
    },

    show: function() {
        this.cpu_plot.start();
        this.memory_plot.start();
        this.disk_io_plot.start();
        this.network_traffic_plot.start();
    },

    leave: function() {
        var self = this;

        self.cpu_plot.destroy();
        self.memory_plot.destroy();
        self.disk_io_plot.destroy();
        self.network_traffic_plot.destroy();

        cockpit.set_watched_client(null);
        $(self.manager).off('.server');
        self.manager = null;
        $(self.realms).off('.server');
        self.realms = null;
        $(self.client).off('.server');
        self.client.release();
        self.client = null;
    },

    start_plots: function () {
        var self = this;

    },

    update_avatar: function () {
        this.manager.call('GetAvatarDataURL', function (error, result) {
            if (result)
                $('#server-avatar').attr('src', result);
        });
    },

    trigger_change_avatar: function() {
        if (window.File && window.FileReader)
            $('#server-avatar-uploader').trigger('click');
    },

    change_avatar: function() {
        var me = this;
        cockpit.show_change_avatar_dialog('#server-avatar-uploader',
                                           function (data) {
                                               me.manager.call('SetAvatarDataURL', data,
                                                               function (error) {
                                                                   if (error)
                                                                       cockpit.show_unexpected_error(error);
                                                               });
                                           });
    },

    update_realms: function() {
        var self = this;
        var joined = self.realms.Joined;

        function realms_text(val) {
            if (!val)
                return "?";

            var res = [ ];
            for (var i = 0; i < val.length; i++)
                res.push(val[i][0]);
            return res.join (", ");
        }

        $('#system_information_realms').text(realms_text(joined));

        $("#realms-leave").toggle(joined && joined.length > 0);
        $("#realms-join").toggle(joined && joined.length === 0);

        /* Never show the spinner together with the Join button.
         */
        if (joined && joined.length === 0)
            $("#realms-leave-spinner").hide();
    },

    leave_realm: function () {
        var self = this;

        var joined = self.realms.Joined;
        if (joined.length < 1)
            return;

        $("#realms-leave-spinner").show();

        var name = joined[0][0];
        var details = joined[0][1];

        $("#realms-leave-error").text("");
        var options = { 'server-software': details['server-software'],
                        'client-software': details['client-software']
                      };

        self.realms.call("Leave", name, [ 'none', '', '' ], options,
                         function (error, result) {
                             $("#realms-leave-spinner").hide();
                             if (error) {
                                 if (error.name == 'com.redhat.Cockpit.Error.AuthenticationFailed') {
                                     cockpit.realms_op_set_parameters(self.realms, 'leave', name, details);
                                     $("#realms-op").modal('show');
                                 } else
                                     $("#realms-leave-error").text(error.message);
                             }
                         });
    }
};

function PageServer() {
    this._init();
}

cockpit.pages.push(new PageServer());

PageSystemInformationChangeHostname.prototype = {
    _init: function() {
        this.id = "system_information_change_hostname";
    },

    setup: function() {
        $("#sich-pretty-hostname").on("input change", $.proxy(this._on_full_name_changed, this));
        $("#sich-hostname").on("input change", $.proxy(this._on_name_changed, this));
        $("#sich-apply-button").on("click", $.proxy(this._on_apply_button, this));
    },

    enter: function() {
        var self = this;

        self.manager = PageSystemInformationChangeHostname.client.get("/com/redhat/Cockpit/Manager",
                                                                      "com.redhat.Cockpit.Manager");
        self._initial_hostname = self.manager.StaticHostname || "";
        self._initial_pretty_hostname = self.manager.PrettyHostname || "";
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
                                  cockpit.show_unexpected_error(error);
                              }
                          });
    },

    _on_full_name_changed: function(event) {
        /* Whenever the pretty host name has changed (e.g. the user has edited it), we compute a new
         * simple host name (e.g. 7bit ASCII, no special chars/spaces, lower case) from it...
         */
        var pretty_hostname = $("#sich-pretty-hostname").val();
        if (this._always_update_from_pretty || this._initial_pretty_hostname != pretty_hostname) {
            var old_hostname = $("#sich-hostname").val();
            var first_dot = old_hostname.indexOf(".");
            var new_hostname = pretty_hostname.toLowerCase().replace(/['".]+/g, "").replace(/[^a-zA-Z0-9]+/g, "-");
            new_hostname = new_hostname.substr(0, 64);
            if (first_dot >= 0)
                new_hostname = new_hostname + old_hostname.substr(first_dot);
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
        var note1 = $("#sich-note-1");
        var note2 = $("#sich-note-2");
        var changed = false;
        var valid = false;
        var can_apply = false;

        var charError = "Real host name can only contain lower-case characters, digits, dashes, and periods (with populated subdomains)";
        var lengthError = "Real host name must be 64 characters or less";

        var validLength = $("#sich-hostname").val().length <= 64;
        var hostname = $("#sich-hostname").val();
        var pretty_hostname = $("#sich-pretty-hostname").val();
        var validSubdomains = true;
        var periodCount = 0;

        for(var i=0; i<$("#sich-hostname").val().length; i++) {
            if($("#sich-hostname").val()[i] == '.')
                periodCount++;
            else
                periodCount = 0;

            if(periodCount > 1) {
                validSubdomains = false;
                break;
            }
        }

        var validName = (hostname.match(/[.a-z0-9-]*/) == hostname) && validSubdomains;

        if ((hostname != this._initial_hostname ||
            pretty_hostname != this._initial_pretty_hostname) &&
            (hostname !== "" || pretty_hostname !== ""))
            changed = true;

        if (validLength && validName)
            valid = true;

        if (changed && valid)
            can_apply = true;

        if (valid) {
            $(note1).css("visibility", "hidden");
            $(note2).css("visibility", "hidden");
            $("#sich-hostname-error").removeClass("has-error");
        } else if(!validLength && validName) {
            $("#sich-hostname-error").addClass("has-error");
            $(note1).text(lengthError);
            $(note1).css("visibility", "visible");
            $(note2).css("visibility", "hidden");
        } else if(validLength && !validName) {
            $("#sich-hostname-error").addClass("has-error");
            $(note1).text(charError);
            $(note1).css("visibility", "visible");
            $(note2).css("visibility", "hidden");
        } else {
            $("#sich-hostname-error").addClass("has-error");

            if($(note1).text() === lengthError)
                $(note2).text(charError);
            else if($(note1).text() === charError)
                $(note2).text(lengthError);
            else {
                $(note1).text(lengthError);
                $(note2).text(charError);
            }
            $(note1).css("visibility", "visible");
            $(note2).css("visibility", "visible");
        }

        apply_button.prop('disabled', !can_apply);
    }
};

function PageSystemInformationChangeHostname() {
    this._init();
}

cockpit.pages.push(new PageSystemInformationChangeHostname());

})(cockpit, $);
