/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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
    "base1/mustache",
    "shell/controls",
    "shell/shell",
    "shell/machines",
    "./image-editor",
    "base1/patterns",
    "shell/plot",
], function($, cockpit, Mustache, controls, shell, machines, image_editor) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

/* Handles an href link to a server */
$(document).on("click", "a[data-address]", function(ev) {
    cockpit.jump("/", $(this).attr("data-address"));
    ev.preventDefault();
});

var common_plot_options = {
    legend: { show: false },
    series: { shadowSize: 0 },
    xaxis: { tickColor: "#d1d1d1", mode: "time", tickFormatter: shell.format_date_tick, minTickSize: [ 1, 'minute' ] },
    // The point radius influences the margin around the grid even if
    // no points are plotted.  We don't want any margin, so we set the
    // radius to zero.
    points: { radius: 0 },
    grid: { borderWidth: 1,
            borderColor: "#e1e6ed",
            hoverable: true,
            autoHighlight: false
          }
};

var resource_monitors = [
    { selector: "#dashboard-plot-0",
      plot: {
          direct: [
              "kernel.all.cpu.nice",
              "kernel.all.cpu.user",
              "kernel.all.cpu.sys"
          ],
          internal: [
              "cpu.basic.nice",
              "cpu.basic.user",
              "cpu.basic.system"
          ],
          units: "millisec",
          derive: "rate",
          factor: 0.1  // millisec / sec -> percent
      },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter: function(v) { return v + "%"; }} },
      ymax_unit: 100
    },
    { selector: "#dashboard-plot-1",
      plot: {
          direct: [
              "mem.util.used"
          ],
          internal: [
              "memory.used"
          ],
          units: "bytes",
      },
      options: { yaxis: { ticks: shell.memory_ticks,
                          tickColor: "#e1e6ed",
                          tickFormatter: shell.format_bytes_tick
                        }
               },
      ymax_unit: 100000000
    },
    { selector: "#dashboard-plot-2",
      plot: {
          direct: [
              "network.interface.total.bytes"
          ],
          internal: [
              "network.all.rx",
              "network.all.tx"
          ],
          units: "bytes",
          'omit-instances': [ "lo" ],
          derive: "rate"
      },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter: shell.format_bits_per_sec_tick
                        }
               },
      ymax_min: 100000
    },
    { selector: "#dashboard-plot-3",
      plot: {
          direct: [
              "disk.dev.total_bytes"
          ],
          internal: [
              "block.device.read",
              "block.device.written"
          ],
          units: "bytes",
          derive: "rate"
      },
      options: { yaxis: { ticks: shell.memory_ticks,
                          tickColor: "#e1e6ed",
                          tickFormatter: shell.format_bytes_per_sec_tick
                        }
               },
      ymax_min: 100000
    }
];

var avatar_editor;

$(function () {
    avatar_editor = image_editor($('#host-edit-avatar'), 256, 256);

    $('#host-edit-color').parent().
        on('show.bs.dropdown', function () {
            var $div = $('#host-edit-color');
            var $pop = $('#host-edit-color-popover');
            var div_pos = $div.position();
            var div_width = $div.width();
            var div_height = $div.height();
            var pop_width = $pop.width();
            var pop_height = $pop.height();

            $pop.css('left', div_pos.left + (div_width - pop_width) / 2);
            $pop.css('top', div_pos.top - pop_height + 10);
            $pop.show();
        }).
        on('hide.bs.dropdown', function () {
            $('#host-edit-color-popover').hide();
        });
});

function host_edit_dialog(machine_manager, host) {
    var machine = machine_manager.lookup(host);
    if (!machine)
        return;

    var dlg = $("#host-edit-dialog");
    $('#host-edit-fail').text("").hide();
    $('#host-edit-name').val(machine.label);
    $('#host-edit-name').prop('disabled', machine.state == "failed");
    $('#host-edit-color').css('background-color', machine.color);
    $('#host-edit-apply').off('click');
    $('#host-edit-apply').on('click', function () {
        dlg.dialog('failure', null);
        var values = {
            avatar: avatar_editor.changed ? avatar_editor.get_data(128, 128, "image/png") : null,
            color: $.color.parse($('#host-edit-color').css('background-color')).toString(),
            label: $('#host-edit-name').val()
        };
        var promise = machine_manager.change(machine.key, values);
        dlg.dialog('promise', promise);
    });
    $('#host-edit-avatar').off('click');
    $('#host-edit-avatar').on('click', function () {
        $('#host-edit-fail').text("").hide();
        avatar_editor.select_file().
            done(function () {
                $('#host-edit-avatar').off('click');
                avatar_editor.changed = true;
                avatar_editor.start_cropping();
            });
    });
    dlg.modal('show');

    avatar_editor.stop_cropping();
    avatar_editor.load_data(machine.avatar || "images/server-large.png").
        fail(function () {
            $('#host-edit-fail').text("Can't load image").show();
        });
}

var permission = cockpit.permission({ group: "wheel" });
$(permission).on("changed", update_servers_privileged);

function update_servers_privileged() {
    controls.update_privileged_ui(
        permission, ".servers-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to manage servers"),
            cockpit.user.name)
    );
}

PageDashboard.prototype = {
    _init: function() {
        this.id = "dashboard";
        this.edit_enabled = false;
    },

    getTitle: function() {
        return null;
    },

    toggle_edit: function(val) {
        var self = this;
        self.edit_enabled = val;
        $('#dashboard-enable-edit').toggleClass('active', self.edit_enabled);
        $('.os').toggleClass('hidden', self.edit_enabled);
        $('#dashboard-hosts').toggleClass('editable', self.edit_enabled);
    },

    setup: function() {
        var self = this;

        self.machines = machines.instance();

        function make_color_div(c) {
            return $('<div class="color-cell">').
                css('background-color', c);
        }

        var rows = [ ];

        for (var i = 0; i < machines.colors.length; i += 6) {
            var part = machines.colors.slice(i, i+6);
            rows.push(
                $('<div>').
                    append(
                        part.map(make_color_div)));
        }

        $('#host-edit-color-popover .popover-content').append(rows);
        $('#host-edit-color-popover .popover-content .color-cell').click(function () {
            $('#host-edit-color').css('background-color', $(this).css('background-color'));
        });

        var current_monitor = 0;

        $('#dashboard-add').click(function () {
            host_setup(self.machines);
        });
        $('#dashboard-enable-edit').click(function () {
            self.toggle_edit(!self.edit_enabled);
        });

        var renderer = host_renderer($("#dashboard-hosts .list-group"));
        $(self.machines).on("added.dashboard", renderer);
        $(self.machines).on("removed.dashboard", renderer);
        $(self.machines).on("updated.dashboard", renderer);

        $('#dashboard .nav-tabs li').click(function () {
            set_monitor(parseInt($(this).data('monitor-id'), 10));
        });

        function set_monitor(id) {
            $('#dashboard .nav-tabs li').removeClass("active");
            $('#dashboard .nav-tabs li[data-monitor-id=' + id + ']').addClass("active");
            current_monitor = id;
            $('.dashboard-plot').hide();
            $(resource_monitors[id].selector).show();
            plot_refresh();
        }

        plot_init();
        set_monitor(current_monitor);
        shell.setup_plot_controls($('#dashboard'), $('#dashboard-toolbar'), self.plots);

        $("#dashboard-hosts")
            .on("click", "a.list-group-item", function() {
                if (self.edit_enabled)
                    return false;
            })
            .on("click", "button.pficon-delete", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                var machine = self.machines.lookup(item.attr("data-address"));
                if (machine)
                    self.machines.change(machine.key, { visible: false });
                return false;
            })
            .on("click", "button.pficon-edit", function() {
                var item = $(this).parent(".list-group-item");
                var host = item.attr("data-address");
                self.toggle_edit(false);
                host_edit_dialog(self.machines, host);
                return false;
            })
            .on("mouseenter", "a.list-group-item", function() {
                highlight($(this), true);
            })
            .on("mouseleave", "a.list-group-item", function() {
                highlight($(this), false);
            });

        var series = { };

        function update_series() {
            var refresh = false;

            var seen = { };
            $.each(series, function(addr) {
                seen[addr] = true;
            });

            $("#dashboard-hosts .list-group-item").each(function() {
                var item = $(this);
                var addr = item.attr("data-address");
                var machine = self.machines.lookup(addr);
                if (!machine || machine.state != "connected")
                    return;
                delete seen[addr];
                if (!series[addr]) {
                    series[addr] = plot_add(addr);
                }
                series[addr].forEach(function (s) {
                    $(s)
                        .off('hover')
                        .on('hover', function(event, val) {
                            highlight(item, val);
                        });
                    var color = machine.color;
                    if (s.options.color != color) {
                        refresh = true;
                        s.options.color = color;
                    }
                });
            });

            $.each(seen, function(addr) {
                series[addr].forEach(function (s) { s.remove(); });
                delete series[addr];
            });

            if (refresh)
                plot_refresh();
        }

        function highlight(item, val) {
            item.toggleClass("highlight", val);
            var ser = series[item.attr("data-address")];
            if (ser) {
                ser.forEach(function (s) {
                    s.options.lines.lineWidth = val? 3 : 2;
                    if (val)
                        s.move_to_front();
                });
                plot_refresh();
            }
        }

        function host_renderer(target) {
            var template = $("#dashboard-hosts-tmpl").html();
            Mustache.parse(template);

            /* jshint validthis:true */
            function render_avatar() {
                if (this.state == "failed")
                    return "../shell/images/server-error.png";
                else if (this.avatar)
                    return this.avatar;
                else
                    return "../shell/images/server-small.png";
            }

            function avatar_display() {
                if (this.restarting)
                    return "hidden";
                else
                    return "";
            }

            function connecting_display() {
                if (this.restarting)
                    return "";
                else
                    return "hidden";
            }

            function render() {
                var text = Mustache.render(template, {
                    machines: self.machines.list,
                    render_avatar: render_avatar,
                    avatar_display: avatar_display,
                    connecting_display: connecting_display
                });

                target.html(text);
                $(".delete-localhost").tooltip({
                      title : _("You are currently connected directly to this server. You cannot delete it.")
                });
                $(".delete-localhost").toggleClass('disabled', true);
                $(".delete-localhost").toggleClass('servers-privileged', false);
                update_servers_privileged();
                update_series();
            }

            /* delay and throttle rendering
               events shouldn't fire continuously anyway,
               so in case of a burst it's better to wait a bit before we start rendering
             */
            function throttled_render() {
                var timer = null;
                return function() {
                    if (timer === null) {
                        timer = window.setTimeout(function () {
                            timer = null;
                            render();
                        }, 500);
                    }
                };
            }
            return throttled_render();
        }

        function plot_refresh() {
            self.plots.forEach(function (p) { p.refresh(); });
        }

        function plot_add(addr) {
            var machine = self.machines.lookup(addr);

            if (!machine || machine.state != "connected")
                return null;

            var series = [ ];
            var i = 0;
            resource_monitors.forEach(function (rm) {
                if (self.plots[i]) {
                    series.push(self.plots[i].add_metrics_sum_series($.extend({ host: addr},
                                                                              rm.plot),
                                                                     { color: machine.color,
                                                                       lines: {
                                                                           lineWidth: 2
                                                                       }
                                                                     }));
                }
                i += 1;
            });
            return series;
        }

        function plot_init() {
            self.plots = [];

            resource_monitors.forEach(function (rm) {
                function setup_hook(flot) {
                    var axes = flot.getAxes();
                    var config = rm;

                    if (rm.ymax_unit) {
                        if (axes.yaxis.datamax)
                            axes.yaxis.options.max = Math.ceil(axes.yaxis.datamax / config.ymax_unit) * rm.ymax_unit;
                        else
                            axes.yaxis.options.max = rm.ymax_unit;
                    }

                    if (rm.ymax_min) {
                        if (axes.yaxis.datamax < rm.ymax_min)
                            axes.yaxis.options.max = rm.ymax_min;
                        else
                            axes.yaxis.options.max = null;
                    }

                    axes.yaxis.options.min = 0;
                }

                if (!rm.selector)
                    return;

                var options = $.extend({ setup_hook: setup_hook },
                                       common_plot_options,
                                       rm.options);
                var plot = shell.plot($(rm.selector));
                plot.set_options(options);
                self.plots.push(plot);
            });

            series = {};
            update_series();
        }

        $(window).on('resize.dashboard', function () {
            self.plots.forEach(function (p) { p.resize(); });
        });

        renderer();
    },

    show: function() {
        update_servers_privileged();
        this.plots[0].resize();
        this.toggle_edit(false);
    },

    enter: function() {
    },

    leave: function () {
    }
};

function PageDashboard() {
    this._init();
}

PageSetupServer.prototype = {
    _init: function() {
        this.id = "dashboard_setup_server_dialog";
    },

    show: function() {
        $("#dashboard_setup_address").focus();
    },

    leave: function() {
        var self = this;
        $(self.local).off();
        self.local.close();
        self.local = null;
        self.cancel();
    },

    setup: function() {
        $('#dashboard_setup_cancel').on('click', $.proxy(this, 'cancel'));
        $('#dashboard_setup_prev').on('click', $.proxy(this, 'prev'));
        $('#dashboard_setup_next').on('click', $.proxy(this, 'next'));
    },

    highlight_error: function(container) {
        $(container).addClass("has-error");
    },

    hide_error: function(container) {
        $(container).removeClass("has-error");
    },

    highlight_error_message: function(id, message) {
        $(id).text(message);
        $(id).css("visibility", "visible");
    },

    hide_error_message: function(id) {
        $(id).css("visibility", "hidden");
    },

    check_empty_address: function() {
        var addr = $('#dashboard_setup_address').val();

        if (addr === "") {
            $('#dashboard_setup_next').prop('disabled', true);
            this.hide_error('#dashboard_setup_address_tab');
            this.hide_error_message('#dashboard_setup_address_error');
        } else if (addr.search(/\s+/) === -1) {
            $('#dashboard_setup_next').prop('disabled', false);
            this.hide_error('#dashboard_setup_address_tab');
            this.hide_error_message('#dashboard_setup_address_error');
        } else {
            $('#dashboard_setup_next').prop('disabled', true);
            this.highlight_error('#dashboard_setup_address_tab');
            this.highlight_error_message('#dashboard_setup_address_error',
                                         _("IP address or host name cannot contain whitespace."));
        }

        $('#dashboard_setup_next').text(_("Next"));
        $("#dashboard_setup_spinner").hide();
    },

    check_empty_name: function() {
        var name = $('#dashboard_setup_login_user').val();

        if (name === "") {
            this.name_is_done = false;
            $('#dashboard_setup_next').prop('disabled', true);
            this.hide_error('#login_user_cell');
            this.hide_error_message('#dashboard_setup_login_error');
        } else if (name.search(/\s+/) === -1) {
            this.name_is_done = true;
            $('#dashboard_setup_next').prop('disabled', false);
            this.hide_error('#login_user_cell');
            this.hide_error_message('#dashboard_setup_login_error');
        } else {
            this.name_is_done = false;
            $('#dashboard_setup_next').prop('disabled', true);
            this.highlight_error('#login_user_cell');
            this.highlight_error_message('#dashboard_setup_login_error',
                                         _("User name cannot contain whitespace."));
        }

        $('#dashboard_setup_next').text(_("Next"));
        $("#dashboard_setup_spinner").hide();
    },

    enter: function() {
        var self = this;

        self.local = cockpit.dbus(null, { bus: "internal", host: "localhost", superuser: true });

        self.machines = PageSetupServer.machines;
        self.address = null;
        self.options = { "host-key": "" };
        self.name_is_done = false;

        $("#dashboard_setup_address")[0].placeholder = _("Enter IP address or host name");
        $('#dashboard_setup_address').on('keyup change', $.proxy(this, 'update_discovered'));
        $('#dashboard_setup_address').on('input change focus', $.proxy(this, 'check_empty_address'));
        $('#dashboard_setup_login_user').on('input change focus', $.proxy(this, 'check_empty_name'));
        $('#dashboard_setup_login_password').on('input focus', function() {
            if (self.name_is_done)
                self.hide_error_message('#dashboard_setup_login_error');
        });
        $('#dashboard_setup_address').on('keyup', function(event) {
            if (event.which === 13) {
                var disable = $('#dashboard_setup_next').prop('disabled');

                if (!disable)
                    self.next();
            }
        });
        $('#dashboard_setup_login_user').on('keyup', function(event) {
            if (event.which === 13)
                $("#dashboard_setup_login_password").focus();
        });
        $('#dashboard_setup_login_password').on('keyup', function(event) {
            if (event.which === 13) {
                var disable = $('#dashboard_setup_next').prop('disabled');

                if (!disable)
                    self.next();
            }
        });

        $('#dashboard_setup_address').val("");
        $('#dashboard_setup_login_user').val("");
        $('#dashboard_setup_login_password').val("");

        $('#dashboard_setup_address_reuse_creds').prop('checked', true);

        self.show_tab('address');
        self.update_discovered();
        $('#dashboard_setup_next').prop('disabled', true);
        $("#dashboard_setup_spinner").hide();
    },

    update_discovered: function() {
        var self = this;

        var filter = $('#dashboard_setup_address').val();
        var discovered = $('#dashboard_setup_address_discovered');

        function render_address(address) {
            if (!address.trim())
                return null;
            if (!filter)
                return $('<span/>').text(address);
            var index = address.indexOf(filter);
            if (index == -1)
                return null;
            return $('<span/>').append(
                $('<span/>').text(address.substring(0,index)),
                $('<b/>').text(address.substring(index,index+filter.length)),
                $('<span/>').text(address.substring(index+filter.length)));
        }

        discovered.empty();

        var rendered_address, item;
        var address, machine, addresses = self.machines.addresses;
        for (var i = 0; i < addresses.length; i++) {
            address = addresses[i];
            machine = self.machines.lookup(address);
            if (!machine.visible) {
                rendered_address = render_address(address);
                if (rendered_address) {
                    item =
                        $('<li>', {
                            'class': 'list-group-item',
                            'on': {
                                'click': $.proxy(this, 'discovered_clicked', address)
                                              }
                        }).html(rendered_address);
                    discovered.append(item);
                }
            }
        }
    },

    discovered_clicked: function(address) {
        $("#dashboard_setup_address").val(address);
        this.update_discovered();
        $("#dashboard_setup_address").focus();
    },

    show_tab: function(tab) {
        $('.cockpit-setup-tab').hide();
        $('#dashboard_setup_next').text(_("Next"));
        $("#dashboard_setup_spinner").hide();
        if (tab == 'address') {
            $('#dashboard_setup_address_tab').show();
            $("#dashboard_setup_address").focus();
            this.hide_error_message('#dashboard_setup_address_error');
            this.next_action = this.next_select;
            this.prev_tab = null;
        } else if (tab == 'login') {
            $('#dashboard_setup_login_tab').show();
            $('#dashboard_setup_login_user').focus();
            this.hide_error_message('#dashboard_setup_login_error');
            this.next_action = this.next_login;
            this.prev_tab = 'address';
        } else if (tab == 'action') {
            $('#dashboard_setup_action_tab').show();
            $('#dashboard_setup_next').text(_("Add host"));
            this.next_action = this.next_setup;
            var reuse = $('#dashboard_setup_address_reuse_creds').prop('checked');
            if (reuse)
                this.prev_tab = 'address';
            else
                this.prev_tab = 'login';
        } else if (tab == 'close') {
            $('#dashboard_setup_action_tab').show();
            $('#dashboard_setup_next').text(_("Close"));
            this.next_action = this.next_close;
            this.prev_tab = null;
        }

        if (this.next_action === this.next_login)
            this.check_empty_name();
        else
            $('#dashboard_setup_next').prop('disabled', false);
        $('#dashboard_setup_prev').prop('disabled', !this.prev_tab);
    },

    close: function() {
        var self = this;
        if (self.remote)
            self.remote.close();
        $("#dashboard_setup_server_dialog").modal('hide');
    },

    cancel: function() {
        this.close();
    },

    prev: function() {
        if (this.prev_tab)
            this.show_tab(this.prev_tab);
    },

    next: function() {
        $("#dashboard_setup_spinner").show();
        $('#dashboard_setup_next').prop('disabled', true);
        this.next_action();
    },

    connect_server: function() {
        /* This function tries to connect to the server in
         * 'this.address' with 'this.options' and does the right thing
         * depending on the result.
         */

        var self = this;

        var options = $.extend({ bus: "internal", host: self.address, superuser: true }, self.options);
        var client = cockpit.dbus(null, options);

        $(client)
            .on("close", function(event, options) {
                if (!self.options["host-key"] && options.problem == "unknown-hostkey") {
                    /* The host key is unknown.  Remember it and try
                     * again while allowing that one host key.  When
                     * the user confirms the host key eventually, we
                     * store it permanently.
                     */
                    self.options["host-key"] = options["host-key"];
                    $('#dashboard_setup_action_fingerprint').text(options["host-fingerprint"]);
                    self.connect_server();
                    return;
                } else if (options.problem == "authentication-failed") {
                    /* The given credentials didn't work.  Ask the
                     * user to try again.
                     */
                    self.show_tab('login');
                    self.highlight_error_message('#dashboard_setup_login_error',
                                                 cockpit.message(options.problem));
                    return;
                }

                /* The connection has failed.  Show the error on every
                 * tab but stay on the current tab.
                 */
                var problem = options.problem || "disconnected";
                self.highlight_error_message('#dashboard_setup_address_error', cockpit.message(problem));
                self.highlight_error_message('#dashboard_setup_login_error', cockpit.message(problem));

                $('#dashboard_setup_next').prop('disabled', false);
                $('#dashboard_setup_next').text(_("Next"));
                $("#dashboard_setup_spinner").hide();
            });

        var remote = client.proxy("cockpit.Setup", "/setup");
        var local = self.local.proxy("cockpit.Setup", "/setup");
        remote.wait(function() {
            if (remote.valid) {
                self.remote = client;
                local.wait(function() {
                    self.prepare_setup(remote, local);
                });
            }
        });
    },

    next_select: function() {
        var me = this;
        var reuse_creds;

        me.hide_error_message('#dashboard_setup_address_error');

        me.address = $('#dashboard_setup_address').val();

        if (me.address.trim() !== "") {
            $('#dashboard_setup_login_address').text(me.address);

            reuse_creds = $('#dashboard_setup_address_reuse_creds').prop('checked');

            if (!reuse_creds)
                me.show_tab('login');
            else {
                me.options.user = null;
                me.options.password = null;
                me.options["host-key"] = null;
                me.connect_server();
            }
        } else {
            $('#dashboard_setup_next').text(_("Next"));
            $("#dashboard_setup_spinner").hide();
            me.highlight_error_message('#dashboard_setup_address_error',
                                       _("IP address or host name cannot be empty."));
        }
    },

    next_login: function() {
        var me = this;

        var user = $('#dashboard_setup_login_user').val();
        var pass = $('#dashboard_setup_login_password').val();

        me.hide_error_message('#dashboard_setup_login_error');

        me.options.user = user;
        me.options.password = pass;

        if (user.trim() !== "") {
            me.connect_server();
        } else {
            $('#dashboard_setup_next').text(_("Next"));
            $("#dashboard_setup_spinner").hide();
            me.highlight_error_message('#dashboard_setup_login_error',
                                       _("User name cannot be empty."));
        }
    },

    reset_tasks: function() {
        var $tasks = $('#dashboard_setup_action_tasks');

        this.tasks = [];
        $tasks.empty();
    },

    add_task: function(desc, func) {
        var $tasks = $('#dashboard_setup_action_tasks');

        var $entry = $('<li/>', { 'class': 'list-group-item' }).append(
            $('<table/>', { 'class': "cockpit-setup-task-table",
                            'style': "width:100%" }).append(
                $('<tr/>').append(
                    $('<td/>').text(
                        desc),
                    $('<td style="width:16px"/>').append(
                        $('<div>',  { 'class': "cockpit-setup-task-spinner spinner",
                                      'style': "display:none"
                                    }),
                        $('<div>', { 'class': "cockpit-setup-task-error fa fa-exclamation-triangle",
                                      'style': "display:none"
                                    }),
                        $('<div>', { 'class': "cockpit-setup-task-done pficon pficon-ok",
                                      'style': "display:none"
                                    })))));

        var task = { entry: $entry,
                     func: func,
                     error: function(msg) {
                         this.had_error = true;
                         this.entry.find(".cockpit-setup-task-table").append(
                             $('<tr/>').append(
                                 $('<td/>', { 'style': "color:red" }).text(msg)));
                     }
                   };

        this.tasks.push(task);
        $tasks.append($entry);
    },

    run_tasks: function(done) {
        var me = this;

        function run(i) {
            var t;

            if (i < me.tasks.length) {
                t = me.tasks[i];
                t.entry.find(".cockpit-setup-task-spinner").show();
                t.func(t, function() {
                    t.entry.find(".cockpit-setup-task-spinner").hide();
                    if (t.had_error)
                        t.entry.find(".cockpit-setup-task-error").show();
                    else
                        t.entry.find(".cockpit-setup-task-done").show();
                    run(i+1);
                });
            } else
                done();
        }

        run(0);
    },

    prepare_setup: function(remote, local) {
        var self = this;

        /* We assume all cockpits support the 'passwd1' mechanism */
        remote.Prepare("passwd1")
            .done(function(prepared) {
                self.reset_tasks();
                self.add_task(_("Synchronize admin logins"), function(task, done) {
                    passwd1_mechanism(task, done, prepared);
                });
                $('#dashboard_setup_action_address').text(self.address);
                self.show_tab('action');
            })
            .fail(function(ex) {
                self.highlight_error_message('#dashboard_setup_address_error', ex);
                self.highlight_error_message('#dashboard_setup_login_error', ex);
            });

        function passwd1_mechanism(task, done, prepared) {
            local.Transfer("passwd1", prepared)
                .fail(function(ex) {
                    task.error(ex);
                    done();
                })
                .done(function(result) {
                    remote.Commit("passwd1", result)
                        .fail(function(ex) {
                            task.error(ex);
                        })
                        .always(function() {
                            done();
                        });
                });
        }
    },

    next_setup: function() {
        var self = this;

        /* We can only add the machine to the list of known machines
         * here since doing so also stores its key as 'known good',
         * and we need the users permission for this.
         */

        self.machines.add(self.address, self.options["host-key"])
            .fail(function(ex) {
                self.highlight_error_message('#dashboard_setup_address_error', ex.toString());
                self.show_tab('address');
            })
            .done(function() {
                self.run_tasks(function() {
                    self.show_tab('close');
                });
            });
    },

    next_close: function() {
        this.close();
    }

};

function PageSetupServer() {
    this._init();
}

function host_setup(machines) {
    PageSetupServer.machines = machines;
    var limit = parseInt($(".dashboard-machine-limit").text(), 10);
    $('.dashboard-machine-warning').toggle(limit * 0.75 <= machines.list.length);
    $('#dashboard_setup_server_dialog').modal('show');
}

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
    $('#' + d.id).
        on('show.bs.modal', function () { d.enter(); }).
        on('shown.bs.modal', function () { d.show(); }).
        on('hidden.bs.modal', function () { d.leave(); });
}

function page_show(p, arg) {
    if (p._entered_)
        p.leave();
    p.enter(arg);
    p._entered_ = true;
    $('#' + p.id).show();
    p.show();
}

function page_hide(p) {
    $('#' + p.id).hide();
    if (p._entered_) {
        p.leave();
        p._entered_ = false;
    }
}

function init() {
    var dashboard_page;

    function navigate() {
        var path = cockpit.location.path;

        if (path.length === 0) {
            page_show(dashboard_page);
        } else { /* redirect */
            console.warn("not a dashboard location: " + path);
            cockpit.location = '';
        }

        $("body").removeAttr("hidden");
    }

    cockpit.translate();

    dashboard_page = new PageDashboard();
    dashboard_page.setup();

    dialog_setup(new PageSetupServer());

    $(cockpit).on("locationchanged", navigate);
    navigate();
}

return init;

});
