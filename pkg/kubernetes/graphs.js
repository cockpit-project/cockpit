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

    var module = { };

    function service_graph() {
        var kube = client.k8client();

        /* Start off with an empty grid */
        var grid = cockpit.grid(1000, 0, 0);

        /* Container to row mappings */
        var cpu = { };
        var memory = { };
        var netrx = { };
        var nettx = { };

        /* Host to cadvisor mapping */
        var cadvisors = [ ];

        function connect_cadvisor(ip) {
        }

        /* The various service rows */
        var services = { };
        var service_map = client.service_map(kube);

        $(service_map)
            .on("host", function(ev, ip) {
                var host = ip;
                if (host === "127.0.0.1")
                    host = null;
                var cadvisor = client.cadvisor(host);
                $(cadvisor).on("container", function(ev, id) {
                    cpu[id] = grid.add(this, [ id, "cpu", "usage", "total" ]);
                    memory[id] = grid.add(this, [ id, "memory", "usage" ]);
                    netrx[id] = grid.add(this, [ id, "network", "rx_bytes" ]);
                    nettx[id] = grid.add(this, [ id, "network", "tx_bytes" ]);
                });

                /* In order to even know which containers we have, ask cadvisor to fetch */
                cadvisor.fetch();

                /* TODO: Handle cadvisor failure somehow */
            })
            .on("service", function(ev, uid) {
                services[uid] = grid.add(function(r, x, n) {
                    calculate_service(uid, r, x, n);
                });
                grid.notify(grid.beg, grid.end);
            })
            .on("changed", function(ev) {
                $(grid).triggerHandler("added-service", [ uid ]);
                changed = true;
            });

        /* Called to summarize all data for a given container */
        function calculate_service(uid, row, x, n) {
            var i, j, length;

            /* Gather all rows to calculate from */
            var id, r, rows = [];
            var mapped = service_to_containers[uid];
            if (mapped) {
                for(id in mapped) {
                    r = cpu[id];
                    if (r)
                        rows.push(r);
                }
            }

            var v, value;
            length = rows.length;

            var last, res;
            if (x > 0)
                last = row[x - 1];

            var max = row.maximum || 0;

            /* Calculate the sum of the rows */
            for (i = 0; i < n; i++) {
                value = undefined;
                for (j = 0; j < length; j++) {
                    v = rows[j][x + i];
                    if (v !== undefined) {
                        if (value === undefined)
                            value = v;
                        else
                            value += v;
                    }
                }

                if (last === undefined || value === undefined) {
                    res = undefined;
                } else {
                    res = (value - last) / (1000 * 1000 * 1000);
                    if (res > max) {
                        max = res;
                        row.maximum = max;
                    }
                }

                row[x + i] = res;
                last = value;
            }
        }

        function update_services() {
            var changed = false;

            /* Lookup all the services */
            kube.services.forEach(function(service) {
                if (!service.spec || !service.spec.selector)
                    return;

                var name = service.metadata.name;
                if (name === "kubernetes" || name === "kubernetes-ro")
                    return;

                var uid = service.metadata.uid;

                /* Lookup all the pods for each service */
                kube.select(service.spec.selector, service.metadata.namespace, "Pod").forEach(function(pod) {
                    var status = pod.status || { };
                    var ip = status.hostIP;
                    var containers = status.containerStatuses || [];

                    if (ip && !cadvisors[ip]) {
                        connect_cadvisor(ip);
                        changed = true;
                    }

                    /* Note all the containers for that pod */
                    containers.forEach(function(container) {
                        var id = container.containerID;
                        if (id.indexOf("docker://") !== 0)
                            return;
                        id = id.substring(9);
                        var mapped = service_to_containers[uid];
                        if (!mapped)
                            mapped = service_to_containers[uid] = { };
                        if (!mapped[id]) {
                            mapped[id] = id;
                            changed = true;
                        }
                    });
                });

                if (!grid.services[uid]) {
                    grid.services[uid] = grid.add(function(r, x, n) {
                        calculate_service(uid, r, x, n);
                    });
                    $(grid).triggerHandler("added-service", [ uid ]);
                    changed = true;
                }
            });

            /* Notify for all rows */
            if (changed)
                grid.notify(0, grid.end, grid.beg);
        }

        $(kube).on("services pods", update_services);
        update_services();

        var base_close = grid.close;
        grid.close = function close() {
            $.each(cadvisors, function(cadvisor) {
                cadvisor.close();
            });

            $(kube).off("services", update_services);
            kube.close();

            base_close.apply(grid);
        };

        return grid;
    }

    function service_graph(selector, grid, lines) {
        var margins = {
            top: 6,
            right: 10,
            bottom: 40,
            left: 40
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

        function adjust() {
            if (!rendered)
                return;

            element
                .attr("width", width)
                .attr("height", height);

            var w = (width - margins.right) - margins.left;
            var h = (height - margins.top) - margins.bottom;

            var interval = grid.interval;

            /* TODO: This doesn't yet work for an arbitary ponit in time */
            var end = Math.floor($.now() / interval);
            var beg = end - Math.floor((factor * w) / interval);

            /* Indicate the time range that the X axis is using */
            x.domain([new Date(beg * interval), new Date(end * interval)]).range([0, w]);
            y.range([h, 0]);

            grid.move(beg, end);

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
                .attr("transform", "translate(0," + h + ")")
                .call(x_axis)
              .selectAll("text")
                .attr("y", "10px");

            /* Turn the Y axis ticks into a grid */
            y_axis.tickSize(-w, -w);

            y_group
                .call(y_axis)
              .selectAll("text")
                .attr("x", "-10px");
        }

        function notified(ev, x, n) {
            var series = stage.selectAll("path")
                .data(Object.keys(grid.services), function (d) { return d; });

            series
                .attr("d", function(d) { return line(grid.services[d]); });
            series.enter().append("path")
                .attr("class", "line");
            series.exit().remove();
        }

        $(grid).on("notify", notified);

        function resized() {
            width = $(selector).innerWidth();
            adjust();
        }

        $(window).on('resize', resized);
        resized();

        return element;
    }

    module.services = function services(selector) {
        var grid = service_grid();
        return service_graph(selector, grid);
    };

    return module;
});
