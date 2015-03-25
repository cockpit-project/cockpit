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
    "base1/mustache",
    "shell/controls",
    "shell/shell",
    "shell/machines",
    "shell/cockpit-main"
], function($, cockpit, Mustache, controls, shell, machines) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

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
              "network.all.rx"
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
    avatar_editor = shell.image_editor($('#host-edit-avatar'), 256, 256);

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

function show_problem_dialog(machine) {
    $('#reconnect-dialog-summary').text(
        cockpit.format(_("Couldn't establish connection to $0."), machine.display_name));
    $('#reconnect-dialog-problem').text(cockpit.message(machine.problem));
    $('#reconnect-dialog-reconnect').off('click');
    $('#reconnect-dialog-reconnect').on('click', function () {
        $('#reconnect-dialog').modal('hide');
        machine.connect();
    });
    $('#reconnect-dialog').modal('show');
}

function host_edit_dialog(machine) {
    if (!machine)
        return;

    $('#host-edit-fail').text("").hide();
    $('#host-edit-name').val(machine.label);
    $('#host-edit-name').prop('disabled', machine.state == "failed");
    $('#host-edit-color').css('background-color', machine.color);
    $('#host-edit-apply').off('click');
    $('#host-edit-apply').on('click', function () {
        $('#host-edit-dialog').modal('hide');
        var values = {
            avatar: avatar_editor.changed ? avatar_editor.get_data(128, 128, "image/png") : null,
            color: $('#host-edit-color').css('background-color'),
            label: $('#host-edit-name').val()
        };
        machine.change(values)
            .fail(shell.show_unexpected_error);
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
    $('#host-edit-dialog').modal('show');

    avatar_editor.stop_cropping();
    avatar_editor.load_data(machine.avatar || "images/server-large.png").
        fail(function () {
            $('#host-edit-fail').text("Can't load image").show();
        });
}

function update_servers_privileged() {
    controls.update_privileged_ui(
        shell.default_permission, ".servers-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to manage servers"),
            cockpit.user.name)
    );
}
$(shell.default_permission).on("changed", update_servers_privileged);

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
        $('#dashboard-hosts').toggleClass('editable', self.edit_enabled);
    },

    setup: function() {
        var self = this;

        this.machines = machines.instance();

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
            shell.host_setup(self.machines);
        });
        $('#dashboard-enable-edit').click(function () {
            self.toggle_edit(!self.edit_enabled);
        });

        var renderer = host_renderer($("#dashboard-hosts .list-group"));
        $(self.machines).on("added.dashboard", function(ev, machine) {
            machine.connect();
            renderer();
        });
        $(self.machines).on("removed.dashboard", renderer);
        $(self.machines).on("changed.dashboard", renderer);

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
                var addr = $(this).attr("data-address");
                var machine = self.machines.lookup(addr);
                if (machine.state == "failed") {
                    show_problem_dialog(machine);
                    return false;
                }
            })
            .on("click", "button.pficon-delete", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                var machine = self.machines.lookup(item.attr("data-address"));
                if (machine) {
                    machine.change({ visible: false });
                    machine.close();
                }
                return false;
            })
            .on("click", "button.pficon-edit", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                host_edit_dialog(self.machines.lookup(item.attr("data-address")));
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
                if (!machine || machine.state == "failed")
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
                    var color = shell.esc(machine.color);
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
                    return "images/server-error.png";
                else if (this.avatar)
                    return this.avatar;
                else
                    return "images/server-small.png";
            }

            function render() {
                var text = Mustache.render(template, {
                    machines: self.machines.list,
                    render_avatar: render_avatar
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

            return render;
        }

        function plot_refresh() {
            self.plots.forEach(function (p) { p.refresh(); });
        }

        function plot_add(addr) {
            var machine = self.machines.lookup(addr);

            if (!machine || machine.state == "failed")
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

        $(cockpit).on('resize.dashboard', function () {
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
        this.old_sidebar_state = $('#cockpit-sidebar').is(':visible');
        $('#content-navbar').hide();
        $('#cockpit-sidebar').hide();
    },

    leave: function () {
        $('#content-navbar').show();
        $('#cockpit-sidebar').toggle(this.old_sidebar_state);
    }
};

function PageDashboard() {
    this._init();
}

shell.pages.push(new PageDashboard());

});
