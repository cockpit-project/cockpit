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

function cockpit_client_error_description (error) {
    if (error == "terminated")
        return _("Your session has been terminated.");
    else if (error == "no-session")
        return _("Your session has expired.  Please log in again.");
    else if (error == "not-authorized")
        return _("Login failed");
    else if (error == "unknown-hostkey")
        return _("Untrusted host");
    else if (error == "internal-error")
        return _("Internal error");
    else if (error == "timeout")
        return _("Connection has timed out.");
    else if (error === null)
        return _("Server has closed the connection.");
    else
        return error;
}

PageDashboard.prototype = {
    _init: function() {
        this.id = "dashboard";
    },

    getTitleHtml: function() {
        return C_("page-title", '<img src="images/header-gear.png">');
    },

    getTitle: function() {
        return C_("page-title", "Server Console");
    },

    enter: function(first_visit) {
        var me = this;
        if (first_visit) {
            $("#server-actions-menu button").on('click', function () {
                $("#server-actions-menu").popup('close');
                me.server_action(me.server_client, $(this).attr("data-op"));
            });
        }
    },

    show: function() {
        for (var i = 0; i < this.cpu_plots.length; i++) {
            if (this.cpu_plots[i])
                this.cpu_plots[i].start();
        }
    },

    leave: function() {
        for (var i = 0; i < this.cpu_plots.length; i++) {
            if (this.cpu_plots[i])
                this.cpu_plots[i].stop();
        }
    },

    update_machines: function () {
        var me = this;
        var machines = $('#dashboard-machines'), i;
        var monitor;

        if (this.cpu_plots) {
            for (i = 0; i < this.cpu_plots.length; i++) {
                if (this.cpu_plots[i])
                    this.cpu_plots[i].stop();
            }
        }

        function open_actionmenu (client) {
            return function () {
                var o = $(this).offset();
                me.server_client = client;
                $('#server-actions-menu button').button('disable');
                if (client.state == "ready") {
                    $('#server-actions-menu button.ready').button('enable');
                    if (client == cockpit_dbus_client)
                        $('#server-actions-menu button.first-ready').button('enable');
                } else if (client.state == "closed")
                    $('#server-actions-menu button.closed').button('enable');
                $("#server-actions-menu").popup('open', { x: o.left, y: o.top });
            };
        }

        this.cpu_plots = [ ];
        machines.empty ();
        for (i = 0; i < cockpit_dbus_clients.length; i++) {
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
                                $('<div/>', { 'style': "font-weight:bold" }).text(cockpit_dbus_clients[i].target),
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
                            $('<div>', { "data-role": "controlgroup",
                                         "data-type": "horizontal"
                                       }).append(
                                           $('<button>', { on: { click: $.proxy (this, "action", cockpit_dbus_clients[i])
                                                               },
                                                           "class": "cockpit-machine-action",
                                                           "data-inline": "true"
                                                         }).
                                               text("Manage"),
                                           $('<button>', { on: { click: open_actionmenu (cockpit_dbus_clients[i])
                                                               },
                                                           "data-inline": "true"
                                                         }).
                                               text("...")))));
            var li =
                $('<li/>').append(table);
            machines.append (li);
            $(cockpit_dbus_clients[i]).on('state-change', $.proxy(this, "update"));
        }
        machines.append('<li style="text-align:right">' +
                        '<div data-role="controlgroup" data-type="horizontal">' +
                        '<button data-inline="true" id="dashboard-add-server">' + _("Add Server") + '</button>' +
                        '</div>' +
                        '</li>');
        machines.trigger('create');
        machines.listview('refresh');

        $("#dashboard-add-server").on('click', $.proxy(this, "add_server"));

        this.update ();
    },

    update: function () {
        var me = this;

        $('#dashboard-machines > li').each (function (i, e) {
            var info_divs = $(e).find('.cockpit-machine-info > div');
            var action_btn = $(e).find('.cockpit-machine-action');
            var error_div = $(e).find('.cockpit-machine-error');
            var spinner_div = $(e).find('.cockpit-machine-spinner');
            var plot_div = $(e).find('.cockpit-graph');
            var avatar_img = $(e).find('.cockpit-avatar');

            var client = cockpit_dbus_clients[i];
            if (!client)
                return;

            action_btn.button('disable');
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
                    $(manager).on('AvatarChanged.dashboard', $.proxy (me, "update"));
                }
                action_btn.text("Manage");
                if (client == cockpit_dbus_client)
                    action_btn.button('enable');
                error_div.text("");
                error_div.hide();
                spinner_div.hide();
                plot_div.show();
            } else if (client.state == "closed") {
                action_btn.text("Connect");
                action_btn.button('enable');
                error_div.text(cockpit_client_error_description(client.error) || "Disconnected");
                error_div.show();
                spinner_div.hide();
                plot_div.hide();
                if (me.cpu_plots[i]) {
                    me.cpu_plots[i].stop();
                    me.cpu_plots[i] = null;
                }
            } else {
                action_btn.text("Manage");
                error_div.text("");
                error_div.hide();
                spinner_div.show();
                plot_div.hide();
            }
            action_btn.button('refresh');

            if (cockpit_dbus_clients[i].state == "ready" && !me.cpu_plots[i]) {
                var monitor = cockpit_dbus_clients[i].lookup("/com/redhat/Cockpit/CpuMonitor",
                                                          "com.redhat.Cockpit.ResourceMonitor");
                me.cpu_plots[i] =
                    cockpit_setup_simple_plot($(e).find('.cockpit-graph-plot'),
                                           $(e).find('.cockpit-graph-text'),
                                           monitor,
                                           {
                                               series: {
                                                   lines: {show: true, lineWidth: 1},
                                                   color: "rgb(128, 128, 128)",
                                                   shadowSize: 0
                                               },
                                               grid: {show: false},
                                               yaxis: {min: 0, max: 100}
                                           },
                                           function(values) { // Combines the series into a single plot-value
                                               return values[1] + values[2] + values[3];
                                           },
                                           function(values) { // Combines the series into a textual string
                                               var total = values[1] + values[2] + values[3];
                                               return total.toFixed(1) + "%";
                                           });
                me.cpu_plots[i].start();
            }
        });

    },

    action: function (client, event) {
        if (client.state == "ready")
            this.server_action(client, "manage");
        else if (client.state == "closed")
            this.server_action(client, "connect");
    },

    server_action: function (client, op) {
        if (op == "manage") {
            if (client == cockpit_dbus_client)
                cockpit_go_down ({ page: "server", machine: client.target });
        } else if (op == "connect") {
            client.connect();
        } else if (op == "disconnect") {
            client.close();
        } else if (op == "remove") {
            cockpit_remove_machine (client.target);
        } else
            console.log ("unsupported server op %s", op);
    },

    add_server: function () {
        cockpit_popup(null, "#dashboard_add_server_dialog");
    }

};

function PageDashboard() {
    this._init();
}

var cockpit_dashboard_page = new PageDashboard();

cockpit_pages.push(cockpit_dashboard_page);

function cockpit_dashboard_update_machines ()
{
    cockpit_dashboard_page.update_machines();
}

PageAddServer.prototype = {
    _init: function() {
        this.id = "dashboard_add_server_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Add Server");
    },

    show: function() {
    },

    leave: function() {
    },

    enter: function(first_visit) {
        if (first_visit) {
            $("#dashboard_add_server_cancel").on('click', $.proxy(this, "cancel"));
            $("#dashboard_add_server_add").on('click', $.proxy(this, "add"));
        }
        $("#dashboard_add_server_address").val("");
    },

    cancel: function() {
        $("#dashboard_add_server_dialog").popup('close');
    },

    add: function() {
        var machine = $("#dashboard_add_server_address").val();
        $("#dashboard_add_server_dialog").popup('close');
        cockpit_add_machine (machine);
    }

};

function PageAddServer() {
    this._init();
}

cockpit_pages.push(new PageAddServer());
