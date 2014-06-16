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

function cockpit_setup_plot (graph_id, resmon, data, user_options,
                             store_samples)
{
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

    function start ()
    {
        running = true;
        maybe_start();
    }

    function maybe_start()
    {
        if (ready && running) {
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
            plot.setupGrid();
            plot.draw();
        }
    }

    function resize ()
    {
        if (plot && running) {
            sync_divs ();
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

    return { start: start, stop: stop,
             resize: resize, element: inner_div[0],
             destroy: destroy
           };
}

function cockpit_setup_complicated_plot (graph_id, resmon, data, options)
{
    var i;
    var plot = null;
    var my_options = $.extend ({ legend: { show: true } },
                               options);

    function store_samples (samples, index)
    {
        var value, series;
        var n, i, floor;
        for (n = 0; n < data.length; n++) {
            series = data[n].data;
            value = samples[n];

            if (options["x_rh_stack_graphs"]) {
                floor = 0;
                for (i = n + 1; i < samples.length; i++) {
                    floor += samples[i];
                }
                series[index][1] = value + floor;
                series[index][2] = floor;
            } else {
                series[index][1] = value;
            }
        }
    }

    function setup_legends()
    {
        for (i = 0; i < data.length; i++)
            data[i].label = resmon.Legends[i];
        if (plot)
            plot.resize();
    }

    if (resmon.Legends)
        setup_legends();
    else
        $(resmon).on('notify:Legends', setup_legends);

    plot = cockpit_setup_plot (graph_id, resmon, data, my_options,
                               store_samples);
    return plot;
}

// ----------------------------------------------------------------------------------------------------

function cockpit_setup_simple_plot (plot_id,
                                    text_id,
                                    resmon,
                                    options,
                                    series_combine_func,
                                    series_text_func)
{
    var data = [ {} ];

    function store_samples (samples, index)
    {
        var series = data[0].data;
        series[index][1] = series_combine_func(samples);
        if (index == series.length-1)
            $(text_id).html(series_text_func(samples));
    }

    return cockpit_setup_plot (plot_id, resmon, data, options,
                               store_samples);
}
