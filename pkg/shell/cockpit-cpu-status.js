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
    "shell/shell",
    "shell/cockpit-main"
], function($, cockpit, shell) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

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

shell.pages.push(new PageCpuStatus());

});
