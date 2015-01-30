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

/* global jQuery   */
/* global cockpit  */
/* global _        */
/* global C_       */

var shell = shell || { };
(function($, shell) {

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
 * - plot.reset([x_range],[x_stop])
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
 *   interval:        The interval between samples.
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
        if (!walk_timer)
            walk_timer = window.setInterval(function () {
                refresh();
                now += interval;
            }, interval);
    }

    function stop_walking() {
        if (walk_timer)
            window.clearInterval(walk_timer);
        walk_timer = null;
    }

    function reset(x_range_seconds, x_stop_seconds) {
        stop_walking();
        for (var i = 0; i < data.length; i++)
            data[i].stop();

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

    function add_metrics_sum_series(desc, opts) {
        var series = opts;
        var series_data = null;
        var timestamp;
        var archive_channel, real_time_channel;
        var factor;
        var cur_samples;
        var stopped = false;
        var refresh_on_samples = true;

        var self = {
            options: series,
            move_to_front: move_to_front,
            remove: remove
        };

        series.stop = stop;
        series.hover = hover;

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

        function trim_series() {
            for (var i = 0; i < series_data.length; i++) {
                if (series_data[i][0] >= now - x_range - x_offset) {
                    series_data.splice(0, i);
                    return;
                }
            }
        }

        var metrics;
        var instances;

        function init(msg) {
            series_data = [];
            trim_series();
            add_series();
            refresh();
        }

        function on_new_sample(samples) {
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

            trim_series();
            if (!isNaN(sum))
                series_data[series_data.length] = [ timestamp, sum*factor ];
            timestamp += interval;
        }

        function remove() {
            stop();
            remove_series();
            refresh();
        }

        metrics = desc.metrics.map(function (n) { return { name: n, units: desc.units }; });

        function handle_message(event, message) {
            if (stopped)
                return;

            var msg = JSON.parse(message);
            var i, t;
            if (msg.length) {
                for (i = 0; i < msg.length; i++) {
                    on_new_sample(msg[i]);
                }
                if (refresh_on_samples)
                    refresh();
                if (!archive_channel)
                    refresh_on_samples = false;
            } else {
                instances = msg.metrics.map(function (m) { return m.instances; });
                cur_samples = [];
                for (i = 0; i < metrics.length; i++) {
                    if (instances[i] !== null)
                        cur_samples[i] = [];
                }

                if (series_data === null)
                    init(msg);

                t = new Date().getTime() + (msg.timestamp - msg.now);
                if (archive_channel && t > timestamp + 2 * interval)
                    series_data[series_data.length] = [ timestamp, null ];
                timestamp = t;
            }
        }

        if (desc.factor)
            factor = desc.factor / (interval / 1000);
        else
            factor = 1;

        var chanopts = {
            payload: "metrics1",
            metrics: metrics,
            instances: desc.instances,
            "omit-instances": desc['omit-instances'],
            interval: interval,
            host: desc.host
        };

        archive_channel = cockpit.channel($.extend({
                                            source: "pcp-archive",
                                            timestamp: -x_range - x_offset,
                                            limit: (x_offset > 0) ? (x_range / interval) : undefined,
                                          }, chanopts));
        $(archive_channel).on("message", function(event, message) {
            if (!result.archives) {
                result.archives = true;
                $(result).triggerHandler("changed");
            }
            handle_message(event, message);
        });

        $(archive_channel).on("close", function (event, message) {
            archive_channel = null;

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

            if (x_offset === 0 && !stopped) {
                real_time_channel = cockpit.channel($.extend({ source: "direct" }, chanopts));
                $(real_time_channel).on("message", handle_message);
                $(real_time_channel).on("close", function (event, message) {
                    real_time_channel = null;
                });
            }
        });

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

    $(element).on("plothover", hover_on);
    $(element).on("mouseleave", hover_off);

    reset(x_range_seconds, x_stop_seconds);

    $.extend(result, {
        archives: false, /* true if any archive data found */
        start_walking: start_walking,
        stop_walking: stop_walking,
        refresh: refresh,
        reset: reset,
        resize: resize,
        set_options: set_options,
        add_metrics_sum_series: add_metrics_sum_series
    });

    return result;
};

})(jQuery, shell);
