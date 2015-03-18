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
/* global moment   */
/* global _        */
/* global C_       */

var shell = shell || { };
var modules = modules || { };
(function($, cockpit, shell, modules) {

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

        $('#system_information_systime_button').on('click', function () {
            PageSystemInformationChangeSystime.client = self.client;
            PageSystemInformationChangeSystime.callback = $.proxy(self.get_time, self);
            $('#system_information_change_systime').modal('show');
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

        /* TODO: Need to migrate away from old dbus */
        self.client = shell.dbus(null);

        self.manager = self.client.get("/com/redhat/Cockpit/Manager",
                                       "com.redhat.Cockpit.Manager");
        $(self.manager).on('AvatarChanged.server', $.proxy (this, "update_avatar"));

        $('#server-avatar').attr('src', "images/server-large.png");

        var monitor;
        var series;

        /* CPU graph */

        var cpu_data = {
            direct: [ "kernel.all.cpu.nice", "kernel.all.cpu.user", "kernel.all.cpu.sys" ],
            internal: [ "cpu.basic.nice", "cpu.basic.user", "cpu.basic.system" ],
            units: "millisec",
            derive: "rate",
            factor: 0.1  // millisec / sec -> percent
        };

        var cpu_options = shell.plot_simple_template();
        $.extend(cpu_options.yaxis, { max: 100 });

        self.cpu_plot = shell.plot($("#server_cpu_graph"), 300);
        self.cpu_plot.set_options(cpu_options);
        series = self.cpu_plot.add_metrics_sum_series(cpu_data, { });
        $(series).on("value", function(ev, value) {
            $("#server_cpu_text").text(value.toFixed(1) + "%");
        });

        /* Memory graph */

        var memory_data = {
            direct: [ "mem.util.used" ],
            internal: [ "memory.used" ],
            units: "bytes"
        };

        var memory_options = shell.plot_simple_template();

        self.memory_plot = shell.plot($("#server_memory_graph"), 300);
        self.memory_plot.set_options(memory_options);
        series = self.memory_plot.add_metrics_sum_series(memory_data, { });
        $(series).on("value", function(ev, value) {
            $("#server_memory_text").text(cockpit.format_bytes(value));
        });

        /* Network graph */

        var network_data = {
            direct: [ "network.interface.total.bytes" ],
            internal: [ "network.all.tx", "network.all.rx" ],
            units: "bytes",
            derive: "rate"
        };

        var network_options = shell.plot_simple_template();
        network_options.setup_hook = function network_setup_hook(plot) {
            var axes = plot.getAxes();
            if (axes.yaxis.datamax < 100000)
                axes.yaxis.options.max = 100000;
            else
                axes.yaxis.options.max = null;
            axes.yaxis.options.min = 0;
        };

        self.network_plot = shell.plot($("#server_network_traffic_graph"), 300);
        self.network_plot.set_options(network_options);
        series = self.network_plot.add_metrics_sum_series(network_data, { });
        $(series).on("value", function(ev, value) {
            $("#server_network_traffic_text").text(cockpit.format_bits_per_sec(value * 8));
        });

        /* Disk IO graph */

        var disk_data = {
            direct: [ "disk.dev.total_bytes" ],
            internal: [ "block.device.read", "block.device.written" ],
            units: "bytes",
            derive: "rate"
        };

        self.disk_plot = shell.plot($("#server_disk_io_graph"), 300);
        self.disk_plot.set_options(shell.plot_simple_template());
        series = self.disk_plot.add_metrics_sum_series(disk_data, { });
        $(series).on("value", function(ev, value) {
            $("#server_disk_io_text").text(cockpit.format_bytes_per_sec(value));
        });

        shell.util.machine_info(null).
            done(function (info) {
                cpu_options.yaxis.max = info.cpus * 100;
                self.cpu_plot.set_options(cpu_options);

                // TODO - round memory to something nice and/or adjust
                //        the ticks.
                memory_options.yaxis.max = info.memory;
                self.memory_plot.set_options(memory_options);
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

        this.get_time();

        self.realms = self.client.get("/com/redhat/Cockpit/Realms", "com.redhat.Cockpit.Realms");

        $(self.realms).on('notify:Joined.server',
                          $.proxy(self, "update_realms"));
        self.update_realms();
    },

    show: function() {
        this.cpu_plot.start_walking();
        this.memory_plot.start_walking();
        this.disk_plot.start_walking();
        this.network_plot.start_walking();
    },

    leave: function() {
        var self = this;

        self.cpu_plot.destroy();
        self.memory_plot.destroy();
        self.disk_plot.destroy();
        self.network_plot.destroy();

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

    get_time: function() {
        var self = this;

        function systime_text() {
            if (! self.timestamp_diff)
                return;

            var time = moment(self.timestamp_diff + (new Date()).valueOf()).tz(self.timedate.Timezone);
            $('#system_information_systime_button').text(time.format('MMMM D LT'));
        }

        function systime_timestamp(data) {
            self.timestamp_diff = data[0] - (new Date()).valueOf();
            self.service = cockpit.dbus('org.freedesktop.timedate1');
            self.timedate = self.service.proxy();

            PageSystemInformationChangeSystime.timestamp_diff = self.timestamp_diff;
            PageSystemInformationChangeSystime.timedate = self.timedate;
            $(self.timedate).on("changed", systime_text);
            window.setInterval(systime_text, 30000);
        }

        var client = cockpit.dbus(null, { "bus": "internal" });
        client.call("/time", "cockpit.Time", "GetWallTime", [ ])
              .done(systime_timestamp)
              .fail(function(ex) { console.warn("couldn't get server time: " + ex); })
              .always(function() { client.close(); });
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

PageSystemInformationChangeSystime.prototype = {
    _init: function() {
        this.id = "system_information_change_systime";
        this.dirty = false;
    },

    setup: function() {
        $("#systime-apply-button").on("click", $.proxy(this._on_apply_button, this));
        $('#change_systime').on('change', $.proxy(this, "update"));
        $('#systime-time-minutes').on('focusout', $.proxy(this, "update_minutes"));
        $('#systime-time-minutes').on('change', $.proxy(this, "check_input"));
        $('#systime-time-hours').on('change', $.proxy(this, "check_input"));
        $('#systime-date-input').on('change', $.proxy(this, "check_input"));
    },

    enter: function() {
        var timedate = PageSystemInformationChangeSystime.timedate;
        var date = new Date();

        if (this.dirty)
            return;

        date.setTime(date.getTime() + PageSystemInformationChangeSystime.timestamp_diff);

        $('#systime-date-input').datepicker({autoclose: true,
                                             todayHighlight: true});
        $('#systime-date-input').val(date.toLocaleDateString());
        $('#systime-time-minutes').val(date.getMinutes());
        $('#systime-time-hours').val(date.getHours());
        $('#change_systime').val(timedate.NTP ? 'ntp_time' : 'manual_time');
        $('#change_systime').selectpicker('refresh');
        $('#systime-parse-error').css('visibility', 'hidden');
        $('#systime-apply-button').prop('disabled', false);

        this.update();
        this.update_minutes();
    },

    show: function() {
    },

    leave: function() {
        this.dirty = false;
    },

    _on_apply_button: function(event) {
        var self = this;
        var timedate = PageSystemInformationChangeSystime.timedate;

        function set_manual_time() {
            if ($('#change_systime').val() == 'manual_time') {
                var new_date = new Date($("#systime-date-input").val());

                new_date.setHours(parseInt($('#systime-time-hours').val()));
                new_date.setMinutes(parseInt($('#systime-time-minutes').val()));

                var call = timedate.SetTime(new_date.getTime() * 1000, false, true);
                call.fail(function (err) { shell.show_unexpected_error(err); });
                call.done(function () {
                              $("#system_information_change_systime").modal('hide');
                              PageSystemInformationChangeSystime.callback();
                          });
            } else {
                $("#system_information_change_systime").modal('hide');
                PageSystemInformationChangeSystime.callback();
            }
        }

        if ($('#change_systime').val() == 'manual_time' && ! self.check_input())
            return;

        var call_ntp = timedate.SetNTP($('#change_systime').val() == 'ntp_time', true);
        call_ntp.fail(function (err) { shell.show_unexpected_error(err); });
        call_ntp.done(set_manual_time);
    },

    check_input: function() {
        var time_error = false;
        var date_error = false;
        var new_date;

        var hours = parseInt($('#systime-time-hours').val());
        var minutes = parseInt($('#systime-time-minutes').val());


        if (isNaN(hours) || hours < 0 || hours > 23  ||
            isNaN(minutes) || minutes < 0 || minutes > 59) {
           time_error = true;
        }

        new_date = new Date($("#systime-date-input").val());

        if (isNaN(new_date.getTime()) || new_date.getTime() < 0)
            date_error = true;

        if (time_error && date_error)
           $('#systime-parse-error').text(_("Invalid date format and Invalid time format"));
        else if (time_error)
           $('#systime-parse-error').text(_("Invalid time format"));
        else if (date_error)
           $('#systime-parse-error').text(_("Invalid date format"));
        else
           $('#systime-parse-error').css('visibility', 'hidden');

        if (time_error || date_error) {
            $('#systime-parse-error').css('visibility', 'visible');
            $('#systime-apply-button').prop('disabled', true);
            return false;
        } else {
            $('#systime-parse-error').css('visibility', 'hidden');
            $('#systime-apply-button').prop('disabled', false);
            return true;
        }
    },

    update: function() {
        this.dirty = true;
        $("#systime-date-input").prop('disabled', $('#change_systime').val() === 'ntp_time');
        $("#systime-time-hours").prop('disabled', $('#change_systime').val() === 'ntp_time');
        $("#systime-time-minutes").prop('disabled', $('#change_systime').val() === 'ntp_time');
    },

    update_minutes: function() {
        var val = parseInt($('#systime-time-minutes').val());
        if (val < 10)
            $('#systime-time-minutes').val("0" + val);
    }
};

function PageSystemInformationChangeSystime() {
    this._init();
}

shell.dialogs.push(new PageSystemInformationChangeSystime());

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

        var arg = (op == "shutdown") ? "--poweroff" : "--reboot";
        cockpit.spawn(["shutdown", arg, when, message], { superuser: true })
            .fail(function(ex) {
                $('#shutdown-dialog').modal('hide');
                shell.show_unexpected_error(ex);
            })
            .done(function(ex) {
                $('#shutdown-dialog').modal('hide');
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

})(jQuery, cockpit, shell, modules);
