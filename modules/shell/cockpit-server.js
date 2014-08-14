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

(function(cockpit, $) {

PageServer.prototype = {
    _init: function() {
        this.id = "server";
    },

    enter_breadcrumb: function() {
        this.title_address = cockpit.get_page_param('machine', 'server') || "localhost";
        this.title_client = cockpit.dbus(this.title_address);
        this.title_manager = this.title_client.get("/com/redhat/Cockpit/Manager",
                                                   "com.redhat.Cockpit.Manager");
        $(this.title_manager).on('notify:PrettyHostname.server-title', cockpit.content_update_loc_trail);
        $(this.title_manager).on('notify:Hostname.server-title', cockpit.content_update_loc_trail);
    },

    leave_breadcrumb: function() {
        $(this.title_manager).off('.server-title');
        this.title_client.release();
    },

    getTitle: function() {
        var fallback = this.title_address || "?";
        if (this.title_manager)
            return this.title_manager.PrettyHostname || this.title_manager.Hostname || fallback;
        else
            return fallback;
    },

    setup: function() {
        $('#server-avatar').on('click', $.proxy (this, "trigger_change_avatar"));
        $('#server-avatar-uploader').on('change', $.proxy (this, "change_avatar"));
    },

    enter: function() {
        var self = this;

        self.address = cockpit.get_page_param('machine') || "localhost";
        self.client = cockpit.dbus(self.address);
        cockpit.set_watched_client(self.client);

        self.manager = self.client.get("/com/redhat/Cockpit/Manager",
                                       "com.redhat.Cockpit.Manager");
        $(self.manager).on('AvatarChanged.server', $.proxy (this, "update_avatar"));

        /* TODO: This needs to be reworked once real module loading lands */
        var prefix = cockpit.environment.localhost.modules.shell.prefix;

        $('#server-avatar').css('background-image', 'url(' + prefix + '/images/server-large.png)');

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
            cockpit_setup_simple_plot("#server_cpu_graph",
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
            cockpit_setup_simple_plot("#server_memory_graph",
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
            cockpit_setup_simple_plot("#server_network_traffic_graph",
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
            cockpit_setup_simple_plot("#server_disk_io_graph",
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


        cockpit.util.machine_info(this.address).
            done(function (info) {
                // TODO - round memory to something nice and/or adjust
                //        the ticks.
                self.cpu_plot.set_yaxis_max(info.cpus*100);
                self.memory_plot.set_yaxis_max(info.memory);
            });

        self.update_avatar ();
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

        cockpit.set_watched_client(null);
        $(self.manager).off('.server');
        self.manager = null;
        $(self.client).off('.server');
        self.client.release();
        self.client = null;
    },

    start_plots: function () {
        var self = this;

    },

    update_avatar: function () {
        this.manager.call('GetAvatarDataURL', function (error, result) {
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
        cockpit.show_change_avatar_dialog('#server-avatar-uploader',
                                           function (data) {
                                               me.manager.call('SetAvatarDataURL', data,
                                                               function (error) {
                                                                   if (error)
                                                                       cockpit.show_unexpected_error(error);
                                                               });
                                           });
    }

};

function PageServer() {
    this._init();
}

cockpit.pages.push(new PageServer());

})(cockpit, $);
