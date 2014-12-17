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

define([
    "jquery",
    "latest/cockpit",
    "latest/po"
], function($, cockpit, po) {
    "use strict";

    var _ = cockpit.locale(po).gettext;

    var kubernetes = { };

    function debug() {
        if (window.debugging == "all" || window.debugging == "kubernetes")
            console.debug.apply(console, arguments);
    }

    function EtcdMonitor() {
        var self = this;

        var etcd = cockpit.http(4001);
        var request;
        var timeout;

        function notify(index) {
            var params = { wait: true, recursive: true };
            if (index !== undefined)
                params["waitIndex"] = index;
            request = etcd.get("/v2/keys/", params)
                .done(function(data) {
                    var resp = { };
                    $(self).triggerHandler("changed");
                    if (data) {
                        try {
                            resp = JSON.parse(data);
                        } catch(ex) {
                            console.warn("etcd parse exception", ex, data);
                        }
                    }
                    var nindex;
                    if (resp.node && resp.node.modifiedIndex)
                        nindex = resp.node.modifiedIndex;
                    else if (resp.prevNode && resp.prevNode.modifiedIndex)
                        nindex = resp.prevNode.modifiedIndex;
                    if (nindex !== undefined) {
                        nindex++;
                        notify(nindex);
                    } else {
                        timeout = window.setTimeout(function() { notify(); }, 2000);
                    }
                })
                .fail(function(ex) {
                    request = null;
                    console.warn("etcd: " + ex.message);
                });
        }

        self.poke = function poke() {
            if (!request)
                notify();
        };

        self.close = function close() {
            if (request)
                request.close();
        };

        notify();
    }

    kubernetes.discover = function discover(address, callback) {
        var self = this;

        var monitor;
        var store = { };

        var result = {
            close: function() {
                if (monitor)
                    monitor.close();
            }
        };

        function send() {
            debug("kubernetes disco", store);
            callback(store);
        }

        /* We only ever discover kubernetes on the local machine */
        if (address && address != "localhost") {
            send();
            return result;
        }

        /* Always include this master machine in the mix */
        store[""] = { address: "localhost" };
        var api = cockpit.http(8080);
        var changed = false;
        var first = true;

        var later;
        monitor = new EtcdMonitor();
        $(monitor).on("changed", function() {
            if (!later) {
                later = window.setTimeout(function() {
                    later = null;
                    update();
                }, 200);
            }
        });

        function update_minions(data) {
            var seen = { };

            $.each(store, function(id) {
                seen[id] = id;
            });

            /* Keep the master around */
            delete seen[""];

            $.each(data, function(i, minion) {
                var id = minion.id, node;
                if (id) {
                    node = store[id];
                    if (!node) {
                        changed = true;
                        node = { };
                        store[id] = node;
                    }
                    node.address = minion.id;
                    node.internal = minion;
                    node.events = [ ];

                    if (!seen[id] && !first) {
                        node.events.push({
                            "id": "minion-available",
                            "message": _("Kubernetes minion has started")
                        });
                    }

                    delete seen[id];
                }
            });

            $.each(seen, function(id) {
                changed = true;
                delete store[id];
            });
        }

        function update_pods(data) {

            /* Clear all pods */
            store[""].objects = { };
            $.each(store, function(id, node) {
                node.objects = { };
            });

            /* DEMO Hack work around for kubernetes bug */
            var running = [];
            var waiting = [];

            /* Fill them back in */
            $.each(data, function(i, item) {
                var pod;
                if (item.id) {
                    var label = item.labels && item.labels.name ? item.labels.name : item.id;

                    pod = {
                        location: "pod/" + item.id,
                        label: cockpit.format(_("Pod: $0"), label),
                        internal: item,
                        events: [ ]
                    };

                    var started;
                    var reason/* = item.status*/;
                    if (item.currentState) {
                        reason = item.currentState.status;

                        if (item.currentState &&
                            item.currentState.info &&
                            item.currentState.info.net &&
                            item.currentState.info.net.state &&
                            item.currentState.info.net.state.running &&
                            item.currentState.info.net.state.running.startedAt) {
                            var ev = {
                                id: "started",
                                timestamp: Date.parse(item.currentState.info.net.state.running.startedAt)
                            };
                            if (item.currentState.host)
                                ev.message = cockpit.format(_("Started on $0"), item.currentState.host);
                            else
                                ev.message = _("Started pod");
                            pod.events.push(ev);
                        }
                    } else if (item.desiredState) {
                        reason = item.desiredState.status;
                    }

                    if (reason == "Waiting") {
                        pod.state = "waiting";
                        waiting.push(pod);
                    } else if (reason == "Terminated") {
                        pod.state = "stopped";
                    } else if (reason == "Running") {
                        pod.state = "running";
                        running.push(pod);
                    } else {
                        pod.state = "unknown";
                    }

                    if (reason)
                        pod.message = String(reason);

                    /* The host we want */
                    var node/* = item.host || ""*/;
                    if (item.currentState && item.currentState.host)
                        node = item.currentState.host;
                    else if (item.desiredState && item.desiredState.host)
                        node = item.desiredState.host;
                    if (!store[node])
                        node = "";
                    store[node].objects[pod.location] = pod;
                    changed = true;
                }
            });

            if (running.length > 0) {
                $.each(waiting, function(i, pod) {
                    pod.events.push({
                        id: "failed-schedule",
                        message: _("Failed to schedule due to constraint violation"),
                        priority: "crit",
                    });
                });
            }

            /* TODO: Use resourceVersion to optimize and not change unnecessarily */
            changed = true;
        }

        function update() {
            var reqs = [];

            reqs.push(api.get("/api/v1beta1/minions")
                .done(function(data) {
                    var resp = JSON.parse(data);
                    if (resp.items)
                        update_minions(resp.items);
                    if (!first && changed) {
                        changed = false;
                        send();
                    }
                })
                .fail(function(ex) {
                    console.warn(ex);
                }));

            reqs.push(api.get("/api/v1beta1/pods")
                .done(function(data) {
                    var resp = JSON.parse(data);
                    if (resp.items)
                        update_pods(resp.items);
                    if (!first && changed) {
                        changed = false;
                        send();
                    }
                })
                .fail(function(ex) {
                    console.warn(ex);
                }));

            if (first) {
                $.when.apply($, reqs)
                    .always(function() {
                        first = false;
                        send();
                    });
            }
        }

        update();
        return result;
    };

    return kubernetes;
});
