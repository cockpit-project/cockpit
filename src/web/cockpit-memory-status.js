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

PageMemoryStatus.prototype = {
    _init: function() {
        this.id = "memory_status";
    },

    getTitle: function() {
        return C_("page-title", "Memory");
    },

    enter: function() {
        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address, { protocol: "dbus-json1" });

        var resmon = this.client.get("/com/redhat/Cockpit/MemoryMonitor", "com.redhat.Cockpit.ResourceMonitor");
        var options = {
            series: {shadowSize: 0, // drawing is faster without shadows
                     lines: {lineWidth: 0.0, fill: true}
                    },
            yaxis: {min: 0,
                    ticks: 5,
                    tickFormatter: function (v) {
                        return cockpit_format_bytes(v);
                    }
                   },
            xaxis: {show: true,
                    ticks: [[0.0*60, "5 min"],
                            [1.0*60, "4 min"],
                            [2.0*60, "3 min"],
                            [3.0*60, "2 min"],
                            [4.0*60, "1 min"]]},
            x_rh_stack_graphs: true
        };

        this.plot = cockpit_setup_complicated_plot("#memory_status_graph",
                                                   resmon,
                                                   [{color: "rgb(200,200,200)"},
                                                    {color: "rgb(150,150,150)"},
                                                    {color: "rgb(100,100,100)"},
                                                    {color: "rgb( 50, 50, 50)"}
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

function PageMemoryStatus() {
    this._init();
}

cockpit_pages.push(new PageMemoryStatus());
