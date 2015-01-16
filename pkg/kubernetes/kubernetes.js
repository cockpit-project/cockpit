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

    function KubernetesClient() {
        var self = this;

        var api = cockpit.http(8080);
        var first = true;

        self.minions = [ ];
        self.pods = [ ];
        self.services = [ ];

        var later;
        var monitor = new EtcdMonitor();
        $(monitor).on("changed", function() {
            if (!later) {
                later = window.setTimeout(function() {
                    later = null;
                    update();
                }, 200);
            }
        });

        function receive(data, what) {
            var resp = JSON.parse(data);
            if (!resp.items)
                return;
            resp.items.sort(function(a1, a2) {
                return (a1.id || "").localeCompare(a2.id || "");
            });
            self[what] = resp.items;
            if (!first)
                $(self).triggerHandler(what, [ self[what] ]);
        }

        function failure(ex) {
            console.warn(ex);
        }

        function update() {
            var reqs = [];

            reqs.push(api.get("/api/v1beta1/minions")
                .fail(failure)
                .done(function(data) {
                    receive(data, "minions");
                }));

            reqs.push(api.get("/api/v1beta1/pods")
                .fail(failure)
                .done(function(data) {
                    receive(data, "pods");
                }));

            reqs.push(api.get("/api/v1beta1/services")
                .fail(failure)
                .done(function(data) {
                    receive(data, "services");
                }));

            if (first) {
                $.when.apply($, reqs)
                    .always(function() {
                        first = false;
                        $(self).triggerHandler("minions", [ self.minions ]);
                        $(self).triggerHandler("services", [ self.services ]);
                        $(self).triggerHandler("pods", [ self.pods ]);
                    });
            }
        }

        update();

        self.close = function close() {
            monitor.close();
        };
    }

    kubernetes.client = function client() {
        return new KubernetesClient();
    };

    kubernetes.discover = function discover(address, callback) {
        var self = this;

        var client;
        var store = { };

        var result = {
            close: function() {
                if (client)
                    client.close();
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
        client = new KubernetesClient();

        $(client).on("minions", function(event, data) {
            var changed = false;
            var seen = { };

            $.each(store, function(id) {
                seen[id] = id;
            });

            /* Keep the master around */
            delete seen[""];

            $.each(data, function(i, minion) {
                var id = minion.id, node;
                if (id) {
                    delete seen[id];
                    node = store[id];
                    if (!node) {
                        changed = true;
                        node = { };
                        store[id] = node;
                    }
                    node.address = minion.id;
                    node.internal = minion;
                }
            });

            $.each(seen, function(id) {
                changed = true;
                delete store[id];
            });

            if (changed)
                send();
        });

        $(client).on("pods", function(event, data) {

            /* Clear all pods */
            store[""].objects = { };
            $.each(store, function(id, node) {
                node.objects = { };
            });

            /* Fill them back in */
            $.each(data, function(i, item) {
                var pod;
                if (item.id) {
                    var label = item.labels && item.labels.name ? item.labels.name : item.id;

                    pod = {
                        location: "pod/" + item.id,
                        label: cockpit.format(_("Pod: $0"), label),
                        internal: item,
                    };

                    var reason/* = item.status*/;
                    if (item.currentState)
                        reason = item.currentState.status;
                    else if (item.desiredState)
                        reason = item.desiredState.status;

                    if (reason == "Waiting")
                        pod.state = "waiting";
                    else if (reason == "Running")
                        pod.state = "running";
                    else
                        pod.state = "unknown";

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
                }
            });

            /* TODO: Use resourceVersion to optimize and not change unnecessarily */
            send();
        });

        return result;
    };

    return kubernetes;
});
