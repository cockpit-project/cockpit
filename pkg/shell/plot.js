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

/* A thin abstraction over flot and the cockpitd resource monitors.
 * It mostly shields you from hairy array acrobatics and having to
 * know when it is safe or required to create the flot object.
 *
 *
 * - plot = shell.plot(element, x_range)
 *
 * Creates a 'plot' object attached to the given DOM element.  It will
 * show 'x_range' seconds worth of samples.
 *
 * - plot.start_walking(interval)
 *
 * Scroll towards the future every 'interval' seconds.
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
 * - plot.reset()
 *
 * Resets the plot to be empty.  The plot will disappear completely
 * from the DOM, including the grid.
 *
 * - series = plot.add_cockpitd_resource_monitor(path, get_sample, options)
 *
 * Adds a standard cockpitd resource monitor into the plot with the
 * given options.  The plot will automatically refresh as data becomes
 * available from the monitor.  The 'get_sample' argument should be a
 * function that converts the raw samples of the monitor into a single
 * value for use in the plot.
 *
 * - series.options
 *
 * Direct access to the series options.  You need to refresh the plot
 * after changing it.  This is guaranteed to be the same object that
 * was passed to 'add_cockpitd_resource_monitor' and you can use it to
 * attach extra bookkeeping information for your own use.
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

shell.plot = function plot(element, x_range) {
    var options = { };
    var data = [ ];
    var flot = null;
    var generation = 0;

    var now = 0;
    var walk_timer;

    function refresh() {
        if (flot === null) {
            if (element.height() === 0 || element.width() === 0)
                return;
            flot = $.plot(element, data, options);
        }

        flot.setData(data);
        var axes = flot.getAxes();

        axes.xaxis.options.min = now - x_range;
        axes.xaxis.options.max = now;
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

    function start_walking(interval) {
        if (!walk_timer)
            walk_timer = window.setInterval(function () {
                now += interval;
                refresh();
            }, interval*1000);
    }

    function stop_walking() {
        if (walk_timer)
            window.clearInterval(walk_timer);
        walk_timer = null;
    }

    function reset() {
        stop_walking();
        for (var i = 0; i < data.length; i++)
            data[i].stop();

        options = { };
        data = [ ];
        flot = null;
        $(element).empty();
        generation += 1;
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

    function add_cockpitd_resource_monitor(cockpitd, path, get, opts) {
        var series = opts;
        var series_data = null;
        var offset;

        var my_gen = generation;

        var self = {
            options: series,
            move_to_front: move_to_front,
            remove: remove
        };

        series.stop = stop;
        series.hover = hover;

        function stop() {
            if (subs)
                subs.remove();
            subs = null;
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

        function get_data_point(sample) {
            return [ sample[0]/1000000 - offset, get(sample[1]) ];
        }

        function trim_series() {
            for (var i = 0; i < series_data.length; i++) {
                if (series_data[i][0] >= now - x_range) {
                    series_data.splice(0, i);
                    return;
                }
            }
        }

        function init(samples) {
            var i;

            if (my_gen < generation || !subs) {
                /* The plot has been reset or this series has been
                   stopped already.
                */
                return;
            }

            if (samples.length === 0)
                return;

            /* We assume that the timestamp of the last sample
             * corresponds to 'now'.  This can be quite off, but is
             * good enough for the current cockpitd monitors.
             *
             * TODO: Get an explicit 'now' timestamp from the
             * GetSamples call or equivalent.
             */

            offset = samples[samples.length-1][0]/1000000 - now;
            series_data = [];
            for (i = 0; i < samples.length; i++)
                series_data[i] = get_data_point(samples[i]);
            trim_series();

            add_series();
            refresh();
        }

        function on_new_sample(path, iface, signal, args) {
            var i;

            if (!series_data)
                init([ args ]);
            else {
                trim_series();
                series_data[series_data.length] = get_data_point(args);
            }
        }

        var subs = cockpitd.subscribe({ "path": path,
                                        "interface": "com.redhat.Cockpit.ResourceMonitor",
                                        "member": "NewSample"
                                      }, on_new_sample);

        cockpitd.call(path,
                      "com.redhat.Cockpit.ResourceMonitor",
                      "GetSamples", [ { } ], { }).
            done(function (result) { init (result[0]); });

        function remove() {
            stop();
            remove_series();
            refresh();
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

    $(element).on("plothover", hover_on);
    $(element).on("mouseleave", hover_off);

    set_options({});

    return {
        start_walking: start_walking,
        stop_walking: stop_walking,
        refresh: refresh,
        reset: reset,
        resize: resize,
        set_options: set_options,
        add_cockpitd_resource_monitor: add_cockpitd_resource_monitor
    };
};

})(jQuery, shell);
