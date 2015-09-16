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

define([
    "jquery",
    "base1/cockpit",
    "shell/shell"
], function($, cockpit, shell) {

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

shell.setup_complicated_plot = function setup_complicated_plot(graph_id, grid, series, options) {
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

// ----------------------------------------------------------------------------------------------------

shell.setup_simple_plot = function setup_simple_plot(plot_id, text_id, resmon, options,
                                                       series_combine_func, series_text_func) {
    var data = [ {} ];

    function store_samples (samples, index)
    {
        var series = data[0].data;
        series[index][1] = series_combine_func(samples);
        if (index == series.length-1)
            $(text_id).html(series_text_func(samples));
    }

    return setup_plot_x(plot_id, resmon, data, options, store_samples);
};

// ----------------------------------------------------------------------------------------------------

shell.setup_multi_plot = function setup_multi_plot(element, monitor, sample_index,
                                                     colors, is_interesting, setup_hook) {
    var self = this;
    var max_consumers = colors.length-1;
    var data = new Array(max_consumers+1);       // max_consumers entries plus one for the total
    var consumers = new Array(max_consumers);
    var plot;
    var i;

    for (i = 0; i < data.length; i++)
        data[i] = { };

    function update_consumers() {
        var mcons = monitor.Consumers || [ ];
        consumers.forEach(function (c, i) {
            if (c && mcons.indexOf(c) < 0 || !is_interesting(c)) {
                consumers[i] = null;
            }
        });
        mcons.forEach(function (mc) {
            if (!is_interesting(mc))
                return;
            if (consumers.indexOf(mc) < 0) {
                for (i = 0; i < max_consumers; i++) {
                    if (!consumers[i]) {
                        consumers[i] = mc;
                        return;
                    }
                }
                console.warn("Too many consumers");
            }
        });
    }

    function store_samples (samples, index) {
        var total = 0;
        for (var c in samples) {
            if (is_interesting(c))
                total += samples[c][sample_index];
        }
        function store(i, value) {
            var series = data[i].data;
            var floor = (i > 0? data[i-1].data[index][2] : 0);
            series[index][1] = floor;
            series[index][2] = floor + value;
        }
        consumers.forEach(function (c, i) {
            store(i, (c && samples[c]? samples[c][sample_index] : 0));
        });
        store(max_consumers, total);
        if (index == monitor.NumSamples-1)
            $(plot).trigger('update-total', [ total ]);
    }

    plot = setup_plot_x(element, monitor, data,
                               { colors: colors,
                                 grid: { hoverable: true,
                                         autoHighlight: false
                                       },
                                 setup_hook: setup_hook
                               },
                               store_samples);
    $(monitor).on("notify:Consumers", update_consumers);

    var cur_highlight = null;

    function highlight(consumer) {
        if (consumer != cur_highlight) {
            cur_highlight = consumer;
            $(plot).trigger('highlight', [ consumer ]);
        }
    }

    function highlight_on(event, pos, item) {
        var i, index;

        index = Math.round(pos.x);
        if (index < 0)
            index = 0;
        if (index > monitor.NumSamples-1)
            index = monitor.NumSamples-1;

        for (i = 0; i < max_consumers; i++) {
            if (i < max_consumers && data[i].data[index][1] <= pos.y && pos.y <= data[i].data[index][2])
                break;
        }
        if (i < max_consumers)
            highlight(consumers[i]);
        else
            highlight(null);
    }

    function highlight_off(event) {
        highlight(null);
    }

    $(plot.element).on("plothover", highlight_on);
    $(plot.element).on("mouseleave", highlight_off);

    $(plot).on("destroyed", function () {
        $(monitor).off("notify:Consumers", update_consumers);
        $(plot.element).off("plothover", highlight_on);
        $(plot.element).off("mouseleave", highlight_off);
    });

    update_consumers();
    return plot;
};

});
