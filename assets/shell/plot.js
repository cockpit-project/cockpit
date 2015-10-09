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

define([
    "jquery",
    "base1/cockpit",
    "shell/shell"
], function($, cockpit, shell) {

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

/* A thin abstraction over flot and metrics channels.  It mostly
 * shields you from hairy array acrobatics and having to know when it
 * is safe or required to create the flot object.
 *
 *
 * - plot = shell.plot(element, x_range, [x_stop])
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

shell.plot = function plot(element, x_range_seconds, x_stop_seconds) {
    var options = { };
    var result = { };

    var series = [ ];
    var flot_data = [ ];
    var flot = null;

    var interval;
    var grid;

    function refresh_now() {
        if (flot === null) {
            if (element.height() === 0 || element.width() === 0)
                return;
            flot = $.plot(element, flot_data, options);
        }

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

    function add_metrics_stacked_instances_series(desc, opts, colors) {
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

        function add_instance(name) {
            if (instances[name])
                return;

            var instance_data = $.extend({}, opts);
            var factor = desc.factor || 1;
            var last = last_instance;
            var metrics_row;

            function reset() {
                metrics_row = grid.add(channel, [ "a", name ]);
                instance_data.data = grid.add(function(row, x, n) {
                    for (var i = 0; i < n; i++) {
                        var floor = last? last.data[x + i][2] : 0;
                        row[x + i] = [(grid.beg + x + i)*interval, floor, floor + (metrics_row[x + i] || 0)*factor];
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
                if (d[index] && d[index][1] <= pos.y && pos.y <= d[index][2])
                    return name;
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

shell.plot_simple_template = function simple() {
    return {
        colors: [ "#0099d3" ],
        legend: { show: false },
        series: { shadowSize: 0,
            lines: {
                lineWidth: 0.0,
                fill: 1.0
            }
        },
        xaxis: { tickColor: "#d1d1d1",
                 mode: "time",
                 tickFormatter: shell.format_date_tick,
                 minTickSize: [ 1, 'minute' ],
                 reserveSpace: false
               },
        yaxis: { tickColor: "#d1d1d1",
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
            aboveData: true,
            color: "black",
            borderColor: $.color.parse("black").scale('a', 0.22).toString(),
            labelMargin: 0
        }
    };
};

shell.plot_simple_stacked_template = function simple_stacked() {
    return {
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
};

shell.memory_ticks = function memory_ticks(opts) {
    // Not more than 5 ticks, nicely rounded to powers of 2.
    var size = Math.pow(2.0, Math.ceil(Math.log(opts.max/5)/Math.LN2));
    var ticks = [ ];
    for (var t = 0; t < opts.max; t += size)
        ticks.push(t);
    return ticks;
};

var month_names = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];

shell.format_date_tick = function format_date_tick(val, axis) {
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
        label += C_("month-name", month_names[d.getMonth()]) + " ";
    if (day_index >= begin && day_index <= end)
        label += d.getDate().toFixed() + " ";
    if (hour_minute_index >= begin && hour_minute_index <= end)
        label += pad(d.getHours()) + ':' + pad(d.getMinutes()) + " ";

    return label.substr(0, label.length-1);
};

shell.format_bytes_tick = function format_bytes_tick(val, axis) {
    var max = cockpit.format_bytes(axis.max, 1024, true);
    return cockpit.format_bytes(val, max[1]);
};

shell.format_bytes_per_sec_tick = function format_bytes_per_sec_tick(val, axis) {
    var max = cockpit.format_bytes_per_sec(axis.max, 1024, true);
    return cockpit.format_bytes_per_sec(val, max[1]);
};

shell.format_bits_per_sec_tick = function format_bits_per_sec_tick(val, axis) {
    var max = cockpit.format_bits_per_sec(axis.max*8, 1000, true);
    return cockpit.format_bits_per_sec(val*8, max[1]);
};

shell.setup_plot_controls = function setup_plot_controls(container, element, plots) {

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
        function fmt(sing, plur, n) {
            return cockpit.format(cockpit.ngettext(sing, plur, n), n);
        }
        if (seconds >= 365*24*60*60)
            return fmt("$0 year", "$0 years", Math.ceil(seconds / (365*24*60*60)));
        else if (seconds >= 30*24*60*60)
            return fmt("$0 month", "$0 months", Math.ceil(seconds / (30*24*60*60)));
        else if (seconds >= 7*24*60*60)
            return fmt("$0 week", "$0 weeks", Math.ceil(seconds / (7*24*60*60)));
        else if (seconds >= 24*60*60)
            return fmt("$0 day", "$0 days", Math.ceil(seconds / (24*60*60)));
        else if (seconds >= 60*60)
            return fmt("$0 hour", "$0 hours", Math.ceil(seconds / (60*60)));
        else
            return fmt("$0 minute", "$0 minutes", Math.ceil(seconds / 60));
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

});
