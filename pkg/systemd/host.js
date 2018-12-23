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
import { mustache } from "mustache";
import $ from "jquery";

import "polyfills.js";
import cockpit from "cockpit";
import * as machine_info from "machine-info.js";
import * as packagekit from "packagekit.js";
import { install_dialog } from "cockpit-components-install-dialog.jsx";
import * as plot from "plot.js";
import * as service from "service.js";
import { shutdown } from "./shutdown.js";
import host_keys_script from "raw-loader!./ssh-list-host-keys.sh";

/* These add themselves to jQuery so just including is enough */
import "patterns";
import "bootstrap-datepicker/dist/js/bootstrap-datepicker";
import "patternfly-bootstrap-combobox/js/bootstrap-combobox";

const _ = cockpit.gettext;
var C_ = cockpit.gettext;

var permission = cockpit.permission({ admin: true });
$(permission).on("changed", update_hostname_privileged);
$(permission).on("changed", update_shutdown_privileged);
$(permission).on("changed", update_systime_privileged);

function update_hostname_privileged() {
    $(".hostname-privileged").update_privileged(
        permission, cockpit.format(
            _("The user <b>$0</b> is not permitted to modify hostnames"),
            permission.user ? permission.user.name : ''), null, $('#hostname-tooltip')
    );
}

function update_shutdown_privileged() {
    $(".shutdown-privileged").update_privileged(
        permission, cockpit.format(
            _("The user <b>$0</b> is not permitted to shutdown or restart this server"),
            permission.user ? permission.user.name : '')
    );
}

function update_systime_privileged() {
    $(".systime-privileged").update_privileged(
        permission, cockpit.format(
            _("The user <b>$0</b> is not permitted to change the system time"),
            permission.user ? permission.user.name : ''), null, $('#systime-tooltip')
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

    self.timedate1_service = service.proxy("dbus-org.freedesktop.timedate1.service");
    self.timesyncd_service = service.proxy("systemd-timesyncd.service");

    /*
     * The time we return from here as its UTC time set to the
     * server time. This is the only way to get predictable
     * behavior and formatting of a Date() object in the absence of
     * IntlDateFormat and  friends.
     */
    Object.defineProperty(self, 'utc_fake_now', {
        enumerable: true,
        get: function get() {
            var offset = time_offset + remote_offset;
            return new Date(offset + (new Date()).valueOf());
        }
    });

    Object.defineProperty(self, 'now', {
        enumerable: true,
        get: function get() {
            return new Date(time_offset + (new Date()).valueOf());
        }
    });

    self.format = function format(and_time) {
        var string = self.utc_fake_now.toISOString();
        if (!and_time)
            return string.split('T')[0];
        var pos = string.lastIndexOf(':');
        if (pos !== -1)
            string = string.substring(0, pos);
        return string.replace('T', ' ');
    };

    self.updateInterval = window.setInterval(function() {
        $(self).triggerHandler("changed");
    }, 30000);

    self.wait = function wait() {
        if (remote_offset === null)
            return self.update();
        return cockpit.resolve();
    };

    self.update = function update() {
        return cockpit.spawn(["date", "+%s:%:z"], { err: "message" })
                .done(function(data) {
                    var parts = data
                            .trim()
                            .split(":")
                            .map(function(x) {
                                return parseInt(x, 10);
                            });
                    if (parts[1] < 0)
                        parts[2] = -(parts[2]);
                    var timems = parts[0] * 1000;
                    var offsetms = (parts[1] * 3600000) + parts[2] * 60000;
                    var now = new Date();
                    time_offset = (timems - now.valueOf());
                    remote_offset = offsetms;
                    $(self).triggerHandler("changed");
                })
                .fail(function(ex) {
                    console.log("Couldn't calculate server time offset: " + cockpit.message(ex));
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
        cockpit.spawn(["date", "--date=" + datestr + " " + hourstr + ":" + minstr, "+%s"])
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

    self.poll_ntp_synchronized = function poll_ntp_synchronized() {
        client.call(timedate.path,
                    "org.freedesktop.DBus.Properties", "Get", [ "org.freedesktop.timedate1", "NTPSynchronized" ])
                .fail(function(error) {
                    if (error.name != "org.freedesktop.DBus.Error.UnknownProperty" &&
                        error.problem != "not-found")
                        console.log("can't get NTPSynchronized property", error);
                })
                .done(function(result) {
                    var ifaces = { "org.freedesktop.timedate1": { NTPSynchronized: result[0].v } };
                    var data = { };
                    data[timedate.path] = ifaces;
                    client.notify(data);
                });
    };

    self.close = function close() {
        client.close();
    };

    self.update();
}

var change_systime_dialog;

PageServer.prototype = {
    _init: function() {
        this.id = "server";
        this.server_time = null;
        this.client = null;
        this.hostname_proxy = null;
        this.os_updates = null; // packagekit.Enum.INFO_* → #count
        this.os_updates_icon = document.getElementById("system_information_updates_icon");
        this.unregistered = false;
    },

    getTitle: function() {
        return null;
    },

    setup: function() {
        var self = this;
        update_hostname_privileged();

        cockpit.file("/etc/motd").watch(function(content) {
            if (content)
                content = $.trim(content);
            if (content && content != cockpit.localStorage.getItem('dismissed-motd')) {
                $('#motd').text(content);
                $('#motd-box').show();
            } else {
                $('#motd-box').hide();
            }
            // To help the tests known when we have loaded motd
            $('#motd-box').attr('data-stable', 'yes');
        });

        $('#motd-box button.close').click(function() {
            cockpit.localStorage.setItem('dismissed-motd', $('#motd').text());
            $('#motd-box').hide();
        });

        $('#shutdown-group [data-action]').on("click", function() {
            self.shutdown($(this).attr('data-action'));
        });

        $('#system-ostree-version-link').on('click', function() {
            cockpit.jump("/updates", cockpit.transport.host);
        });

        $('#system_information_hostname_button').on('click', function() {
            PageSystemInformationChangeHostname.client = self.client;
            $('#system_information_change_hostname').modal('show');
        });

        $('#system_information_systime_button').on('click', function() {
            change_systime_dialog.display(self.server_time);
        });

        self.server_time = new ServerTime();
        $(self.server_time).on("changed", function() {
            $('#system_information_systime_button').text(self.server_time.format(true));
        });

        self.ntp_status_tmpl = $("#ntp-status-tmpl").html();
        mustache.parse(this.ntp_status_tmpl);

        self.ntp_status_icon_tmpl = $("#ntp-status-icon-tmpl").html();
        mustache.parse(this.ntp_status_icon_tmpl);

        self.ssh_host_keys_tmpl = $("#ssh-host-keys-tmpl").html();
        mustache.parse(this.ssh_host_keys_tmpl);

        $("#system_information_ssh_keys").on("show.bs.modal", function() {
            self.host_keys_show();
        });

        $("#system_information_ssh_keys").on("hide.bs.modal", function() {
            self.host_keys_hide();
        });

        var $ntp_status = $('#system_information_systime_ntp_status');

        function update_ntp_status() {
            if (!self.server_time.timedate.NTP) {
                $ntp_status.hide();
                $ntp_status.attr("data-original-title", null);
                return;
            }

            $ntp_status.show();

            var model = {
                Synched: self.server_time.timedate.NTPSynchronized,
                service: null
            };

            var timesyncd_server_regex = /.*time server (.*)\./i;

            var timesyncd_status = (self.server_time.timesyncd_service.state == "running" &&
                                    self.server_time.timesyncd_service.service &&
                                    self.server_time.timesyncd_service.service.StatusText);

            if (self.server_time.timesyncd_service.state == "running")
                model.service = "systemd-timesyncd.service";

            if (timesyncd_status) {
                var match = timesyncd_status.match(timesyncd_server_regex);
                if (match)
                    model.Server = match[1];
                else if (timesyncd_status != "Idle." && timesyncd_status !== "")
                    model.SubStatus = timesyncd_status;
            }

            var tooltip_html = mustache.render(self.ntp_status_tmpl, model);
            if (tooltip_html != $ntp_status.attr("data-original-title"))
                $ntp_status.attr("data-original-title", tooltip_html);

            var icon_html = mustache.render(self.ntp_status_icon_tmpl, model);
            $ntp_status.html(icon_html);
        }

        $ntp_status.tooltip();

        $(self.server_time.timesyncd_service).on("changed", update_ntp_status);
        $(self.server_time.timedate).on("changed", update_ntp_status);
        update_ntp_status();

        /* NTPSynchronized needs to be polled so we just do that
         * always.
         */
        window.setInterval(function() {
            self.server_time.poll_ntp_synchronized();
        }, 5000);

        $('#server').on('click', "[data-goto-service]", function() {
            var service = $(this).attr("data-goto-service");
            cockpit.jump("/system/services/#/" + window.encodeURIComponent(service),
                         cockpit.transport.host);
        });

        self.plot_controls = plot.setup_plot_controls($('#server'), $('#server-graph-toolbar'));

        var pmcd_service = service.proxy("pmcd");
        var pmlogger_service = service.proxy("pmlogger");
        var pmlogger_promise;
        var pmlogger_exists = false;
        var packagekit_exists = false;

        function update_pmlogger_row() {
            if (!pmlogger_exists) {
                $('#system-information-enable-pcp').toggle(packagekit_exists);
                $('#server-pmlogger-onoff-row').hide();
            } else if (!pmlogger_promise) {
                $('#system-information-enable-pcp').hide();
                $("#server-pmlogger-switch").onoff('value', pmlogger_service.enabled);
                $('#server-pmlogger-onoff-row').show();
            }
        }

        function pmlogger_service_changed() {
            pmlogger_exists = pmlogger_service.exists;

            /* HACK: The pcp packages on Ubuntu and Debian include SysV init
             * scripts in /etc, which stay around when removing (as opposed to
             * purging) the package. Systemd treats those as valid units, even
             * if they're not backed by packages anymore. Thus,
             * pmlogger_service.exists will be true. Check for the binary
             * directly to make sure the package is actually available.
             */
            if (pmlogger_exists) {
                cockpit.spawn([ "which", "pmlogger" ], { err: "ignore" })
                        .fail(function() {
                            pmlogger_exists = false;
                        })
                        .always(update_pmlogger_row);
            } else {
                update_pmlogger_row();
            }
        }

        packagekit.detect().then(function(exists) {
            packagekit_exists = exists;
            update_pmlogger_row();
        });

        $("#server-pmlogger-switch").on("change", function(ev) {
            if (!pmlogger_exists)
                return;

            if ($(this).onoff('value')) {
                pmlogger_promise = cockpit.all(pmcd_service.enable(),
                                               pmcd_service.start(),
                                               pmlogger_service.enable(),
                                               pmlogger_service.start())
                        .fail(function(error) {
                            console.warn("Enabling pmlogger failed", error);
                        });
            } else {
                pmlogger_promise = cockpit.all(pmlogger_service.disable(),
                                               pmlogger_service.stop())
                        .fail(function(error) {
                            console.warn("Disabling pmlogger failed", error);
                        });
            }
            pmlogger_promise.always(function() {
                pmlogger_promise = null;
                pmlogger_service_changed();
            });
        });

        $(pmlogger_service).on('changed', pmlogger_service_changed);
        pmlogger_service_changed();

        // if cockpit component "page" is available, set element content to a link to it, otherwise just text
        function set_page_link(element_sel, page, text) {
            if (cockpit.manifests[page]) {
                var link = document.createElement("a");
                link.innerHTML = text;
                link.addEventListener("click", function() { cockpit.jump("/" + page) });
                $(element_sel).html(link);
            } else {
                $(element_sel).text(text);
            }
        }

        function refresh_os_updates_state() {
            self.os_updates_icon.className = ""; // hide spinner

            // if system is unregistered, always show that
            if (self.unregistered) {
                self.os_updates_icon.className = "pficon pficon-warning-triangle-o";
                set_page_link("#system_information_updates_text", "subscriptions", _("System Not Registered"));
                return;
            }

            var infos = Object.keys(self.os_updates || {}).sort();
            if (infos.length === 0) {
                $("#system_information_updates_text").text(_("System Up To Date"));
                return;
            }

            // show highest severity level
            var severity = infos[infos.length - 1];
            var text;
            self.os_updates_icon.className = packagekit.getSeverityIcon(
                severity > packagekit.Enum.INFO_UNKNOWN ? severity : packagekit.Enum.INFO_NORMAL);
            if (severity == packagekit.Enum.INFO_SECURITY)
                text = _("Security Updates Available");
            else if (severity >= packagekit.Enum.INFO_NORMAL)
                text = _("Bug Fix Updates Available");
            else if (severity >= packagekit.Enum.INFO_LOW)
                text = _("Enhancement Updates Available");
            else
                text = _("Updates Available");

            set_page_link("#system_information_updates_text", "updates", text);
        }

        function check_for_updates() {
            var os_updates = { };
            self.os_updates = null;

            packagekit.cancellableTransaction(
                "GetUpdates", [0],
                function(data) {
                    // we are getting progress, so PackageKit works; show spinner
                    if (self.os_updates === null) {
                        self.os_updates = os_updates;
                        $("#system_information_updates_text").text(_("Checking for updates…"));
                        self.os_updates_icon.className = "spinner spinner-xs spinner-inline";
                    }
                },
                {
                    Package: function(info) {
                        // dnf backend yields wrong severity (https://bugs.freedesktop.org/show_bug.cgi?id=101070)
                        if (info < packagekit.Enum.INFO_LOW || info > packagekit.Enum.INFO_SECURITY)
                            info = packagekit.Enum.INFO_UNKNOWN;
                        os_updates[info] = (os_updates[info] || 0) + 1;
                    }
                })
                    .then(refresh_os_updates_state)
                    .catch(function(ex) {
                        // if PackageKit is not available, hide the table line
                        console.warn("Checking for available updates failed:", ex.toString());
                        self.os_updates_icon.className = "";
                        $("#system_information_updates_text").toggle(false);
                    });
        }

        // check for updates now and on page switches, in case they get applied on /updates or terminal
        $(cockpit).on("visibilitychange", check_for_updates);
        check_for_updates();

        // check for unregistered system
        packagekit.watchRedHatSubscription(function(subscribed) {
            self.unregistered = !subscribed;
            refresh_os_updates_state();
        });
    },

    enter: function() {
        var self = this;

        var machine_id = cockpit.file("/etc/machine-id");
        machine_id.read()
                .done(function(content) {
                    $("#system_machine_id")
                            .text(content)
                            .tooltip({ title: content, placement: "bottom" });
                })
                .fail(function(ex) {
                    console.error("Error reading machine id", ex);
                })
                .always(function() {
                    machine_id.close();
                });

        self.ostree_client = cockpit.dbus('org.projectatomic.rpmostree1',
                                          {"superuser" : true});
        $(self.ostree_client).on("close", function() {
            self.ostree_client = null;
        });

        self.sysroot = self.ostree_client.proxy('org.projectatomic.rpmostree1.Sysroot',
                                                '/org/projectatomic/rpmostree1/Sysroot');
        $(self.sysroot).on("changed", $.proxy(this, "sysroot_changed"));

        self.client = cockpit.dbus('org.freedesktop.hostname1',
                                   {"superuser" : "try"});
        self.hostname_proxy = self.client.proxy('org.freedesktop.hostname1',
                                                '/org/freedesktop/hostname1');
        self.kernel_hostname = null;

        /* CPU graph */

        var cpu_data = {
            direct: [ "kernel.all.cpu.nice", "kernel.all.cpu.user", "kernel.all.cpu.sys" ],
            internal: [ "cpu.basic.nice", "cpu.basic.user", "cpu.basic.system" ],
            units: "millisec",
            derive: "rate",
            factor: 0.1 // millisec / sec -> percent
        };

        var cpu_options = plot.plot_simple_template();
        $.extend(cpu_options.yaxis,
                 {
                     tickFormatter: function(v) { return v.toFixed(0) },
                     max: 100
                 }
        );
        self.cpu_plot = new plot.Plot($("#server_cpu_graph"), 300);
        self.cpu_plot.set_options(cpu_options);
        // This is added to the plot once we have the machine info, see below.

        /* Memory graph */

        var memory_data = {
            direct: [ "mem.physmem", "mem.util.available" ],
            internal: [ "memory.used" ],
            units: "bytes"
        };

        var memory_options = plot.plot_simple_template();
        $.extend(memory_options.yaxis,
                 {
                     ticks: plot.memory_ticks,
                     tickFormatter: plot.format_bytes_tick_no_unit
                 });
        memory_options.post_hook = function memory_post_hook(pl) {
            var axes = pl.getAxes();
            $('#server_memory_unit').text(plot.bytes_tick_unit(axes.yaxis));
        };

        self.memory_plot = new plot.Plot($("#server_memory_graph"), 300);
        self.memory_plot.set_options(memory_options);
        self.memory_plot.add_metrics_difference_series(memory_data, { });

        /* Network graph */

        var network_data = {
            direct: [ "network.interface.total.bytes" ],
            internal: [ "network.interface.tx", "network.interface.rx" ],
            "omit-instances": [ "lo" ],
            units: "bytes",
            derive: "rate"
        };

        var network_options = plot.plot_simple_template();
        $.extend(network_options.yaxis, { tickFormatter: plot.format_bits_per_sec_tick_no_unit });
        network_options.setup_hook = function network_setup_hook(pl) {
            var axes = pl.getAxes();
            if (axes.yaxis.datamax < 100000)
                axes.yaxis.options.max = 100000;
            else
                axes.yaxis.options.max = null;
            axes.yaxis.options.min = 0;
        };
        network_options.post_hook = function network_post_hook(pl) {
            var axes = pl.getAxes();
            $('#server_network_traffic_unit').text(plot.bits_per_sec_tick_unit(axes.yaxis));
        };

        self.network_plot = new plot.Plot($("#server_network_traffic_graph"), 300);
        self.network_plot.set_options(network_options);
        self.network_plot.add_metrics_sum_series(network_data, { });

        /* Disk IO graph */

        var disk_data = {
            direct: [ "disk.all.total_bytes" ],
            internal: [ "disk.all.read", "disk.all.written" ],
            units: "bytes",
            derive: "rate"
        };

        var disk_options = plot.plot_simple_template();
        $.extend(disk_options.yaxis,
                 {
                     ticks: plot.memory_ticks,
                     tickFormatter: plot.format_bytes_per_sec_tick_no_unit
                 });
        disk_options.setup_hook = function disk_setup_hook(pl) {
            var axes = pl.getAxes();
            if (axes.yaxis.datamax < 100000)
                axes.yaxis.options.max = 100000;
            else
                axes.yaxis.options.max = null;
            axes.yaxis.options.min = 0;
        };
        disk_options.post_hook = function disk_post_hook(pl) {
            var axes = pl.getAxes();
            $('#server_disk_io_unit').text(plot.bytes_per_sec_tick_unit(axes.yaxis));
        };

        self.disk_plot = new plot.Plot($("#server_disk_io_graph"), 300);
        self.disk_plot.set_options(disk_options);
        self.disk_plot.add_metrics_sum_series(disk_data, { });

        machine_info.cpu_ram_info()
                .done(function(info) {
                    $('#link-cpu').text(cockpit.format(cockpit.ngettext("of $0 CPU core", "of $0 CPU cores",
                                                                        info.cpus),
                                                       info.cpus));
                    cpu_data.factor = 0.1 / info.cpus; // millisec / sec -> percent
                    self.cpu_plot.add_metrics_sum_series(cpu_data, { });

                    if (info.swap) {
                        memory_options.yaxis.max = info.memory + info.swap * 0.25;
                        memory_options.yaxis.tickFormatter = function(v) {
                            return v <= info.memory ? plot.format_bytes_tick_no_unit(v, memory_options.yaxis)
                                : plot.format_bytes_tick_no_unit(v + (v - info.memory) * 4, memory_options.yaxis);
                        };
                        memory_options.colors[1] = "#CC0000";
                        memory_options.grid.markings = [
                            { yaxis: { from: info.memory, to: info.memory + info.swap * 0.25 }, color: "#ededed" }
                        ];
                        var swap_data = {
                            internal: [ "memory.swap-used" ],
                            units: "bytes",
                            factor: 0.25,
                            threshold: info.memory,
                            offset: info.memory
                        };
                        self.memory_plot.add_metrics_sum_series(swap_data, { });
                        $("#link-memory").hide();
                        $("#link-memory-and-swap").show();
                    } else {
                        memory_options.yaxis.max = info.memory;
                    }
                    self.memory_plot.set_options(memory_options);
                });

        self.plot_controls.reset([ self.cpu_plot, self.memory_plot, self.network_plot, self.disk_plot ]);

        $(window).on('resize.server', function() {
            self.cpu_plot.resize();
            self.memory_plot.resize();
            self.network_plot.resize();
            self.disk_plot.resize();
        });

        machine_info.dmi_info()
                .done(function(fields) {
                    $("#system_information_hardware_text")
                            .tooltip({ title: _("Click to see system hardware information"), placement: "bottom" })
                            .text(fields.sys_vendor + " " + fields.product_name);
                    var present = !!(fields.product_serial || fields.chassis_serial);
                    $("#system_information_asset_tag_text")
                            .text(fields.product_serial || fields.chassis_serial);
                    $("#system-info-asset-row").toggle(present);
                })
                .fail(function(ex) {
                    debug("couldn't read dmi info: " + ex);
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
            $("#system_information_hostname_button").attr("title", str);
            $("#system_information_os_text").text(self.hostname_proxy.OperatingSystemPrettyName || "");
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

        $(self.hostname_proxy).off();
        self.hostname_proxy = null;

        self.client.close();
        self.client = null;

        $(cockpit).off('.server');

        $(self.sysroot).off();
        self.sysroot = null;
        if (self.ostree_client) {
            self.ostree_client.close();
            self.ostree_client = null;
        }
    },

    host_keys_show: function() {
        var self = this;
        $("#system_information_ssh_keys .spinner").toggle(true);
        $("#system_information_ssh_keys .content").toggle(false);
        $("#system_information_ssh_keys .alert").toggle(false);

        /*
         * Yes, we do refresh the keys while the dialog is open.
         * It may occur that sshd is not running at the point when
         * we try, or in rare cases the keys may change.
         */
        self.host_keys_interval = window.setInterval(function() {
            self.host_keys_update();
        }, 10 * 1000);
        self.host_keys_update();
    },

    host_keys_update: function() {
        var self = this;
        var parenthesis = /^\((.*)\)$/;
        var spinner = $("#system_information_ssh_keys .spinner");
        var content = $("#system_information_ssh_keys .content");
        var error = $("#system_information_ssh_keys .alert");

        cockpit.script(host_keys_script, [], { "superuser": "try",
                                               "err": "message" })
                .done(function(data) {
                    var seen = {};
                    var arr = [];
                    var keys = {};

                    var i, tmp, m;
                    var full = data.trim().split("\n");
                    for (i = 0; i < full.length; i++) {
                        var line = full[i];
                        if (!line)
                            continue;

                        var parts = line.trim().split(" ");
                        var title;
                        var fp = parts[1];
                        if (!seen[fp]) {
                            seen[fp] = fp;
                            title = parts[parts.length - 1];
                            if (title) {
                                m = title.match(parenthesis);
                                if (m && m[1])
                                    title = m[1];
                            }
                            if (!keys[title])
                                keys[title] = [];
                            keys[title].push(fp);
                        }
                    }

                    arr = Object.keys(keys);
                    arr.sort();
                    arr = arr.map(function(k) {
                        return { title: k, fps: keys[k] };
                    });

                    tmp = mustache.render(self.ssh_host_keys_tmpl, { keys: arr });
                    content.html(tmp);
                    spinner.toggle(false);
                    error.toggle(false);
                    content.toggle(true);
                })
                .fail(function(ex) {
                    var msg = cockpit.format(_("failed to list ssh host keys: $0"), ex.message);
                    content.toggle(false);
                    spinner.toggle(false);
                    $("#system_information_ssh_keys .alert strong").text(msg);
                    error.toggle(true);
                });
    },

    host_keys_hide: function() {
        var self = this;
        window.clearInterval(self.host_keys_interval);
        self.host_keys_interval = null;
    },

    sysroot_changed: function() {
        var self = this;

        if (self.sysroot.Booted && self.ostree_client) {
            var version = "";
            self.ostree_client.call(self.sysroot.Booted,
                                    "org.freedesktop.DBus.Properties", "Get",
                                    ['org.projectatomic.rpmostree1.OS', "BootedDeployment"])
                    .done(function(result) {
                        if (result && result[0]) {
                            var deployment = result[0].v;
                            if (deployment && deployment.version)
                                version = deployment.version.v;
                        }
                    })
                    .fail(function(ex) {
                        console.log(ex);
                    })
                    .always(function() {
                        $("#system-ostree-version").toggleClass("hidden", !version);
                        $("#system-ostree-version-link").text(version);
                    });
        } else {
            $("#system-ostree-version").toggleClass("hidden", true);
            $("#system-ostree-version-link").text("");
        }
    },

    shutdown: function(action_type) {
        shutdown(action_type, this.server_time);
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
        $("#system_information_change_hostname").dialog("promise", cockpit.all(one, two));
    },

    _on_full_name_changed: function(event) {
        /* Whenever the pretty host name has changed (e.g. the user has edited it), we compute a new
         * simple host name (e.g. 7bit ASCII, no special chars/spaces, lower case) from it...
         */
        var pretty_hostname = $("#sich-pretty-hostname").val();
        if (this._always_update_from_pretty || this._initial_pretty_hostname != pretty_hostname) {
            var old_hostname = $("#sich-hostname").val();
            var first_dot = old_hostname.indexOf(".");
            var new_hostname = pretty_hostname
                    .toLowerCase()
                    .replace(/['".]+/g, "")
                    .replace(/[^a-zA-Z0-9]+/g, "-");
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

        var charError = _("Real host name can only contain lower-case characters, digits, dashes, and periods (with populated subdomains)");
        var lengthError = _("Real host name must be 64 characters or less");

        var validLength = $("#sich-hostname").val().length <= 64;
        var hostname = $("#sich-hostname").val();
        var pretty_hostname = $("#sich-pretty-hostname").val();
        var validSubdomains = true;
        var periodCount = 0;

        for (var i = 0; i < $("#sich-hostname").val().length; i++) {
            if ($("#sich-hostname").val()[i] == '.')
                periodCount++;
            else
                periodCount = 0;

            if (periodCount > 1) {
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
        } else if (!validLength && validName) {
            $("#sich-hostname-error").addClass("has-error");
            $(note1).text(lengthError);
            $(note1).css("visibility", "visible");
            $(note2).css("visibility", "hidden");
        } else if (validLength && !validName) {
            $("#sich-hostname-error").addClass("has-error");
            $(note1).text(charError);
            $(note1).css("visibility", "visible");
            $(note2).css("visibility", "hidden");
        } else {
            $("#sich-hostname-error").addClass("has-error");

            if ($(note1).text() === lengthError)
                $(note2).text(charError);
            else if ($(note1).text() === charError)
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
        this.ntp_type = null;
    },

    setup: function() {
        var self = this;

        function enable_apply_button() {
            $('#systime-apply-button').prop('disabled', false);
        }

        $("#systime-apply-button").on("click", $.proxy(this._on_apply_button, this));

        self.ntp_type = "manual_time";
        $('#change_systime li').on('click', function() {
            self.ntp_type = $(this).attr("value");
            self.update();
        });

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
        $('#change_systime').on('click', enable_apply_button);
        $('#systime-date-input').on('focusin', $.proxy(this, "store_date"));
        $('#systime-date-input').on('focusout', $.proxy(this, "restore_date"));

        self.ntp_servers_tmpl = $("#ntp-servers-tmpl").html();
        mustache.parse(this.ntp_servers_tmpl);

        $('#systime-ntp-servers').on('click', '[data-action="add"]', function() {
            var index = $(this).attr('data-index');
            self.sync_ntp_servers();
            self.custom_ntp_servers.splice(index + 1, 0, "");
            self.update_ntp_servers();

            // HACK - without returning 'false' here, the dialog will
            // be magically closed when controlled by the
            // check-system-info test.
            return false;
        });

        $('#systime-ntp-servers').on('click', '[data-action="del"]', function() {
            var index = $(this).attr('data-index');
            self.sync_ntp_servers();
            self.custom_ntp_servers.splice(index, 1);
            self.update_ntp_servers();

            // HACK - without returning 'false' here, the dialog will
            // be magically closed when controlled by the
            // check-system-info test.
            return false;
        });
    },

    enter: function() {
        var self = this;

        $('#systime-date-input').val(self.server_time.format());
        $('#systime-time-minutes').val(self.server_time.utc_fake_now.getUTCMinutes());
        $('#systime-time-hours').val(self.server_time.utc_fake_now.getUTCHours());

        self.ntp_type = self.server_time.timedate.NTP ? (self.custom_ntp_enabled ? 'ntp_time_custom' : 'ntp_time') : 'manual_time';
        $('#change_systime [value="ntp_time"]')
                .toggleClass("disabled", !self.server_time.timedate.CanNTP);
        $('#change_systime [value="ntp_time_custom"]')
                .toggleClass("disabled", !(self.server_time.timedate.CanNTP && self.custom_ntp_supported));
        $('#systime-parse-error')
                .parents('tr')
                .hide();
        $('#systime-timezone-error')
                .parents('tr')
                .hide();
        $('#systime-apply-button').prop('disabled', false);
        $('#systime-timezones').prop('disabled', 'disabled');

        self.update();
        self.update_minutes();
        self.update_ntp_servers();
        self.get_timezones();
    },

    display: function(server_time) {
        var self = this;

        if (self.server_time) {
            console.warn("change-systime dialog reentered");
            return;
        }

        self.server_time = server_time;

        self.get_ntp_servers(function() {
            $('#system_information_change_systime').modal('show');
        });
    },

    get_timezones: function() {
        var self = this;

        function parse_timezones(content) {
            var lines = content.split('\n');
            var curr_timezone = self.server_time.timedate.Timezone;

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

    get_ntp_servers: function(callback) {
        var self = this;

        /* We only support editing the configuration of
         * systemd-timesyncd, by dropping a file into
         * /etc/systemd/timesyncd.conf.d.  We assume that timesyncd is
         * used when:
         *
         * - systemd-timedated is answering for
         *   org.freedesktop.timedate1 as opposed to, say, timedatex.
         *
         * - systemd-timesyncd is actually available.
         *
         * The better alternative would be to have an API in
         * o.fd.timedate1 for managing the list of NTP server
         * candidates.
         */

        var timedate1 = self.server_time.timedate1_service;
        var timesyncd = self.server_time.timesyncd_service;

        self.custom_ntp_supported = false;
        self.custom_ntp_enabled = false;
        self.custom_ntp_servers = [ ];

        function check() {
            if ((timedate1.exists === false || timedate1.unit) && (timesyncd.exists !== null)) {
                $([ timedate1, timesyncd ]).off(".get_ntp_servers");

                if (!timedate1.exists || timedate1.unit.Id !== "systemd-timedated.service") {
                    console.log("systemd-timedated not in use, ntp server configuration not supported");
                    callback();
                    return;
                }

                if (!timesyncd.exists) {
                    console.log("systemd-timesyncd not available, ntp server configuration not supported");
                    callback();
                    return;
                }

                self.custom_ntp_supported = true;

                if (!self.ntp_config_file)
                    self.ntp_config_file = cockpit.file("/etc/systemd/timesyncd.conf.d/50-cockpit.conf",
                                                        { superuser: "try" });

                self.ntp_config_file.read()
                        .done(function(text) {
                            var ntp_line = "";
                            self.ntp_servers = null;
                            if (text) {
                                self.custom_ntp_enabled = true;
                                text.split("\n").forEach(function(line) {
                                    if (line.indexOf("NTP=") === 0) {
                                        ntp_line = line.slice(4);
                                        self.custom_ntp_enabled = true;
                                    } else if (line.indexOf("#NTP=") === 0) {
                                        ntp_line = line.slice(5);
                                        self.custom_ntp_enabled = false;
                                    }
                                });

                                self.custom_ntp_servers = ntp_line.split(" ").filter(function(val) {
                                    return val !== "";
                                });
                                if (self.custom_ntp_servers.length === 0)
                                    self.custom_ntp_enabled = false;
                            }
                            callback();
                        })
                        .fail(function(error) {
                            console.warn("failed to load time servers", error);
                            callback();
                        });
            }
        }

        $([ timedate1, timesyncd ]).on("changed.get_ntp_servers", check);
        check();
    },

    set_ntp_servers: function(servers, enabled) {
        var self = this;

        var text = `# This file is automatically generated by Cockpit\n\n[Time]\n${enabled ? "" : "#"}NTP=${servers.join(" ")}\n`;

        return cockpit.spawn([ "mkdir", "-p", "/etc/systemd/timesyncd.conf.d" ], { superuser: "try" })
                .then(function() {
                    return self.ntp_config_file.replace(text);
                });
    },

    show: function() {
    },

    leave: function() {
        var self = this;

        $(self.server_time.timedate1_service).off(".change_systime");
        $(self.server_time.timesyncd_service).off(".change_systime");
        self.server_time = null;
    },

    _on_apply_button: function(event) {
        var self = this;

        if (!self.check_input())
            return;

        var manual_time = self.ntp_type == 'manual_time';
        var ntp_time_custom = self.ntp_type == 'ntp_time_custom';

        self.sync_ntp_servers();
        var servers = self.custom_ntp_servers.filter(function(val) { return val !== "" });

        function target_error (msg, target) {
            var err = new Error(msg);
            err.target = target;
            return err;
        }

        if (ntp_time_custom && servers.length === 0) {
            var err = target_error(_("Need at least one NTP server"),
                                   '#systime-ntp-servers .systime-inline');
            $("#system_information_change_systime").dialog("failure", err);
            return;
        }

        var promises = [ ];

        if (!$('#systime-timezones').prop('disabled')) {
            promises.push(
                self.server_time.timedate.call('SetTimezone', [$('#systime-timezones').val(), true]));
        }

        function set_ntp(val) {
            return self.server_time.timedate.call('SetNTP', [val, true]);
        }

        if (manual_time) {
            promises.push(
                set_ntp(false)
                        .then(function() {
                            return self.server_time.change_time($("#systime-date-input").val(),
                                                                $('#systime-time-hours').val(),
                                                                $('#systime-time-minutes').val());
                        }));
        } else if (!self.custom_ntp_supported) {
            promises.push(
                set_ntp(true));
        } else {
            /* HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1272085
             *
             * Switch off NTP, bump the clock by one microsecond to
             * clear the NTPSynchronized status, write the config
             * file, and switch NTP back on.
             *
             */
            promises.push(
                set_ntp(false)
                        .then(function() {
                            return self.server_time.timedate.call('SetTime', [ 1, true, true ]);
                        })
                        .then(function() {
                            return self.set_ntp_servers(servers, ntp_time_custom);
                        })
                        .then(function() {
                            // NTPSynchronized should be false now.  Make
                            // sure we pick that up immediately.
                            self.server_time.poll_ntp_synchronized();

                            return set_ntp(true);
                        }));
        }

        $("#system_information_change_systime").dialog("promise", cockpit.all(promises));
    },

    check_input: function() {
        var date_error = false;
        var timezone_error = false;
        var new_date;

        var hours = $('#systime-time-hours').val();
        var minutes = $('#systime-time-minutes').val();
        var time_error = !/^[0-9]+$/.test(hours.trim()) || !/^[0-9]+$/.test(minutes.trim());

        if (!time_error) {
            hours = Number(hours);
            minutes = Number(minutes);
            time_error = hours < 0 || hours > 23 || minutes < 0 || minutes > 59;
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

        $('#systime-timezones').toggleClass("has-error", !timezone_error);
        $('#systime-time-hours').toggleClass("has-error", !time_error);
        $('#systime-time-minutes').toggleClass("has-error", !time_error);
        $('#systime-date-input').toggleClass("has-error", !date_error);

        $('#systime-parse-error')
                .parents('tr')
                .toggleClass("has-error", time_error || date_error);
        $('#systime-parse-error').toggle(time_error || date_error);
        $('#systime-timezone-error')
                .parents('tr')
                .toggle(timezone_error);

        if (time_error || date_error || timezone_error) {
            $('#systime-apply-button').prop('disabled', true);
            return false;
        } else {
            $('#systime-apply-button').prop('disabled', false);
            return true;
        }
    },

    update: function() {
        var self = this;
        var manual_time = self.ntp_type === 'manual_time';
        var ntp_time_custom = self.ntp_type === 'ntp_time_custom';
        var text = $("#change_systime li[value=" + self.ntp_type + "]").text();
        $("#change_systime button span").text(text);
        $('#systime-manual-row, #systime-manual-error-row').toggle(manual_time);
        $('#systime-ntp-servers-row').toggle(ntp_time_custom);
        $('#systime-parse-error').hide();
    },

    sync_ntp_servers: function() {
        var self = this;

        self.custom_ntp_servers = $('#systime-ntp-servers input')
                .map(function(i, elt) {
                    return $(elt).val();
                })
                .get();
    },

    update_ntp_servers: function() {
        var self = this;

        if (self.custom_ntp_servers === null || self.custom_ntp_servers.length === 0)
            self.custom_ntp_servers = [ "" ];

        var model = {
            NTPServers: self.custom_ntp_servers.map(function(val, i) {
                return { index: i,
                         Value: val,
                         Placeholder: _("NTP Server")
                };
            })
        };

        $('#systime-ntp-servers').html(mustache.render(self.ntp_servers_tmpl, model));
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

PageCpuStatus.prototype = {
    _init: function() {
        this.id = "cpu_status";
    },

    getTitle: function() {
        return C_("page-title", "CPU Status");
    },

    enter: function() {
        var self = this;

        var n_cpus = 1;

        var options = {
            series: {shadowSize: 0,
                     lines: {lineWidth: 0, fill: 1}
            },
            yaxis: {min: 0,
                    max: n_cpus * 1000,
                    show: true,
                    ticks: 5,
                    tickFormatter: function(v) { return (v / 10 / n_cpus) + "%" }},
            xaxis: {show: true,
                    ticks: [[0.0 * 60, "5 min"],
                        [1.0 * 60, "4 min"],
                        [2.0 * 60, "3 min"],
                        [3.0 * 60, "2 min"],
                        [4.0 * 60, "1 min"]]},
            x_rh_stack_graphs: true
        };

        var metrics = [
            { name: "cpu.basic.iowait", derive: "rate" },
            { name: "cpu.basic.system", derive: "rate" },
            { name: "cpu.basic.user", derive: "rate" },
            { name: "cpu.basic.nice", derive: "rate" },
        ];

        var series = [
            { color: "#cc0000", label: _("I/O Wait") },
            { color: "#f5c12e", label: _("Kernel") },
            { color: "#8461f7", label: _("User") },
            { color: "#6eb664", label: _("Nice") },
        ];

        self.channel = cockpit.metrics(1000, {
            source: "internal",
            metrics: metrics,
            cache: "cpu-status-rate"
        });

        /* The grid shows us the last five minutes */
        self.grid = cockpit.grid(1000, -300, -0);

        var i;
        for (i = 0; i < series.length; i++) {
            series[i].row = self.grid.add(self.channel, [ metrics[i].name ]);
        }

        /* Start pulling data, and make the grid follow the data */
        self.channel.follow();
        self.grid.walk();

        this.plot = plot.setup_complicated_plot("#cpu_status_graph", self.grid, series, options);

        machine_info.cpu_ram_info()
                .done(function(info) {
                    // Setting n_cpus changes the tick labels, see tickFormatter above.
                    n_cpus = info.cpus;
                    self.plot.set_yaxis_max(n_cpus * 1000);
                    $("#cpu_status_title").text(cockpit.format(cockpit.ngettext("Usage of $0 CPU core",
                                                                                "Usage of $0 CPU cores",
                                                                                n_cpus),
                                                               n_cpus));
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
        var dfd = cockpit.defer();
        self.setupPromise = dfd.promise;

        machine_info.cpu_ram_info().done(function(info) {
            var options = {
                series: {
                    shadowSize: 0, // drawing is faster without shadows
                    lines: {lineWidth: 0.0, fill: 1}
                },
                yaxis: {
                    min: 0,
                    max: info.memory,
                    ticks: 5,
                    tickFormatter: function(v) {
                        return cockpit.format_bytes(v);
                    }
                },
                xaxis: {
                    show: true,
                    ticks: [[0.0 * 60, _("5 min")],
                        [1.0 * 60, _("4 min")],
                        [2.0 * 60, _("3 min")],
                        [3.0 * 60, _("2 min")],
                        [4.0 * 60, _("1 min")]]
                },
                x_rh_stack_graphs: true,
            };
            var metrics = [
                { name: "memory.used" },
                { name: "memory.cached" },
            ];
            var series = [
                { color: "#0088ce", label: _("Used") },
                { color: "#e4f5bc", label: _("Cached") },
            ];

            if (info.swap) {
                options.yaxis.max = info.memory + info.swap * 0.25;
                options.yaxis.tickFormatter = function(v) {
                    return v <= info.memory ? cockpit.format_bytes(v)
                        : cockpit.format_bytes(v + (v - info.memory) * 4);
                };
                $.extend(options, { grid: { aboveData: false, markings: [
                    { yaxis: { from: info.memory, to: info.memory + info.swap * 0.25 }, color: "#ededed" }
                ]}});
                metrics.push({ name: "memory.swap-used" });
                series.push({ color: "#e41a1c", label: _("Swap Used"), offset: info.memory, factor: 0.25 });
            } else {
                $("#memory_status .memory-swap").hide();
            }

            self.channel = cockpit.metrics(1000, {
                source: "internal",
                metrics: metrics,
                cache: "memory-status"
            });
            /* The grid shows us the last five minutes */
            self.grid = cockpit.grid(1000, -300, -0);
            for (var i = 0; i < series.length; i++)
                series[i].row = self.grid.add(self.channel, [ metrics[i].name ]);

            /* Start pulling data, and make the grid follow the data */
            self.channel.follow();
            self.grid.walk();
            self.plot = plot.setup_complicated_plot("#memory_status_graph", self.grid, series, options);
            dfd.resolve();
        })
                .fail(function(ex) {
                    debug("Couldn't read memory info: " + ex);
                    dfd.reject();
                });
    },

    show: function() {
        var self = this;
        if (self.setupPromise) {
            self.setupPromise.done(function() {
                self.plot.start();
                $("#memory_status_graph canvas").css("z-index", -1);
            });
        }
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

$("#link-memory, #link-memory-and-swap").on("click", function() {
    cockpit.location.go([ "memory" ]);
    return false;
});

$("#link-network").on("click", function() {
    cockpit.jump("/network", cockpit.transport.host);
    return false;
});

$("#link-disk").on("click", function() {
    cockpit.jump("/storage", cockpit.transport.host);
    return false;
});

$("#system_information_hardware_text").on("click", function() {
    $("#system_information_hardware_text").tooltip("hide");
    cockpit.jump("/system/hwinfo", cockpit.transport.host);
    return false;
});

$("#system-information-enable-pcp-link").on("click", function() {
    install_dialog("cockpit-pcp");
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
    $('#' + d.id)
            .on('show.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.enter();
            })
            .on('shown.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.show();
            })
            .on('hidden.bs.modal', function(event) {
                if (event.target.id === d.id)
                    d.leave();
            });
}

function page_show(p, arg) {
    if (!p._entered_)
        p.enter(arg);
    p._entered_ = true;
    $('#' + p.id)
            .show()
            .removeAttr("hidden");
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
    dialog_setup(change_systime_dialog = new PageSystemInformationChangeSystime());

    $(cockpit).on("locationchanged", navigate);
    navigate();
}

$(init);
