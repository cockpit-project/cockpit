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

PageCpuStatus.prototype = {
    _init: function() {
        this.id = "cpu_status";
    },

    getTitle: function() {
        return C_("page-title", "CPU Status");
    },

    enter: function() {
        var self = this;

        /* TODO: This code needs to be migrated away from old dbus */
        this.client = shell.dbus(null);

        var resmon = this.client.get("/com/redhat/Cockpit/CpuMonitor", "com.redhat.Cockpit.ResourceMonitor");
        var options = {
            series: {shadowSize: 0,
                     lines: {lineWidth: 0, fill: true}
                    },
            yaxis: {min: 0,
                    max: 100,
                    show: true,
                    ticks: 5,
                    tickFormatter: function(v) { return v + "%"; }},
            xaxis: {show: true,
                    ticks: [[0.0*60, "5 min"],
                            [1.0*60, "4 min"],
                            [2.0*60, "3 min"],
                            [3.0*60, "2 min"],
                            [4.0*60, "1 min"]]},
            x_rh_stack_graphs: true
        };

        this.plot = shell.setup_complicated_plot("#cpu_status_graph",
                                                   resmon,
                                                   [{color: "rgb(200,200,200)"},
                                                    {color: "rgb(150,150,150)"},
                                                    {color: "rgb(100,100,100)"},
                                                    {color: "rgb( 50, 50, 50)"}
                                                   ],
                                                   options);

        shell.util.machine_info().
            done(function (info) {
                self.plot.set_yaxis_max(info.cpus * 100);
            });
    },

    show: function() {
        this.plot.start();
    },

    leave: function() {
        this.plot.destroy();
        this.client.release();
        this.client = null;
    }
};

function PageCpuStatus() {
    this._init();
}

shell.pages.push(new PageCpuStatus());

})(jQuery, cockpit, shell);
