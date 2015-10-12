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

define([
    "jquery",
    "base1/cockpit",
    "domain/operation",
    "shell/controls",
    "shell/shell",
    "system/server",
    "system/service",
    "shell/plot",
    "shell/cockpit-plot",
    "shell/cockpit-util",
    "base1/bootstrap-datepicker",
    "base1/bootstrap-combobox",
    "base1/patterns",
], function($, cockpit, domain, controls, shell, server, service) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

var permission = cockpit.permission({ group: "wheel" });
$(permission).on("changed", update_hostname_privileged);

function update_hostname_privileged() {
    controls.update_privileged_ui(
        permission, ".hostname-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to modify hostnames"),
            cockpit.user.name)
    );
}

function debug() {
    if (window.debugging == "all" || window.debugging == "system")
        console.debug.apply(console, arguments);
}

function ServerTime() {
    var self = this;

    var client = cockpit.dbus('org.freedesktop.timedate1');
    var timedate = client.proxy();

    var time_offset = null;
    var remote_offset = null;

    self.timedate = timedate;

    /*
     * The time we return from here as its UTC time set to the
     * server time. This is the only way to get predictable
     * behavior and formatting of a Date() object in the absence of
     * IntlDateFormat and  friends.
     */
    Object.defineProperty(self, 'now', {
        enumerable: true,
        get: function get() {
            var offset = time_offset + remote_offset;
            return new Date(offset + (new Date()).valueOf());
        }
    });

    self.format = function format(and_time) {
        var string = self.now.toISOString();
        if (!and_time)
            return string.split('T')[0];
        var pos = string.lastIndexOf(':');
        if (pos !== -1)
            string = string.substring(0, pos);
        return string.replace('T', ' ');
    };

    var interval = window.setInterval(function() {
        $(self).triggerHandler("changed");
    }, 30000);

    function offsets(timems, offsetms) {
        var now = new Date();
        time_offset = (timems - now.valueOf());
        remote_offset = offsetms;
        $(self).triggerHandler("changed");
    }

    self.update = function update() {
        cockpit.spawn(["/usr/bin/date", "+%s:%:z"])
            .done(function(data) {
                var parts = data.trim().split(":").map(function(x) {
                    return parseInt(x, 10);
                });
                if (parts[1] < 0)
                    parts[2] = -(parts[2]);
                offsets(parts[0] * 1000, (parts[1] * 3600000) + parts[2] * 60000);
            });
    };

    self.change_time = function change_time(datestr, hourstr, minstr) {
        var dfd = $.Deferred();

        /*
         * The browser is brain dead when it comes to dates. But even if
         * it wasn't, or we loaded a library like moment.js, there is no
         * way to make sense of this date without a round trip to the
         * server ... the timezone is really server specific.
         */
        cockpit.spawn(["/usr/bin/date", "--date=" + datestr + " " + hourstr + ":" + minstr, "+%s"])
            .fail(function(ex) {
                dfd.reject(ex);
            })
            .done(function(data) {
                var seconds = parseInt(data.trim(), 10);
                timedate.call('SetTime', [seconds * 1000 * 1000, false, true])
                    .fail(function(ex) {
                        dfd.reject(ex);
                    })
                    .done(function() {
                        self.update();
                        dfd.resolve();
                    });
            });

        return dfd;
    };

    self.close = function close() {
        client.close();
    };

    self.update();
}

PageServer.prototype = {
    _init: function() {
        this.id = "server";
        this.server_time = null;
        this.os_file_name = "/etc/os-release";
        this.client = null;
        this.hostname_proxy = null;
    },

    getTitle: function() {
        return null;
    },

    setup: function() {
        var self = this;
        update_hostname_privileged();

        self.timedate = cockpit.dbus('org.freedesktop.timedate1').proxy();

        $('#shutdown-group').append(
              shell.action_btn(
                  function (op) { self.shutdown(op); },
                  [ { title: _("Restart"),         action: 'default' },
                    { title: _("Shutdown"),        action: 'shutdown' },
                  ])
        );

        $('#system_information_hostname_button').on('click', function () {
            PageSystemInformationChangeHostname.client = self.client;
            $('#system_information_change_hostname').modal('show');
        });

        $('#system_information_systime_button').on('click', function () {
            PageSystemInformationChangeSystime.server_time = self.server_time;
            $('#system_information_change_systime').modal('show');
        });

        self.domain_button = domain.button();
        $("#system-info-realms td.button-location").append(self.domain_button);

        self.server_time = new ServerTime();
        $(self.server_time).on("changed", function() {
            $('#system_information_systime_button').text(self.server_time.format(true));
        });

        self.plot_controls = shell.setup_plot_controls($('#server'), $('#server-graph-toolbar'));

        var pmcd_service = service.proxy("pmcd");
        var pmlogger_service = service.proxy("pmlogger");
        var pmlogger_promise;

        $("#server-pmlogger-switch").on("change", function(ev) {
            var val = $(this).onoff('value');
            if (pmlogger_service.exists) {
                if (val) {
                    pmlogger_promise = $.when(pmcd_service.enable(),
                           pmcd_service.start(),
                           pmlogger_service.enable(),
                           pmlogger_service.start()).
                        fail(function (error) {
                            console.warn("Enabling pmlogger failed", error);
                        });
                } else {
                    pmlogger_promise = $.when(pmlogger_service.disable(),
                           pmlogger_service.stop()).
                        fail(function (error) {
                            console.warn("Disabling pmlogger failed", error);
                        });
                }
                pmlogger_promise.always(function() {
                    pmlogger_promise = null;
                    refresh_pmlogger_state();
                });
            }
        });

        function refresh_pmlogger_state() {
            if (!pmlogger_service.exists)
                $('#server-pmlogger-onoff-row').hide();
            else if (!pmlogger_promise) {
                $("#server-pmlogger-switch").onoff('value', pmlogger_service.enabled);
                $('#server-pmlogger-onoff-row').show();
            }
        }

        $(pmlogger_service).on('changed', refresh_pmlogger_state);
        refresh_pmlogger_state();
    },

    enter: function() {
        var self = this;

        self.client = cockpit.dbus('org.freedesktop.hostname1');
        self.hostname_proxy = self.client.proxy('org.freedesktop.hostname1',
                                     '/org/freedesktop/hostname1');
        self.kernel_hostname = null;

        // HACK: We really should use OperatingSystemPrettyName
        // from hostname1 here. Once we require system > 211
        // we should change this.
        function parse_pretty_name(data, tag, ex) {
            if (ex) {
                console.warn("couldn't load os data: " + ex);
                data = "";
            }

            var lines = data.split("\n");
            for (var i = 0; i < lines.length; i++) {
                var parts = lines[i].split("=");
                if (parts[0] === "PRETTY_NAME") {
                    var text = parts[1];
                    try {
                        text = JSON.parse(text);
                    } catch (e) {}
                    $("#system_information_os_text").text(text);
                    break;
                }
            }
        }

        self.os_file = cockpit.file(self.os_file_name);
        self.os_file.watch(parse_pretty_name);

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
        $.extend(cpu_options.yaxis, { tickFormatter: function(v) { return v.toFixed(0); },
                                      max: 100
                                    });
        self.cpu_plot = shell.plot($("#server_cpu_graph"), 300);
        self.cpu_plot.set_options(cpu_options);
        series = self.cpu_plot.add_metrics_sum_series(cpu_data, { });

        /* Memory graph */

        var memory_data = {
            direct: [ "mem.util.used" ],
            internal: [ "memory.used" ],
            units: "bytes"
        };

        var memory_options = shell.plot_simple_template();
        $.extend(memory_options.yaxis, { ticks: shell.memory_ticks,
                                         tickFormatter: shell.format_bytes_tick_no_unit
                                       });
        memory_options.setup_hook = function memory_setup_hook(plot) {
            var axes = plot.getAxes();
            $('#server_memory_unit').text(shell.bytes_tick_unit(axes.yaxis));
        };

        self.memory_plot = shell.plot($("#server_memory_graph"), 300);
        self.memory_plot.set_options(memory_options);
        series = self.memory_plot.add_metrics_sum_series(memory_data, { });

        /* Network graph */

        var network_data = {
            direct: [ "network.interface.total.bytes" ],
            internal: [ "network.all.tx", "network.all.rx" ],
            units: "bytes",
            derive: "rate"
        };

        var network_options = shell.plot_simple_template();
        $.extend(network_options.yaxis, { tickFormatter: shell.format_bits_per_sec_tick_no_unit
                                        });
        network_options.setup_hook = function network_setup_hook(plot) {
            var axes = plot.getAxes();
            if (axes.yaxis.datamax < 100000)
                axes.yaxis.options.max = 100000;
            else
                axes.yaxis.options.max = null;
            axes.yaxis.options.min = 0;

            $('#server_network_traffic_unit').text(shell.bits_per_sec_tick_unit(axes.yaxis));
        };

        self.network_plot = shell.plot($("#server_network_traffic_graph"), 300);
        self.network_plot.set_options(network_options);
        series = self.network_plot.add_metrics_sum_series(network_data, { });

        /* Disk IO graph */

        var disk_data = {
            direct: [ "disk.dev.total_bytes" ],
            internal: [ "block.device.read", "block.device.written" ],
            units: "bytes",
            derive: "rate"
        };

        var disk_options = shell.plot_simple_template();
        $.extend(disk_options.yaxis, { ticks: shell.memory_ticks,
                                       tickFormatter: shell.format_bytes_per_sec_tick_no_unit
                                     });
        disk_options.setup_hook = function disk_setup_hook(plot) {
            var axes = plot.getAxes();
            if (axes.yaxis.datamax < 100000)
                axes.yaxis.options.max = 100000;
            else
                axes.yaxis.options.max = null;
            axes.yaxis.options.min = 0;

            $('#server_disk_io_unit').text(shell.bytes_per_sec_tick_unit(axes.yaxis));
        };

        self.disk_plot = shell.plot($("#server_disk_io_graph"), 300);
        self.disk_plot.set_options(disk_options);
        series = self.disk_plot.add_metrics_sum_series(disk_data, { });

        shell.util.machine_info(null).
            done(function (info) {
                cpu_options.yaxis.max = info.cpus * 100;
                self.cpu_plot.set_options(cpu_options);
                memory_options.yaxis.max = info.memory;
                self.memory_plot.set_options(memory_options);
            });

        self.plot_controls.reset([ self.cpu_plot, self.memory_plot, self.network_plot, self.disk_plot ]);

        $(window).on('resize.server', function () {
            self.cpu_plot.resize();
            self.memory_plot.resize();
            self.network_plot.resize();
            self.disk_plot.resize();
        });

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
                      { directory: "/sys/devices/virtual/dmi/id", err: "ignore" })
            .done(function(output) {
                var fields = parse_lines(output);
                $("#system_information_bios_text").text(fields.bios_vendor + " " +
                                                        fields.bios_version + " (" +
                                                        fields.bios_date + ")");
                $("#system_information_hardware_text").text(fields.sys_vendor + " " +
                                                            fields.product_name);
            })
            .fail(function(ex) {
                debug("couldn't read dmi info: " + ex);
            });

        cockpit.spawn(["grep", "\\w", "product_serial", "chassis_serial"],
                      { directory: "/sys/devices/virtual/dmi/id", superuser: "try", err: "ignore" })
            .done(function(output) {
                var fields = parse_lines(output);
                $("#system_information_asset_tag_text").text(fields.product_serial ||
                                                             fields.chassis_serial);
            })
            .fail(function(ex) {
                debug("couldn't read serial dmi info: " + ex);
            });

        function hostname_text() {
            if (!self.hostname_proxy)
                return;

            var pretty_hostname = self.hostname_proxy.PrettyHostname;
            var static_hostname = self.hostname_proxy.StaticHostname;

            var str = self.kernel_hostname;
            if (pretty_hostname && static_hostname && static_hostname != pretty_hostname)
                str = pretty_hostname + " (" + static_hostname + ")";
            else if (static_hostname)
                str = static_hostname;

            if (!str)
                str = _("Set Host name");
            $("#system_information_hostname_button").text(str);
        }

        cockpit.spawn(["hostname"], { err: "ignore" })
            .done(function(output) {
                self.kernel_hostname = $.trim(output);
                hostname_text();
            })
            .fail(function(ex) {
                hostname_text();
                debug("couldn't read kernel hostname: " + ex);
            });
        $(self.hostname_proxy).on("changed", hostname_text);
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

        self.os_file.close();
        self.os_file = null;

        $(self.hostname_proxy).off();
        self.hostname_proxy = null;

        self.client.close();
        self.client = null;

        $(cockpit).off('.server');
    },

    shutdown: function(action_type) {
        PageShutdownDialog.type = action_type;
        $('#shutdown-dialog').modal('show');
    },
};

function PageServer() {
    this._init();
}

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

        self.hostname_proxy = PageSystemInformationChangeHostname.client.proxy();

        self._initial_hostname = self.hostname_proxy.StaticHostname || "";
        self._initial_pretty_hostname = self.hostname_proxy.PrettyHostname || "";
        $("#sich-pretty-hostname").val(self._initial_pretty_hostname);
        $("#sich-hostname").val(self._initial_hostname);

        this._always_update_from_pretty = false;
        this._update();
    },

    show: function() {
        $("#sich-pretty-hostname").focus();
    },

    leave: function() {
        this.hostname_proxy = null;
    },

    _on_apply_button: function(event) {
        var self = this;

        var new_full_name = $("#sich-pretty-hostname").val();
        var new_name = $("#sich-hostname").val();

        var one = self.hostname_proxy.call("SetStaticHostname", [new_name, true]);
        var two = self.hostname_proxy.call("SetPrettyHostname", [new_full_name, true]);
        $("#system_information_change_hostname").dialog("promise", $.when(one, two));
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

PageSystemInformationChangeSystime.prototype = {
    _init: function() {
        this.id = "system_information_change_systime";
        this.date = "";
    },

    setup: function() {
        function enable_apply_button() {
            $('#systime-apply-button').prop('disabled', false);
        }

        $("#systime-apply-button").on("click", $.proxy(this._on_apply_button, this));
        $('#change_systime').on('change', $.proxy(this, "update"));
        $('#systime-time-minutes').on('focusout', $.proxy(this, "update_minutes"));
        $('#systime-date-input').datepicker({
            autoclose: true,
            todayHighlight: true,
            format: 'yyyy-mm-dd'
        });
        $('#systime-timezones').css('max-height', '10em');
        $('#systime-timezones').combobox();

        $('#systime-time-minutes').on('input', enable_apply_button);
        $('#systime-time-hours').on('input', enable_apply_button);
        $('#systime-date-input').on('input', enable_apply_button);
        $('#systime-timezones').on('change', enable_apply_button);
        $('#systime-date-input').on('focusin', $.proxy(this, "store_date"));
        $('#systime-date-input').on('focusout', $.proxy(this, "restore_date"));
    },

    enter: function() {
        var server_time = PageSystemInformationChangeSystime.server_time;

        $('#systime-date-input').val(server_time.format());
        $('#systime-time-minutes').val(server_time.now.getUTCMinutes());
        $('#systime-time-hours').val(server_time.now.getUTCHours());
        $('#change_systime').val(server_time.timedate.NTP ? 'ntp_time' : 'manual_time');
        $('#change_systime').selectpicker('refresh');
        $('#systime-parse-error').parents('tr').hide();
        $('#systime-timezone-error').parents('tr').hide();
        $('#systime-apply-button').prop('disabled', false);
        $('#systime-timezones').prop('disabled', 'disabled');

        this.update();
        this.update_minutes();
        this.get_timezones();
    },

    get_timezones: function() {
        var self = this;

        function parse_timezones(content) {
            var timezones = [];
            var lines = content.split('\n');
            var curr_timezone = PageSystemInformationChangeSystime.server_time.timedate.Timezone;

            $('#systime-timezones').empty();

            for (var i = 0; i < lines.length; i++) {
                $('#systime-timezones').append($('<option>', {
                    value: lines[i],
                    text: lines[i].replace(/_/g, " "),
                    selected: lines[i] == curr_timezone
                }));
            }

            $('#systime-timezones').prop('disabled', false);
            $('#systime-timezones').combobox('refresh');
        }

        cockpit.spawn(["/usr/bin/timedatectl", "list-timezones"])
           .done(parse_timezones);
    },

    show: function() {
    },

    leave: function() {
    },

    _on_apply_button: function(event) {
        var server_time = PageSystemInformationChangeSystime.server_time;

        if (!this.check_input())
            return;

        var manual_time = $('#change_systime').val() == 'manual_time';

        var promise = server_time.timedate.call('SetNTP', [!manual_time, true])
            .done(function() {
                var promises = [];
                var promise;

                if (!$('#systime-timezones').prop('disabled')) {
                    promise = server_time.timedate.call('SetTimezone', [$('#systime-timezones').val(), true]);
                    promises.push(promise);
                }

                if (manual_time) {
                    promise = server_time.change_time($("#systime-date-input").val(),
                                                      $('#systime-time-hours').val(),
                                                      $('#systime-time-minutes').val());
                    promises.push(promise);
                }

                $("#system_information_change_systime").dialog("promise", $.when.apply($, promises));
            })
            .fail(function(ex) {
                $("#system_information_change_systime").dialog("failure", ex);
            });
        $("#system_information_change_systime").dialog("wait", promise);
    },

    check_input: function() {
        var time_error = false;
        var date_error = false;
        var timezone_error = false;
        var new_date;

        var hours = parseInt($('#systime-time-hours').val(), 10);
        var minutes = parseInt($('#systime-time-minutes').val(), 10);

        if (isNaN(hours) || hours < 0 || hours > 23  ||
            isNaN(minutes) || minutes < 0 || minutes > 59) {
           time_error = true;
        }

        new_date = new Date($("#systime-date-input").val());

        if (isNaN(new_date.getTime()) || new_date.getTime() < 0)
            date_error = true;

        if (time_error && date_error)
           $('#systime-parse-error').text(_("Invalid date format and invalid time format"));
        else if (time_error)
           $('#systime-parse-error').text(_("Invalid time format"));
        else if (date_error)
           $('#systime-parse-error').text(_("Invalid date format"));

        if ($('#systime-timezones').val() === "") {
           timezone_error = true;
           $('#systime-timezone-error').css('visibility', 'visible');
        } else {
           $('#systime-timezone-error').css('visibility', 'hidden');
        }

        $('#systime-timezones').toggleClass("has-error", ! timezone_error);
        $('#systime-time-hours').toggleClass("has-error", ! time_error);
        $('#systime-time-minutes').toggleClass("has-error", ! time_error);
        $('#systime-date-input').toggleClass("has-error", ! date_error);

        $('#systime-parse-error').parents('tr').toggle(time_error || date_error);
        $('#systime-timezone-error').parents('tr').toggle(timezone_error);

        if (time_error || date_error || timezone_error) {
            $('#systime-apply-button').prop('disabled', true);
            return false;
        } else {
            $('#systime-apply-button').prop('disabled', false);
            return true;
        }
    },

    update: function() {
        var ntp_time = $('#change_systime').val() === 'ntp_time';
        $("#systime-date-input").prop('disabled', ntp_time);
        $("#systime-time-hours").prop('disabled', ntp_time);
        $("#systime-time-minutes").prop('disabled', ntp_time);
    },

    update_minutes: function() {
        var val = parseInt($('#systime-time-minutes').val(), 10);
        if (val < 10)
            $('#systime-time-minutes').val("0" + val);
    },

    store_date: function() {
        this.date = $("#systime-date-input").val();
    },

    restore_date: function() {
        if ($("#systime-date-input").val().length === 0)
            $("#systime-date-input").val(this.date);
    }
};

function PageSystemInformationChangeSystime() {
    this._init();
}

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

        var promise = cockpit.spawn(["shutdown", arg, when, message], { superuser: "try" });
        $('#shutdown-dialog').dialog("promise", promise);
        promise.done(function() {
            if (op == "restart")
                cockpit.hint("restart");
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

PageCpuStatus.prototype = {
    _init: function() {
        this.id = "cpu_status";
    },

    getTitle: function() {
        return C_("page-title", "CPU Status");
    },

    enter: function() {
        var self = this;

        var options = {
            series: {shadowSize: 0,
                     lines: {lineWidth: 0, fill: true}
                    },
            yaxis: {min: 0,
                    max: 100,
                    show: true,
                    ticks: 5,
                    tickFormatter: function(v) { return (v / 10) + "%"; }},
            xaxis: {show: true,
                    ticks: [[0.0*60, "5 min"],
                            [1.0*60, "4 min"],
                            [2.0*60, "3 min"],
                            [3.0*60, "2 min"],
                            [4.0*60, "1 min"]]},
            legend: { show: true },
            x_rh_stack_graphs: true
        };

        var metrics = [
            { name: "cpu.basic.iowait", derive: "rate" },
            { name: "cpu.basic.system", derive: "rate" },
            { name: "cpu.basic.user", derive: "rate" },
            { name: "cpu.basic.nice", derive: "rate" },
        ];

        var series = [
            { color: "#e41a1c", label: _("I/O Wait") },
            { color: "#ff7f00", label: _("Kernel") },
            { color: "#377eb8", label: _("User") },
            { color: "#4daf4a", label: _("Nice") },
        ];

        self.channel = cockpit.metrics(1000, {
            source: "internal",
            metrics: metrics,
            cache: "cpu-status-rate"
        });

        /* The grid shows us the last five minutes */
        self.grid = cockpit.grid(1000, -300, -0);

        var i;
        for(i = 0; i < series.length; i++) {
            series[i].row = self.grid.add(self.channel, [ metrics[i].name ]);
        }

        /* Start pulling data, and make the grid follow the data */
        self.channel.follow();
        self.grid.walk();

        this.plot = shell.setup_complicated_plot("#cpu_status_graph", self.grid, series, options);

        shell.util.machine_info().
            done(function (info) {
                self.plot.set_yaxis_max(info.cpus * 1000);
            });
    },

    show: function() {
        this.plot.start();
    },

    leave: function() {
        this.plot.destroy();
        this.channel.close();
        this.channel = null;
    }
};

function PageCpuStatus() {
    this._init();
}

PageMemoryStatus.prototype = {
    _init: function() {
        this.id = "memory_status";
    },

    getTitle: function() {
        return C_("page-title", "Memory");
    },

    enter: function() {
        var self = this;

        var options = {
            series: {shadowSize: 0, // drawing is faster without shadows
                     lines: {lineWidth: 0.0, fill: true}
                    },
            yaxis: {min: 0,
                    ticks: 5,
                    tickFormatter: function (v) {
                        return cockpit.format_bytes(v);
                    }
                   },
            xaxis: {show: true,
                    ticks: [[0.0*60, "5 min"],
                            [1.0*60, "4 min"],
                            [2.0*60, "3 min"],
                            [3.0*60, "2 min"],
                            [4.0*60, "1 min"]]},
            legend: { show: true },
            x_rh_stack_graphs: true
        };

        var metrics = [
            { name: "memory.swap-used" },
            { name: "memory.cached" },
            { name: "memory.used" },
            { name: "memory.free" },
        ];

        var series = [
            { color: "#e41a1c", label: _("Swap Used") },
            { color: "#ff7f00", label: _("Cached") },
            { color: "#377eb8", label: _("Used") },
            { color: "#4daf4a", label: _("Free") },
        ];

        self.channel = cockpit.metrics(1000, {
            source: "internal",
            metrics: metrics,
            cache: "memory-status"
        });

        /* The grid shows us the last five minutes */
        self.grid = cockpit.grid(1000, -300, -0);

        var i;
        for(i = 0; i < series.length; i++) {
            series[i].row = self.grid.add(self.channel, [ metrics[i].name ]);
        }

        /* Start pulling data, and make the grid follow the data */
        self.channel.follow();
        self.grid.walk();

        this.plot = shell.setup_complicated_plot("#memory_status_graph", self.grid, series, options);
    },

    show: function() {
        this.plot.start();
    },

    leave: function() {
        this.plot.destroy();
        this.channel.close();
        this.channel = null;
    }
};

function PageMemoryStatus() {
    this._init();
}

$("#link-cpu").on("click", function() {
    cockpit.location.go([ "cpu" ]);
    return false;
});

$("#link-memory").on("click", function() {
    cockpit.location.go([ "memory" ]);
    return false;
});

$("#link-network").on("click", function() {
    cockpit.jump("/network");
    return false;
});

$("#link-disk").on("click", function() {
    cockpit.jump("/storage");
    return false;
});


/*
 * INITIALIZATION AND NAVIGATION
 *
 * The code above still uses the legacy 'Page' abstraction for both
 * pages and dialogs, and expects page.setup, page.enter, page.show,
 * and page.leave to be called at the right times.
 *
 * We cater to this with a little compatability shim consisting of
 * 'dialog_setup', 'page_show', and 'page_hide'.
 */

function dialog_setup(d) {
    d.setup();
    var already_entered = false;
    $('#' + d.id).
        on('show.bs.modal', function (event) {
            if (event.target.id === d.id)
                d.enter();
        }).
        on('shown.bs.modal', function (event) {
            if (event.target.id === d.id)
              d.show();
        }).
        on('hidden.bs.modal', function (event) {
            if (event.target.id === d.id)
              d.leave();
        });
}

function page_show(p, arg) {
    if (!p._entered_)
        p.enter(arg);
    p._entered_ = true;
    $('#' + p.id).show().removeAttr("hidden");
    p.show();
}

function page_hide(p) {
    $('#' + p.id).hide();
}

function init() {
    var server_page;
    var memory_page;
    var cpu_page;

    function navigate() {
        var path = cockpit.location.path;

        if (path.length === 0) {
            page_hide(cpu_page);
            page_hide(memory_page);
            page_show(server_page);
        } else if (path.length === 1 && path[0] == 'cpu') {
            page_hide(server_page);
            page_hide(memory_page);
            page_show(cpu_page);
        } else if (path.length === 1 && path[0] == 'memory') {
            page_hide(server_page);
            page_hide(cpu_page);
            page_show(memory_page);
        } else { /* redirect */
            console.warn("not a system location: " + path);
            cockpit.location = '';
        }

        $("body").removeAttr("hidden");
    }

    cockpit.translate();

    server_page = new PageServer();
    server_page.setup();

    cpu_page = new PageCpuStatus();
    memory_page = new PageMemoryStatus();

    dialog_setup(new PageSystemInformationChangeHostname());
    dialog_setup(new PageSystemInformationChangeSystime());
    dialog_setup(new PageShutdownDialog());

    $(cockpit).on("locationchanged", navigate);
    navigate();
}

return init;

});
