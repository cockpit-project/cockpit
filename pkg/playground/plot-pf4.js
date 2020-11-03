import '@patternfly/patternfly/patternfly-charts.css';
import '../lib/patternfly/patternfly-cockpit.scss';
import './plot-pf4.css';

import React, { useState, useRef } from 'react';
import ReactDOM from "react-dom";
import {
    Chart, ChartArea, ChartAxis, ChartStack
} from '@patternfly/react-charts';
import { VictorySelectionContainer } from "victory-selection-container";

import {
    Button,
    Dropdown,
    DropdownToggle,
    DropdownItem,
    DropdownSeparator,
    Page,
    Card,
    CardBody,
    Split,
    SplitItem,
    Grid,
    GridItem
} from '@patternfly/react-core';

import * as plot from "plot.js";
import { useObject, useEvent } from "hooks.js";

import cockpit from "cockpit";
import moment from "moment";

import "../lib/patternfly/patternfly-4-overrides.scss";

const _ = cockpit.gettext;

moment.locale(cockpit.language);

function time_ticks(data) {
    const start_ms = data[0][0].x;
    const end_ms = data[0][data[0].length - 1].x;

    // Determine size between ticks

    const sizes_in_seconds = [
        60, // minute
        5 * 60, // 5 minutes
        10 * 60, // 10 minutes
        30 * 60, // half hour
        60 * 60, // hour
        6 * 60 * 60, // quarter day
        12 * 60 * 60, // half day
        24 * 60 * 60, // day
        7 * 24 * 60 * 60, // week
        30 * 24 * 60 * 60, // month
        183 * 24 * 60 * 60, // half a year
        365 * 24 * 60 * 60, // year
        10 * 365 * 24 * 60 * 60 // 10 years
    ];

    let size;
    for (let i = 0; i < sizes_in_seconds.length; i++) {
        if (((end_ms - start_ms) / 1000) / sizes_in_seconds[i] < 10 || i == sizes_in_seconds.length - 1) {
            size = sizes_in_seconds[i] * 1000;
            break;
        }
    }

    // Determine what to omit from the tick label.  If it's all in the
    // current year, we don't need to include the year, for example.

    var n = new Date();
    var l = new Date(start_ms);

    const year_index = 0;
    const month_index = 1;
    const day_index = 2;
    const hour_minute_index = 3;

    let format_begin;
    const format_end = hour_minute_index;

    format_begin = year_index;
    if (l.getFullYear() == n.getFullYear()) {
        format_begin = month_index;
        if (l.getMonth() == n.getMonth()) {
            format_begin = day_index;
            if (l.getDate() == n.getDate())
                format_begin = hour_minute_index;
        }
    }

    if (format_begin == day_index)
        format_begin = month_index;

    // Compute the actual ticks

    const ticks = [];
    let t = Math.ceil(start_ms / size) * size;
    while (t < end_ms) {
        ticks.push(t);
        t += size;
    }

    // Render the label

    function pad(n) {
        var str = n.toFixed();
        if (str.length == 1)
            str = '0' + str;
        return str;
    }

    function format_tick(val, index, ticks) {
        var d = new Date(val);
        var label = ' ';

        if (year_index >= format_begin && year_index <= format_end)
            label += d.getFullYear().toFixed() + ' ';
        if (month_index >= format_begin && month_index <= format_end)
            label += moment(d).format('MMM') + ' ';
        if (day_index >= format_begin && day_index <= format_end)
            label += d.getDate().toFixed() + '\n';
        if (hour_minute_index >= format_begin && hour_minute_index <= format_end)
            label += pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ';

        return label.substr(0, label.length - 1);
    }

    return {
        ticks: ticks,
        formatter: format_tick
    };
}

function value_ticks(data) {
    let max = 4 * 1024;
    for (let i = 0; i < data[0].length; i++) {
        let s = 0;
        for (let j = 0; j < data.length; j++)
            s += data[j][i].y;
        if (s > max)
            max = s;
    }

    // Pick a unit
    let unit = 1;
    while (max > unit * 1024)
        unit *= 1024;

    // Find the highest power of 10 that is below max.  If we use that
    // as the distance between ticks, we get at most 10 ticks.
    var size = Math.pow(10, Math.floor(Math.log10(max / unit))) * unit;

    // Get the number of ticks to be around 4, but don't produce
    // fractional numbers.
    while (max / size > 7)
        size *= 2;
    while (max / size < 3 && size / unit >= 10)
        size /= 2;

    var ticks = [];
    for (let t = 0; t <= max; t += size)
        ticks.push(t);

    const unit_str = cockpit.format_bytes_per_sec(unit, 1024, true)[1];

    return {
        ticks: ticks,
        formatter: (val) => cockpit.format_bytes_per_sec(val, unit_str, true)[0],
        unit: unit_str
    };
}

class ZoomState {
    constructor(plots) {
        cockpit.event_target(this);
        this.x_range = 5 * 60;
        this.x_stop = undefined;
        this.history = [];
        this.plots = plots;

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

        this.plots.forEach(p => {
            p.stop_walking();
            p.reset(this.x_range, this.x_stop);
            p.refresh();
            if (this.x_stop === undefined)
                p.start_walking();
        });

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

        var r = this.history.pop();
        if (r === undefined) {
            var i;
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
        var step = this.x_range / 10;
        if (this.x_stop === undefined)
            this.x_stop = (new Date()).getTime() / 1000;
        this.x_stop -= step;
        this.reset();
    }

    scroll_right() {
        var step = this.x_range / 10;
        if (this.x_stop !== undefined) {
            this.x_stop += step;
            this.reset();
        }
    }
}

const ZoomControls = ({ zoom_state }) => {
    function format_range(seconds) {
        var n;
        if (seconds >= 365 * 24 * 60 * 60) {
            n = Math.ceil(seconds / (365 * 24 * 60 * 60));
            return cockpit.format(cockpit.ngettext("$0 year", "$0 years", n), n);
        } else if (seconds >= 30 * 24 * 60 * 60) {
            n = Math.ceil(seconds / (30 * 24 * 60 * 60));
            return cockpit.format(cockpit.ngettext("$0 month", "$0 months", n), n);
        } else if (seconds >= 7 * 24 * 60 * 60) {
            n = Math.ceil(seconds / (7 * 24 * 60 * 60));
            return cockpit.format(cockpit.ngettext("$0 week", "$0 weeks", n), n);
        } else if (seconds >= 24 * 60 * 60) {
            n = Math.ceil(seconds / (24 * 60 * 60));
            return cockpit.format(cockpit.ngettext("$0 day", "$0 days", n), n);
        } else if (seconds >= 60 * 60) {
            n = Math.ceil(seconds / (60 * 60));
            return cockpit.format(cockpit.ngettext("$0 hour", "$0 hours", n), n);
        } else {
            n = Math.ceil(seconds / 60);
            return cockpit.format(cockpit.ngettext("$0 minute", "$0 minutes", n), n);
        }
    }

    const [isOpen, setIsOpen] = useState(false);
    useEvent(zoom_state, "changed");

    function range_item(seconds, title) {
        return (
            <DropdownItem key={title}
                          onClick={() => {
                              setIsOpen(false);
                              zoom_state.set_range(seconds);
                          }}>
                {title}
            </DropdownItem>);
    }

    return (
        <div>
            <Dropdown
                isOpen={isOpen}
                toggle={<DropdownToggle onToggle={setIsOpen}>{format_range(zoom_state.x_range)}</DropdownToggle>}
                dropdownItems={[
                    <DropdownItem key="now" onClick={() => { zoom_state.goto_now(); setIsOpen(false) }}>
                        {_("Go to now")}
                    </DropdownItem>,
                    <DropdownSeparator key="sep" />,
                    range_item(5 * 60, _("5 minutes")),
                    range_item(60 * 60, _("1 hour")),
                    range_item(6 * 60 * 60, _("6 hours")),
                    range_item(24 * 60 * 60, _("1 day")),
                    range_item(7 * 24 * 60 * 60, _("1 week"))
                ]} />
            { "\n" }
            <Button variant="secondary" onClick={() => zoom_state.zoom_out()}
                    isDisabled={!zoom_state.enable_zoom_out}>
                <span className="glyphicon glyphicon-zoom-out" />
            </Button>
            { "\n" }
            <Button variant="secondary" onClick={() => zoom_state.scroll_left()}
                    isDisabled={!zoom_state.enable_scroll_left}>
                <span className="fa fa-angle-left" />
            </Button>
            <Button variant="secondary" onClick={() => zoom_state.scroll_right()}
                    isDisabled={!zoom_state.enable_scroll_right}>
                <span className="fa fa-angle-right" />
            </Button>
        </div>
    );
};

const StoragePlot = ({ title, plot, zoom_state, onHover }) => {
    const container_ref = useRef(null);
    useEvent(plot, "plot");
    useEvent(zoom_state, "changed");
    useEvent(window, "resize");

    function conv(arr) {
        return { x: arr[0], y: arr[1] ? arr[1] - arr[2] : null };
    }

    const chart_data = plot.flot_data.map(data => data.data.map(conv));
    const t_ticks = time_ticks(chart_data);
    const y_ticks = value_ticks(chart_data);

    let chart = null;
    if (container_ref.current && chart_data.length > 0) {
        chart = (
            <>
                <Chart containerComponent={<VictorySelectionContainer responsive={false}
                                                                      allowSelection={zoom_state.enable_zoom_in}
                                                                      selectionDimension="x"
                                                                      onSelection={(a, b, c) => {
                                                                          zoom_state.zoom_in((b.x[1] - b.x[0]) / 1000,
                                                                                             b.x[1] / 1000);
                                                                      }} />}
                       width={container_ref.current.offsetWidth} height={container_ref.current.offsetHeight}
                       padding={{ top: 14, bottom: 50, left: 50, right: 4 }}>
                    <ChartAxis tickValues={t_ticks.ticks} tickFormat={t_ticks.formatter} />
                    <ChartAxis dependentAxis showGrid
                               tickValues={y_ticks.ticks} tickFormat={y_ticks.formatter} />
                    <ChartStack>
                        { chart_data.map((d, i) => <ChartArea key={i} data={d}
                                                              interpolation="monotoneX"
                                                              events={[
                                                                  {
                                                                      target: "data",
                                                                      eventHandlers: {
                                                                          onMouseOver: () => {
                                                                              onHover(i);
                                                                          },
                                                                          onMouseOut: () => {
                                                                              onHover(-1);
                                                                          }
                                                                      }
                                                                  }
                                                              ]} />)
                        }
                    </ChartStack>
                </Chart>
            </>);
    }

    return (
        <div>
            <div>
                <span className="plot-unit">{y_ticks.unit}</span>
                <span className="plot-title">{title}</span>
            </div>
            <div className="storage-graph" ref={container_ref}>
                {chart}
            </div>
        </div>);
};

class PlotState {
    constructor() {
        this.plot = new plot.Plot(null, 300);
        this.plot.start_walking();
    }

    plot_single(metric) {
        if (this.stacked_instances_series) {
            this.stacked_instances_series.clear_instances();
            this.stacked_instances_series.remove();
            this.stacked_instances_series = null;
        }
        if (!this.sum_series) {
            this.sum_series = this.plot.add_metrics_sum_series(metric, { });
        }
    }

    plot_instances(metric, insts) {
        if (this.sum_series) {
            this.sum_series.remove();
            this.sum_series = null;
        }
        if (!this.stacked_instances_series) {
            this.stacked_instances_series = this.plot.add_metrics_stacked_instances_series(metric, { });
        }
        // XXX - Add all instances, but don't remove anything.
        //
        // This doesn't remove old instances, but that is mostly
        // harmless since if the block device doesn't exist anymore, we
        // don't get samples for it.  But it would be better to be precise here.
        for (var i = 0; i < insts.length; i++) {
            this.stacked_instances_series.add_instance(insts[i]);
        }
    }

    destroy() {
        this.plot.destroy();
    }
}

const instances_read_metric = {
    direct: "disk.dev.read_bytes",
    internal: "block.device.read",
    units: "bytes",
    derive: "rate",
    threshold: 1000
};

const instances_write_metric = {
    direct: "disk.dev.write_bytes",
    internal: "block.device.written",
    units: "bytes",
    derive: "rate",
    threshold: 1000
};

const single_read_metric = {
    direct: ["disk.all.read_bytes"],
    internal: ["disk.all.read"],
    units: "bytes",
    derive: "rate",
    threshold: 1000
};

const single_write_metric = {
    direct: ["disk.all.write_bytes"],
    internal: ["disk.all.written"],
    units: "bytes",
    derive: "rate",
    threshold: 1000
};

const StoragePlots = () => {
    const devs = ["vda", "sda", "sdb"];

    const ps1 = useObject(() => new PlotState(), ps => ps.destroy(), []);
    const ps2 = useObject(() => new PlotState(), ps => ps.destroy(), []);
    const zs = useObject(() => new ZoomState([ps1.plot, ps2.plot]), () => null, []);

    if (devs.length > 10) {
        ps1.plot_single(single_read_metric);
        ps2.plot_single(single_write_metric);
    } else {
        ps1.plot_instances(instances_read_metric, devs);
        ps2.plot_instances(instances_write_metric, devs);
    }

    const [hovered, setHovered] = useState(null);

    return (
        <>
            <Split>
                <SplitItem isFilled />
                <SplitItem><ZoomControls zoom_state={zs} /></SplitItem>
            </Split>
            <Grid sm={12} md={6} lg={6} hasGutter>
                <GridItem>
                    <StoragePlot title="Reading" plot={ps1.plot} zoom_state={zs} onHover={idx => setHovered(devs[idx])} />
                </GridItem>
                <GridItem>
                    <StoragePlot title="Writing" plot={ps2.plot} zoom_state={zs} onHover={idx => setHovered(devs[idx])} />
                </GridItem>

            </Grid>
            <div>{(hovered && devs.length <= 10) ? hovered : "--"}</div>
        </>);
};

const MyPage = () => {
    return (
        <Page>
            <Card>
                <CardBody>
                    <StoragePlots />
                </CardBody>
            </Card>
        </Page>);
};

document.addEventListener("DOMContentLoaded", function() {
    ReactDOM.render(<MyPage />, document.getElementById('plots'));
});
