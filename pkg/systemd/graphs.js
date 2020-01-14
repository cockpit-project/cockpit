/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import $ from "jquery";
import * as plot from "plot.js";

import cockpit from "cockpit";
import * as machine_info from "machine-info.js";

const _ = cockpit.gettext;
var C_ = cockpit.gettext;

function set_page_link(element_sel, page, text) {
    if (cockpit.manifests[page]) {
        var link = document.createElement("a");
        link.innerHTML = text;
        link.tabIndex = 0;
        link.addEventListener("click", function() { cockpit.jump("/" + page) });
        $(element_sel).html(link);
    } else {
        $(element_sel).text(text);
    }
}

function page_show(p, arg) {
    if (!p._entered_) {
        p.enter(arg);
    }
    p._entered_ = true;
    $('#' + p.id)
            .show()
            .removeAttr("hidden");
    p.show();
}

function page_hide(p) {
    $('#' + p.id).hide();
}

function debug() {
    if (window.debugging == "all" || window.debugging == "system")
        console.debug.apply(console, arguments);
}

function GraphServer() {
    this._init();
}

GraphServer.prototype = {
    _init: function() {
        this.id = "simple_graphs";
    },

    setup: function() {
        var self = this;
        self.plot_controls = plot.setup_plot_controls($('#simple_graphs'), $('#server-graph-toolbar'));

        // Only link from graphs to available pages
        set_page_link("#link-disk", "storage", _("Disk I/O"));
        set_page_link("#link-network", "network", _("Network Traffic"));

        $("#link-memory, #link-memory-and-swap").on("click", function() {
            cockpit.location.go(["memory"]);
            return false;
        });

        $("#link-cpu").on("click", function() {
            cockpit.location.go(["cpu"]);
            return false;
        });
    },

    relayout: function() {
        var self = this;
        if (self.network_plot) {
            self.network_plot.resize();
            self.disk_plot.resize();
            self.cpu_plot.resize();
            self.memory_plot.resize();
        }
    },

    enter: function() {
        var self = this;

        /* CPU graph */
        var cpu_data = {
            direct: ["kernel.all.cpu.nice", "kernel.all.cpu.user", "kernel.all.cpu.sys"],
            internal: ["cpu.basic.nice", "cpu.basic.user", "cpu.basic.system"],
            units: "millisec",
            derive: "rate",
            factor: 0.1 // millisec / sec -> percent
        };

        var cpu_options = plot.plot_simple_template();
        $.extend(cpu_options.yaxis, {
            tickFormatter: function(v) { return v.toFixed(0) },
            max: 100
        });
        self.cpu_plot = new plot.Plot($("#server_cpu_graph"), 300);
        self.cpu_plot.set_options(cpu_options);
        // This is added to the plot once we have the machine info, see below.

        /* Memory graph */

        var memory_data = {
            direct: ["mem.physmem", "mem.util.available"],
            internal: ["memory.used"],
            units: "bytes"
        };

        var memory_options = plot.plot_simple_template();
        $.extend(memory_options.yaxis, {
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

        machine_info.cpu_ram_info()
                .done(function(info) {
                    $('#link-cpu').text(
                        cockpit.format(cockpit.ngettext("of $0 CPU", "of $0 CPUs", info.cpus), info.cpus)
                    );
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
                            internal: ["memory.swap-used"],
                            units: "bytes",
                            factor: 0.25,
                            threshold: info.memory,
                            offset: info.memory
                        };
                        self.memory_plot.add_metrics_sum_series(swap_data, { });
                        $("#link-memory").hide();
                        $("#link-memory-and-swap").prop("hidden", false);
                    } else {
                        memory_options.yaxis.max = info.memory;
                    }
                    self.memory_plot.set_options(memory_options);
                });

        /* Network graph */

        var network_data = {
            direct: ["network.interface.total.bytes"],
            internal: ["network.interface.tx", "network.interface.rx"],
            "omit-instances": ["lo"],
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
            direct: ["disk.all.total_bytes"],
            internal: ["disk.all.read", "disk.all.written"],
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

        self.plot_controls.reset([self.cpu_plot, self.memory_plot, self.network_plot, self.disk_plot]);

        $(window).on('resize.server', () => { self.relayout() });
    },

    show: function() {
        this.disk_plot.start_walking();
        this.network_plot.start_walking();
    },

    leave: function() {
        this.disk_plot.destroy();
        this.network_plot.destroy();
    },
};

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
            series: {
                shadowSize: 0,
                lines: { lineWidth: 0, fill: 1 }
            },
            yaxis: {
                min: 0,
                max: n_cpus * 1000,
                show: true,
                ticks: 5,
                tickFormatter: function(v) { return (v / 10 / n_cpus) + "%" }
            },
            xaxis: {
                show: true,
                ticks: [[0.0 * 60, "5 min"],
                    [1.0 * 60, "4 min"],
                    [2.0 * 60, "3 min"],
                    [3.0 * 60, "2 min"],
                    [4.0 * 60, "1 min"]]
            },
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
            series[i].row = self.grid.add(self.channel, [metrics[i].name]);
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
                    lines: { lineWidth: 0.0, fill: 1 }
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
                $.extend(options, {
                    grid: {
                        aboveData: false, markings: [
                            { yaxis: { from: info.memory, to: info.memory + info.swap * 0.25 }, color: "#ededed" }
                        ]
                    }
                });
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
                series[i].row = self.grid.add(self.channel, [metrics[i].name]);

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

        $("#memory_status_title").text(_("Memory & Swap Usage"));

        if (self.setupPromise) {
            self.setupPromise.done(function() {
                self.plot.start();
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

$(function() {
    var memory_page;
    var cpu_page;
    var server_page;
    cockpit.translate();

    server_page = new GraphServer();
    server_page.setup();

    cpu_page = new PageCpuStatus();
    memory_page = new PageMemoryStatus();

    $("#system-link").on("click", () => cockpit.jump('/system'));
    $("#graphs-link").on("click", () => cockpit.jump('/system/graphs'));

    function navigate() {
        var path = cockpit.location.path;

        if (path.length === 0) {
            page_hide(cpu_page);
            page_hide(memory_page);
            page_show(server_page);
            $('#complicated_graphs').hide();
        } else if (path.length === 1 && path[0] == 'cpu') {
            page_hide(server_page);
            page_hide(memory_page);
            page_show(cpu_page);
            $('#complicated_graphs')
                    .show()
                    .removeAttr("hidden");
            $("#complicated_graph_current_breadcrumb").text(_("CPU Graph"));
        } else if (path.length === 1 && path[0] == 'memory') {
            page_hide(server_page);
            page_hide(cpu_page);
            page_show(memory_page);
            $('#complicated_graphs')
                    .show()
                    .removeAttr("hidden");
            $("#complicated_graph_current_breadcrumb").text(_("Memory Graph"));
        } else { /* redirect */
            console.warn("not a system location: " + path);
            cockpit.location = '';
        }
    }

    $(cockpit).on("locationchanged", navigate);
    navigate();
});
