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
    var data = [ ];
    var flot = null;
    var walk_timer;
    var result = { };

    var now, x_range, x_offset, interval;

    function refresh() {
        if (flot === null) {
            if (element.height() === 0 || element.width() === 0)
                return;
            flot = $.plot(element, data, options);
        }

        flot.setData(data);
        var axes = flot.getAxes();

        axes.xaxis.options.min = now - x_range - x_offset;
        axes.xaxis.options.max = now - x_offset;
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

    function start_walking() {
        /* Don't overflow 32 signed bits with the interval.  This
         * means that plots that would make about one step every month
         * don't walk at all, but I guess that is ok.
         */
        if (interval > 2000000000)
            return;

        if (!walk_timer)
            walk_timer = window.setInterval(function () {
                now += interval;
                for (var i = 0; i < data.length; i++)
                    data[i].walk();
                refresh();
            }, interval);
    }

    function stop_walking() {
        if (walk_timer)
            window.clearInterval(walk_timer);
        walk_timer = null;
    }

    function reset(x_range_seconds, x_stop_seconds) {
        if (flot)
            flot.clearSelection(true);

        now = (new Date()).getTime();

        if (x_stop_seconds !== undefined)
            x_offset = now - x_stop_seconds*1000;
        else
            x_offset = 0;

        // Fill the plot with about 1000 samples.
        //
        // TODO - do this based on the actual size of the plot.
        //
        if (x_range_seconds !== undefined) {
            x_range = x_range_seconds * 1000;
            interval = Math.ceil(x_range_seconds / 1000) * 1000;
        }

        for (var i = 0; i < data.length; i++)
            data[i].reset();
    }

    function destroy() {
        stop_walking();
        for (var i = 0; i < data.length; i++)
            data[i].stop();

        options = { };
        data = [ ];
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
        var series = opts;
        var series_data = null;
        var old_series_data = null;
        var timestamp;
        var archive_channel, real_time_channel;
        var cur_samples;
        var stopped = false;
        var refresh_on_samples = true;

        var real_time_samples = [];
        var max_real_time_samples = 1000;
        var n_real_time_samples = 0;
        var real_time_samples_pos = -1;
        var real_time_samples_timestamp = null;
        var real_time_samples_interval = 2000;

        var self = {
            options: series,
            move_to_front: move_to_front,
            remove: remove
        };

        series.stop = stop;
        series.reset = reset_series;
        series.hover = hover;
        series.walk = walk;

        function stop() {
            stopped = true;
            if (archive_channel)
                archive_channel.close();
            if (real_time_channel)
                real_time_channel.close();
        }

        function hover(val) {
            $(self).triggerHandler('hover', [ val ]);
        }

        function walk() {
            if (archive_channel === null)
                trim_series();
            var val = sample_real_time(now-interval, now);
            if (!isNaN(val))
                series_data[series_data.length] = [ now, val ];
        }

        function add_series() {
            series.data = series_data;
            data.push(series);
        }

        function remove_series() {
            var pos = data.indexOf(series);
            if (pos >= 0)
                data.splice(pos, 1);
        }

        function move_to_front() {
            var pos = data.indexOf(series);
            if (pos >= 0) {
                data.splice(pos, 1);
                data.push(series);
            }
        }

        function remove() {
            stop();
            remove_series();
            refresh();
        }

        function trim_series() {
            for (var i = 0; i < series_data.length; i++) {
                if (series_data[i] && series_data[i][0] >= now - x_range - x_offset) {
                    series_data.splice(0, i);
                    return;
                }
            }
        }

        var metrics;

        function channel_sampler(options, callback) {
            var instances;
            var timestamp;
            var factor;

            factor = desc.factor || 1;

            function on_new_samples(msg) {

                function compute_sample(samples) {
                    var i, j, sum = 0;

                    function count_sample(index, cur, samples) {
                        if (samples[index] || samples[index] === 0)
                            cur[index] = samples[index];
                        sum += cur[index];
                    }

                    for (i = 0; i < metrics.length; i++) {
                        if (instances[i] !== undefined) {
                            for (j = 0; j < instances[i].length; j++)
                                count_sample(j, cur_samples[i], samples[i]);
                        } else
                            count_sample(i, cur_samples, samples);
                    }

                    return sum*factor;
                }

                var res = [ ];
                var last = null;
                for (var i = 0; i < msg.length; i++) {
                    last = compute_sample(msg[i]);
                    res[i] = [ timestamp, last ];
                    timestamp += options.interval;
                }

                callback (res);

                if (last !== null)
                    $(self).triggerHandler("value", [ last ]);
            }

            function handle_message(event, message) {
                if (stopped)
                    return;

                var msg = JSON.parse(message);
                var i, t;
                if (msg.length) {
                    on_new_samples(msg);
                } else {
                    instances = msg.metrics.map(function (m) { return m.instances; });
                    cur_samples = [];
                    for (i = 0; i < metrics.length; i++) {
                        if (instances[i] !== null)
                            cur_samples[i] = [];
                    }

                    timestamp = new Date().getTime() + (msg.timestamp - msg.now);
                }
            }

            var channel = cockpit.channel(options);
            $(channel).on("message", handle_message);
            return channel;
        }

        function build_metric(n) {
            return { name: n, units: desc.units, derive: desc.derive };
        }

        metrics = desc.direct.map(build_metric);
        var fallback = null;

        if (desc.internal)
            fallback = desc.internal.map(build_metric);

        var chanopts = {
            payload: "metrics1",
            metrics: metrics,
            instances: desc.instances,
            "omit-instances": desc['omit-instances'],
            host: desc.host
        };

        function reset_series() {
            if (archive_channel) {
                archive_channel.close();
                archive_channel = null;
            }

            series_data = [ ];
            series.data = series_data;

            var plot_start = now - x_range - x_offset;
            var plot_end = now - x_offset;
            var real_time_start;
            var archive_start, archive_end, archive_limit, archive_index;
            var min_gap;

            if (real_time_samples_timestamp)
                real_time_start = real_time_samples_timestamp - (n_real_time_samples-1) * real_time_samples_interval;
            else
                real_time_start = now;

            if (plot_start > real_time_start)
                real_time_start = plot_start;

            archive_start = plot_start;
            archive_end = Math.min(real_time_start, plot_end);
            archive_limit = Math.ceil((archive_end - archive_start) / interval);

            min_gap = Math.max(2*60*1000, 2*interval);

            if (archive_limit > 0) {
                archive_index = 0;

                archive_channel = channel_sampler($.extend({ source: "pcp-archive",
                                                             interval: interval,
                                                             timestamp: -x_range - x_offset,
                                                             limit: archive_limit
                                                           }, chanopts),
                                                  function (vals) {
                                                      var i, gap, del;

                                                      if (!result.archives) {
                                                          result.archives = true;
                                                          $(result).triggerHandler("changed");
                                                      }

                                                      for (i = 0; i < vals.length; i++) {
                                                          if (vals[i][0] > archive_end) {
                                                              vals.length = i;
                                                              break;
                                                          }
                                                      }
                                                      if (vals.length > 0) {
                                                          del = 0;
                                                          if (archive_index > 0) {
                                                              gap = vals[0][0] - series_data[archive_index-1][0];
                                                              if (gap < min_gap)
                                                                  del = 1;
                                                          }
                                                          Array.prototype.splice.apply(series_data, [archive_index-del, del].concat(vals));
                                                          archive_index += vals.length - del;
                                                          gap = real_time_start - vals[vals.length-1][0];
                                                          if (gap > min_gap) {
                                                              series_data.splice(archive_index, 0, [ vals[vals.length-1][0], null ]);
                                                              archive_index += 1;
                                                          } else if (archive_index == series_data.length) {
                                                              series_data.splice(archive_index, 0, [ real_time_start, vals[vals.length-1][1] ]);
                                                              archive_index += 1;
                                                          }
                                                          refresh();
                                                      }
                                                  });
                $(archive_channel).on("close", function (event, message) {
                    archive_channel = null;
                    trim_series();
                    refresh();

                    /* If no archived data was available within the time frame, check for presence of any */
                    if (!result.archives) {
                        var lookup = cockpit.channel($.extend({ source: "pcp-archive", limit: 1 }, chanopts));
                        $(lookup)
                            .on("message", function() {
                                result.archives = true;
                                lookup.close();
                            })
                            .on("close", function() {
                                $(result).triggerHandler("changed");
                            });
                    }
                });
            }

            for (var t = real_time_start; t <= plot_end; t += interval) {
                var val = sample_real_time(t - interval, t);
                if (val !== null)
                    series_data[series_data.length] = [ t, val ];
            }
        }

        reset_series();
        add_series();

        function process_samples(vals) {
            real_time_samples_pos += 1;
            if (real_time_samples_pos >= max_real_time_samples)
                real_time_samples_pos = 0;
            else
                n_real_time_samples += 1;
            real_time_samples[real_time_samples_pos] = vals[0][1];
            real_time_samples_timestamp = vals[0][0];
        }

        function channel_closed(ev, options, desc) {
            real_time_channel = null;
            if (options.problem && options.problem != "terminated" && options.problem != "disconnected")
                console.log("problem retrieving " + desc + " metrics data: " + options.problem);
        }

        real_time_channel = channel_sampler($.extend({ }, chanopts, {
            source: "direct",
            interval: real_time_samples_interval
        }), process_samples);
        $(real_time_channel).on("close", function (event, options) {

            /* Go for the fallback internal metrics if these metrics are not supported */
            if ((options.problem == "not-supported" || options.problem == "not-found") && fallback) {
                real_time_channel = channel_sampler($.extend({ }, chanopts, {
                    source: "internal",
                    interval: real_time_samples_interval,
                    metrics: fallback
                }), process_samples);
                $(real_time_channel).on("close", function(event, options) {
                    channel_closed(event, options, "internal");
                });

            /* Otherwise it could be just a normal failure */
            } else {
                channel_closed(event, options, "real time");
            }
        });

        function sample_real_time(t1, t2) {
            var p1 = Math.min(Math.floor((t1 - real_time_samples_timestamp) / real_time_samples_interval), 0);
            var p2 = Math.min(Math.ceil((t2 - real_time_samples_timestamp) / real_time_samples_interval), 0);

            if (-p1 >= n_real_time_samples)
                p1 = -n_real_time_samples + 1;

            if (p1 > p2)
                return null;

            var sum = 0;
            for (var i = p1; i <= p2; i++) {
                var p = real_time_samples_pos+i;
                if (p > max_real_time_samples)
                    p -= max_real_time_samples;
                sum += real_time_samples[p];
            }
            return sum / (p2-p1+1);
        }

        return self;
    }

    var cur_hover = null;

    function hover(series) {
        if (series !== cur_hover) {
            if (cur_hover && cur_hover.hover)
                cur_hover.hover(false);
            cur_hover = series;
            if (cur_hover && cur_hover.hover)
                cur_hover.hover(true);
        }
    }

    function hover_on(event, pos, item) {
        hover(item && item.series);
    }

    function hover_off(event) {
        hover(null);
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
        add_metrics_sum_series: add_metrics_sum_series
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

            $(p).on("changed", function() {
                if (p.archives) {
                    container.addClass('show-zoom-controls');
                    update_selection_zooming();
                }
            });
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
