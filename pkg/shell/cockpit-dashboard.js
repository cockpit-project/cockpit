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
    "use strict";

    function Disco() {
        var self = this;

        var store = { };
        var keys = { };
        var happened = { };
        var seed = 0;

        self.machines = [ ];
        self.events = [ ];

        self.lookup = function lookup(key) {
            return keys[key];
        };

        function top() {
            var i, j, data, layers = [];
            for (i in store) {
                data = store[i];
                for (j in data)
                    layers.push(data[j]);
            }
            return layers;
        }

        function event_sink(key, events) {
            var now = new Date().getTime();
            var count = 0;

            $.each(events, function(x, ev) {
                if (!ev.id) {
                    ev.id = now + ":" + seed;
                    seed++;
                }
                if (happened[ev.id]) {
                    ev = happened[ev.id];
                } else {
                    self.events.push(ev);
                    happened[ev.id] = true;
                    count += 1;
                }
                if (ev.key != key) {
                    ev.key = key;
                    count += 1;
                }
            });

            return count;
        }

        function disco(layers, machines, parent) {
            var seen = { };
            var added = { };
            var combine = { };
            var stage = { };

            machines.length = 0;

            var evented = 0;

            if (!parent)
                keys = { };

            /* Group everything by address or machine id */
            $.each(layers, function(i, layer) {
                var key = layer.id || layer.address;
                if (key) {
                    if (!stage[key])
                        stage[key] = [];
                    stage[key].push(layer);
                }
                if (layer.id && layer.address)
                    combine[layer.address] = layer.id;
            });

            /* Combine address and machine id if possible */
            $.each(combine, function(one, two) {
                if (stage[one] && stage[two]) {
                    stage[two].push.apply(stage[two], stage[one]);
                    delete stage[one];
                }
            });

            $.each(stage, function(key, staged) {
                var machine = { key: "m:" + key, machines: { }, objects: [ ], problems: [ ] };
                machines.push(machine);
                keys[machine.key] = machine;

                $.each(staged, function(x, layer) {
                    if (layer.address)
                        keys["m:" + layer.address] = machine;
                });

                /*
                 * TODO: A custom extend method could tell us if something actually
                 * changed, and avoid copying objects which should be unique already
                 */
                staged.unshift(true, machine);
                $.extend.apply($, staged);

                /*
                 * Squash any child machines recursively. This is already a copy
                 * due to the deep extend above, so no worries about messing with the
                 * data
                 */
                if (machine.machines) {
                    var values = Object.keys(machine.machines).map(function(i) { return machine.machines[i]; });
                    var children = [ ];
                    disco(values, children, machine);
                    machine.machines = children;
                }

                /* Normalize the machine a bit */
                if (machine.problems && machine.problems.length)
                    machine.state = "failed";
                if (!machine.label)
                    machine.label = machine.address || "";
                if (machine.problems.length && !machine.message)
                    machine.message = machine.problems.map(shell.client_error_description);
                if (machine.state && !machine.message)
                    machine.message = machine.state;

                /* Bring in events */
                if (machine.events)
                    evented += event_sink(machine.key, machine.events);

                /* Squash and sort the machine's objects */
                machine.objects = Object.keys(machine.objects).map(function(i) { return machine.objects[i]; });
                machine.objects.sort(function(a1, a2) {
                    return (a1.label || "").localeCompare(a2.label || "");
                });
                $.each(machine.objects, function(i, object) {
                    object.key = "o:" + object.location;
                    object.machine = machine;
                    keys[object.key] = object;
                    if (object.events)
                        evented += event_sink(object.key, object.events);
                });
            });

            /* Sort any machines */
            machines.sort(function(a1, a2) {
                return (a1.label || "").localeCompare(a2.label || "");
            });

            if (!parent)
                $(self).triggerHandler("changed");
            if (evented > 0)
                $(self).triggerHandler("events");
        }

        /* Discover for all plugins */
        function disco_plugins(host) {
            cockpit.packages.all(false).
                done(function(packages) {
                    $.each(packages, function(i, pkg) {
                        if (pkg.manifest.discovery) {
                            $.each(pkg.manifest.discovery, function(i, module) {
                                var module_id = pkg.name + "/" + module;

                                /*
                                 * The interface with the discovery module is very sparse and needs
                                 * to be backwards compatible. It is documented in doc/discovery.md
                                 */

                                /* TODO: No way to do this for other hosts yet */
                                require([module_id], function(module) {
                                    module.discover(host, function(data) {
                                        store[host + "/" + module_id] = data;
                                        disco(top(), self.machines);
                                    });
                                });
                            });
                        }
                    });
                });
        }

        disco_plugins("localhost");
        disco_plugins("192.168.11.100");

        /*
         * Now discover shell hosts and overlay those.
         *
         * TODO: Once the shell is an AMD loaded module, we can use the same
         * mechanism above. But for now hard code this.
         */
        shell.discover(function(data) {
            store["shell-hosts"] = data;
            disco(top(), self.machines);
        });

        /*
         * And lastly (re)discover any machines for which we don't have a
         * machine-id. We load them after the fact and overlay this info.
         */
        store["machine-ids"] = { };
        $(self).on("changed", function() {
            $.each(self.machines, function(i, machine) {
                if (machine.id || !machine.address || machine.masked)
                    return;

                var addr = machine.address;
                if (addr in store["machine-ids"])
                    return;

                store["machine-ids"][addr] = { address: addr, problems: [] };

                /*
                 * TODO: Migrate this to cockpit.file() once that lands. In addition
                 * using the cockpit.file() machinery and superuser channels we can
                 * actually write a file here atomically if it doesn't already exist.
                 */

                var channel = cockpit.channel({ payload: "fsread1",
                                                host: addr,
                                                path: "/etc/machine-id" });
                var data = channel.buffer(null);
                $(channel).on("close", function(event, options) {
                    if (options.problem == "not-found") {
                        console.warn("no /etc/machine-id in host");
                    } else if (options.problem) {
                        console.warn(addr + ": couldn't get machine uuid: " + options.problem);
                        store["machine-ids"][addr].problems.push(options.problem);
                    } else {
                        store["machine-ids"][addr].id = $.trim(data.squash());
                    }

                    disco(top(), self.machines);
                });
            });
        });
    }

    function replacer(key, value) {
        if (key === "avatar")
            return "XXXX";
        return value;
    }

    shell.disco = new Disco();

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

        var renderer = server_renderer($("#dashboard-hosts .list-group"));
        $(shell.disco).on("changed events", renderer);

        renderer = event_renderer($("#dashboard-events table"));
        $(shell.disco).on("changed events", renderer);

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

        function diagnose(machine) {
            var shown = true;
            $.each(machine.problems, function(i, problem) {
                var sel = $("#diagnose-" + problem);
                if (sel.length) {
                    sel.data("machine", machine);
                    sel.modal('show');
                    shown = true;
                    return false;
                }
            });

            if (!shown)
                $("#diagnose").data("machine", machine).modal('show');
        }

        $("#dashboard")
            .on("mouseenter", "[data-key]", function() {
                highlight($(this).attr("data-key"), true);
            })
            .on("mouseleave", "[data-key]", function() {
                highlight($(this).attr("data-key"), false);
            });

        $("#dashboard-hosts")
            .on("click", "a.list-group-item", function() {
                if (self.edit_enabled)
                    return false;
                var machine = shell.disco.lookup($(this).attr("data-key"));
                if (machine.state == "failed") {
                    diagnose(machine);
                    return false;
                }
            })
            .on("click", "button.pficon-close", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                /* TODO: This needs porting */
                var h = shell.hosts[item.attr("data-address")];
                if (h)
                    h.remove();
                return false;
            })
            .on("click", "button.pficon-edit", function() {
                var item = $(this).parent(".list-group-item");
                self.toggle_edit(false);
                /* TODO: This needs porting */
                host_edit_dialog(item.attr("data-address"));
                return false;
            });

        var series = { };

        function update_series() {
            var refresh = false;

            var seen = { };
            $.each(series, function(key) {
                seen[key] = true;
            });

            $("#dashboard-hosts .list-group-item").each(function() {
                var item = $(this);
                var key = item.attr("data-key");
                var machine = shell.disco.lookup(key);
                var addr = machine.address;
                var host = shell.hosts[addr];
                if (!host || host.state == "failed")
                    return;
                delete seen[key];
                if (!series[key]) {
                    series[key] = plot_add(addr);
                }
                $(series[key])
                    .off('hover')
                    .on('hover', function(event, val) {
                        highlight(key, val);
                    });
                if (series[key].options.color != host.color) {
                    refresh = true;
                    series[key].options.color = host.color;
                }
            });

            $.each(seen, function(key) {
                series[key].remove();
                delete series[key];
            });

            if (refresh)
                self.plot.refresh();
        }

        function highlight(key, val) {
            $('#dashboard [data-key="' + key + '"]').toggleClass("highlight", val);
            var s = series[key];
            if (s) {
                s.options.lines.lineWidth = val? 3 : 2;
                if (val)
                    s.move_to_front();
                self.plot.refresh();
            }
        }

        function server_renderer(target) {
            var template = $("#dashboard-hosts-tmpl").html();
            Mustache.parse(template);

            /* jshint validthis:true */
            var helpers = {
                render_avatar: function() {
                    if (this.avatar)
                        return this.avatar;
                    else
                        return "images/server-small.png";
                },
                render_state: function() {
                    if (this.problems) {
                        var problem, i, length = this.problems.length;
                        for (i = 0; i < length; i++) {
                            problem = this.problems[i];
                            if (problem == "no-cockpit" || problem == "not-supported")
                                return "fa fa-cog";
                            else if (problem == "unknown-hostkey" || problem == "no-forwarding")
                                return "fa fa-lock";
                        }
                        if (this.problems.length)
                            return "fa fa-exclamation-circle";
                    }
                    if (this.state == "failed")
                        return "fa fa-exclamation-circle";
                    else if (this.state == "waiting")
                        return "fa fa-pause smaller";
                    else if (this.state == "stopped")
                        return "fa fa-stop smaller";
                    else if (this.state == "running" || this.state == "connected")
                        return "";
                    else
                        return "fa fa-question-circle";
                }
            };

            function render() {
                var text = Mustache.render(template, $.extend({
                    machines: shell.disco.machines,
                }, helpers));

                target.amend(text);
                update_series();
            }

            return render;
        }

        function event_renderer(target) {
            var template = $("#dashboard-events-tmpl").html();
            Mustache.parse(template);

            /* jshint validthis:true */
            var helpers = {
                key: function() {
                    var what = shell.disco.lookup(this.key);
                    if (what) {
                        if (what.machine)
                            return what.machine.key;
                        return what.key;
                    }
                    return this.key;
                },
                render_what: function() {
                    var what = shell.disco.lookup(this.key);
                    if (what)
                        return what.label;
                    return null;
                },
                render_when: function() {
                    if (this.timestamp) {
                        var date = new Date(this.timestamp);
                        var hours = date.getHours();
                        var minutes = date.getMinutes();

                        if (hours < 10)
                            hours = "0" + hours;
                        if (minutes < 10)
                            minutes = "0" + minutes;

                        return hours + ":" + minutes;
                    }
                    return "";
                },
                render_color: function() {
                    var what = shell.disco.lookup(this.key);
                    if (what) {
                        if (what.color)
                            return what.color;
                        else if (what.machine && what.machine.color)
                            return what.machine.color;
                    }
                    return "#BABABA";
                },
                render_priority: function() {
                    if (this.priority == "crit" || this.priority == "emerg" || this.priority == "alert")
                        return "fa fa-exclamation-circle";
                    return null;
                },
                render_json: function() {
                    return JSON.stringify(this);
                }
            };

            function render() {
                var text = Mustache.render(template, $.extend({
                    events: shell.disco.events,
                }, helpers));

                target.html(text);
                update_series();
            }

            return render;
        }

        function plot_add(addr) {
            var shell_info = shell.hosts[addr];

            if (!shell_info || shell_info.state == "failed")
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

        renderer();
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

$("#diagnose-no-cockpit").on('show.bs.modal', function() {
    var dialog = $(this);
    var machine = dialog.data("machine");
    console.log(machine);

    var message = cockpit.format(_("An appropriate version of cockpit-bridge is not installed on the machine $address. If you wish to connect to this machine, please install Cockpit."), machine);
    dialog.children(".diagnose-details").text(message);
});

})(jQuery, cockpit, shell);
