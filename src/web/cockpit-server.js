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

PageServer.prototype = {
    _init: function() {
        this.id = "server";
    },

    getTitle: function() {
        return cockpit_get_display_hostname();
    },

    enter: function(first_visit) {
        if (first_visit) {
            $('#server-avatar').on('click', $.proxy (this, "trigger_change_avatar"));
            $('#server-avatar-uploader').on('change', $.proxy (this, "change_avatar"));

            var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager",
                                                  "com.redhat.Cockpit.Manager");
            $(manager).on('AvatarChanged', $.proxy (this, "update"));

            var plot_options =
                { colors: [ "black" ],
                  legend: { show: false },
                  series: { shadowSize: 0,
                            lines: { lineWidth: 0.0,
                                     fill: true
                                   }
                          },
                  xaxis: { tickFormatter: function() { return "";  } },
                  yaxis: { tickFormatter: function() { return "";  } },
                  grid: { borderWidth: 1 }
                };

            var monitor = cockpit_dbus_client.lookup("/com/redhat/Cockpit/CpuMonitor", "com.redhat.Cockpit.ResourceMonitor");
            this.cpu_plot =
                cockpit_setup_simple_plot("#server_cpu_graph",
                                          "#server_cpu_text",
                                          monitor,
                                          plot_options,
                                          function(values) { // Combines the series into a single plot-value
                                              return values[1] + values[2] + values[3];
                                          },
                                          function(values) { // Combines the series into a textual string
                                              var total = values[1] + values[2] + values[3];
                                              return total.toFixed(1) + "%";
                                          });

            monitor = cockpit_dbus_client.lookup("/com/redhat/Cockpit/MemoryMonitor", "com.redhat.Cockpit.ResourceMonitor");
            this.memory_plot =
                cockpit_setup_simple_plot("#server_memory_graph",
                                          "#server_memory_text",
                                          monitor,
                                          plot_options,
                                          function(values) { // Combines the series into a single plot-value
                                              return values[1] + values[2] + values[3];
                                          },
                                          function(values) { // Combines the series into a textual string
                                              var total = values[1] + values[2] + values[3];
                                              return cockpit_format_bytes(total);
                                          });

            monitor = cockpit_dbus_client.lookup("/com/redhat/Cockpit/NetworkMonitor", "com.redhat.Cockpit.ResourceMonitor");
            this.network_traffic_plot =
                cockpit_setup_simple_plot("#server_network_traffic_graph",
                                          "#server_network_traffic_text",
                                          monitor,
                                          plot_options,
                                          function(values) { // Combines the series into a single plot-value
                                              return values[0] + values[1];
                                          },
                                          function(values) { // Combines the series into a textual string
                                              var total = values[0] + values[1];
                                              return cockpit_format_bytes_per_sec(total);
                                          });

            monitor = cockpit_dbus_client.lookup("/com/redhat/Cockpit/DiskIOMonitor", "com.redhat.Cockpit.ResourceMonitor");
            this.disk_io_plot =
                cockpit_setup_simple_plot("#server_disk_io_graph",
                                          "#server_disk_io_text",
                                          monitor,
                                          plot_options,
                                          function(values) { // Combines the series into a single plot-value
                                              return values[0] + values[1];
                                          },
                                          function(values) { // Combines the series into a textual string
                                              var total = values[0] + values[1];
                                              return cockpit_format_bytes_per_sec(total);
                                          });

        } // if (first_visit)

        this.update ();
    },

    show: function() {
        this.cpu_plot.start();
        this.memory_plot.start();
        this.disk_io_plot.start();
        this.network_traffic_plot.start();
    },

    leave: function() {
        this.cpu_plot.stop();
        this.memory_plot.stop();
        this.disk_io_plot.stop();
        this.network_traffic_plot.stop();
    },

    update: function () {
        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager",
                                                 "com.redhat.Cockpit.Manager");
        manager.call('GetAvatarDataURL', function (error, result) {
            if (result)
                $('#server-avatar').css('background-image', 'url(' + result + ')');
        });
    },

    trigger_change_avatar: function() {
        if (window.File && window.FileReader)
            $('#server-avatar-uploader').trigger('click');
    },

    change_avatar: function() {
        var me = this;
        cockpit_show_change_avatar_dialog ('#server-avatar-uploader',
                                           function (data) {
                                               var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager",
                                                                                        "com.redhat.Cockpit.Manager");
                                               manager.call('SetAvatarDataURL', data,
                                                            function (error) {
                                                                if (error)
                                                                    cockpit_show_unexpected_error (error);
                                                            });
                                           });
    }

};

function PageServer() {
    this._init();
}

cockpit_pages.push(new PageServer());
