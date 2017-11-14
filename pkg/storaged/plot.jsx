/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
import React from "react";
import $ from "jquery";

import plot from "plot";
import { decode_filename } from "./utils.js";

const _ = cockpit.gettext;

class ZoomControls extends React.Component {
    constructor() {
        super();
        this.classes = { }
        this.plots = [ ];
    }

    render() {
        var self = this;

        function setup(element) {
            if (!element)
                return;

            if (!self.controls) {
                // The setup_plot_controls function has been written
                // to work with a jQuery object but it will only modify
                // the classes of it with the usual hasClass/addClass/removeClass functions.
                // So we duck-type the relevant functions.
                var duck = {
                    hasClass: (cl) => self.classes[cl],
                    addClass: (cl) => {
                        self.classes[cl] = true;
                        self.props.onClassesChanged(self.classes);
                    },
                    removeClass: (cl) => {
                        delete self.classes[cl];
                        self.props.onClassesChanged(self.classes);
                    }
                };
                self.controls = plot.setup_plot_controls(duck, $(element), self.plots);
            }
        }

        return (
            <div ref={setup} id="storage-graph-toolbar" className="zoom-controls standard-zoom-controls">
                <div className="dropdown">
                    <button className="btn btn-default dropdown-toggle" data-toggle="dropdown">
                        <span></span>
                        <div className="caret"></div>
                    </button>
                    <ul className="dropdown-menu" role="menu">
                        <li role="presentation">
                            <a role="menuitem" tabindex="-1" data-action="goto-now">{_("Go to now")}</a>
                        </li>
                        <li role="presentation" className="divider"/>
                        <li role="presentation">
                            <a role="menuitem" tabindex="-1" data-range="300">{_("5 minutes")}</a>
                        </li>
                        <li role="presentation">
                            <a role="menuitem" tabindex="-1" data-range="3600">{_("1 hour")}</a>
                        </li>
                        <li role="presentation">
                            <a role="menuitem" tabindex="-1" data-range="21600">{_("6 hours")}</a>
                        </li>
                        <li role="presentation">
                            <a role="menuitem" tabindex="-1" data-range="86400">{_("1 day")}</a>
                        </li>
                        <li role="presentation">
                            <a role="menuitem" tabindex="-1" data-range="604800">{_("1 week")}</a>
                        </li>
                    </ul>
                </div>
                { "\n" }
                <button className="btn btn-default" data-action="zoom-out">
                    <span className="glyphicon glyphicon-zoom-out"></span>
                </button>
                { "\n" }
                <div className="btn-group">
                    <button className="btn btn-default fa fa-angle-left" data-action="scroll-left"></button>
                    <button className="btn btn-default fa fa-angle-right" data-action="scroll-right"></button>
                </div>
            </div>
        );
    }

    reset(plots) {
        if (this.controls)
            this.controls.reset(plots);
        else
            this.plots = plots;
    }
}

class StoragePlot extends React.Component {
    constructor() {
        super();
        this.state = { unit: "" }
        this.on_resize = () => { this.setState({}); };
    }

    componentDidMount() {
        window.addEventListener("resize", this.on_resize);
    }

    componentWillUnmount() {
        window.removeEventListener("resize", this.on_resize);
    }

    render() {
        var self = this;

        function setup_hook(flot) {
            var axes = flot.getAxes();
            if (axes.yaxis.datamax < 100000)
                axes.yaxis.options.max = 100000;
            else
                axes.yaxis.options.max = null;
            axes.yaxis.options.min = 0;
        }

        function post_hook(flot) {
            var axes = flot.getAxes();
            self.setState({ unit: cockpit.format_bytes_per_sec(axes.yaxis.max, 1024, true)[1] });
        }

        function hover(event, dev) {
            if (self.props.onHover)
                self.props.onHover(dev);
        }

        function setup_plot(element) {
            if (!element)
                return;

            /* If we get a new DOM element, we need to recreate the
             * whole plot.  This is bad, but does not actually happen
             * in the normal life of the storage page.
             */
            if (self.plot && element != self.plot_element) {
                self.plot.destroy();
                self.plot = null;
            }

            if (self.plot) {
                if (element.offsetWidth != self.last_offsetWidth || element.offsetHeight != self.last_offsetHeight) {
                    self.last_offsetWidth = element.offsetWidth;
                    self.last_offsetHeight = element.offsetHeight;
                    self.plot.resize();
                }
                return;
            }

            var plot_options = plot.plot_simple_template();
            $.extend(plot_options.yaxis, { ticks: plot.memory_ticks,
                                           tickFormatter: plot.format_bytes_per_sec_tick_no_unit
            });
            $.extend(plot_options.grid,  { hoverable: true,
                                           autoHighlight: false
            });
            plot_options.setup_hook = setup_hook;
            plot_options.post_hook = post_hook;
            self.plot = plot.plot($(element), 300);
            self.plot_element = element;
            self.plot.set_options(plot_options);
            self.series = self.plot.add_metrics_stacked_instances_series(self.props.data, { });
            self.plot.start_walking();
            $(self.series).on('hover', hover);

            if (self.props.onPlotCreated)
                self.props.onPlotCreated(self.plot);
        }

        if (self.series) {
            for (var i = 0; i < self.props.devs.length; i++)
                self.series.add_instance(self.props.devs[i]);
        }

        return (
            <div className="col-sm-6 storage-graph-container">
                <div>
                    <span className="plot-unit">{this.state.unit}</span>
                    <span className="plot-title">{this.props.title}</span>
                </div>
                <div ref={setup_plot} className="zoomable-plot storage-graph"></div>
            </div>
        );
    }
}

export class StoragePlots extends React.Component {
    constructor() {
        super();
        this.plots = [ ];
        this.state = { classes: { } };
    }

    render() {
        var read_plot_data = {
            direct: "disk.dev.read_bytes",
            internal: "block.device.read",
            units: "bytes",
            derive: "rate",
            threshold: 1000
        };

        var write_plot_data = {
            direct: "disk.dev.write_bytes",
            internal: "block.device.written",
            units: "bytes",
            derive: "rate",
            threshold: 1000
        };

        var client = this.props.client;
        var devs = [ ];
        for (var p in client.drives) {
            var block = client.drives_block[p];
            var dev = block && decode_filename(block.Device).replace(/^\/dev\//, "");
            if (dev)
                devs.push(dev);
        }

        // We need to tell the zoom controls about our plots as they
        // get created.

        const setup_controls = (element) => {
            if (element && !this.controls) {
                this.controls = element;
                this.controls.reset(this.plots);
            }
        }

        const new_plot = (p) => {
            this.plots.push(p);
            if (this.controls)
                this.controls.reset(this.plots);
        }

        return (
            <div className={Object.keys(this.state.classes).join(" ")}>
                <ZoomControls ref={setup_controls}
                              onClassesChanged={(cls) => this.setState({ classes: cls })}/>
                <div className="row">
                    <StoragePlot devs={devs} onHover={this.props.onHover}
                                 onPlotCreated={new_plot}
                                 title={_("Reading")} data={read_plot_data}/>
                    <StoragePlot devs={devs} onHover={this.props.onHover}
                                 onPlotCreated={new_plot}
                                 title={_("Writing")} data={write_plot_data}/>
                </div>
            </div>
        );
    }
}
