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

var shell = shell || { };
(function($, shell) {

/* A thin abstraction over flot and the cockpitd resource monitors.
 * It mostly shields you from hairy array acrobatics and having to
 * know when it is safe or required to create the flot object.
 *
 *
 * - plot = shell.plot(element)
 *
 * Creates a 'plot' object attached to the given DOM element.
 *
 * - plot.refresh()
 *
 * Draw the plot again.
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

shell.plot = function plot(element) {
    var options = { };
    var data = [ ];
    var flot = null;
    var generation = 0;

    /* For now, all our resource monitors have 300 samples and tick
       once per second.  We exploit this to keep things simple for
       now.  One series will be the 'driver', and the plot is only
       refreshed when that series receives a new sample.  This reduces
       the amount of redraws and leads to a more stable scrolling
       effect.

       TODO: Allow monitors with different number of samples in the
       same plot, and different sample frequencies.
     */
    var num_samples = 300;
    var driver = null;

    function choose_driver() {
        driver = data[0];
    }

    function refresh() {
        if (flot === null) {
            if (element.height() === 0 || element.width() === 0)
                return;
            flot = $.plot(element, data, options);
        }

        flot.setData(data);
        if (options.setup_hook)
            options.setup_hook(flot);
        flot.setupGrid();
        flot.draw();
    }

    function reset() {
        for (var i = 0; i < data.length; i++)
            data[i].stop();

        options = { };
        data = [ ];
        flot = null;
        driver = null;
        $(element).empty();
        generation += 1;
    }

    function resize() {
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
            choose_driver();
        }

        function remove_series() {
            var pos = data.indexOf(series);
            if (pos >= 0)
                data.splice(pos, 1);
            choose_driver();
        }

        function move_to_front() {
            var pos = data.indexOf(series);
            if (pos >= 0) {
                data.splice(pos, 1);
                data.push(series);
            }
        }

        function init(samples) {
            if (my_gen < generation || !subs) {
                /* The plot has been reset or this series has been
                   stopped already.
                */
                return;
            }

            series_data = [ ];
            for (var i = 0; i < num_samples; i++) {
                var j = i - 300 + samples.length;
                if (j >= 0 && j < samples.length)
                    series_data[i] = [i, get(samples[j][1])];
                else
                    series_data[i] = [i, 0];
            }
            add_series();
            refresh();
        }

        function on_new_sample(path, iface, signal, args) {
            if (series_data) {
                for (var i = 0; i < series_data.length-1; i++)
                    series_data[i][1] = series_data[i+1][1];
                series_data[i][1] = get(args[1]);
                if (series === driver)
                    refresh();
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

    return {
        refresh: refresh,
        reset: reset,
        resize: resize,
        set_options: set_options,
        add_cockpitd_resource_monitor: add_cockpitd_resource_monitor
    };
};

})(jQuery, shell);
