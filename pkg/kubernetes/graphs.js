/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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
    "kubernetes/d3",
    "kubernetes/client",
], function($, cockpit, d3, client) {
    "use strict";

    var _ = cockpit.gettext;
    var module = { };

    var colors = [
        "#0099d3",
        "#67d300",
        "#d39e00",
        "#d3007c",
        "#00d39f",
        "#00d1d3",
        "#00618a",
        "#4c8a00",
        "#8a6600",
        "#9b005b",
        "#008a55",
        "#008a8a",
        "#00b9ff",
        "#7dff00",
        "#ffbe00",
        "#ff0096",
        "#00ffc0",
        "#00fdff",
        "#023448",
        "#264802",
        "#483602",
        "#590034",
        "#024830",
        "#024848"
    ];

    function service_grid() {
        var self = cockpit.grid(1000, 0, 0);

        /* The various rows being shown, override */
        self.rows = [ ];
        self.events = [ ];

        var kube = client.k8client();

        var change_queued = false;
        var current_metric = null;

        var services = [ ];
        var rows = {
            cpu: { },
            memory: { },
            network: { }
        };

        var container_cpu = { };
        var container_mem = { };
        var container_rx = { };
        var container_tx = { };

        /* All the cadvisors that have been opened */
        var cadvisors = [ ];

        /* Gives us events when kube does something */
        var service_map = client.service_map(kube);
        $(service_map)
            .on("host", function(ev, ip) {
                var host = ip;
                if (host === "127.0.0.1")
                    host = null;
                var cadvisor = client.cadvisor(host);
                $(cadvisor).on("container", function(ev, id) {
                    var cpu = self.add(this, [ id, "cpu", "usage", "total" ]);
                    container_cpu[id] = self.add(function(row, x, n) {
                        row_delta(cpu, row, x, n);
                    }, true);

                    container_mem[id] = self.add(this, [ id, "memory", "usage" ]);

                    var rx = self.add(this, [ id, "network", "rx_bytes" ]);
                    container_rx[id] = self.add(function(row, x, n) {
                        row_delta(rx, row, x, n);
                    }, true);

                    var tx = self.add(this, [ id, "network", "tx_bytes" ]);
                    container_tx[id] = self.add(function(row, x, n) {
                        row_delta(tx, row, x, n);
                    }, true);

                    self.sync();
                });

                /* In order to even know which containers we have, ask cadvisor to fetch */
                cadvisor.fetch(self.beg, self.end);

                /* TODO: Handle cadvisor failure somehow */

                cadvisors.push(cadvisor);
            })
            .on("service", function(ev, uid) {
                services.push(uid);

                /* CPU needs summing of containers, and then delta between them */
                rows.cpu[uid] = self.add(function(row, x, n) {
                    containers_sum(uid, container_cpu, row, x, n);
                });

                /* Memory row is pretty simple, just sum containers */
                rows.memory[uid] = self.add(function(row, x, n) {
                    containers_sum(uid, container_mem, row, x, n);
                });

                /* Network sums containers, then sum tx and rx, and then delta */
                var tx = self.add(function(row, x, n) {
                    containers_sum(uid, container_tx, row, x, n);
                });
                var rx = self.add(function(row, x, n) {
                    containers_sum(uid, container_rx, row, x, n);
                });
                rows.network[uid] = self.add(function(row, x, n) {
                    rows_sum([tx, rx], row, x, n);
                });

                change_queued = true;
            })
            .on("changed", function(ev) {
                self.sync();
            });

        $(self).on("notify", function() {
            if (change_queued) {
                change_queued = false;
                self.metric(current_metric);
            }
        });

        function rows_sum(input, row, x, n) {
            var max = row.maximum || 0;
            var value, i, v, j, len = input.length;

            /* Calculate the sum of the rows */
            for (i = 0; i < n; i++) {
                value = undefined;
                for (j = 0; j < len; j++) {
                    v = input[j][x + i];
                    if (v !== undefined) {
                        if (value === undefined)
                            value = v;
                        else
                            value += v;
                    }
                }

                if (value !== undefined && value > max) {
                    row.maximum = max = value;
                    change_queued = true;
                }

                row[x + i] = value;
            }
        }

        function row_delta(input, row, x, n) {
            var i, last, res, value;
            if (x > 0)
                last = input[x - 1];

            var max = row.maximum || 1;
            for (i = 0; i < n; i++) {
                value = input[x + i];
                if (last === undefined || value === undefined) {
                    res = undefined;
                } else {
                    res = (value - last);
                    if (res > max) {
                        row.maximum = max = res;
                        change_queued = true;
                    }
                }
                row[x + i] = res;
                last = value;
            }
        }

        function containers_sum(service, input, row, x, n) {
            var id, rowc, subset = [];
            var mapped = service_map.containers[service];
            if (mapped) {
                for(id in mapped) {
                    rowc = input[id];
                    if (rowc)
                        subset.push(rowc);
                }
            }
            rows_sum(subset, row, x, n);
        }

        self.metric = function metric(type) {
            if (type === undefined)
                return current_metric;
            if (rows[type] === undefined)
                throw "unsupported metric type";

            self.rows = [];
            current_metric = type;

            var row, i, len = services.length;
            for (i = 0; i < len; i++) {
                row = rows[type][services[i]];
                if (row !== undefined)
                    self.rows.push(row);
            }

            $(self).triggerHandler("changed");
        };

        var base_close = self.close;
        self.close = function close() {
            cadvisors.forEach(function(cadvisor) {
                cadvisor.close();
            });

            service_map.close();
            kube.close();
            base_close.apply(self);
        };

        return self;
    }

    function service_graph(selector) {
        var grid = service_grid();

        var outer = d3.select(selector);

        /* Various tabs */

        var tabs = {
            cpu: {
                label: _("CPU"),
                step: 1000 * 1000 * 1000,
                formatter: function(v) { return (v / (10 * 1000 * 1000)) + "%"; }
            },
            memory: {
                label: _("Memory"),
                step: 1024 * 1024 * 64,
                formatter: function(v) { return cockpit.format_bytes(v); }
            },
            network: {
                label: _("Network"),
                step: 1000 * 1000,
                formatter: function(v) { return cockpit.format_bits_per_sec(v, "Mbps"); }
            }
        };

        outer.append("ul")
            .attr("class", "nav nav-tabs")
            .selectAll("li")
                .data(Object.keys(tabs))
              .enter().append("li")
                .attr("data-metric", function(d) { return d; })
              .append("a")
                .text(function(d) { return tabs[d].label; });

        function metric_tab(tab) {
            outer.selectAll("ul li")
                .attr("class", function(d) { return tab === d ? "active": null; });
            grid.metric(tab);
        }

        outer.selectAll("ul li")
            .on("click", function() {
                metric_tab(d3.select(this).attr("data-metric"));
            });

        metric_tab("cpu");

        /* The main svg graph stars here */

        var margins = {
            top: 12,
            right: 10,
            bottom: 40,
            left: 60
        };

        var element = d3.select(selector).append("svg");
        var stage = element.append("g")
            .attr("transform", "translate(" + margins.left + "," + margins.top + ")");

        var minutes = d3.time.format("%H:%M");

        var y = d3.scale.linear();
        var y_axis = d3.svg.axis()
            .scale(y)
            .ticks(5)
            .orient("left");
        var y_group = stage.append("g")
            .attr("class", "y axis");

        var x = d3.time.scale();
        var x_axis = d3.svg.axis()
            .scale(x)
            .orient("bottom");
        var x_group = stage.append("g")
            .attr("class", "x axis");

        var line = d3.svg.line()
            .defined(function(d) { return d !== undefined; })
            .x(function(d, i) { return x(new Date((grid.beg + i) * grid.interval)); })
            .y(function(d, i) { return y(d); });

        /* Initial display: 1024 px is 5 minutes of data */
        var factor = 300000 / 1024;
        var width = 300;
        var height = 300;

        var rendered = false;
        window.setTimeout(function() {
            rendered = true;
            adjust();
        }, 1);

        function ceil(value, step) {
            var d = value % step;
            if (value === 0 || d !== 0)
                value += (step - d);
            return value;
        }

        function jump() {
console.log("jump");
            var interval = grid.interval;
            var w = (width - margins.right) - margins.left;

            /* TODO: This doesn't yet work for an arbitary ponit in time */
            var end = Math.floor($.now() / interval);
            var beg = end - Math.floor((factor * w) / interval);

            /* Indicate the time range that the X axis is using */
            x.domain([new Date(beg * interval), new Date(end * interval)]);

            /* Re-render the X axis. Note that we also
             * bump down the labels a bit. */
            x_group
                .transition()
                .call(x_axis)
              .selectAll("text")
                .attr("y", "10px");

            grid.move(beg, end);
        }

        function adjust() {
            if (!rendered)
                return;

            element
                .attr("width", width)
                .attr("height", height);

            var w = (width - margins.right) - margins.left;
            var h = (height - margins.top) - margins.bottom;

            var metric = grid.metric();
            var interval = grid.interval;

            /* Calculate our maximum value, hopefully rows are tracking this for us */
            var rows = grid.rows, maximum = 0;
            var i, max, len = rows.length;
            for (i = 0; i < len; i++) {
                if (rows[i].maximum !== undefined)
                    max = rows[i].maximum;
                else
                    max = d3.max(rows[i]);
                if (max > maximum)
                    maximum = Math.ceil(max);
            }

            y.domain([0, ceil(maximum, tabs[metric].step)]).range([h, 0]);

            x.range([0, w]);

            /*
             * Make x-axis ticks into grid of right height
             *
             * TODO: We should calculate number of ticks based on width
             * In addition the tick formatter needs to change based on end - start
             */
            x_axis
                .ticks(6)
                .tickSize(-h, -h)
                .tickFormat(function(d) {
                    if (d.getSeconds() === 0)
                        return minutes(d);
                    return "";
                });

            /* Re-render the X axis. Note that we also
             * bump down the labels a bit. */
            x_group
                .attr("transform", "translate(0," + h + ")");

            /* Turn the Y axis ticks into a grid */
            y_axis
                .tickSize(-w, -w)
                .tickFormat(tabs[metric].formatter);

            y_group
                .call(y_axis)
              .selectAll("text")
                .attr("x", "-10px");

            jump();
        }

        function notified(ev, x, n) {
            var rows = grid.rows;

            var series = stage.selectAll("path.line")
                .data(rows, function(d, i) { return i; });

            series
                .style("stroke", function(d, i) { return colors[i % colors.length]; })
                .transition().attr("d", function(d) { return line(d); });
            series.enter().append("path")
                .attr("class", "line");
            series.exit().remove();
        }

        $(grid).on("changed", adjust);
        $(grid).on("notify changed", notified);

        function resized() {
            width = $(selector).innerWidth();
            adjust();
        }

        $(window).on('resize', resized);
        resized();

        window.setInterval(jump, grid.interval);

        return element;
    }

    module.services = function services(selector) {
        return service_graph(selector);
    };

    return module;
});
