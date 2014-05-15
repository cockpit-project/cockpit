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

var cockpit = cockpit || { };

(function($, cockpit, cockpit_pages) {

PageDashboard.prototype = {
    _init: function() {
        this.id = "dashboard";
        this.cpu_plots = [ ];
        this.local_client = null;
        this.dbus_clients = [ ];
    },

    getTitle: function() {
        return C_("page-title", "All");
    },

    setup: function() {
        var self = this;

        $('#dashboard-local-reconnect').on('click', function() {
            if (self.local_client)
                self.local_client.connect();
        });
    },

    enter: function() {
        var self = this;

        /* TODO: This code needs to be migrated away from dbus-json1 */
        self.local_client = cockpit.dbus("localhost", { protocol: "dbus-json1" });
        $(self.local_client).on('state-change.dashboard-local', $.proxy(self, "local_client_state_change"));
        $(self.local_client).on('objectAdded.dashboard-local objectRemoved.dashboard-local', function (event, object) {
            if (object.lookup('com.redhat.Cockpit.Machine'))
                self.update_machines ();
        });
        $(self.local_client).on('propertiesChanged.dashboard-local', function (event, object, iface) {
            if (iface._iface_name == "com.redhat.Cockpit.Machine")
                self.update_machines ();
        });
        self.update_machines ();
    },

    show: function() {
        this.start_plots();
    },

    leave: function() {
        this.destroy_plots();
        this.put_clients();

        $(this.local_client).off('.dashboard-local');
        this.local_client.release();
        this.local_client = null;
    },

    local_client_state_change: function () {
        if (this.local_client.state == "ready") {
            $('#dashboard-local-disconnected').hide();
        } else {
            if (this.local_client.state == "closed")
                $('#dashboard-local-error').text(cockpit.client_error_description(this.local_client.error));
            else
                $('#dashboard-local-error').text("...");
            $('#dashboard-local-disconnected').show();
        }
    },

    destroy_plots: function () {
        this.cpu_plots.forEach(function(p) {
            if (p)
                p.destroy();
        });
        this.cpu_plots = [ ];
    },

    put_clients: function () {
        this.dbus_clients.forEach(function (c) {
            $(c).off('.dashboard');
            c.release();
        });
        this.dbus_clients = [ ];
    },

    start_plots: function () {
        this.cpu_plots.forEach(function(p) {
            if (p)
                p.start();
        });
    },

    update_machines: function () {

        var self = this;
        var machines = $('#dashboard-machines'), i;
        var configured_machines = this.local_client.getInterfacesFrom ("/com/redhat/Cockpit/Machines",
                                                                       "com.redhat.Cockpit.Machine");
        this.destroy_plots();
        this.put_clients();

        configured_machines = configured_machines.filter(function (m) {
            return cockpit_find_in_array(m.Tags, "dashboard");
        });

        function machine_action_func (machine) {
            return function (action) {
                self.server_action (machine, action);
            };
        }

        var machine_action_spec = [
            { title: _("Manage"),          action: 'manage',     is_default: true },
            { title: _("Connect"),         action: 'connect' },
            { title: _("Disconnect"),      action: 'disconnect' },
            { title: _("Remove"),          action: 'remove' },
            { title: _("Rescue Terminal"), action: 'rescue' }
        ];

        machines.empty ();
        for (i = 0; i < configured_machines.length; i++) {
            var address = configured_machines[i].Address;
            /* TODO: This code needs to be migrated away from dbus-json1 */
            var machine = { address: address,
                            client: cockpit.dbus(address, { protocol: "dbus-json1" }, false),
                            dbus_iface: configured_machines[i]
                          };

            var table =
                $('<table/>', { style: "width:100%" }).append(
                    $('<tr/>').append(
                        $('<td/>', { 'style': "width:64px;height:64px;vertical-align:top" }).append(
                            $('<img/>', { 'class': "cockpit-avatar",
                                          'src': "images/server-large.png",
                                          'Width': "64px",
                                          'style': "border-radius:5px"
                                        })),
                        $('<td/>', { 'class': "cockpit-machine-info",
                                     'style': "vertical-align:top;padding-left:10px" }).
                            append(
                                $('<div/>', { 'style': "font-weight:bold" }).text(address),
                                $('<div/>'),
                                $('<div/>')),
                        $('<td/>', { style: "width:200px" }).append(
                            $('<div/>', { 'class': "cockpit-graph", 'style': "height:50px" }).append(
                                $('<div/>', { 'class': "cockpit-graph-label" }).
                                    text(_("CPU")),
                                $('<div/>', { 'class': "cockpit-graph-text" } ),
                                $('<div/>', { 'class': "cockpit-graph-plot",
                                              'style': "width:100%;height:100%" })),
                            $('<div/>', { 'class': "cockpit-machine-spinner" }).append(
                                $('<img/>', { 'src': "images/small-spinner.gif" })),
                            $('<div/>', { 'class': "cockpit-machine-error", 'style': "color:red" })),
                        $('<td/>', { style: "text-align:right;width:180px" }).append(
                            cockpit_action_btn (machine_action_func (machine),
                                                machine_action_spec).addClass('cockpit-machine-action'))));

            var bd =
                $('<li>', { 'class': 'list-group-item' }).append(table);
            machines.append (bd);
            this.dbus_clients[i] = machine.client;
            $(this.dbus_clients[i]).on('state-change.dashboard', $.proxy(this, "update"));
        }
        machines.append('<div class="panel-body" style="text-align:right">' +
                        '<button class="btn btn-default" id="dashboard-add-server">' + _("Add Server") + '</button>' +
                        '</div>');

        $("#dashboard-add-server").on('click', $.proxy(this, "add_server"));

        this.update ();
    },

    update: function () {
        var self = this;

        $('#dashboard-machines > li').each (function (i, e) {
            var info_divs = $(e).find('.cockpit-machine-info > div');
            var action_btn = $(e).find('.cockpit-machine-action');
            var error_div = $(e).find('.cockpit-machine-error');
            var spinner_div = $(e).find('.cockpit-machine-spinner');
            var plot_div = $(e).find('.cockpit-graph');
            var avatar_img = $(e).find('.cockpit-avatar');

            var client = self.dbus_clients[i];

            if (client.state == "ready") {
                var manager = client.lookup("/com/redhat/Cockpit/Manager",
                                            "com.redhat.Cockpit.Manager");
                if (manager) {
                    $(info_divs[0]).text(manager.PrettyHostname || manager.Hostname);
                    $(info_divs[1]).text(manager.System || "--");
                    $(info_divs[2]).text(manager.OperatingSystem || "--");
                    manager.call('GetAvatarDataURL', function (error, result) {
                        if (result)
                            avatar_img.attr('src', result);
                    });
                    $(manager).off('AvatarChanged.dashboard');
                    $(manager).on('AvatarChanged.dashboard', $.proxy (self, "update"));
                }
                cockpit_action_btn_enable (action_btn, 'manage', true);
                cockpit_action_btn_enable (action_btn, 'connect', false);
                cockpit_action_btn_enable (action_btn, 'disconnect', true);
                cockpit_action_btn_select (action_btn, 'manage');
                error_div.text("");
                error_div.hide();
                spinner_div.hide();
                plot_div.show();
            } else if (client.state == "closed") {
                cockpit_action_btn_enable (action_btn, 'manage', false);
                cockpit_action_btn_enable (action_btn, 'connect', true);
                cockpit_action_btn_enable (action_btn, 'disconnect', false);
                cockpit_action_btn_select (action_btn, 'connect');
                error_div.text(cockpit.client_error_description(client.error) || "Disconnected");
                error_div.show();
                spinner_div.hide();
                plot_div.hide();
                if (self.cpu_plots[i]) {
                    self.cpu_plots[i].stop();
                    self.cpu_plots[i] = null;
                }
            } else {
                cockpit_action_btn_select (action_btn, 'manage');
                error_div.text("");
                error_div.hide();
                spinner_div.show();
                plot_div.hide();
            }

            if (client.state == "ready" && !self.cpu_plots[i]) {
                var monitor = client.lookup("/com/redhat/Cockpit/CpuMonitor",
                                            "com.redhat.Cockpit.ResourceMonitor");
                var plot_options = { };
                self.cpu_plots[i] =
                    cockpit_setup_simple_plot($(e).find('.cockpit-graph-plot'),
                                              $(e).find('.cockpit-graph-text'),
                                              monitor, plot_options,
                                              function(values) { // Combines the series into a single plot-value
                                                  return values[1] + values[2] + values[3];
                                              },
                                              function(values) { // Combines the series into a textual string
                                                  var total = values[1] + values[2] + values[3];
                                                  return total.toFixed(1) + "%";
                                              });
                self.cpu_plots[i].start();
            }
        });

    },

    action: function (machine, event) {
        if (machine.client.state == "ready")
            this.server_action(machine, "manage");
        else if (machine.client.state == "closed")
            this.server_action(machine, "connect");
    },

    server_action: function (machine, op) {
        if (op == "manage") {
            cockpit_go_down ({ page: "server", machine: machine.address });
        } else if (op == "connect") {
            machine.client.connect();
        } else if (op == "disconnect") {
            machine.client.close();
        } else if (op == "remove") {
            machine.dbus_iface.call('RemoveTag', "dashboard", function (error) {
                if (error)
                    cockpit_show_unexpected_error (error);
            });
        } else if (op == "rescue") {
            cockpit_go ([ { page: "dashboard" },
                          { page: "server", machine: machine.address },
                          { page: "terminal" } ]);
        } else
            console.log ("unsupported server op %s", op);
    },

    add_server: function () {
        $('#dashboard_setup_server_dialog').modal('show');
    }
};

function PageDashboard() {
    this._init();
}

cockpit_pages.push(new PageDashboard());

})(jQuery, cockpit, cockpit_pages);
