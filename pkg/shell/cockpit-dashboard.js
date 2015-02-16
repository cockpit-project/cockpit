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
/* global Mustache */

var shell = shell || { };
(function($, cockpit, shell) {

var month_names = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];

function format_date_tick(val, axis) {
    function pad(n) {
        var str = n.toFixed();
        if(str.length == 1)
            str = '0' + str;
        return str;
    }

    var d = new Date(val);
    var n = new Date();
    var time = pad(d.getHours()) + ':' + pad(d.getMinutes());

    if (d.getFullYear() == n.getFullYear() && d.getMonth() == n.getMonth() && d.getDate() == n.getDate()) {
        return time;
    } else {
        var day = C_("month-name", month_names[d.getMonth()]) + ' ' + d.getDate().toFixed();
        return day + ", " + time;
    }
}

var common_plot_options = {
    legend: { show: false },
    series: { shadowSize: 0 },
    xaxis: { tickColor: "#d1d1d1", mode: "time", tickFormatter: format_date_tick, minTickSize: [ 1, 'minute' ] },
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

function memory_ticks(opts) {
    // Not more than 5 ticks, nicely rounded to powers of 2.
    var size = Math.pow(2.0, Math.ceil(Math.log(opts.max/5)/Math.LN2));
    var ticks = [ ];
    for (var t = 0; t < opts.max; t += size)
        ticks.push(t);
    return ticks;
}

var resource_monitors = [
    { selector: "#dashboard-plot-0",
      plot: { metrics: [ "kernel.all.cpu.nice",
                         "kernel.all.cpu.user",
                         "kernel.all.cpu.sys"
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
      plot: { metrics: [ "mem.util.used" ],
              units: "byte"
            },
      options: { yaxis: { ticks: memory_ticks,
                          tickColor: "#e1e6ed",
                          tickFormatter:  function (v) { return cockpit.format_bytes(v); }
                        }
               },
      ymax_unit: 100000000
    },
    { selector: "#dashboard-plot-2",
      plot: { metrics: [ "network.interface.total.bytes" ],
              units: "byte",
              'omit-instances': [ "lo" ],
              derive: "rate"
            },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter:  function (v) { return cockpit.format_bits_per_sec(v*8); }
                        }
               },
      ymax_min: 100000
    },
    { selector: "#dashboard-plot-3",
      plot: { metrics: [ "disk.dev.total_bytes" ],
              units: "byte",
              derive: "rate"
            },
      options: { yaxis: { tickColor: "#e1e6ed",
                          tickFormatter:  function (v) { return cockpit.format_bytes_per_sec(v); }
                        }
               },
      ymax_min: 100000
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

        var current_monitor = 0;

        $('#dashboard-add').click(function () {
            shell.host_setup();
        });
        $('#dashboard-enable-edit').click(function () {
            self.toggle_edit(!self.edit_enabled);
        });

        var renderer = host_renderer($("#dashboard-hosts .list-group"));
        $(shell.hosts).on("added.dashboard", renderer);
        $(shell.hosts).on("removed.dashboard", renderer);
        $(shell.hosts).on("changed.dashboard", renderer);

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
        shell.setup_plot_controls($('#dashboard-toolbar'), self.plots);

        $("#dashboard-hosts")
            .on("click", "a.list-group-item", function() {
                if (self.edit_enabled)
                    return false;
                var addr = $(this).attr("data-address");
                var h = shell.hosts[addr];
                if (h.state == "failed") {
                    h.show_problem_dialog();
                    return false;
                }
            })
            .on("click", "button.pficon-delete", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                var h = shell.hosts[item.attr("data-address")];
                if (h)
                    h.remove();
                return false;
            })
            .on("click", "button.pficon-edit", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                host_edit_dialog(item.attr("data-address"));
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
                var host = shell.hosts[addr];
                if (!host || host.state == "failed")
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
                    if (s.options.color != host.color) {
                        refresh = true;
                        s.options.color = host.color;
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
                var sorted_hosts = Object.keys(shell.hosts)
                    .sort(function(a1, a2) {
                        return shell.hosts[a1].compare(shell.hosts[a2]);
                    }).
                    map(function(a) {
                        return shell.hosts[a];
                    });

                var text = Mustache.render(template, {
                    machines: sorted_hosts,
                    render_avatar: render_avatar
                });

                target.html(text);
                update_series();
            }

            return render;
        }

        function plot_refresh() {
            self.plots.forEach(function (p) { p.refresh(); });
        }

        function plot_add(addr) {
            var shell_info = shell.hosts[addr];

            if (shell_info.state == "failed")
                return null;

            var series = [ ];
            var i = 0;
            resource_monitors.forEach(function (rm) {
                if (self.plots[i]) {
                    series.push(self.plots[i].add_metrics_sum_series($.extend({ host: addr},
                                                                              rm.plot),
                                                                     { color: shell_info.color,
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

            $("#dashboard-toolbar").hide();

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

                $(plot).on("changed", function() {
                    if (plot.archives && !options.selection) {
                        $("#dashboard-toolbar").show();
                        options.selection = { mode: "x", color: "#d4edfa" };
                        plot.set_options(options);
                        plot.refresh();
                    }
                });
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

})(jQuery, cockpit, shell);
