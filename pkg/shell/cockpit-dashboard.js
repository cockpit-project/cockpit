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

var resource_monitors = [
    { path: "/com/redhat/Cockpit/CpuMonitor",
      get: function (s) { return s[0]+s[1]+s[2]; },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter: function(v) { return v + "%"; }} },
      ymax_unit: 100
    },
    { path: "/com/redhat/Cockpit/MemoryMonitor",
      get: function (s) { return s[1]+s[2]+s[3]; },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickSize: 1024*1024*256,
                          tickFormatter:  function (v) { return shell.format_bytes(v); }
                        }
               },
      ymax_unit: 1024*1024*256
    },
    { path: "/com/redhat/Cockpit/NetworkMonitor",
      get: function (s) { return s[0]+s[1]; },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter:  function (v) { return shell.format_bits_per_sec(v*8); }
                        }
               },
      ymax_min: 100000
    },
    { path: "/com/redhat/Cockpit/DiskIOMonitor",
      get: function (s) { return s[0]+s[1]; },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter:  function (v) { return shell.format_bytes_per_sec(v); }
                        }
               }
    }
];

PageDashboard.prototype = {
    _init: function() {
        this.id = "dashboard";
    },

    getTitle: function() {
        return null;
    },

    setup: function() {
        $('#dashboard-add').click(function () {
            shell.host_setup();
        });
        this.plot = shell.plot($('#dashboard-plot'));
    },

    enter: function() {
        var self = this;

        var hosts = self.hosts = { };

        $('#dashboard-hosts').empty();

        $(shell.hosts).on("added.dashboard", added);
        $(shell.hosts).on("removed.dashboard", removed);
        $(shell.hosts).on("changed.dashboard", changed);

        var current_monitor = parseInt(shell.get_page_param('m'), 10) || 0;

        $('#dashboard .nav-tabs li').click(function () {
            set_monitor(parseInt($(this).attr('data-monitor-id'), 10));
        });

        function set_monitor(id) {
            $('#dashboard .nav-tabs li').removeClass("active");
            $('#dashboard .nav-tabs li[data-monitor-id=' + id + ']').addClass("active");
            current_monitor = id;
            plot_reset();
            shell.set_page_param('m', id.toString());
        }

        set_monitor(current_monitor);

        function added (event, addr) {
            var info = hosts[addr] = { };
            info.link = $('<a class="list-group-item">').append(
                $('<button class="btn btn-default" style="float:right">').
                    text("-").
                    click(function () {
                        var h = shell.hosts[addr];
                        if (h)
                            h.remove();
                        return false;
                    }),
                info.avatar_img = $('<img width="32" height="32" class="host-avatar">').
                    attr('src', "images/server-small.png"),
                info.hostname_span = $('<span>')).
                click(function () {
                    var h = shell.hosts[addr];
                    if (h.state == "failed")
                        h.show_problem_dialog();
                    else
                        cockpit.location.go([ addr, "server" ]);
                }).
                mouseenter(function () {
                    highlight (true);
                }).
                mouseleave(function () {
                    highlight (false);
                });

            changed (event, addr);

            function highlight(val) {
                info.link.toggleClass("highlight", val);
                if (info.plot_series) {
                    info.plot_series.options.lines.lineWidth = val? 3 : 2;
                    info.plot_series.move_to_front();
                    self.plot.refresh();
                }
            }

            info.plot_series = plot_add(addr);
            $(info.plot_series).on('hover', function (event, val) { highlight(val); });

            info.remove = function () {
                info.link.remove();
                if (info.plot_series)
                    info.plot_series.remove();
            };

            show_hosts();
        }

        function removed (event, addr) {
            hosts[addr].remove();
            delete hosts[addr];
        }

        function changed (event, addr) {
            var shell_info = shell.hosts[addr];
            var dash_info = hosts[addr];
            dash_info.hostname_span.text(shell_info.display_name);
            if (shell_info.state == "failed") {
                dash_info.avatar_img.attr('src', "images/server-error.png");
                dash_info.avatar_img.
                    css('border', "none");
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
                        css('border-width', 2).
                        css('border-style', "solid").
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
            $('#dashboard-hosts').append(
                sorted_hosts.map(function (addr) { return hosts[addr].link; }));
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

            if (config.ymax_unit)
                axes.yaxis.options.max = Math.ceil(axes.yaxis.datamax / config.ymax_unit) * config.ymax_unit;

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
            for (addr in hosts)
                plot_add(addr);
        }

        $(cockpit).on('resize.dashboard', function () {
            self.plot.resize();
        });

        for (var addr in shell.hosts)
            added (null, addr);

        self.old_sidebar_state = $('#cockpit-sidebar').is(':visible');
        $('#content-navbar').hide();
        $('#cockpit-sidebar').hide();
    },

    show: function() {
        this.plot.resize();
    },

    leave: function() {
        var self = this;

        self.plot.reset();

        for (var addr in self.hosts)
            self.hosts[addr].remove();

        $(shell.hosts).off(".dashboard");
        $(cockpit).off('.dashboard');

        $('#content-navbar').show();
        $('#cockpit-sidebar').toggle(this.old_sidebar_state);
    }
};

function PageDashboard() {
    this._init();
}

shell.pages.push(new PageDashboard());

})(jQuery, cockpit, shell);
