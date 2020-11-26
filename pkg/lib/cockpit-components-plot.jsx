/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import cockpit from "cockpit";
import moment from "moment";

import React, { useState, useRef, useLayoutEffect } from 'react';
import { useEvent } from "hooks.js";

import {
    Button,
    Dropdown,
    DropdownToggle,
    DropdownItem,
    DropdownSeparator
} from '@patternfly/react-core';

const _ = cockpit.gettext;

moment.locale(cockpit.language);

function time_ticks(data) {
    const first_plot = data[0].data;
    const start_ms = first_plot[0][0];
    const end_ms = first_plot[first_plot.length - 1][0];

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
        formatter: format_tick,
        start: start_ms,
        end: end_ms
    };
}

function value_ticks(data, config) {
    let max = config.min_max;
    const last_plot = data[data.length - 1].data;
    for (let i = 0; i < data.length; i++) {
        const d = data[i].data;
        for (let j = 0; j < d.length; j++) {
            const s = d[j][1] || d[j][2];
            if (s > max)
                max = s;
        }
    }

    // Pick a unit
    let unit = 1;
    while (config.base_unit && max > unit * config.base_unit)
        unit *= config.base_unit;

    // Find the highest power of 10 that is below max.  If we use that
    // as the distance between ticks, we get at most 10 ticks.
    let size = Math.pow(10, Math.floor(Math.log10(max / unit))) * unit;

    // Get the number of ticks to be around 4, but don't produce
    // fractional numbers.
    while (max / size > 7)
        size *= 2;
    while (max / size < 3 && size / unit >= 10)
        size /= 2;

    let ticks = [];
    for (let t = 0; t < max + size; t += size)
        ticks.push(t);

    if (config.pull_out_unit) {
        const unit_str = config.formatter(unit, config.base_unit, true)[1];

        return {
            ticks: ticks,
            formatter: (val) => config.formatter(val, unit_str, true)[0],
            unit: unit_str,
            max: ticks[ticks.length - 1]
        };
    } else {
        return {
            ticks: ticks,
            formatter: config.formatter,
            max: ticks[ticks.length - 1]
        };
    }
}

export const ZoomControls = ({ plot_state }) => {
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

    const zoom_state = plot_state.zoom_state;

    const [isOpen, setIsOpen] = useState(false);
    useEvent(plot_state, "changed");
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

    if (!zoom_state)
        return null;

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

const useLayoutSize = (init_width, init_height) => {
    const ref = useRef(null);
    const [ size, setSize ] = useState({ width: init_width, height: init_height });
    useLayoutEffect(() => {
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            if (rect.width != size.width || rect.height != size.height)
                setSize({ width: rect.width, height: rect.height });
        }
    });
    return [ ref, size ];
}

export const SvgPlot = ({ title, config, style, plot_state, plot_id, onHover, className }) => {
    const [ container_ref, container_size ] = useLayoutSize(0, 0);
    const [ measure_ref, measure_size ] = useLayoutSize(36, 20);

    useEvent(plot_state, "plot:" + plot_id);
    useEvent(plot_state, "changed");
    useEvent(window, "resize");

    const [selection, setSelection] = useState(null);

    const chart_data = plot_state.data(plot_id);
    if (!chart_data || chart_data.length == 0)
        return null;

    const t_ticks = time_ticks(chart_data);
    const y_ticks = value_ticks(chart_data, config);

    function make_chart() {
        const w = container_size.width;
        const h = container_size.height;

        if (w == 0 || h == 0)
            return null;

        const x_off = t_ticks.start;
        const x_range = (t_ticks.end - t_ticks.start);
        const y_range = y_ticks.max;

        const tick_length = 5;
        const tick_gap = 3;

        const m_left = Math.ceil(measure_size.width) + tick_gap + tick_length; // unit string plus gap plus tick
        const m_right = 30; // half of the time label
        const m_top = (y_ticks.unit || title ? 1.5 : 0.5) * Math.ceil(measure_size.height); // half line plus one if necc.
        const m_bottom = tick_length + tick_gap + 2 * Math.ceil(measure_size.height); // two line labels plus gap plus tick

        function x_coord(x) {
            return (x - x_off) / x_range * (w - m_left - m_right) + m_left;
        }

        function x_value(c) {
            return (c - m_left) / (w - m_left - m_right) * x_range + x_off;
        }

        function y_coord(y) {
            return h - Math.max(y, 0) / y_range * (h - m_top - m_bottom) - m_bottom;
        }

        function cmd(op, x, y) {
            return op + x.toFixed() + "," + y.toFixed() + " ";
        }

        function path(data, color, hover_arg) {
            let d = "";
            let next_cmd = "M";
            if (style != "lines") {
                d += cmd("M", m_left, h - m_bottom);
                next_cmd = "L";
            }
            for (let i = 0; i < data.length; i++) {
                d += cmd(next_cmd, x_coord(data[i][0]), y_coord(data[i][1]));
                next_cmd = "L";
            }
            if (style != "lines") {
                d += cmd("L", w - m_right, h - m_bottom);
                d += "z";
            }

            const stroke = style == "lines" ? color : "#005dc9";
            const stroke_width = style == "lines" ? 2 : null;
            const fill = style == "lines" ? "transparent" : color;

            return <path key={hover_arg} d={d}
                         stroke={stroke} strokeWidth={stroke_width} fill={fill}
                         onMouseEnter={() => onHover(hover_arg)}
                         onMouseLeave={() => onHover(null)} />;
        }

        const colors = [
            '#39a5dc',
            '#008ff0',
            '#2daaff',
            '#69c2ff',
            '#a5daff',
            '#e1f3ff',
            '#00243c',
            '#004778'
        ];

        const paths = [];
        for (let i = chart_data.length - 1; i >= 0; i--)
            paths.push(path(chart_data[i].data,
                            chart_data[i].color || colors[i % colors.length],
                            chart_data[i].name || true));

        function start_dragging(event) {
            if (event.button !== 0)
                return;

            const bounds = container_ref.current.getBoundingClientRect();
            const x = event.clientX - bounds.x;
            if (x >= m_left && x < w - m_right)
                setSelection({ start: x, stop: x, left: x, right: x });
        }

        function drag(event) {
            const bounds = container_ref.current.getBoundingClientRect();
            let x = event.clientX - bounds.x;
            if (x < m_left) x = m_left;
            if (x > w - m_right) x = w - m_right;
            setSelection({
                start: selection.start, stop: x,
                left: Math.min(selection.start, x), right: Math.max(selection.start, x)
            });
        }

        function stop_dragging() {
            const left = x_value(selection.left) / 1000;
            const right = x_value(selection.right) / 1000;
            plot_state.zoom_state.zoom_in(right - left, right);
            setSelection(null);
        }

        function cancel_dragging() {
            setSelection(null);
        }

        // This is a thin transparent rectangle placed at the x-axis,
        // on top of all the graphs.  It prevents bogus hover events
        // for parts of the graph that are zero or very very close to
        // it.
        const hover_guard =
            <rect x={0} y={h - m_bottom} width={w} height={2} fill="transparent" />;

        return (
            <svg width={w} height={h}
                 onMouseDown={plot_state.zoom_state && plot_state.zoom_state.enable_zoom_in ? start_dragging : null}
                 onMouseUp={selection ? stop_dragging : null}
                 onMouseMove={selection ? drag : null}
                 onMouseLeave={cancel_dragging}>
                <text x={0} y={-20} style={{ fontSize: "small" }} ref={measure_ref}>{config.widest_string}</text>
                <rect x={m_left} y={m_top} width={w - m_left - m_right} height={h - m_top - m_bottom}
                      stroke="#d4d4d4" fill="transparent" shapeRendering="crispEdges" />
                { y_ticks.unit && <text x={m_left - tick_length - tick_gap} y={0.5 * m_top}
                                        style={{ fontSize: "small" }}
                                        textAnchor="end">
                                      {y_ticks.unit}
                                  </text>
                }
                { title && <text x={m_left} y={0.5 * m_top}>
                               {title}
                           </text>
                }
                { y_ticks.ticks.map((t, i) => <line key={i}
                                                    x1={m_left - tick_length} x2={w - m_right}
                                                    y1={y_coord(t)} y2={y_coord(t)}
                                                    stroke="#d4d4d4" shapeRendering="crispEdges" />) }
                { t_ticks.ticks.map((t, i) => <line key={i}
                                                    x1={x_coord(t)} x2={x_coord(t)}
                                                    y1={h - m_bottom} y2={h - m_bottom + tick_length}
                                                    stroke="#d4d4d4" shapeRendering="crispEdges" />) }
                { paths }
                { hover_guard }
                { y_ticks.ticks.map((t, i) => <text key={i} x={m_left - tick_length - tick_gap} y={y_coord(t) + 5}
                                                    textAnchor="end"
                                                    style={{ fontSize: "small" }}>
                    {y_ticks.formatter(t)}
                </text>) }
                { t_ticks.ticks.map((t, i) => <text key={i} y={h - m_bottom + tick_length + tick_gap}
                                                    textAnchor="middle"
                                                    style={{ fontSize: "small" }}>
                    { t_ticks.formatter(t).split("\n")
                            .map((s, j) =>
                                <tspan key={i + "." + j} x={x_coord(t)} dy="1.2em">{s}</tspan>) }
                </text>) }
                { selection &&
                <rect x={selection.left} y={m_top} width={selection.right - selection.left} height={h - m_top - m_bottom}
                        stroke="black" fill="tan" opacity="0.5" shapeRendering="crispEdges" /> }
            </svg>);
    }

    return (
        <div className={className} ref={container_ref}>
            {make_chart()}
        </div>);
};

export const bytes_per_sec_config = {
    base_unit: 1024,
    min_max: 10240,
    pull_out_unit: true,
    widest_string: "MiB/s",
    formatter: cockpit.format_bytes_per_sec
};

export const bits_per_sec_config = {
    base_unit: 1000,
    min_max: 10000,
    pull_out_unit: true,
    widest_string: "Mbps",
    formatter: cockpit.format_bits_per_sec
};

export const bytes_per_sec_config_with_inline_units = {
    base_unit: 1024,
    min_max: 10240,
    widest_string: "999 MiB/s",
    formatter: cockpit.format_bytes_per_sec
};

export const bits_per_sec_config_with_inline_units = {
    base_unit: 1000,
    min_max: 10000,
    widest_string: "999 Mbps",
    formatter: cockpit.format_bits_per_sec
};

export const percent_config = {
    min_max: 100,
    widest_string: "999%",
    formatter: val => val.toFixed() + "%"
};

export const memory_config_with_inline_units = {
    base_unit: 1024,
    min_max: 10240,
    widest_string: "1999 MiB",
    formatter: cockpit.format_bytes
};
