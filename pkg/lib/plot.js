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

import $ from 'jquery';
import cockpit from 'cockpit';

import 'jquery-flot/jquery.flot';
import 'jquery-flot/jquery.flot.selection';
import 'jquery-flot/jquery.flot.time';

const C_ = cockpit.gettext;

/* A thin abstraction over flot and metrics channels.  It mostly
 * shields you from hairy array acrobatics and having to know when it
 * is safe or required to create the flot object.
 *
 *
 * - plot = new plot.Plot(element, x_range, [x_stop])
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
 * In addition to the flot options, you can also set the 'setup_hook'
 * field to a function.  This function will be called between
 * flot.setData() and flot.draw() and can be used to adjust the axes
 * limits, for example.  It is called with the flot object as its only
 * parameter.
 *
 * Setting the 'post_hook' to a function will call that function after
 * each refresh of the plot.  This is used to decorate a plot with the
 * unit strings, for example.
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

class Metrics_series {
    constructor(desc, opts, grid, flot_data, interval) {
        this.desc = desc;
        this.options = opts;
        this.grid = grid;
        this.flot_data = flot_data;
        this.interval = interval;
        this.channel = null;
        this.chanopts_list = [ ];
    }

    stop() {
        if (this.channel)
            this.channel.close();
    }

    remove_series() {
        var pos = this.flot_data.indexOf(this.options);
        if (pos >= 0)
            this.flot_data.splice(pos, 1);
    }

    remove() {
        this.stop();
        this.remove_series();
        $(self).triggerHandler('removed');
    }

    build_metric(n) {
        return { name: n, units: this.desc.units, derive: this.desc.derive };
    }

    hover_hit(pos, item) {
        return !!(item && (item.series.data == this.options.data));
    }

    hover(val) {
        $(this).triggerHandler('hover', [ val ]);
    }

    move_to_front() {
        var pos = this.flot_data.indexOf(this.options);
        if (pos >= 0) {
            this.flot_data.splice(pos, 1);
            this.flot_data.push(this.options);
        }
    }

    check_archives() {
        if (this.channel.archives)
            $(this).triggerHandler('changed');
    }
}

class Metrics_sum_series extends Metrics_series {
    constructor(desc, opts, grid, flot_data, interval) {
        super(desc, opts, grid, flot_data, interval);
        if (this.desc.direct) {
            this.chanopts_list.push({
                source: 'direct',
                archive_source: 'pcp-archive',
                metrics: this.desc.direct.map(this.build_metric, this),
                instances: this.desc.instances,
                'omit-instances': this.desc['omit-instances'],
                host: this.desc.host
            });
        }
        if (this.desc.internal) {
            this.chanopts_list.push({
                source: 'internal',
                metrics: this.desc.internal.map(this.build_metric, this),
                instances: this.desc.instances,
                'omit-instances': this.desc['omit-instances'],
                host: this.desc.host
            });
        }
    }

    flat_sum(val) {
        var sum;

        if (!val)
            return 0;
        if (val.length !== undefined) {
            sum = 0;
            for (let i = 0; i < val.length; i++)
                sum += this.flat_sum(val[i]);
            return sum;
        }
        return val;
    }

    reset_series() {
        if (this.channel)
            this.channel.close();

        this.channel = cockpit.metrics(this.interval, this.chanopts_list);

        var metrics_row = this.grid.add(this.channel, [ ]);
        var factor = this.desc.factor || 1;
        var threshold = this.desc.threshold || null;
        var offset = this.desc.offset || 0;
        this.options.data = this.grid.add((row, x, n) => {
            for (let i = 0; i < n; i++) {
                let value = offset + this.flat_sum(metrics_row[x + i]) * factor;
                if (threshold !== null)
                    row[x + i] = [ (this.grid.beg + x + i) * this.interval, Math.abs(value) > threshold ? value : null, threshold ];
                else
                    row[x + i] = [ (this.grid.beg + x + i) * this.interval, value ];
            }
        });

        $(this.channel).on('changed', this.check_archives.bind(this));
        this.check_archives();
    }
}

class Metrics_difference_series extends Metrics_series {
    constructor(desc, opts, grid, flot_data, interval) {
        super(desc, opts, grid, flot_data, interval);
        if (this.desc.direct) {
            this.chanopts_list.push({
                source: 'direct',
                archive_source: 'pcp-archive',
                metrics: this.desc.direct.map(this.build_metric, this),
                instances: this.desc.instances,
                'omit-instances': this.desc['omit-instances'],
                host: this.desc.host
            });
        }
        if (this.desc.internal) {
            this.chanopts_list.push({
                source: 'internal',
                metrics: this.desc.internal.map(this.build_metric, this),
                instances: this.desc.instances,
                'omit-instances': this.desc['omit-instances'],
                host: this.desc.host
            });
        }
    }

    flat_difference(val) {
        var diff;

        if (!val)
            return 0;
        if (val.length !== undefined) {
            diff = val[0];
            for (let i = 1; i < val.length; i++)
                diff -= this.flat_difference(val[i]);
            return diff;
        }
        return val;
    }

    reset_series() {
        if (this.channel)
            this.channel.close();

        this.channel = cockpit.metrics(this.interval, this.chanopts_list);

        var metrics_row = this.grid.add(this.channel, [ ]);
        var factor = this.desc.factor || 1;
        var threshold = this.desc.threshold || null;
        var offset = this.desc.offset || 0;
        this.options.data = this.grid.add((row, x, n) => {
            for (let i = 0; i < n; i++) {
                let value = offset + this.flat_difference(metrics_row[x + i]) * factor;
                if (threshold !== null)
                    row[x + i] = [ (this.grid.beg + x + i) * this.interval, Math.abs(value) > threshold ? value : null, threshold ];
                else
                    row[x + i] = [ (this.grid.beg + x + i) * this.interval, value ];
            }
        });

        $(this.channel).on('changed', this.check_archives.bind(this));
        this.check_archives();
    }
}

class Metrics_stacked_instances_series extends Metrics_series {
    constructor(desc, opts, grid, flot_data, interval) {
        super(desc, opts, grid, flot_data, interval);
        this.instances = { };
        this.last_instance = null;
        if (this.desc.direct) {
            this.chanopts_list.push({
                source: 'direct',
                archive_source: 'pcp-archive',
                metrics: [ this.build_metric(this.desc.direct) ],
                metrics_path_names: [ 'a' ],
                instances: this.desc.instances,
                'omit-instances': this.desc['omit-instances'],
                host: this.desc.host
            });
        }

        if (this.desc.internal) {
            this.chanopts_list.push({
                source: 'internal',
                metrics: [ this.build_metric(this.desc.internal) ],
                metrics_path_names: [ 'a' ],
                instances: this.desc.instances,
                'omit-instances': this.desc['omit-instances'],
                host: this.desc.host
            });
        }
    }

    reset_series() {
        if (this.channel)
            this.channel.close();
        this.channel = cockpit.metrics(this.interval, this.chanopts_list);
        $(this.channel).on('changed', this.check_archives.bind(this));
        this.check_archives();
        for (let name in this.instances)
            this.instances[name].reset();
    }

    add_instance(name, selector) {
        if (this.instances[name])
            return;

        var instance_data = $.extend({ selector: selector }, this.options);
        var factor = this.desc.factor || 1;
        var threshold = this.desc.threshold || 0;
        var metrics_row;
        var last = this.last_instance;

        function reset() {
            metrics_row = this.grid.add(this.channel, [ 'a', name ]);
            instance_data.data = this.grid.add((row, x, n) => {
                for (let i = 0; i < n; i++) {
                    let value = (metrics_row[x + i] || 0) * factor;
                    let ts = (this.grid.beg + x + i) * this.interval;
                    let floor = 0;

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
        }

        function remove() {
            this.grid.remove(metrics_row);
            this.grid.remove(instance_data.data);
            var pos = this.flot_data.indexOf(instance_data);
            if (pos >= 0)
                this.flot_data.splice(pos, 1);
        }

        instance_data.reset = reset.bind(this);
        instance_data.remove = remove.bind(this);
        this.last_instance = instance_data;
        this.instances[name] = instance_data;
        instance_data.reset();
        this.flot_data.push(instance_data);
        this.grid.sync();
    }

    clear_instances() {
        for (let i in this.instances)
            this.instances[i].remove();
        this.instances = { };
        this.last_instance = null;
    }

    hover_hit(pos, item) {
        var index;

        if (!this.grid)
            return false;

        index = Math.round(pos.x / this.interval) - this.grid.beg;
        if (index < 0)
            index = 0;

        for (let name in this.instances) {
            let d = this.instances[name].data;
            if (d[index] && d[index][1] && d[index][2] <= pos.y && pos.y <= d[index][1])
                return this.instances[name].selector || name;
        }
        return false;
    }
}

export class Plot {
    constructor(element, x_range_seconds, x_stop_seconds) {
        this.element = element;
        this.options = { };

        this.series = [ ];
        this.flot_data = [ ];
        this.flot = null;

        this.interval = Math.ceil(x_range_seconds / 1000) * 1000;
        this.grid = null;

        this.refresh_pending = false;
        this.sync_suppressed = 0;
        this.archives = false;

        this.cur_hover_series = null;
        this.cur_hover_val = false;

        $(this.element).on('plothover', null, this, this.hover_on);
        $(this.element).on('mouseleave', null, this, this.hover_off);
        $(this.element).on('plotselecting', null, this, this.selecting);
        $(this.element).on('plotselected', null, this, this.selected);

        // for testing
        $(this.element).data('flot_data', this.flot_data);

        this.reset(x_range_seconds, x_stop_seconds);
    }

    refresh_now() {
        if (this.element.height() === 0 || this.element.width() === 0)
            return;

        if (this.flot === null)
            this.flot = $.plot(this.element, this.flot_data, this.options);

        this.flot.setData(this.flot_data);
        var axes = this.flot.getAxes();

        /* Walking and fetching samples are not synchronized, which
         * means that a walk step might reveal a sample that hasn't
         * been fetched yet.  To reduce flicker, we cut off one extra
         * sample at the end.
         */
        axes.xaxis.options.min = this.grid.beg * this.interval;
        axes.xaxis.options.max = (this.grid.end - 2) * this.interval;
        if (this.options.setup_hook)
            this.options.setup_hook(this.flot);

        /* This makes sure that the axes are displayed even for an
         * empty plot.
         */
        axes.xaxis.show = true;
        axes.xaxis.used = true;
        axes.yaxis.show = true;
        axes.yaxis.used = true;

        this.flot.setupGrid();
        this.flot.draw();

        if (this.options.post_hook)
            this.options.post_hook(this.flot);
    }

    refresh() {
        if (!this.refresh_pending) {
            this.refresh_pending = true;
            window.setTimeout(() => {
                this.refresh_pending = false;
                this.refresh_now();
            }, 0);
        }
    }

    start_walking() {
        this.grid.walk();
    }

    stop_walking() {
        this.grid.move(this.grid.beg, this.grid.end);
    }

    reset(x_range_seconds, x_stop_seconds) {
        if (this.flot)
            this.flot.clearSelection(true);

        // Fill the plot with about 1000 samples, but don't sample
        // faster than once per second.
        //
        // TODO - do this based on the actual size of the plot.
        this.interval = Math.ceil(x_range_seconds / 1000) * 1000;

        var x_offset;
        if (x_stop_seconds !== undefined)
            x_offset = (new Date().getTime()) - x_stop_seconds * 1000;
        else
            x_offset = 0;

        var beg = -Math.ceil((x_range_seconds * 1000 + x_offset) / this.interval);
        var end = -Math.floor(x_offset / this.interval);

        if (this.grid && this.grid.interval == this.interval) {
            this.grid.move(beg, end);
        } else {
            if (this.grid)
                this.grid.close();
            this.grid = cockpit.grid(this.interval, beg, end);
            this.sync_suppressed++;
            for (var i = 0; i < this.series.length; i++) {
                this.series[i].stop();
                this.series[i].interval = this.interval;
                this.series[i].grid = this.grid;
                this.series[i].reset_series();
            }
            this.sync_suppressed--;
            this.sync();

            $(this.grid).on('notify', (event, index, count) => {
                this.refresh();
            });
        }
    }

    sync() {
        if (this.sync_suppressed === 0)
            this.grid.sync();
    }

    destroy() {
        this.grid.close();
        for (var i = 0; i < this.series.length; i++)
            this.series[i].stop();

        this.options = { };
        this.series = [ ];
        this.flot_data = [ ];
        this.flot = null;
        $(this.element).empty();
        $(this.element).data('flot_data', null);
    }

    resize() {
        if (this.element.height() === 0 || this.element.width() === 0)
            return;
        if (this.flot)
            this.flot.resize();
        this.refresh();
    }

    set_options(opts) {
        this.options = opts;
        this.flot = null;
    }

    get_options() {
        return this.options;
    }

    check_archives() {
        if (!this.archives) {
            this.archives = true;
            $(this).triggerHandler('changed');
        }
    }

    add_metrics_sum_series(desc, opts) {
        var sum_series = new Metrics_sum_series(desc, opts, this.grid, this.flot_data, this.interval);

        $(sum_series).on('removed', this.refresh.bind(this));
        $(sum_series).on('changed', this.check_archives.bind(this));
        sum_series.reset_series();
        sum_series.check_archives();

        this.series.push(sum_series);
        this.sync();
        this.flot_data.push(opts);

        return sum_series;
    }

    add_metrics_difference_series(desc, opts) {
        var difference_series = new Metrics_difference_series(desc, opts, this.grid, this.flot_data, this.interval);

        $(difference_series).on('removed', this.refresh.bind(this));
        $(difference_series).on('changed', this.check_archives.bind(this));
        difference_series.reset_series();
        difference_series.check_archives();

        this.series.push(difference_series);
        this.sync();
        this.flot_data.push(opts);

        return difference_series;
    }

    add_metrics_stacked_instances_series(desc, opts) {
        var stacked_series = new Metrics_stacked_instances_series(desc, opts, this.grid, this.flot_data, this.interval);

        $(stacked_series).on('removed', this.refresh.bind(this));
        $(stacked_series).on('changed', this.check_archives.bind(this));
        stacked_series.reset_series();
        stacked_series.check_archives();

        this.series.push(stacked_series);
        this.sync_suppressed++;
        for (let name in stacked_series.instances)
            stacked_series.instances[name].reset();
        this.sync_suppressed--;
        this.sync();

        return stacked_series;
    }

    hover(next_hover_series, next_hover_val) {
        if (this.cur_hover_series != next_hover_series) {
            if (this.cur_hover_series)
                this.cur_hover_series.hover(false);
            this.cur_hover_series = next_hover_series;
            this.cur_hover_val = next_hover_val;
            if (this.cur_hover_series)
                this.cur_hover_series.hover(this.cur_hover_val);
        } else if (this.cur_hover_val != next_hover_val) {
            this.cur_hover_val = next_hover_val;
            if (this.cur_hover_series)
                this.cur_hover_series.hover(this.cur_hover_val);
        }
    }

    hover_on(event, pos, item) {
        var next_hover_series = null;
        var next_hover_val = false;
        for (let i = 0; i < event.data.series.length; i++) {
            next_hover_val = event.data.series[i].hover_hit(pos, item);
            if (next_hover_val) {
                next_hover_series = event.data.series[i];
                break;
            }
        }
        event.data.hover(next_hover_series, next_hover_val);
    }

    hover_off(event) {
        event.data.hover(null, false);
    }

    selecting(event, ranges) {
        if (ranges)
            $(event.data).triggerHandler('zoomstart', [ ]);
    }

    selected(event, ranges) {
        event.data.flot.clearSelection(true);
        $(event.data).triggerHandler('zoom', [ (ranges.xaxis.to - ranges.xaxis.from) / 1000, ranges.xaxis.to / 1000 ]);
    }
}

export function plot_simple_template() {
    var plot_colors = [
        '#39a5dc',
        '#008ff0',
        '#2daaff',
        '#69c2ff',
        '#a5daff',
        '#e1f3ff',
        '#00243c',
        '#004778'
    ];

    return {
        colors: plot_colors,
        legend: { show: false },
        series: {
            shadowSize: 0,
            lines: {
                lineWidth: 2.0,
                fill: 1
            }
        },
        xaxis: {
            tickLength: 0,
            mode: 'time',
            tickFormatter: format_date_tick,
            minTickSize: [ 1, 'minute' ],
            reserveSpace: false
        },
        yaxis: {
            tickColor: '#d1d1d1',
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
            color: 'black',
            borderColor: $.color
                    .parse('black')
                    .scale('a', 0.22)
                    .toString(),
            labelMargin: 0
        }
    };
}

export function memory_ticks(opts) {
    // Not more than 5 ticks, nicely rounded to powers of 2.
    var size = Math.pow(2.0, Math.ceil(Math.log(opts.max / 5) / Math.LN2));
    var ticks = [ ];
    for (let t = 0; t < opts.max; t += size)
        ticks.push(t);
    return ticks;
}

const month_names = [
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

export function format_date_tick(val, axis) {
    function pad(n) {
        var str = n.toFixed();
        if (str.length == 1)
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
    if (size == 'minute' || size == 'hour')
        end = hour_minute_index;
    else if (size == 'day')
        end = day_index;
    else if (size == 'month')
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
    var label = ' ';

    if (year_index >= begin && year_index <= end)
        label += d.getFullYear().toFixed() + ' ';
    if (month_index >= begin && month_index <= end)
        label += month_names[d.getMonth()] + ' ';
    if (day_index >= begin && day_index <= end)
        label += d.getDate().toFixed() + ' ';
    if (hour_minute_index >= begin && hour_minute_index <= end)
        label += pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ';

    return label.substr(0, label.length - 1);
}

export function bytes_tick_unit(axis) {
    return cockpit.format_bytes(axis.max, 1024, true)[1];
}

export function format_bytes_tick_no_unit(val, axis) {
    return cockpit.format_bytes(val, bytes_tick_unit(axis), true)[0];
}

export function format_bytes_tick(val, axis) {
    return cockpit.format_bytes(val, 1024);
}

export function bytes_per_sec_tick_unit(axis) {
    return cockpit.format_bytes_per_sec(axis.max, 1024, true)[1];
}

export function format_bytes_per_sec_tick_no_unit(val, axis) {
    return cockpit.format_bytes_per_sec(val, bytes_per_sec_tick_unit(axis), true)[0];
}

export function format_bytes_per_sec_tick(val, axis) {
    return cockpit.format_bytes_per_sec(val, 1024);
}

export function bits_per_sec_tick_unit(axis) {
    return cockpit.format_bits_per_sec(axis.max * 8, 1000, true)[1];
}

export function format_bits_per_sec_tick_no_unit(val, axis) {
    return cockpit.format_bits_per_sec(val * 8, bits_per_sec_tick_unit(axis), true)[0];
}

export function format_bits_per_sec_tick(val, axis) {
    return cockpit.format_bits_per_sec(val * 8, 1000);
}

export function setup_plot_controls(container, element, plots) {
    var plot_min_x_range = 5 * 60;
    var plot_zoom_steps = [ 5 * 60, 60 * 60, 6 * 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60, 30 * 24 * 60 * 60, 365 * 24 * 60 * 60 ];
    var plot_x_range = 5 * 60;
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
            for (i = 0; i < plot_zoom_steps.length - 1; i++) {
                if (plot_zoom_steps[i] > plot_x_range)
                    break;
            }
            r = plot_zoom_steps[i];
        }
        if (plot_x_stop !== undefined)
            plot_x_stop += (r - plot_x_range) / 2;
        plot_x_range = r;
        plot_reset();
    }

    function format_range(seconds) {
        var n;
        if (seconds >= 365 * 24 * 60 * 60) {
            n = Math.ceil(seconds / (365 * 24 * 60 * 60));
            return cockpit.format(cockpit.ngettext('$0 year', '$0 years', n), n);
        } else if (seconds >= 30 * 24 * 60 * 60) {
            n = Math.ceil(seconds / (30 * 24 * 60 * 60));
            return cockpit.format(cockpit.ngettext('$0 month', '$0 months', n), n);
        } else if (seconds >= 7 * 24 * 60 * 60) {
            n = Math.ceil(seconds / (7 * 24 * 60 * 60));
            return cockpit.format(cockpit.ngettext('$0 week', '$0 weeks', n), n);
        } else if (seconds >= 24 * 60 * 60) {
            n = Math.ceil(seconds / (24 * 60 * 60));
            return cockpit.format(cockpit.ngettext('$0 day', '$0 days', n), n);
        } else if (seconds >= 60 * 60) {
            n = Math.ceil(seconds / (60 * 60));
            return cockpit.format(cockpit.ngettext('$0 hour', '$0 hours', n), n);
        } else {
            n = Math.ceil(seconds / 60);
            return cockpit.format(cockpit.ngettext('$0 minute', '$0 minutes', n), n);
        }
    }

    function update_plot_buttons() {
        element.find('[data-action="scroll-right"]').attr('disabled', plot_x_stop === undefined);
        element.find('[data-action="zoom-out"]').attr('disabled', plot_x_range >= plot_zoom_steps[plot_zoom_steps.length - 1]);
    }

    function update_selection_zooming() {
        var mode;

        if (container.hasClass('show-zoom-controls') && plot_x_range > plot_min_x_range) {
            container.addClass('show-zoom-cursor');
            mode = 'x';
        } else {
            container.removeClass('show-zoom-cursor');
            mode = null;
        }

        plots.forEach(function (p) {
            var options = p.get_options();
            if (!options.selection || options.selection.mode != mode) {
                options.selection = { mode: mode, color: '#edf8ff' };
                p.set_options(options);
                p.refresh();
            }
        });
    }

    function plot_reset() {
        if (plot_x_range < plot_min_x_range) {
            plot_x_stop += (plot_min_x_range - plot_x_range) / 2;
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

            $(p).on('changed', check_archives);
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
            $(p).on('zoomstart', function (event) { zoom_plot_start() });
            $(p).on('zoom', function (event, x_range, x_stop) { zoom_plot_in(x_range, x_stop) });
        });
        plot_reset();
    }

    reset(plots);

    return {
        reset: reset
    };
}

export function setup_plot(graph_id, grid, data, user_options) {
    var options = {
        colors: [ '#0099d3' ],
        legend: { show: false },
        series: {
            shadowSize: 0,
            lines: {
                lineWidth: 0.0,
                fill: 1.0
            }
        },
        xaxis: { tickFormatter: function() { return '' } },
        yaxis: { tickFormatter: function() { return '' } },
        // The point radius influences
        // the margin around the grid
        // even if no points are plotted.
        // We don't want any margin, so
        // we set the radius to zero.
        points: { radius: 0 },
        grid: {
            borderWidth: 1,
            aboveData: true,
            color: 'black',
            borderColor: $.color
                    .parse('black')
                    .scale('a', 0.22)
                    .toString(),
            labelMargin: 0
        }
    };

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
    var starting = null;
    outer_div.empty();
    outer_div.append(inner_div);

    function sync_divs() {
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
            refresh();
        } else {
            options.yaxis.max = max;
        }
    }

    function start () {
        running = true;
        maybe_start();
    }

    function maybe_start() {
        if (running && outer_div.width() > 0 && outer_div.height() > 0) {
            if (!plot) {
                sync_divs();
                plot = $.plot(inner_div, data, options);
            } else
                resize();

            if (starting)
                window.clearInterval(starting);
        } else if (!starting) {
            starting = window.setInterval(maybe_start, 500);
        }
    }

    function stop () {
        running = false;
    }

    function refresh() {
        if (plot && running) {
            plot.setData(data);
            if (user_options.setup_hook)
                user_options.setup_hook(plot);
            plot.setupGrid();
            plot.draw();
            if (user_options.post_hook)
                user_options.post_hook(plot);
        }
    }

    function resize() {
        if (plot && running) {
            sync_divs();
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

    self = {
        start: start, stop: stop,
        resize: resize, element: inner_div[0],
        set_yaxis_max: set_yaxis_max,
        destroy: destroy
    };
    return self;
}

export function setup_complicated_plot(graph_id, grid, series, options) {
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

    function offset_flot_row(grid, input, offset, factor) {
        var f = factor || 1;
        return grid.add(function(row, x, n) {
            for (var i = 0; i < n; i++)
                row[x + i] = [i, offset + (f * (input[x + i] || 0)), offset];
        });
    }

    /* All the data row setup happens now */
    var last = null;
    series.forEach(function(ser, i) {
        if (ser.offset)
            ser.data = offset_flot_row(grid, ser.row, ser.offset, ser.factor);
        else if (options.x_rh_stack_graphs)
            ser.data = stacked_flot_row(grid, ser.row, last);
        else
            ser.data = basic_flot_row(grid, ser.row);
        last = ser.data;
    });
    return setup_plot(graph_id, grid, series, options);
}
