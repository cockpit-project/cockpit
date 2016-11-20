/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

require("jquery-flot/jquery.flot");
require("jquery-flot/jquery.flot.selection");
require("jquery-flot/jquery.flot.time");

var plotter = { };

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

/* A thin abstraction over flot and metrics channels.  It mostly
 * shields you from hairy array acrobatics and having to know when it
 * is safe or required to create the flot object.
 *
 *
 * - plot = plotter.plot(element, x_range, [x_stop])
 *
 * Creates a 'plot' object attached to the given DOM element.  It will
 * show 'x_range' seconds worth of samples, until 'x_stop'.
 *
 * If 'x_stop' is undefined, the plot will show the last 'x_range'
 * seconds until now and walking will work as expected (see below).
 *
 * If 'x_stop' is not undefined, it should be the number of seconds
 * since the epoch.
 *
 * - plot.start_walking()
 *
 * Scroll towards the future.
 *
 * - plot.stop_walking()
 *
 * Stop automatic scrolling.
 *
 * - plot.refresh()
 *
 * Draw the plot.
 *
 * - plot.resize()
 *
 * Resize the plot to fit into its DOM element.  This will
 * automatically refresh the plot.  You should also call this function
 * when 'element' has changed visibility as that might affect its
 * size.
 *
 * - plot.set_options(options)
 *
 * Set the global flot options.  You need to refresh the plot
 * afterwards.
 *
 * In addition to the flot options, you can also set 'setup_hook'
 * field to a function.  This function will be called between
 * flot.setData() and flot.draw() and can be used to adjust the axes
 * limits, for example.  It is called with the flot object as its only
 * parameter.
 *
 * - options = plot.get_options()
 *
 * Get the global flot options.  You can modify the object and then
 * pass it to set_options.  Don't forget to refresh the plot.
 *
 * - plot.reset(x_range, [x_stop])
 *
 * Resets the range of the plot.  All current sources are reinitialzed
 * but keep their current samples.
 *
 * - plot.destroy()
 *
 * Resets the plot to be empty.  The plot will disappear completely
 * from the DOM, including the grid.
 *
 * - series = plot.add_metrics_sum_series(desc, options)
 *
 * Adds a single series into the plot that is fed by a metrics
 * channel.  The series will have the given flot options.  The plot
 * will automatically refresh as data becomes available from the
 * channel.
 *
 * The single value for the series is computed by summing the values
 * for all metrics and all instances that are delivered by the
 * channel.
 *
 * The 'desc' argument determines the channel options:
 *
 *   metrics:         An array with the names of all metrics to monitor.
 *   units:           The common units string for all metrics.
 *   instances:       A optional list of instances to include.
 *   omit_instances:  A optional list of instances to omit.
 *   factor:          A factor to apply to the final sum of all samples.
 *
 * - series.options
 *
 * Direct access to the series options.  You need to refresh the plot
 * after changing it.
 *
 * - series.move_to_front()
 *
 * Move the series in front of all other series.  You need to refresh
 * the plot to see the effect immediately.
 *
 * - series.remove()
 *
 * Removes the series from its plot.  The plot will be refreshed.
 *
 * - $(series).on('hover', function (event, val) { ... })
 *
 * This event is triggered when the user hovers over the series ('val'
 * == true), or stops hovering over it ('val' == false).
 */

plotter.plot = function plot(element, x_range_seconds, x_stop_seconds) {
    var options = { };
    var result = { };

    var series = [ ];
    var flot_data = [ ];
    var flot = null;

    var interval;
    var grid;

    function refresh_now() {
        if (element.height() === 0 || element.width() === 0)
            return;

        if (flot === null)
            flot = $.plot(element, flot_data, options);

        flot.setData(flot_data);
        var axes = flot.getAxes();

        /* Walking and fetching samples are not synchronized, which
         * means that a walk step might reveal a sample that hasn't
         * been fetched yet.  To reduce flicker, we cut off one extra
         * sample at the end.
         */
        axes.xaxis.options.min = grid.beg * interval;
        axes.xaxis.options.max = (grid.end - 2) * interval;
        if (options.setup_hook)
            options.setup_hook(flot);

        /* This makes sure that the axes are displayed even for an
         * empty plot.
         */
        axes.xaxis.show = true;
        axes.xaxis.used = true;
        axes.yaxis.show = true;
        axes.yaxis.used = true;

        flot.setupGrid();
        flot.draw();
    }

    var refresh_pending = false;

    function refresh() {
        if (!refresh_pending) {
            refresh_pending = true;
            window.setTimeout(function () {
                refresh_pending = false;
                refresh_now();
            }, 0);
        }
    }

    function start_walking() {
        grid.walk();
    }

    function stop_walking() {
        grid.move(grid.beg, grid.end);
    }

    var sync_suppressed = 0;

    function reset(x_range_seconds, x_stop_seconds) {
        if (flot)
            flot.clearSelection(true);

        // Fill the plot with about 1000 samples, but don't sample
        // faster than once per second.
        //
        // TODO - do this based on the actual size of the plot.

        interval = Math.ceil(x_range_seconds / 1000) * 1000;

        var x_offset;
        if (x_stop_seconds !== undefined)
            x_offset = (new Date().getTime()) - x_stop_seconds * 1000;
        else
            x_offset = 0;

        var beg = -Math.ceil((x_range_seconds * 1000 + x_offset) / interval);
        var end = -Math.floor(x_offset / interval);

        if (grid && grid.interval == interval) {
            grid.move(beg, end);
        } else {
            if (grid)
                grid.close();
            grid = cockpit.grid(interval, beg, end);
            sync_suppressed++;
            for (var i = 0; i < series.length; i++)
                series[i].reset();
            sync_suppressed--;
            sync();

            $(grid).on('notify', function (event, index, count) {
                refresh();
            });
        }
    }

    function sync() {
        if (sync_suppressed === 0)
            grid.sync();
    }

    function destroy() {
        grid.close();
        for (var i = 0; i < series.length; i++)
            series[i].stop();

        options = { };
        series = [ ];
        flot_data = [ ];
        flot = null;
        $(element).empty();
        $(element).data("flot_data", null);
    }

    function resize() {
        if (element.height() === 0 || element.width() === 0)
            return;
        if (flot)
            flot.resize();
        refresh();
    }

    function set_options(opts) {
        options = opts;
        flot = null;
    }

    function get_options() {
        return options;
    }

    function add_metrics_sum_series(desc, opts) {
        var channel = null;

        var self = {
            options: opts,
            move_to_front: move_to_front,
            remove: remove
        };

        series.push({
            stop: stop,
            reset: reset_series,
            hover_hit: hover_hit,
            hover: hover
        });

        function stop() {
            if (channel)
                channel.close();
        }

        function add_series() {
            flot_data.push(opts);
        }

        function remove_series() {
            var pos = flot_data.indexOf(opts);
            if (pos >= 0)
                flot_data.splice(pos, 1);
        }

        function move_to_front() {
            var pos = flot_data.indexOf(opts);
            if (pos >= 0) {
                flot_data.splice(pos, 1);
                flot_data.push(opts);
            }
        }

        function remove() {
            stop();
            remove_series();
            refresh();
        }

        function build_metric(n) {
            return { name: n, units: desc.units, derive: desc.derive };
        }

        var chanopts_list = [ ];

        if (desc.direct) {
            chanopts_list.push({ source: "direct",
                                 archive_source: "pcp-archive",
                                 metrics: desc.direct.map(build_metric),
                                 instances: desc.instances,
                                 "omit-instances": desc['omit-instances'],
                                 host: desc.host
                               });
        }

        if (desc.internal) {
            chanopts_list.push({ source: "internal",
                                 metrics: desc.internal.map(build_metric),
                                 instances: desc.instances,
                                 "omit-instances": desc['omit-instances'],
                                 host: desc.host
                               });
        }

        function flat_sum(val) {
            var i, sum;

            if (!val)
                return 0;
            if (val.length !== undefined) {
                sum = 0;
                for (i = 0; i < val.length; i++)
                    sum += flat_sum(val[i]);
                return sum;
            }
            return val;
        }

        function reset_series() {
            if (channel)
                channel.close();

            channel = cockpit.metrics(interval, chanopts_list);

            var metrics_row = grid.add(channel, [ ]);
            var factor = desc.factor || 1;
            opts.data = grid.add(function(row, x, n) {
                for (var i = 0; i < n; i++)
                    row[x + i] = [(grid.beg + x + i)*interval, flat_sum(metrics_row[x + i]) * factor];
            });

            function check_archives() {
                if (channel.archives && !result.archives) {
                    result.archives = true;
                    $(result).triggerHandler("changed");
                }
            }

            $(channel).on('changed', check_archives);
            check_archives();

            sync();
        }

        function hover_hit(pos, item) {
            return !!(item && (item.series.data == opts.data));
        }

        function hover(val) {
            $(self).triggerHandler('hover', [ val ]);
        }

        reset_series();
        add_series();

        return self;
    }

    function add_metrics_stacked_instances_series(desc, opts) {
        var channel = null;

        var self = {
            add_instance:    add_instance,
            clear_instances: clear_instances
        };

        series.push({
            stop: stop,
            reset: reset_series,
            hover_hit: hover_hit,
            hover: hover
        });

        function stop() {
            if (channel)
                channel.close();
        }

        function build_metric(n) {
            return { name: n, units: desc.units, derive: desc.derive };
        }

        var chanopts_list = [ ];

        if (desc.direct) {
            chanopts_list.push({ source: "direct",
                                 archive_source: "pcp-archive",
                                 metrics: [ build_metric(desc.direct) ],
                                 metrics_path_names: [ "a" ],
                                 instances: desc.instances,
                                 "omit-instances": desc['omit-instances'],
                                 host: desc.host
                               });
        }

        if (desc.internal) {
            chanopts_list.push({ source: "internal",
                                 metrics: [ build_metric(desc.internal) ],
                                 metrics_path_names: [ "a" ],
                                 instances: desc.instances,
                                 "omit-instances": desc['omit-instances'],
                                 host: desc.host
                               });
        }

        function reset_series() {
            if (channel)
                channel.close();

            channel = cockpit.metrics(interval, chanopts_list);

            function check_archives() {
                if (channel.archives && !result.archives) {
                    result.archives = true;
                    $(result).triggerHandler("changed");
                }
            }

            $(channel).on('changed', check_archives);
            check_archives();

            sync_suppressed++;
            for (var name in instances)
                instances[name].reset();
            sync_suppressed--;
            sync();
        }

        var instances = { };
        var last_instance = null;

        function add_instance(name, selector) {
            if (instances[name])
                return;

            var instance_data = $.extend({ selector: selector }, opts);
            var factor = desc.factor || 1;
            var threshold = desc.threshold || 0;
            var metrics_row;

            var last = last_instance;

            function reset() {
                metrics_row = grid.add(channel, [ "a", name ]);
                instance_data.data = grid.add(function(row, x, n) {
                    for (var i = 0; i < n; i++) {
                        var value = (metrics_row[x + i] || 0)*factor;
                        var ts = (grid.beg + x + i)*interval;
                        var floor = 0;

                        if (last) {
                            if (last.data[x + i][1])
                                floor = last.data[x + i][1];
                            else
                                floor = last.data[x + i][2];
                        }

                        if (Math.abs(value) > threshold) {
                            row[x + i] = [ ts, floor + value, floor ];
                            if (row[x + i - 1] && row[x + i - 1][1] === null)
                                row[x + i - 1][1] = row[x + i - 1][2];
                        } else {
                            row[x + i] = [ ts, null, floor ];
                            if (row[x + i - 1] && row[x + i - 1][1] !== null)
                                row[x + i - 1][1] = row[x + i - 1][2];
                        }
                    }
                });
                sync();
            }

            function remove() {
                grid.remove(metrics_row);
                grid.remove(instance_data.data);
                var pos = flot_data.indexOf(instance_data);
                if (pos >= 0)
                    flot_data.splice(pos, 1);
            }

            last_instance = instance_data;
            instances[name] = instance_data;
            instance_data.reset = reset;
            instance_data.remove = remove;

            reset();
            flot_data.push(instance_data);
        }

        function clear_instances() {
            for (var i in instances)
                instances[i].remove();
            instances = { };
            last_instance = null;
        }

        function hover_hit(pos, item) {
            var name, index;

            if (!grid)
                return false;

            index = Math.round(pos.x/interval) - grid.beg;
            if (index < 0)
                index = 0;

            for (name in instances) {
                var d = instances[name].data;
                if (d[index] && d[index][1] && d[index][2] <= pos.y && pos.y <= d[index][1])
                    return instances[name].selector || name;
            }
            return false;
        }

        function hover(val) {
            $(self).triggerHandler('hover', [ val ]);
        }

        reset_series();
        return self;
    }

    var cur_hover_series = null;
    var cur_hover_val = false;

    function hover(next_hover_series, next_hover_val) {
        if (cur_hover_series != next_hover_series) {
            if (cur_hover_series)
                cur_hover_series.hover(false);
            cur_hover_series = next_hover_series;
            cur_hover_val = next_hover_val;
            if (cur_hover_series)
                cur_hover_series.hover(cur_hover_val);
        } else if (cur_hover_val != next_hover_val) {
            cur_hover_val = next_hover_val;
            if (cur_hover_series)
                cur_hover_series.hover(cur_hover_val);
        }
    }

    function hover_on(event, pos, item) {
        var next_hover_series = null;
        var next_hover_val = false;
        for (var i = 0; i < series.length; i++) {
            next_hover_val = series[i].hover_hit(pos, item);
            if (next_hover_val) {
                next_hover_series = series[i];
                break;
            }
        }

        hover(next_hover_series, next_hover_val);
    }

    function hover_off(event) {
        hover(null, false);
    }

    function selecting(event, ranges) {
        if (ranges)
            $(result).triggerHandler("zoomstart", [ ]);
    }

    function selected(event, ranges) {
        flot.clearSelection(true);
        $(result).triggerHandler("zoom", [ (ranges.xaxis.to - ranges.xaxis.from) / 1000, ranges.xaxis.to / 1000]);
    }

    $(element).on("plothover", hover_on);
    $(element).on("mouseleave", hover_off);
    $(element).on("plotselecting", selecting);
    $(element).on("plotselected", selected);

    // for testing
    $(element).data("flot_data", flot_data);

    reset(x_range_seconds, x_stop_seconds);

    $.extend(result, {
        archives: false, /* true if any archive data found */
        start_walking: start_walking,
        stop_walking: stop_walking,
        refresh: refresh,
        reset: reset,
        destroy: destroy,
        resize: resize,
        set_options: set_options,
        get_options: get_options,
        add_metrics_sum_series: add_metrics_sum_series,
        add_metrics_stacked_instances_series: add_metrics_stacked_instances_series
    });

    return result;
};

var plot_colors = [ "#006bb4",
                    "#008ff0",
                    "#2daaff",
                    "#69c2ff",
                    "#a5daff",
                    "#e1f3ff",
                    "#00243c",
                    "#004778"
                  ];

plotter.plot_simple_template = function simple() {
    return {
        colors: plot_colors,
        legend: { show: false },
        series: { shadowSize: 0,
            lines: {
                lineWidth: 2.0,
                fill: 0.4
            }
        },
        xaxis: { tickLength: 0,
                 mode: "time",
                 tickFormatter: plotter.format_date_tick,
                 minTickSize: [ 1, 'minute' ],
                 reserveSpace: false
               },
        yaxis: { tickColor: "#d1d1d1",
                 min: 0
               },
        /*
         * The point radius influences the margin around the grid even if no points
         * are plotted. We don't want any margin, so we set the radius to zero.
         */
        points: {
            radius: 0
        },
        grid: {
            borderWidth: 1,
            aboveData: false,
            color: "black",
            borderColor: $.color.parse("black").scale('a', 0.22).toString(),
            labelMargin: 0
        }
    };
};

plotter.memory_ticks = function memory_ticks(opts) {
    // Not more than 5 ticks, nicely rounded to powers of 2.
    var size = Math.pow(2.0, Math.ceil(Math.log(opts.max/5)/Math.LN2));
    var ticks = [ ];
    for (var t = 0; t < opts.max; t += size)
        ticks.push(t);
    return ticks;
};

var month_names = [
    C_("month-name", 'Jan'),
    C_("month-name", 'Feb'),
    C_("month-name", 'Mar'),
    C_("month-name", 'Apr'),
    C_("month-name", 'May'),
    C_("month-name", 'Jun'),
    C_("month-name", 'Jul'),
    C_("month-name", 'Aug'),
    C_("month-name", 'Sep'),
    C_("month-name", 'Oct'),
    C_("month-name", 'Nov'),
    C_("month-name", 'Dec')
];

plotter.format_date_tick = function format_date_tick(val, axis) {
    function pad(n) {
        var str = n.toFixed();
        if(str.length == 1)
            str = '0' + str;
        return str;
    }

    var year_index = 0;
    var month_index = 1;
    var day_index = 2;
    var hour_minute_index = 3;

    var begin;
    var end;

    // Determine the smallest unit according to the steps from one
    // tick to the next.

    var size = axis.tickSize[1];
    if (size == "minute" || size == "hour")
        end = hour_minute_index;
    else if (size == "day")
        end = day_index;
    else if (size == "month")
        end = month_index;
    else
        end = year_index;

    // Determine biggest unit according to how far away the left edge
    // of the graph is from 'now'.

    var n = new Date();
    var l = new Date(axis.min);

    begin = year_index;
    if (l.getFullYear() == n.getFullYear()) {
        begin = month_index;
        if (l.getMonth() == n.getMonth()) {
            begin = day_index;
            if (l.getDate() == n.getDate())
                begin = hour_minute_index;
        }
    }

    // Adjust so that it all makes sense

    if (begin > end)
        begin = end;
    if (begin == day_index)
        begin = month_index;

    // And render it

    var d = new Date(val);
    var label = " ";

    if (year_index >= begin && year_index <= end)
        label += d.getFullYear().toFixed() + " ";
    if (month_index >= begin && month_index <= end)
        label += month_names[d.getMonth()] + " ";
    if (day_index >= begin && day_index <= end)
        label += d.getDate().toFixed() + " ";
    if (hour_minute_index >= begin && hour_minute_index <= end)
        label += pad(d.getHours()) + ':' + pad(d.getMinutes()) + " ";

    return label.substr(0, label.length-1);
};

plotter.bytes_tick_unit = function bytes_tick_unit(axis) {
    return cockpit.format_bytes(axis.max, 1024, true)[1];
};

plotter.format_bytes_tick_no_unit = function format_bytes_tick_no_unit(val, axis) {
    return cockpit.format_bytes(val, plotter.bytes_tick_unit(axis), true)[0];
};

plotter.format_bytes_tick = function format_bytes_tick(val, axis) {
    return cockpit.format_bytes(val, 1024);
};

plotter.bytes_per_sec_tick_unit = function bytes_per_sec_tick_unit(axis) {
    return cockpit.format_bytes_per_sec(axis.max, 1024, true)[1];
};

plotter.format_bytes_per_sec_tick_no_unit = function format_bytes_per_sec_tick_no_unit(val, axis) {
    return cockpit.format_bytes_per_sec(val, plotter.bytes_per_sec_tick_unit(axis), true)[0];
};

plotter.format_bytes_per_sec_tick = function format_bytes_per_sec_tick(val, axis) {
    return cockpit.format_bytes_per_sec(val, 1024);
};

plotter.bits_per_sec_tick_unit = function bits_per_sec_tick_unit(axis) {
    return cockpit.format_bits_per_sec(axis.max*8, 1000, true)[1];
};

plotter.format_bits_per_sec_tick_no_unit = function format_bits_per_sec_tick_no_tick(val, axis) {
    return cockpit.format_bits_per_sec(val*8, plotter.bits_per_sec_tick_unit(axis), true)[0];
};

plotter.format_bits_per_sec_tick = function format_bits_per_sec_tick(val, axis) {
    return cockpit.format_bits_per_sec(val*8, 1000);
};

plotter.setup_plot_controls = function setup_plot_controls(container, element, plots) {

    var plot_min_x_range = 5*60;
    var plot_zoom_steps = [ 5*60,  60*60, 6*60*60, 24*60*60, 7*24*60*60, 30*24*60*60, 365*24*60*60 ];

    var plot_x_range = 5*60;
    var plot_x_stop;
    var zoom_history = [ ];

    element.find('[data-range]').click(function () {
        zoom_history = [ ];
        plot_x_range = parseInt($(this).attr('data-range'), 10);
        plot_reset();
    });

    element.find('[data-action="goto-now"]').click(function () {
        plot_x_stop = undefined;
        plot_reset();
    });

    element.find('[data-action="scroll-left"]').click(function () {
        var step = plot_x_range / 10;
        if (plot_x_stop === undefined)
            plot_x_stop = (new Date()).getTime() / 1000;
        plot_x_stop -= step;
        plot_reset();
    });

    element.find('[data-action="scroll-right"]').click(function () {
        var step = plot_x_range / 10;
        if (plot_x_stop !== undefined) {
            plot_x_stop += step;
            plot_reset();
        }
    });

    element.find('[data-action="zoom-out"]').click(function () {
        zoom_plot_out();
    });

    function zoom_plot_start() {
        if (plot_x_stop === undefined) {
            plots.forEach(function (p) {
                p.stop_walking();
            });
            plot_x_stop = (new Date()).getTime() / 1000;
            update_plot_buttons();
        }
    }

    function zoom_plot_in(x_range, x_stop) {
        zoom_history.push(plot_x_range);
        plot_x_range = x_range;
        plot_x_stop = x_stop;
        plot_reset();
    }

    function zoom_plot_out() {
        var r = zoom_history.pop();
        if (r === undefined) {
            var i;
            for (i = 0; i < plot_zoom_steps.length-1; i++) {
                if (plot_zoom_steps[i] > plot_x_range)
                    break;
            }
            r = plot_zoom_steps[i];
        }
        if (plot_x_stop !== undefined)
            plot_x_stop += (r - plot_x_range)/2;
        plot_x_range = r;
        plot_reset();
    }

    function format_range(seconds) {
        var n;
        if (seconds >= 365*24*60*60) {
            n = Math.ceil(seconds / (365*24*60*60));
            return cockpit.format(cockpit.ngettext("$0 year", "$0 years", n), n);
        } else if (seconds >= 30*24*60*60) {
            n = Math.ceil(seconds / (30*24*60*60));
            return cockpit.format(cockpit.ngettext("$0 month", "$0 months", n), n);
        } else if (seconds >= 7*24*60*60) {
            n = Math.ceil(seconds / (7*24*60*60));
            return cockpit.format(cockpit.ngettext("$0 week", "$0 weeks", n), n);
        } else if (seconds >= 24*60*60) {
            n = Math.ceil(seconds / (24*60*60));
            return cockpit.format(cockpit.ngettext("$0 day", "$0 days", n), n);
        } else if (seconds >= 60*60) {
            n = Math.ceil(seconds / (60*60));
            return cockpit.format(cockpit.ngettext("$0 hour", "$0 hours", n), n);
        } else {
            n = Math.ceil(seconds / 60);
            return cockpit.format(cockpit.ngettext("$0 minute", "$0 minutes", n), n);
        }
    }

    function update_plot_buttons() {
        element.find('[data-action="scroll-right"]')
            .attr('disabled', plot_x_stop === undefined);
        element.find('[data-action="zoom-out"]')
            .attr('disabled', plot_x_range >= plot_zoom_steps[plot_zoom_steps.length-1]);
    }

    function update_selection_zooming() {
        var mode;

        if (container.hasClass('show-zoom-controls') && plot_x_range > plot_min_x_range) {
            container.addClass('show-zoom-cursor');
            mode = "x";
        } else {
            container.removeClass('show-zoom-cursor');
            mode = null;
        }

        plots.forEach(function (p) {
            var options = p.get_options();
            if (!options.selection || options.selection.mode != mode) {
                options.selection = { mode: mode, color: "#d4edfa" };
                p.set_options(options);
                p.refresh();
            }
        });
    }

    function plot_reset() {
        if (plot_x_range < plot_min_x_range) {
            plot_x_stop += (plot_min_x_range - plot_x_range)/2;
            plot_x_range = plot_min_x_range;
        }
        if (plot_x_stop >= (new Date()).getTime() / 1000 - 10)
            plot_x_stop = undefined;

        element.find('.dropdown-toggle span:first-child').text(format_range(plot_x_range));

        plots.forEach(function (p) {
            p.stop_walking();
            p.reset(plot_x_range, plot_x_stop);
            p.refresh();
            if (plot_x_stop === undefined)
                p.start_walking();

            function check_archives() {
                if (p.archives) {
                    container.addClass('show-zoom-controls');
                    update_selection_zooming();
                }
            }

            $(p).on("changed", check_archives);
            check_archives();
        });

        update_plot_buttons();
        update_selection_zooming();
    }

    function reset(p) {
        if (p === undefined)
            p = [ ];
        plots = p;
        plots.forEach(function (p) {
            $(p).on("zoomstart", function (event) { zoom_plot_start(); });
            $(p).on("zoom", function (event, x_range, x_stop) { zoom_plot_in(x_range, x_stop); });
        });
        plot_reset();
    }

    reset(plots);

    return {
        reset: reset
    };
};

function setup_plot(graph_id, grid, data, user_options) {
    var options = {
        colors: [ "#0099d3" ],
        legend: { show: false },
        series: { shadowSize: 0,
                  lines: { lineWidth: 0.0,
                           fill: 1.0
                         }
                },
        xaxis: { tickFormatter: function() { return ""; } },
        yaxis: { tickFormatter: function() { return ""; } },
        // The point radius influences
        // the margin around the grid
        // even if no points are plotted.
        // We don't want any margin, so
        // we set the radius to zero.
        points: { radius: 0 },
        grid: { borderWidth: 1,
                aboveData: true,
                color: "black",
                borderColor: $.color.parse("black").scale('a', 0.22).toString(),
                labelMargin: 0
              }
    };

    var num_points = 300;
    var plot;
    var running = false;
    var self;

    $.extend(true, options, user_options);

    // We put the plot inside its own div so that we can give that div
    // a fixed size which only changes when we can also immediately
    // call plot.resize().  Otherwise, the labels and legends briefly
    // get out of sync during resizing.

    var outer_div = $(graph_id);
    var inner_div = $('<div/>');
    outer_div.empty();
    outer_div.append(inner_div);

    function sync_divs ()
    {
        inner_div.width(outer_div.width());
        inner_div.height(outer_div.height());
    }

    // Updating flot options is tricky and somewhat implementation
    // defined.  Different options needs different approaches.  So we
    // just have very specific functions for changing specific options
    // until a pattern emerges.

    function set_yaxis_max (max) {
        if (plot) {
            plot.getAxes().yaxis.options.max = max;
            refresh ();
        } else {
            options.yaxis.max = max;
        }
    }

    function start ()
    {
        running = true;
        maybe_start();
    }

    function maybe_start() {
        if (running && outer_div.width() !== 0 && outer_div.height() !== 0) {
            if (!plot) {
                sync_divs ();
                plot = $.plot(inner_div, data, options);
            } else
                resize();
        }
    }

    function stop ()
    {
        running = false;
    }

    function refresh() {
        if (plot && running) {
            plot.setData(data);
            if (user_options.setup_hook)
                user_options.setup_hook(plot);
            plot.setupGrid();
            plot.draw();
        }
    }

    function resize() {
        if (plot && running) {
            sync_divs ();
            if (inner_div.width() > 0 && inner_div.height() > 0)
                plot.resize();
            refresh();
        }
    }

    function destroy () {
        $(self).trigger('destroyed');
        $(window).off('resize', resize);
        $(outer_div).empty();
        plot = null;
    }

    $(grid).on('notify', refresh);
    $(window).on('resize', resize);
    maybe_start();

    self = { start: start, stop: stop,
             resize: resize, element: inner_div[0],
             set_yaxis_max: set_yaxis_max,
             destroy: destroy
           };
    return self;
}

function setup_plot_x(graph_id, resmon, data, user_options, store_samples) {
    var options = {
        colors: [ "#0099d3" ],
        legend: { show: false },
        series: { shadowSize: 0,
                  lines: { lineWidth: 0.0,
                           fill: 1.0
                         }
                },
        xaxis: { tickFormatter: function() { return ""; } },
        yaxis: { tickFormatter: function() { return ""; } },
        // The point radius influences
        // the margin around the grid
        // even if no points are plotted.
        // We don't want any margin, so
        // we set the radius to zero.
        points: { radius: 0 },
        grid: { borderWidth: 1,
                aboveData: true,
                color: "black",
                borderColor: $.color.parse("black").scale('a', 0.22).toString(),
                labelMargin: 0
              }
    };

    var num_series = data.length;
    var num_points;
    var got_historical_data = false;
    var plot;
    var running = false;
    var ready = false;
    var self;

    $.extend(true, options, user_options);

    // We put the plot inside its own div so that we can give that div
    // a fixed size which only changes when we can also immediately
    // call plot.resize().  Otherwise, the labels and legends briefly
    // get out of sync during resizing.

    var outer_div = $(graph_id);
    var inner_div = $('<div/>');
    outer_div.empty();
    outer_div.append(inner_div);

    function init() {
        if (!ready && resmon.NumSamples !== undefined) {
            // Initialize series
            num_points = resmon.NumSamples;
            for (var n = 0; n < num_series; n++) {
                var series = [];
                for (var m = 0; m < num_points; m++) {
                    series[m] = [m, 0];
                }
                data[n].data = series;
            }

            $(resmon).on("NewSample", new_sample_handler);

            resmon.call("GetSamples", {},
                        function(error, result) {
                            if (!error) {
                                got_historical_samples (result);
                                got_historical_data = true;
                                refresh ();
                            }
                        });

            $(window).on('resize', resize);

            ready = true;
            maybe_start();
        }
    }

    function sync_divs ()
    {
        inner_div.width(outer_div.width());
        inner_div.height(outer_div.height());
    }

    // Updating flot options is tricky and somewhat implementation
    // defined.  Different options needs different approaches.  So we
    // just have very specific functions for changing specific options
    // until a pattern emerges.

    function set_yaxis_max (max) {
        if (plot) {
            plot.getAxes().yaxis.options.max = max;
            refresh ();
        } else {
            options.yaxis.max = max;
        }
    }

    function start ()
    {
        running = true;
        maybe_start();
    }

    function maybe_start()
    {
        if (ready && running && outer_div.width() !== 0 && outer_div.height() !== 0) {
            if (!plot) {
                sync_divs ();
                plot = $.plot(inner_div, data, options);
            } else
                resize();
        }
    }

    function stop ()
    {
        running = false;
    }

    function refresh ()
    {
        if (plot && running) {
            plot.setData(data);
            if (user_options.setup_hook)
                user_options.setup_hook(plot);
            plot.setupGrid();
            plot.draw();
        }
    }

    function resize ()
    {
        if (plot && running) {
            sync_divs ();
            if (inner_div.width() > 0 && inner_div.height() > 0)
                plot.resize();
            refresh();
        }
    }

    function new_samples (samples)
    {
        var series;
        var i, n, m, floor;

        for (n = 0; n < data.length; n++) {
            series = data[n].data;
            for (m = 0; m < series.length-1; m++) {
                series[m][1] = series[m+1][1];
                series[m][2] = series[m+1][2];
            }
        }

        store_samples (samples, data[0].data.length-1);
    }

    function got_historical_samples (history)
    {
        var n, offset;

        offset = data[0].data.length - history.length;
        for (n = 0; n < history.length; n++) {
            store_samples (history[n][1], n+offset);
        }
    }

    function new_sample_handler (event, timestampUsec, samples) {
        if (got_historical_data) {
            new_samples (samples);
            refresh ();
        }
    }

    function destroy () {
        $(self).trigger('destroyed');
        $(resmon).off('notify:NumSamples', init);
        $(resmon).off("NewSample", new_sample_handler);
        $(window).off('resize', resize);
        $(outer_div).empty();
        plot = null;
    }

    if (resmon.NumSamples !== undefined)
        init();
    else
        $(resmon).on('notify:NumSamples', init);

    self = { start: start, stop: stop,
             resize: resize, element: inner_div[0],
             set_yaxis_max: set_yaxis_max,
             destroy: destroy
           };
    return self;
}

plotter.setup_complicated_plot = function setup_complicated_plot(graph_id, grid, series, options) {
    function basic_flot_row(grid, input) {
        return grid.add(function(row, x, n) {
            for (var i = 0; i < n; i++)
                row[x + i] = [i, input[x + i] || 0];
        });
    }

    function stacked_flot_row(grid, input, last) {
        return grid.add(function(row, x, n) {
            var i, l, floor, val;
            for (i = 0; i < n; i++) {
                floor = 0;
                if (last) {
                    l = last[x + i];
                    floor = l ? l[1] : 0;
                }
                val = (input[x + i] || 0);
                row[x + i] = [i, val + floor, floor];
            }
        });
    }

    /* All the data row setup happens now */
    var last = null;
    series.forEach(function(ser, i) {
        if (options.x_rh_stack_graphs)
            ser.data = stacked_flot_row(grid, ser.row, last);
        else
            ser.data = basic_flot_row(grid, ser.row);
        last = ser.data;
    });
    return setup_plot(graph_id, grid, series, options);
};

module.exports = plotter;
