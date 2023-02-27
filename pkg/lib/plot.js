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

import cockpit from 'cockpit';

/* The public API here is not general and a bit weird.  It can only do
 * what Cockpit itself needs right now, and what can be easily
 * implemented without touching the older Metrics_series classes.
 *
 * The basic idea is that you create a global PlotState object and
 * keep it alive for the lifetime of the page.  Then you instantiate
 * ZoomControl and SvgPlot components as needed.
 *
 * To control what to plot, you call some methods on the PlotState
 * object:
 *
 * - plot_state.plot_single(id, metric_options)
 *
 * - plot_state.plot_instances(id, metric_options, instances, reset)
 *
 * You need to figure out the rest of the details from the existing
 * users, unfortunately.
 */

class Metrics_series {
    constructor(desc, opts, grid, plot_data, interval) {
        cockpit.event_target(this);
        this.desc = desc;
        this.options = opts;
        this.grid = grid;
        this.plot_data = plot_data;
        this.interval = interval;
        this.channel = null;
        this.chanopts_list = [];
    }

    stop() {
        if (this.channel)
            this.channel.close();
    }

    remove_series() {
        const pos = this.plot_data.indexOf(this.options);
        if (pos >= 0)
            this.plot_data.splice(pos, 1);
    }

    remove() {
        this.stop();
        this.remove_series();
        this.dispatchEvent("removed");
    }

    build_metric(n) {
        return { name: n, units: this.desc.units, derive: this.desc.derive };
    }

    check_archives() {
        if (this.channel.archives)
            this.dispatchEvent("changed");
    }
}

class Metrics_sum_series extends Metrics_series {
    constructor(desc, opts, grid, plot_data, interval) {
        super(desc, opts, grid, plot_data, interval);
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
        if (this.desc.pmcd) {
            this.chanopts_list.push({
                source: 'pmcd',
                metrics: this.desc.pmcd.map(this.build_metric, this),
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
        if (!val)
            return 0;
        if (val.length !== undefined) {
            let sum = 0;
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

        const metrics_row = this.grid.add(this.channel, []);
        const factor = this.desc.factor || 1;
        const threshold = this.desc.threshold || null;
        const offset = this.desc.offset || 0;
        this.options.data = this.grid.add((row, x, n) => {
            for (let i = 0; i < n; i++) {
                const value = offset + this.flat_sum(metrics_row[x + i]) * factor;
                if (threshold !== null)
                    row[x + i] = [(this.grid.beg + x + i) * this.interval, Math.abs(value) > threshold ? value : null, threshold];
                else
                    row[x + i] = [(this.grid.beg + x + i) * this.interval, value];
            }
        });

        this.channel.addEventListener("changed", this.check_archives.bind(this));
        this.check_archives();
    }
}

class Metrics_stacked_instances_series extends Metrics_series {
    constructor(desc, opts, grid, plot_data, interval) {
        super(desc, opts, grid, plot_data, interval);
        this.instances = { };
        this.last_instance = null;
        if (this.desc.direct) {
            this.chanopts_list.push({
                source: 'direct',
                archive_source: 'pcp-archive',
                metrics: [this.build_metric(this.desc.direct)],
                metrics_path_names: ['a'],
                instances: this.desc.instances,
                'omit-instances': this.desc['omit-instances'],
                host: this.desc.host
            });
        }
        if (this.desc.pmcd) {
            this.chanopts_list.push({
                source: 'pmcd',
                metrics: this.desc.pmcd.map(this.build_metric, this),
                metrics_path_names: ['a'],
                instances: this.desc.instances,
                'omit-instances': this.desc['omit-instances'],
                host: this.desc.host
            });
        }

        if (this.desc.internal) {
            this.chanopts_list.push({
                source: 'internal',
                metrics: [this.build_metric(this.desc.internal)],
                metrics_path_names: ['a'],
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
        this.channel.addEventListener("changed", this.check_archives.bind(this));
        this.check_archives();
        for (const name in this.instances)
            this.instances[name].reset();
    }

    add_instance(name, selector) {
        if (this.instances[name])
            return;

        const instance_data = Object.assign({ selector }, this.options);
        const factor = this.desc.factor || 1;
        const threshold = this.desc.threshold || 0;
        const last = this.last_instance;
        let metrics_row;

        function reset() {
            metrics_row = this.grid.add(this.channel, ['a', name]);
            instance_data.data = this.grid.add((row, x, n) => {
                for (let i = 0; i < n; i++) {
                    const value = (metrics_row[x + i] || 0) * factor;
                    const ts = (this.grid.beg + x + i) * this.interval;
                    let floor = 0;

                    if (last) {
                        if (last.data[x + i][1])
                            floor = last.data[x + i][1];
                        else
                            floor = last.data[x + i][2];
                    }

                    if (Math.abs(value) > threshold) {
                        row[x + i] = [ts, floor + value, floor];
                        if (row[x + i - 1] && row[x + i - 1][1] === null)
                            row[x + i - 1][1] = row[x + i - 1][2];
                    } else {
                        row[x + i] = [ts, null, floor];
                        if (row[x + i - 1] && row[x + i - 1][1] !== null)
                            row[x + i - 1][1] = row[x + i - 1][2];
                    }
                }
            });
        }

        function remove() {
            this.grid.remove(metrics_row);
            this.grid.remove(instance_data.data);
            const pos = this.plot_data.indexOf(instance_data);
            if (pos >= 0)
                this.plot_data.splice(pos, 1);
        }

        instance_data.reset = reset.bind(this);
        instance_data.remove = remove.bind(this);
        instance_data.name = name;
        this.last_instance = instance_data;
        this.instances[name] = instance_data;
        instance_data.reset();
        this.plot_data.push(instance_data);
        this.grid.sync();
    }

    clear_instances() {
        for (const i in this.instances)
            this.instances[i].remove();
        this.instances = { };
        this.last_instance = null;
    }
}

class Plot {
    constructor(element, x_range_seconds, x_stop_seconds) {
        cockpit.event_target(this);

        this.series = [];
        this.plot_data = [];

        this.interval = Math.ceil(x_range_seconds / 1000) * 1000;
        this.grid = null;

        this.sync_suppressed = 0;
        this.archives = false;

        this.reset(x_range_seconds, x_stop_seconds);
    }

    refresh() {
        this.dispatchEvent("plot", this.plot_data);
    }

    start_walking() {
        this.grid.walk();
    }

    stop_walking() {
        this.grid.move(this.grid.beg, this.grid.end);
    }

    reset(x_range_seconds, x_stop_seconds) {
        // Fill the plot with about 1000 samples, but don't sample
        // faster than once per second.
        //
        // TODO - do this based on the actual size of the plot.
        this.interval = Math.ceil(x_range_seconds / 1000) * 1000;

        const x_offset = (x_stop_seconds !== undefined)
            ? (new Date().getTime()) - x_stop_seconds * 1000
            : 0;

        const beg = -Math.ceil((x_range_seconds * 1000 + x_offset) / this.interval);
        const end = -Math.floor(x_offset / this.interval);

        if (this.grid && this.grid.interval == this.interval) {
            this.grid.move(beg, end);
        } else {
            if (this.grid)
                this.grid.close();
            this.grid = cockpit.grid(this.interval, beg, end);
            this.sync_suppressed++;
            for (let i = 0; i < this.series.length; i++) {
                this.series[i].stop();
                this.series[i].interval = this.interval;
                this.series[i].grid = this.grid;
                this.series[i].reset_series();
            }
            this.sync_suppressed--;
            this.sync();

            this.grid.addEventListener("notify", (event, index, count) => {
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
        for (let i = 0; i < this.series.length; i++)
            this.series[i].stop();

        this.options = { };
        this.series = [];
        this.plot_data = [];
    }

    check_archives() {
        if (!this.archives) {
            this.archives = true;
            this.dispatchEvent('changed');
        }
    }

    add_metrics_sum_series(desc, opts) {
        const sum_series = new Metrics_sum_series(desc, opts, this.grid, this.plot_data, this.interval);

        sum_series.addEventListener("removed", this.refresh.bind(this));
        sum_series.addEventListener("changed", this.check_archives.bind(this));
        sum_series.reset_series();
        sum_series.check_archives();

        this.series.push(sum_series);
        this.sync();
        this.plot_data.push(opts);

        return sum_series;
    }

    add_metrics_stacked_instances_series(desc, opts) {
        const stacked_series = new Metrics_stacked_instances_series(desc, opts, this.grid, this.plot_data, this.interval);

        stacked_series.addEventListener("removed", this.refresh.bind(this));
        stacked_series.addEventListener("changed", this.check_archives.bind(this));
        stacked_series.reset_series();
        stacked_series.check_archives();

        this.series.push(stacked_series);
        this.sync_suppressed++;
        for (const name in stacked_series.instances)
            stacked_series.instances[name].reset();
        this.sync_suppressed--;
        this.sync();

        return stacked_series;
    }
}

class ZoomState {
    constructor(reset_callback) {
        cockpit.event_target(this);

        this.reset_callback = reset_callback;

        this.x_range = 5 * 60;
        this.x_stop = undefined;
        this.history = [];

        this.enable_zoom_in = false;
        this.enable_zoom_out = true;
        this.enable_scroll_left = true;
        this.enable_scroll_right = false;
    }

    reset() {
        const plot_min_x_range = 5 * 60;

        if (this.x_range < plot_min_x_range) {
            this.x_stop += (plot_min_x_range - this.x_range) / 2;
            this.x_range = plot_min_x_range;
        }
        if (this.x_stop >= (new Date()).getTime() / 1000 - 10)
            this.x_stop = undefined;

        this.reset_callback(this.x_range, this.x_stop);

        this.enable_zoom_in = (this.x_range > plot_min_x_range);
        this.enable_scroll_right = (this.x_stop !== undefined);

        this.dispatchEvent("changed");
    }

    set_range(x_range) {
        this.history = [];
        this.x_range = x_range;
        this.reset();
    }

    zoom_in(x_range, x_stop) {
        this.history.push(this.x_range);
        this.x_range = x_range;
        this.x_stop = x_stop;
        this.reset();
    }

    zoom_out() {
        const plot_zoom_steps = [
            5 * 60,
            60 * 60,
            6 * 60 * 60,
            24 * 60 * 60,
            7 * 24 * 60 * 60,
            30 * 24 * 60 * 60,
            365 * 24 * 60 * 60
        ];

        let r = this.history.pop();
        if (r === undefined) {
            let i;
            for (i = 0; i < plot_zoom_steps.length - 1; i++) {
                if (plot_zoom_steps[i] > this.x_range)
                    break;
            }
            r = plot_zoom_steps[i];
        }
        if (this.x_stop !== undefined)
            this.x_stop += (r - this.x_range) / 2;
        this.x_range = r;
        this.reset();
    }

    goto_now() {
        this.x_stop = undefined;
        this.reset();
    }

    scroll_left() {
        const step = this.x_range / 10;
        if (this.x_stop === undefined)
            this.x_stop = (new Date()).getTime() / 1000;
        this.x_stop -= step;
        this.reset();
    }

    scroll_right() {
        const step = this.x_range / 10;
        if (this.x_stop !== undefined) {
            this.x_stop += step;
            this.reset();
        }
    }
}

class SinglePlotState {
    constructor() {
        this._plot = new Plot(null, 300);
        this._plot.start_walking();
    }

    plot_single(metric) {
        if (this._stacked_instances_series) {
            this._stacked_instances_series.clear_instances();
            this._stacked_instances_series.remove();
            this._stacked_instances_series = null;
        }
        if (!this._sum_series) {
            this._sum_series = this._plot.add_metrics_sum_series(metric, { });
        }
    }

    plot_instances(metric, insts, reset) {
        if (this._sum_series) {
            this._sum_series.remove();
            this._sum_series = null;
        }
        if (!this._stacked_instances_series) {
            this._stacked_instances_series = this._plot.add_metrics_stacked_instances_series(metric, { });
        } else if (reset) {
            // We can't remove individual instances, only clear the
            // whole thing (because of limitations of Metrics_stacked_instances_series above).
            // So we do that, but only when there is at least one instance
            // that needs to be removed.  That avoids a lot of events and React warnings.
            if (Object.keys(this._stacked_instances_series.instances).some(old => insts.indexOf(old) == -1))
                this._stacked_instances_series.clear_instances();
        }

        for (let i = 0; i < insts.length; i++) {
            this._stacked_instances_series.add_instance(insts[i]);
        }
    }

    destroy() {
        this._plot.destroy();
    }
}

export class PlotState {
    constructor() {
        cockpit.event_target(this);
        this.plots = { };
        this.zoom_state = null;
    }

    _reset_plots(x_range, x_stop) {
        for (const id in this.plots) {
            const p = this.plots[id]._plot;
            p.stop_walking();
            p.reset(x_range, x_stop);
            p.refresh();
            if (x_stop === undefined)
                p.start_walking();
        }
    }

    _check_archives(plot) {
        if (!this.zoom_state && plot.archives) {
            this.zoom_state = new ZoomState(this._reset_plots.bind(this));
            this.dispatchEvent("changed");
        }
    }

    _get(id) {
        if (this.plots[id])
            return this.plots[id];

        const ps = new SinglePlotState();
        ps._plot.addEventListener("changed", () => this._check_archives(ps._plot));
        this._check_archives(ps._plot);
        ps._plot.addEventListener("plot", (event, data) => {
            ps.data = data;
            this.dispatchEvent("plot:" + id);
        });

        this.plots[id] = ps;
        return ps;
    }

    plot_single(id, metric) {
        const ps = this._get(id);
        ps.plot_single(metric);
    }

    plot_instances(id, metric, insts, reset) {
        this._get(id).plot_instances(metric, insts, reset);
    }

    data(id) {
        return this.plots[id] && this.plots[id].data;
    }
}
