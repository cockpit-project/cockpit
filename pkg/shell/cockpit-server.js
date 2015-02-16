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

/* global jQuery   */
/* global cockpit  */
/* global _        */
/* global C_       */

var shell = shell || { };
(function($, cockpit, shell) {

function update_hostname_privileged() {
    shell.update_privileged_ui(
        shell.default_permission, ".hostname-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to modify hostnames"),
            cockpit.user.name)
    );
}

function update_realm_privileged() {
    shell.update_privileged_ui(
        shell.default_permission, ".realm-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to modify realms"),
            cockpit.user.name)
    );
}

$(shell.default_permission).on("changed", update_realm_privileged);
$(shell.default_permission).on("changed", update_hostname_privileged);

PageServer.prototype = {
    _init: function() {
        this.id = "server";
    },

    getTitle: function() {
        return null;
    },

    setup: function() {
        var self = this;
        update_realm_privileged();
        update_hostname_privileged();

        $('#shutdown-group').append(
              shell.action_btn(
                  function (op) { self.shutdown(op); },
                  [ { title: _("Restart"),         action: 'default' },
                    { title: _("Shutdown"),        action: 'shutdown' },
                  ])
        );

        $('#server-avatar').on('click', $.proxy (this, "trigger_change_avatar"));
        $('#server-avatar-uploader').on('change', $.proxy (this, "change_avatar"));

        $('#system_information_hostname_button').on('click', function () {
            PageSystemInformationChangeHostname.client = self.client;
            $('#system_information_change_hostname').modal('show');
        });

        $('#system_information_realms_button').on('click', function () {
            if (self.realms.Joined && self.realms.Joined.length > 0) {
                var name = self.realms.Joined[0][0];
                var details = self.realms.Joined[0][1];
                shell.realms_op_set_parameters(self.realms, 'leave', name, details);
                $('#realms-op').modal('show');
            } else {
                shell.realms_op_set_parameters(self.realms, 'join', '', { });
                $('#realms-op').modal('show');
            }
        });
    },

    enter: function() {
        var self = this;

        self.address = shell.get_page_machine();
        /* TODO: Need to migrate away from old dbus */
        self.client = shell.dbus(self.address);

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
            shell.setup_simple_plot("#server_cpu_graph",
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
            shell.setup_simple_plot("#server_memory_graph",
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
            shell.setup_simple_plot("#server_network_traffic_graph",
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
            shell.setup_simple_plot("#server_disk_io_graph",
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


        shell.util.machine_info(this.address).
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

        /*
         * Parses output like:
         *
         * bios_vendor:LENOVO
         * bios_version:8CET46WW
         */
        function parse_lines(output) {
            var ret = { };
            $.each(output.split("\n"), function(i, line) {
                var pos = line.indexOf(":");
                if (pos !== -1)
                    ret[line.substring(0, pos)] = line.substring(pos + 1);
            });
            return ret;
        }

        cockpit.spawn(["grep", "\\w", "bios_vendor", "bios_version", "bios_date", "sys_vendor", "product_name"],
                      { directory: "/sys/devices/virtual/dmi/id" })
            .done(function(output) {
                var fields = parse_lines(output);
                $("#system_information_bios_text").text(fields.bios_vendor + " " +
                                                        fields.bios_version + " (" +
                                                        fields.bios_date + ")");
                $("#system_information_hardware_text").text(fields.sys_vendor + " " +
                                                            fields.product_name);
            })
            .fail(function(ex) {
                console.warn("couldn't read dmi info: " + ex);
            });

        cockpit.spawn(["grep", "\\w", "product_serial", "chassis_serial"],
                      { directory: "/sys/devices/virtual/dmi/id", superuser: true })
            .done(function(output) {
                var fields = parse_lines(output);
                $("#system_information_asset_tag_text").text(fields.product_serial ||
                                                             fields.chassis_serial);
            })
            .fail(function(ex) {
                if (ex.problem != "not-authorized")
                    console.warn("couldn't read serial dmi info: " + ex);
            });

        bind("#system_information_os_text", self.manager, "OperatingSystem");

        function hostname_text() {
            var pretty_hostname = self.manager.PrettyHostname;
            var static_hostname = self.manager.StaticHostname;
            var str;
            if (!pretty_hostname || pretty_hostname == static_hostname)
                str = static_hostname;
            else
                str = pretty_hostname + " (" + static_hostname + ")";
            if (str === "")
                str = _("Set Host name");
	    return str;
        }

        bindf("#system_information_hostname_button", self.manager, "StaticHostname", hostname_text);
        bindf("#system_information_hostname_button", self.manager, "PrettyHostname", hostname_text);

        self.realms = self.client.get("/com/redhat/Cockpit/Realms", "com.redhat.Cockpit.Realms");

        $(self.realms).on('notify:Joined.server',
                          $.proxy(self, "update_realms"));
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

        $(self.manager).off('.server');
        self.manager = null;
        $(self.realms).off('.server');
        self.realms = null;
        $(self.client).off('.server');
        self.client.release();
        self.client = null;
    },

    shutdown: function(action_type) {
        PageShutdownDialog.type = action_type;
        $('#shutdown-dialog').modal('show');
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
        shell.show_change_avatar_dialog('#server-avatar-uploader',
                                           function (data) {
                                               me.manager.call('SetAvatarDataURL', data,
                                                               function (error) {
                                                                   if (error)
                                                                       shell.show_unexpected_error(error);
                                                               });
                                           });
    },

    update_realms: function() {
        var self = this;
        var joined = self.realms.Joined;

        function realms_text(val) {
            if (!val || val.length === 0)
                return _("Join Domain");

            var res = [ ];
            for (var i = 0; i < val.length; i++)
                res.push(val[i][0]);
            return res.join (", ");
        }

        $('#system_information_realms_button').text(realms_text(joined));
    }
};

function PageServer() {
    this._init();
}

shell.pages.push(new PageServer());

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
                                  shell.show_unexpected_error(error);
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

shell.dialogs.push(new PageSystemInformationChangeHostname());


PageShutdownDialog.prototype = {
    _init: function() {
        this.id = "shutdown-dialog";
    },

    setup: function() {
        $("#shutdown-delay").html(
            this.delay_btn = shell.select_btn($.proxy(this, "update"),
                                                [ { choice: "1",   title: _("1 Minute") },
                                                  { choice: "5",   title: _("5 Minutes") },
                                                  { choice: "20",  title: _("20 Minutes") },
                                                  { choice: "40",  title: _("40 Minutes") },
                                                  { choice: "60",  title: _("60 Minutes") },
                                                  { group : [{ choice: "0",   title: _("No Delay") },
                                                             { choice: "x",   title: _("Specific Time")}]}
                                                ]).
                css("display", "inline"));

        $("#shutdown-time input").change($.proxy(this, "update"));
    },

    enter: function(event) {
        this.address = shell.get_page_machine();

        /* TODO: This needs to be migrated away from the old dbus */
        this.cockpitd = shell.dbus(this.address);
        this.cockpitd_manager = this.cockpitd.get("/com/redhat/Cockpit/Manager",
                                                  "com.redhat.Cockpit.Manager");
        $(this.cockpitd_manager).on("notify.shutdown", $.proxy(this, "update"));

        $("#shutdown-message").
            val("").
            attr("placeholder", _("Message to logged in users")).
            attr("rows", 5);

        shell.select_btn_select(this.delay_btn, "1");

        if (PageShutdownDialog.type == 'shutdown') {
          $('#shutdown-dialog .modal-title').text(_("Shutdown"));
          $("#shutdown-action").click($.proxy(this, "shutdown"));
          $("#shutdown-action").text(_("Shutdown"));
        } else {
          $('#shutdown-dialog .modal-title').text(_("Restart"));
          $("#shutdown-action").click($.proxy(this, "restart"));
          $("#shutdown-action").text(_("Restart"));
        }
        this.update();
    },

    show: function(e) {
    },

    leave: function() {
        $(this.cockpitd_manager).off(".shutdown");
        this.cockpitd.release();
        this.cockpitd = null;
        this.cockpitd_manager = null;
    },

    update: function() {
        var disabled = false;

        var delay = shell.select_btn_selected(this.delay_btn);
        $("#shutdown-time").toggle(delay == "x");
        if (delay == "x") {
            var h = parseInt($("#shutdown-time input:nth-child(1)").val(), 10);
            var m = parseInt($("#shutdown-time input:nth-child(3)").val(), 10);
            var valid = (h >= 0 && h < 24) && (m >= 0 && m < 60);
            $("#shutdown-time").toggleClass("has-error", !valid);
            if (!valid)
                disabled = true;
        }

        $("#shutdown-action").prop('disabled', disabled);
    },

    do_action: function(op) {
        var delay = shell.select_btn_selected(this.delay_btn);
        var message = $("#shutdown-message").val();
        var when;

        if (delay == "x")
            when = ($("#shutdown-time input:nth-child(1)").val() + ":" +
                    $("#shutdown-time input:nth-child(3)").val());
        else
            when = "+" + delay;

        this.cockpitd_manager.call('Shutdown', op, when, message, function(error) {
            $('#shutdown-dialog').modal('hide');
            if (error && error.name != 'Disconnected')
                shell.show_unexpected_error(error);
        });
    },

    restart: function() {
        this.do_action('restart');
    },

    shutdown: function() {
        this.do_action('shutdown');
    }
};

function PageShutdownDialog() {
    this._init();
}

shell.dialogs.push(new PageShutdownDialog());

})(jQuery, cockpit, shell);
