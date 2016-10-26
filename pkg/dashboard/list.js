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

var $ = require("jquery");
var cockpit = require("cockpit");

var Mustache = require("mustache");
var plot = require("plot");

var machines = require("machines");
var mdialogs = require("machine-dialogs");
require("patterns");

var image_editor = require("./image-editor");

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
    xaxis: { tickColor: "#d1d1d1", mode: "time", tickFormatter: plot.format_date_tick, minTickSize: [ 1, 'minute' ] },
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
      options: { yaxis: { ticks: plot.memory_ticks,
                          tickColor: "#e1e6ed",
                          tickFormatter: plot.format_bytes_tick
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
                          tickFormatter: plot.format_bits_per_sec_tick
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
      options: { yaxis: { ticks: plot.memory_ticks,
                          tickColor: "#e1e6ed",
                          tickFormatter: plot.format_bytes_per_sec_tick
                        }
               },
      ymax_min: 100000
    }
];

var avatar_editor;

$(function () {
    avatar_editor = image_editor($('#host-edit-avatar'), 256, 256);
});

function host_edit_dialog(machine_manager, machine_dialogs, host) {
    var machine = machine_manager.lookup(host);
    if (!machine)
        return;

    var can_change_user = machine.address != "localhost";
    var dlg = $("#host-edit-dialog");
    $('#host-edit-fail').text("").hide();
    $('#host-edit-name').val(machine.label);
    $('#host-edit-name').prop('disabled', machine.state == "failed");
    $('#host-edit-user-row').toggle(machines.allow_connection_string);

    if (machines.allow_connection_string) {
        cockpit.user().done(function (user) {
            $('#host-edit-user').attr('placeholder', user.name);
        });
        $('#host-edit-user').prop('disabled', !can_change_user);
        $('#host-edit-user').val(machine.user);
        $("#host-edit-dialog a[data-content]").popover();
    }

    machine_dialogs.render_color_picker("#host-edit-colorpicker", machine.address);
    $('#host-edit-sync-users').off('click');
    $("#host-edit-sync-users").on('click', function () {
        $("#host-edit-dialog").modal('hide');
        machine_dialogs.render_dialog("sync-users",
                                      "dashboard_setup_server_dialog",
                                      machine.address);
    });

    $('#host-edit-apply').off('click');
    $('#host-edit-apply').on('click', function () {
        dlg.dialog('failure', null);
        var values = {
            avatar: avatar_editor.changed ? avatar_editor.get_data(128, 128, "image/png") : null,
            color: machines.colors.parse($('#host-edit-colorpicker #host-edit-color').css('background-color')),
            label: $('#host-edit-name').val(),
        };

        if (can_change_user && machines.allow_connection_string)
            values.user = $('#host-edit-user').val();

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

var permission = cockpit.permission({ admin: true });
$(permission).on("changed", update_servers_privileged);

function update_servers_privileged() {
    $(".servers-privileged").update_privileged(
        permission, cockpit.format(
            _("The user <b>$0</b> is not permitted to manage servers"),
            permission.user ? permission.user.name : '')
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

        self.mdialogs = mdialogs.new_manager(self.machines);

        var current_monitor = 0;

        $('#dashboard-add').click(function () {
            self.mdialogs.render_dialog("add-machine", "dashboard_setup_server_dialog");
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
        plot.setup_plot_controls($('#dashboard'), $('#dashboard-toolbar'), self.plots);

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
                host_edit_dialog(self.machines, self.mdialogs, host);
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
            item.toggleClass("highlight-ct", val);
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
                $("[data-color]", target).each(function() {
                    $(this).css("border-left-color", $(this).attr("data-color"));
                });
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
                    series.push(self.plots[i].add_metrics_sum_series($.extend({ host: machine.connection_string},
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
                var pl = plot.plot($(rm.selector));
                pl.set_options(options);
                self.plots.push(pl);
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

    $(cockpit).on("locationchanged", navigate);
    navigate();
}

$(init);
