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

(function() {
    "use strict";

    var angular = require('angular');
    var d3 = require('d3');

    require('./kube-client');
    require('./kube-client-cockpit');
    require('./utils');

    angular.module('kubernetes.graph', [
        'kubeClient',
        'kubeClient.cockpit',
        'kubeUtils',
    ])


    .factory('CAdvisorSeries', [
        "KubeRequest",
        "CockpitMetrics",
        "$exceptionHandler",
        "$timeout",
        function (KubeRequest, CockpitMetrics, $exceptionHandler, $timeout) {
            function CAdvisor(node) {
                var self = this;

                /* called when containers changed */
                var callbacks = [];

                /* cAdvisor has 10 second intervals */
                var interval = 10000;

                var last = { };

                var requests = { };

                /* Holds the container specs */
                self.specs = { };

                function feed(containers) {
                    var x, y, ylen, i, len;
                    var item, offset, timestamp, container, stat;

                    /*
                     * The cAdvisor data doesn't seem to have inherent guarantees of
                     * continuity or regularity. In theory each stats object can have
                     * it's own arbitrary timestamp ... although in practice they do
                     * generally follow the interval to within a few milliseconds.
                     *
                     * So we first look for the lowest timestamp, treat that as our
                     * base index, and then batch the data based on that.
                     */

                    var first = null;

                    for (x in containers) {
                        container = containers[x];
                        if (container.stats) {
                            len = container.stats.length;
                            for (i = 0; i < len; i++) {
                                timestamp = container.stats[i].timestamp;
                                if (timestamp) {
                                    if (first === null || timestamp < first)
                                        first = timestamp;
                                }
                            }
                        }
                    }

                    if (first === null)
                        return;

                    var base = Math.floor(new Date(first).getTime() / interval);

                    var items = [];
                    var name, mapping = { };
                    var new_ids = [];
                    var id;
                    var names = { };

                    for (x in containers) {
                        container = containers[x];

                        /*
                         * This builds the correct type of object graph for the
                         * paths seen in grid.add() to operate on
                         */
                        name = container.name;
                        if (!name)
                            continue;

                        names[name] = name;
                        mapping[name] = { "": name };
                        id = name;

                        if (container.aliases) {
                            ylen = container.aliases.length;
                            for (y = 0; y < ylen; y++) {
                                mapping[container.aliases[y]] = { "": name };

                                /* Try to use the real docker container id as our id */
                                if (container.aliases[y].length === 64)
                                    id = container.aliases[y];
                            }
                        }

                        if (id && container.spec) {
                            if (!self.specs[id]) {
                                self.specs[id] = container.spec;
                                new_ids.push(id);
                            }
                        }

                        if (container.stats) {
                            len = container.stats.length;
                            for (i = 0; i < len; i++) {
                                stat = container.stats[i];
                                if (!stat.timestamp)
                                    continue;

                                /* Convert the timestamp into an index */
                                offset = Math.floor(new Date(stat.timestamp).getTime() / interval);

                                item = items[offset - base];
                                if (!item)
                                    item = items[offset - base] = { };
                                item[name] = stat;
                            }
                        }
                    }

                    if (new_ids.length > 0)
                        invokeCallbacks(new_ids);

                    /* Make sure each offset has something */
                    len = items.length;
                    for (i = 0; i < len; i++) {
                        if (items[i] === undefined)
                            items[i] = { };
                    }

                    /* Now for each offset, if it's a duplicate, put in a copy */
                    for(name in names) {
                        len = items.length;
                        for (i = 0; i < len; i++) {
                            if (items[i][name] === undefined)
                                items[i][name] = last[name];
                            else
                                last[name] = items[i][name];
                        }
                    }

                    self.series.input(base, items, mapping);
                }

                function request(query) {
                    var body = JSON.stringify(query);

                    /* Only one request active at a time for any given body */
                    if (body in requests)
                        return;

                    var path = "/api/v1/proxy/nodes/" + encodeURIComponent(node) + ":4194/api/v1.2/docker";
                    var req = KubeRequest("POST", path, query);

                    requests[body] = req;
                    req.then(function(data) {
                        delete requests[body];
                        feed(data.data);
                    })
                    .catch(function(ex) {
                        delete requests[body];
                        if (ex.status != 503)
                            console.warn(ex);
                    });
                }

                function invokeCallbacks(/* ... */) {
                    var i, len, func;
                    for (i = 0, len = callbacks.length; i < len; i++) {
                        func = callbacks[i];
                        try {
                            if (func)
                                func.apply(self, arguments);
                        } catch (e) {
                            $exceptionHandler(e);
                        }
                    }
                }

                self.fetch = function fetch(beg, end) {
                    var query;
                    if (!beg || !end) {
                        query = { num_stats: 60 };
                    } else {
                        query = {
                            start: new Date((beg - 1) * interval).toISOString(),
                            end: new Date(end * interval).toISOString()
                        };
                    }
                    request(query);
                };

                self.close = function close() {
                    var req, body;
                    for (body in requests) {
                        req = requests[body];
                        if (req && req.cancel)
                            req.cancel();
                    }
                };

                self.watch = function watch(callback) {
                    var ids;
                    var timeout;
                    callbacks.push(callback);
                    if (self.specs) {
                        ids = Object.keys(self.specs);
                        if (ids.length > 0) {
                            timeout = $timeout(function() {
                                timeout = null;
                                callback.call(self, ids);
                            }, 0);
                        }
                    }

                    return {
                        cancel: function() {
                            var i, len;
                            $timeout.cancel(timeout);
                            timeout = null;
                            for (i = 0, len = callbacks.length; i < len; i++) {
                                if (callbacks[i] === callback)
                                    callbacks[i] = null;
                            }
                        }
                    };
                };

                var cache = "cadv1-" + (node || null);
                self.series = CockpitMetrics.series(interval, cache, self.fetch);
            }

            return {
                new_cadvisor: function(node) {
                    return new CAdvisor(node);
                },
            };
        }
    ])

    .factory('ServiceGrid', [
        "CAdvisorSeries",
        "CockpitMetrics",
        "kubeSelect",
        "kubeLoader",
        function ServiceGrid(CAdvisorSeries, CockpitMetrics, select, loader) {
            function CockpitServiceGrid(until) {
                var self = CockpitMetrics.grid(10000, 0, 0);

                /* All the cadvisors that have been opened, one per host */
                var cadvisors = { };

                /* Service uids */
                var services = { };

                /* The various rows being shown, override */
                self.rows = [ ];
                self.events = [ ];

                var change_queued = false;
                var current_metric = null;

                var rows = {
                    cpu: { },
                    memory: { },
                    network: { }
                };

                var container_cpu = { };
                var container_mem = { };
                var container_rx = { };
                var container_tx = { };

                /* Track Pods and Services */
                loader.listen(function() {
                    var changed = false;
                    var seen_services = {};
                    var seen_hosts = {};

                    /* Lookup all the services */
                    angular.forEach(select().kind("Service"), function(service) {
                        var spec = service.spec;
                        var meta = service.metadata;
                        var name = meta.name;

                        if (!spec || !spec.selector || name === "kubernetes" || name === "kubernetes-ro")
                            return;

                        var uid = meta.uid;
                        var pods = select().kind("Pod")
                                           .namespace(meta.namespace || "")
                                           .label(spec.selector || {});

                        seen_services[uid] = true;
                        if (!services[uid])
                            add_service(uid);

                        /* Lookup all the pods for each service */
                        angular.forEach(pods, function(pod) {
                            var status = pod.status || { };
                            var spec = pod.spec || { };
                            var host = spec.nodeName;
                            var container_ids = {};
                            var containers = status.containerStatuses || [];
                            var i;
                            var mapped = services[uid];

                            seen_hosts[host] = true;
                            if (host && !cadvisors[host]) {
                                add_cadvisor(host);
                            }

                            /* Note all the containers for that pod */
                            for (i = 0; i < containers.length; i++) {
                                var container = containers[i];
                                var id = container.containerID;
                                if (id && id.indexOf("docker://") === 0) {
                                    container_ids[id] = id;
                                    id = id.substring(9);
                                    container_ids[id] = id;
                                    if (!mapped || !mapped[id])
                                        changed = true;
                                }
                            }
                            services[uid] = container_ids;
                        });
                    });

                    var k;
                    for (k in services) {
                        if (!seen_services[k]) {
                            remove_service(k);
                            changed = true;
                        }
                    }

                    for (k in cadvisors) {
                        if (!seen_hosts[k]) {
                            remove_host(k);
                            changed = true;
                        }
                    }

                    /* Notify for all rows */
                    if (changed)
                        self.sync();
                }, until);

                loader.watch("Pod", until);
                loader.watch("Service", until);

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
                    var cadvisor = CAdvisorSeries.new_cadvisor(host);
                    cadvisor.watch(function (ids) {
                        var i;
                        for (i = 0; i < ids.length; i++)
                            add_container(cadvisor, ids[i]);
                    });

                    /* A dummy row to force fetching data from the cadvisor */
                    self.add(cadvisor, [ "unused-dummy" ]);

                    /* TODO: Handle cadvisor failure somehow */
                    cadvisors[host] = cadvisor;
                }

                function remove_host(host) {
                    var cadvisor = cadvisors[host];
                    if (cadvisor) {
                        delete cadvisors[host];
                        cadvisor.close();
                        cadvisor = null;
                        change_queued = true;
                    }
                }

                function add_service(uid) {
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

                function remove_service(uid) {
                    delete services[uid];
                    delete rows.network[uid];
                    delete rows.cpu[uid];
                    delete rows.memory[uid];
                    change_queued = true;
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
                    var mapped = services[service];
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

                    var service_uids = Object.keys(services);
                    var row, i, len = service_uids.length;
                    for (i = 0; i < len; i++) {
                        row = rows[type][service_uids[i]];
                        if (row !== undefined) {
                            self.rows.push(row);
                            row.uid = service_uids[i];
                        }
                    }

                    var event = document.createEvent("CustomEvent");
                    event.initCustomEvent("changed", false, false, null);
                    self.dispatchEvent(event, null);
                };

                var base_close = self.close;
                self.close = function close() {
                    var hosts = Object.keys(cadvisors);
                    var i;
                    for (i = 0; i < hosts.length; i++) {
                        var k = hosts[i];
                        var cadvisor = cadvisors[k];
                        if (cadvisor) {
                            delete cadvisors[k];
                            cadvisor.close();
                            cadvisor = null;
                        }
                    }
                    base_close.apply(self);
                };

                self.addEventListener("notify", function () {
                    if (change_queued) {
                        change_queued = false;
                        self.metric(current_metric);
                    }
                });

                return self;
            }

            return {
                new_grid: function (until) {
                    return new CockpitServiceGrid(until);
                }
            };
        }
    ])

    .directive('kubernetesServiceGraph', [
        "ServiceGrid",
        "KubeTranslate",
        "KubeFormat",
        function kubernetesServiceGraph(ServiceGrid, KubeTranslate, KubeFormat) {
            var _ = KubeTranslate.gettext;

            function service_graph($scope, selector, highlighter) {
                var grid = ServiceGrid.new_grid($scope);
                var outer = d3.select(selector);

                var highlighted = null;

                /* Various tabs */

                var tabs = {
                    cpu: {
                        label: _("CPU"),
                        step: 1000 * 1000 * 1000 * 10,
                        formatter: function(v) { return (v / (100 * 1000 * 1000)) + "%"; }
                    },
                    memory: {
                        label: _("Memory"),
                        step: 1024 * 1024 * 64,
                        formatter: function(v) { return KubeFormat.formatBytes(v); }
                    },
                    network: {
                        label: _("Network"),
                        step: 1000 * 1000 * 10,
                        formatter: function(v) { return KubeFormat.formatBitsPerSec((v / 10), "Mbps"); }
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

                /* Initial display: 1024 px, 5 minutes of data */
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
                    var interval = grid.interval;
                    var w = (width - margins.right) - margins.left;
                    /* This doesn't yet work for an arbitary ponit in time */
                    var now = new Date().getTime();
                    var end = Math.floor(now / interval);
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
                    for (i = 6; i < end; i += 6)
                        ticks.push(Math.round(tsc(i)));

                    /* Make x-axis ticks into grid of right width */
                    x_axis
                        .tickValues(ticks)
                        .tickSize(-h, -h)
                        .tickFormat(function(d) {
                            d = Math.round(tsc.invert(d));
                            return (d / 6) + " min";
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

                    series
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

                grid.addEventListener('notify', notified);

                function changed() {
                    adjust();
                    notified();
                }

                grid.addEventListener('changed', changed);

                function resized() {
	                width = selector.offsetWidth - 10;
	                if (width < 0)
                        width = 0;
                    adjust();
                }

                window.addEventListener('resize', resized);
                resized();

                var timer = window.setInterval(function () {
                    if (!width)
                        resized();
                    else
                        jump();
                }, grid.interval);

                return {
                    highlight: function highlight(uid) {
                        highlighted = uid;
                        notified();
                    },
                    close: function close() {
                        if (timer)
                            window.clearInterval(timer);
                        timer = null;
                        window.removeEventListener('resize', resized);
                        grid.removeEventListener('notify', notified);
                        grid.removeEventListener('changed', changed);
                        grid.close();
                    }
                };
            }

            return {
                restrict: 'E',
                link: function($scope, element, attributes) {
                    var graph = service_graph($scope, element[0], function(uid) {
                        $scope.$broadcast('highlight', uid);
                        $scope.$digest();
                    });
                    $scope.$on("highlight", function(ev, uid) {
                        graph.highlight(uid);
                    });
                    element.on('$destroy', function() {
                        graph.close();
                        graph = null;
                    });
                }
            };
        }
    ]);
}());
