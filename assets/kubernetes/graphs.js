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
    "base1/angular",
    "kubernetes/d3",
    "kubernetes/client",
], function($, cockpit, angular, d3, client) {
    "use strict";

    var _ = cockpit.gettext;
    var module = { };

    function ServiceMap(kube) {
        var self = this;

        self.hosts = { };
        self.services = { };

        var services = kube.select("Service");
        kube.track(services);
        var pods = kube.select("Pod");
        kube.track(pods);
        $([services, pods]).on("changed", update);

        function update() {
            var changed = false;

            /* Lookup all the services */
            angular.forEach(services, function(service) {
                var spec = service.spec;
                var meta = service.metadata;
                var name = meta.name;

                if (!spec || !spec.selector || name === "kubernetes" || name === "kubernetes-ro")
                    return;

                var uid = meta.uid;

                /* Lookup all the pods for each service */
                kube.select("Pod", meta.namespace, spec.selector).items.forEach(function(pod) {
                    var status = pod.status || { };
                    var spec = pod.spec || { };
                    var host = spec.nodeName;
                    var containers = status.containerStatuses || [];

                    if (host && !self.hosts[host]) {
                        self.hosts[host] = host;
                        $(self).triggerHandler("host", host);
                    }

                    /* Note all the containers for that pod */
                    containers.forEach(function(container) {
                        var id = container.containerID;
                        if (id && id.indexOf("docker://") === 0) {
                            id = id.substring(9);
                            var mapped = self.services[uid];
                            if (!mapped) {
                                mapped = self.services[uid] = { };
                                $(self).triggerHandler("service", uid);
                            }
                            if (!mapped[id]) {
                                mapped[id] = id;
                                changed = true;
                            }
                        }
                    });
                });
            });

            /* Notify for all rows */
            if (changed)
                $(self).triggerHandler("changed");
        }

        update();

        self.close = function close() {
            kube.track(services, false);
            kube.track(pods, false);
        };
    }

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
        var service_map = new ServiceMap(kube);
        $(service_map)
            .on("host", function(ev, host) {
                add_cadvisor(host);
            })
            .on("service", function(ev, uid) {
                add_service(uid);
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

        function add_container(cadvisor, id) {
            var cpu = self.add(cadvisor, [ id, "cpu", "usage", "total" ]);
            container_cpu[id] = self.add(function(row, x, n) {
                row_delta(cpu, row, x, n);
            }, true);

            container_mem[id] = self.add(cadvisor, [ id, "memory", "usage" ]);

            var rx = self.add(cadvisor, [ id, "network", "rx_bytes" ]);
            container_rx[id] = self.add(function(row, x, n) {
                row_delta(rx, row, x, n);
            }, true);

            var tx = self.add(cadvisor, [ id, "network", "tx_bytes" ]);
            container_tx[id] = self.add(function(row, x, n) {
                row_delta(tx, row, x, n);
            }, true);

            self.sync();
        }

        function add_cadvisor(host) {
            var cadvisor = client.cadvisor(host);
            $(cadvisor).on("container", function(ev, id) {
                add_container(this, id);
            });

            var id;
            for (id in cadvisor.specs)
                add_container(cadvisor, id);

            /* A dummy row to force fetching data from the cadvisor */
            self.add(cadvisor, [ "unused-dummy" ]);

            /* TODO: Handle cadvisor failure somehow */
            cadvisors.push(cadvisor);
        }

        function add_service(uid) {
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
        }

        function setup() {
            var host, uid;

            for (host in service_map.hosts)
                add_cadvisor(host);
            for (uid in service_map.services)
                add_service(uid);
        }

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
                    if (res < 0) {
                        res = undefined;
                    } else if (res > max) {
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
            var mapped = service_map.services[service];
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
                if (row !== undefined) {
                    self.rows.push(row);
                    row.uid = services[i];
                }
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

        setup();
        return self;
    }

    function service_graph(selector, highlighter) {
        var grid = service_grid();

        var outer = d3.select(selector);

        var highlighted = null;

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
            right: 15,
            bottom: 40,
            left: 60
        };

        var colors = d3.scale.category20();

        var element = d3.select(selector).append("svg");
        var stage = element.append("g")
            .attr("transform", "translate(" + margins.left + "," + margins.top + ")");

        var y = d3.scale.linear();
        var y_axis = d3.svg.axis()
            .scale(y)
            .ticks(5)
            .orient("left");
        var y_group = stage.append("g")
            .attr("class", "y axis");

        var x = d3.scale.linear();
        var x_axis = d3.svg.axis()
            .scale(x)
            .orient("bottom");
        var x_group = stage.append("g")
            .attr("class", "x axis");

        var offset = 0;

        var line = d3.svg.line()
            .defined(function(d) { return d !== undefined; })
            .x(function(d, i) { return x((grid.beg + i) - offset); })
            .y(function(d, i) { return y(d); });

        /* Initial display: 1024 px is 5 minutes of data */
        var factor = 300000 / 1024;
        var width = 300;
        var height = 300;

        var changing = false;

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
            var interval = grid.interval;
            var w = (width - margins.right) - margins.left;

            /* This doesn't yet work for an arbitary ponit in time */
            var end = Math.floor($.now() / interval);
            var beg = end - Math.floor((factor * w) / interval);
            offset = beg;
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

            /* This doesn't yet work for an arbitary ponit in time */
            var end = Math.floor((factor * w) / interval);
            x.domain([0, end]).range([0, w]);
            y.domain([0, ceil(maximum, tabs[metric].step)]).range([h, 0]);

            /* The ticks are inverted backwards */
            var tsc = d3.scale.linear().domain([0, end]).range([end, 0]);

            /* Calculate ticks every 60 seconds in past */
            var ticks = [];
            for (i = 60; i < end; i += 60)
                ticks.push(Math.round(tsc(i)));

            /* Make x-axis ticks into grid of right width */
            x_axis
                .tickValues(ticks)
                .tickSize(-h, -h)
                .tickFormat(function(d) {
                    d = Math.round(tsc.invert(d));
                    return (d / 60) + " min";
                });

            /* Re-render the X axis. Note that we also
             * bump down the labels a bit. */
            x_group
                .attr("transform", "translate(0," + h + ")")
                .call(x_axis)
              .selectAll("text")
                .attr("y", "10px");

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

        function notified() {
            var rows = grid.rows;

            var series = stage.selectAll("path.line")
                .data(rows, function(d, i) { return i; });

            var trans = series
                .style("stroke", function(d, i) { return colors(i); })
                .attr("d", function(d) { return line(d); })
                .classed("highlight", function(d) { return d.uid === highlighted; });

            series.enter().append("path")
                .attr("class", "line")
                .on("mouseover", function() {
                    highlighter(d3.select(this).datum().uid);
                })
                .on("mouseout", function() {
                    highlighter(null);
                });
            series.exit().remove();
        }

        $(grid).on("changed", adjust);
        $(grid).on("notify changed", notified);

        function resized() {
            width = $(selector).outerWidth() - 10;
            if (width < 0)
                width = 0;
            adjust();
        }

        $(window).on('resize', resized);
        resized();

        var timer = window.setInterval(jump, grid.interval);

        return {
            highlight: function highlight(uid) {
                highlighted = uid;
                notified();
            },
            close: function close() {
                $(window).off('resize', resized);
                window.clearInterval(timer);
                grid.close();
            }
        };
    }

    return angular.module('kubernetes.graph', [])
        .directive('kubernetesServiceGraph', function() {
            return {
                restrict: 'E',
                link: function($scope, element, attributes) {
                    var graph = service_graph(element[0], function(uid) {
                        $scope.$broadcast('highlight', uid);
                        $scope.$digest();
                    });
                    $scope.$on("highlight", function(ev, uid) {
                        graph.highlight(uid);
                    });
                    element.on('$destroy', function() {
                        graph.close();
                    });
                }
            };
        });
});
