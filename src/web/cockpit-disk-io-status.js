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

PageDiskIOStatus.prototype = {
    _init: function() {
        this.id = "disk_io_status";
    },

    getTitle: function() {
        return C_("page-title", "Disk I/O");
    },

    enter: function() {
        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address, { protocol: "dbus-json1" });

        var resmon = this.client.get("/com/redhat/Cockpit/DiskIOMonitor", "com.redhat.Cockpit.ResourceMonitor");
        var options = {
            series: {shadowSize: 1,
                     lines: {lineWidth: 0.5}
                    },
            yaxes: [{min: 0,
                     ticks: 5,
                     tickFormatter: function (v) {
                         return cockpit_format_bytes_per_sec(v);
                     }},
                    {
                        min: 0,
                        position: "right",
                        tickFormatter: function (v) {
                            if (v === 0)
                                return "0";
                            else
                                return v.toFixed(1) + "/s";
                        }
                    }],
            xaxis: {show: true,
                    ticks: [[0.0*60, "5 min"],
                            [1.0*60, "4 min"],
                            [2.0*60, "3 min"],
                            [3.0*60, "2 min"],
                            [4.0*60, "1 min"]]},
            x_rh_stack_graphs: true
        };

        this.plot = cockpit_setup_complicated_plot("#disk_io_status_graph",
                                                   resmon,
                                                   [{color: "rgb(  0,  0,255)"},
                                                    {color: "rgb(255,  0,255)"},
                                                    {color: "rgb(128,128,128)", yaxis: 2}
                                                   ],
                                                   options);
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

function PageDiskIOStatus() {
    this._init();
}

cockpit_pages.push(new PageDiskIOStatus());
