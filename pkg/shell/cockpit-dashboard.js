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

var common_plot_options = {
    legend: { show: false },
    series: { shadowSize: 0 },
    xaxis: { tickColor: "#d1d1d1", tickFormatter: function() { return ""; } },
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

function network_ticks(opts) {
    // Not more than 5 ticks, nicely rounded to powers of 2.
    var size = Math.pow(2.0, Math.ceil(Math.log2(opts.max/5)));
    var ticks = [ ];
    for (var t = 0; t < opts.max; t += size)
        ticks.push(t);
    return ticks;
}

var resource_monitors = [
    { path: "/com/redhat/Cockpit/CpuMonitor",
      get: function (s) { return s[0]+s[1]+s[2]; },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter: function(v) { return v + "%"; }} },
      ymax_unit: 100
    },
    { path: "/com/redhat/Cockpit/MemoryMonitor",
      get: function (s) { return s[1]+s[2]+s[3]; },
      options: { yaxis: { ticks: network_ticks,
                          tickColor: "#e1e6ed",
                          tickFormatter:  function (v) { return cockpit.format_bytes(v); }
                        }
               },
      ymax_unit: 100000000
    },
    { path: "/com/redhat/Cockpit/NetworkMonitor",
      get: function (s) { return s[0]+s[1]; },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter:  function (v) { return cockpit.format_bits_per_sec(v*8); }
                        }
               },
      ymax_min: 100000
    },
    { path: "/com/redhat/Cockpit/DiskIOMonitor",
      get: function (s) { return s[0]+s[1]; },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter:  function (v) { return cockpit.format_bytes_per_sec(v); }
                        }
               },
      ymax_min: 10000
    }
];

var avatar_editor;

$(function () {
    var rows = [ ];

    function make_color_div(c) {
        return $('<div class="color-cell">').
            css('background-color', c);
    }

    for (var i = 0; i < shell.host_colors.length; i += 6) {
        var part = shell.host_colors.slice(i, i+6);
        rows.push(
            $('<div>').
                append(
                    part.map(make_color_div)));
    }

    $('#host-edit-color-popover .popover-content').append(rows);
    $('#host-edit-color-popover .popover-content .color-cell').click(function () {
        $('#host-edit-color').css('background-color', $(this).css('background-color'));
    });

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

function host_edit_dialog(addr) {
    var info = shell.hosts[addr];

    $('#host-edit-fail').text("").hide();
    $('#host-edit-name').val(info.display_name);
    $('#host-edit-name').prop('disabled', info.state == "failed");
    $('#host-edit-color').css('background-color', info.color);
    $('#host-edit-apply').off('click');
    $('#host-edit-apply').on('click', function () {
        $('#host-edit-dialog').modal('hide');
        $.when(avatar_editor.changed? info.set_avatar(avatar_editor.get_data(128, 128, "image/png")) : null,
               info.set_color($('#host-edit-color').css('background-color')),
               info.state != "failed"? info.set_display_name($('#host-edit-name').val()) : null).
            fail(shell.show_unexpected_error);
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
    avatar_editor.load_data(info.avatar || "images/server-large.png").
        fail(function () {
            $('#host-edit-fail').text("Can't load image").show();
        });
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
        $('#dashboard-hosts').toggleClass('editable', self.edit_enabled);
    },

    setup: function() {
        var self = this;

        $('#dashboard-add').click(function () {
            shell.host_setup();
        });
        $('#dashboard-enable-edit').click(function () {
            self.toggle_edit(!self.edit_enabled);
        });
        this.plot = shell.plot($('#dashboard-plot'), 300, 1);

        var hosts = self.hosts = { };

        $('#dashboard-hosts .list-group').empty();
        self.toggle_edit(false);

        $(shell.hosts).on("added.dashboard", added);
        $(shell.hosts).on("removed.dashboard", removed);
        $(shell.hosts).on("changed.dashboard", changed);

        var current_monitor = 0;

        $('#dashboard .nav-tabs li').click(function () {
            set_monitor(parseInt($(this).data('monitor-id'), 10));
        });

        function set_monitor(id) {
            $('#dashboard .nav-tabs li').removeClass("active");
            $('#dashboard .nav-tabs li[data-monitor-id=' + id + ']').addClass("active");
            current_monitor = id;
            plot_reset();
        }

        set_monitor(current_monitor);

        $("#dashboard-hosts")
            .on("click", "a.list-group-item", function() {
                if (!self.edit_enabled) {
                    var addr = $(this).data("address");
                    var h = shell.hosts[addr];
                    if (h.state == "failed")
                        h.show_problem_dialog();
                    else
                        cockpit.location.go([ addr, "server" ]);
                    return false;
                }
            })
            .on("click", "button.pficon-close", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                var h = shell.hosts[item.data("address")];
                if (h)
                    h.remove();
                return false;
            })
            .on("click", "button.pficon-edit", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                host_edit_dialog(item.data("address"));
                return false;
            })
            .on("mouseenter", "a.list-group-item", function() {
                highlight($(this), true);
            })
            .on("mouseleave", "a.list-group-item", function() {
                highlight($(this), false);
            });

        function highlight(item, val) {
            item.toggleClass("highlight", val);
            var s = series[item.data("address")];
            if (s) {
                s.options.lines.lineWidth = val? 3 : 2;
                if (val)
                    s.move_to_front();
                self.plot.refresh();
            }
        }

        var series = { };

        function update_series() {
            var refresh = false;

            var seen = { };
            $.each(series, function(addr) {
                seen[addr] = true;
            });

            $("#dashboard-hosts .list-group-item").each(function() {
                var item = $(this);
                var addr = item.data("address");
                var host = shell.hosts[addr];
                if (!host || host.state == "failed")
                    return;
                delete seen[addr];
                if (!series[addr]) {
                    series[addr] = plot_add(addr);
                    $(series[addr]).on('hover', function(event, val) {
                        highlight(item, val);
                    });
                }
                if (series[addr].options.color != host.color) {
                    refresh = true;
                    series[addr].options.color = host.color;
                }
            });

            $.each(seen, function(addr) {
                series[addr].remove();
                delete series[addr];
            });

            if (refresh)
                self.plot.refresh();
        }

        function added(event, addr) {
            var info = hosts[addr] = { };
            info.link = $('<a class="list-group-item">')
                .attr("data-address", addr).append(
                $('<button class="btn btn-danger edit-button pficon pficon-close">'),
                $('<button class="btn btn-default edit-button pficon pficon-edit">'),
                info.avatar_img = $('<img class="host-avatar">').
                    attr('src', "images/server-small.png"),
                info.hostname_span = $('<span>'));

            changed(event, addr);

            info.remove = function () {
                var series = info.link.data("series");
                if (series)
                    series.remove();
                info.link.remove();
            };

            show_hosts();
        }

        function removed(event, addr) {
            hosts[addr].remove();
            delete hosts[addr];
            update_series();
        }

        function changed(event, addr) {
            var shell_info = shell.hosts[addr];
            var dash_info = hosts[addr];

            if (!dash_info || !shell_info)
                return;

            dash_info.hostname_span.text(shell_info.display_name);
            var failed = (shell_info.state == "failed");
            dash_info.link.toggleClass("failed", failed);
            if (failed) {
                dash_info.avatar_img.attr('src', "images/server-error.png");
                if (dash_info.plot_series) {
                    dash_info.plot_series.remove();
                    dash_info.plot_series = null;
                }
            } else {
                if (shell_info.avatar)
                    dash_info.avatar_img.attr('src', shell_info.avatar);
                if (shell_info.color && shell_info.color != dash_info.color) {
                    dash_info.color = shell_info.color;
                    dash_info.avatar_img.
                        css('border-color', shell_info.color);
                    if (dash_info.plot_series) {
                        dash_info.plot_series.options.color = shell_info.color;
                        self.plot.refresh();
                    }
                }
            }
            show_hosts();
        }

        function show_hosts() {
            var sorted_hosts = (Object.keys(hosts).
                                sort(function (a1, a2) {
                                    return shell.hosts[a1].compare(shell.hosts[a2]);
                                }));
            $('#dashboard-hosts .list-group').append(
                sorted_hosts.map(function (addr) { return hosts[addr].link; }));

            update_series();
        }

        function plot_add(addr) {
            var shell_info = shell.hosts[addr];

            if (shell_info.state == "failed")
                return null;

            return self.plot.add_cockpitd_resource_monitor(shell_info.cockpitd,
                                                           resource_monitors[current_monitor].path,
                                                           resource_monitors[current_monitor].get,
                                                           { color: shell_info.color,
                                                             lines: {
                                                                 lineWidth: 2
                                                             }
                                                           });
        }

        function plot_setup_hook(flot) {
            var axes = flot.getAxes();
            var config = resource_monitors[current_monitor];

            if (config.ymax_unit) {
                if (axes.yaxis.datamax)
                    axes.yaxis.options.max = Math.ceil(axes.yaxis.datamax / config.ymax_unit) * config.ymax_unit;
                else
                    axes.yaxis.options.max = config.ymax_unit;
            }

            if (config.ymax_min) {
                if (axes.yaxis.datamax < config.ymax_min)
                    axes.yaxis.options.max = config.ymax_min;
                else
                    axes.yaxis.options.max = null;
            }

            axes.yaxis.options.min = 0;
        }

        function plot_reset() {
            var options = $.extend({ setup_hook: plot_setup_hook },
                                   common_plot_options,
                                   resource_monitors[current_monitor].options);
            self.plot.reset();
            self.plot.set_options(options);
            series = {};
            update_series();
            self.plot.refresh();
            self.plot.start_walking(1);
        }

        $(cockpit).on('resize.dashboard', function () {
            self.plot.resize();
        });

        for (var addr in shell.hosts)
            added(null, addr);
    },

    show: function() {
        this.plot.resize();
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

})(jQuery, cockpit, shell);
