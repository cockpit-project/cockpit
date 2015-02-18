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

    cockpit.locale(po);
    var _ = cockpit.gettext;

    var kubernetes = { };

    function debug() {
        if (window.debugging == "all" || window.debugging == "kubernetes")
            console.debug.apply(console, arguments);
    }

    function failure(ex) {
        console.warn(ex);
    }

    function KubernetesWatch(api, type, update, remove) {
        var self = this;

        var lastResource;
        var stopping = false;
        var requested = false;
        var req = null;

        var buffer;
        function handle_watch(data) {
            if (buffer)
                data = buffer + data;

            var lines = data.split("\n");
            var i, length = lines.length - 1;

            /* Last line is incomplete save for later */
            buffer = lines[length];

            /* Process all the others */
            var action, object;
            for (i = 0; i < length; i++) {
                try {
                    action = JSON.parse(lines[i]);
                } catch (ex) {
                    failure(ex);
                    req.close();
                    continue;
                }

                object = action.object;
                if (!object) {
                    console.warn("invalid watch without object");
                    continue;
                }

                if (object.metadata)
                    lastResource = object.metadata.resourceVersion;
                else
                    lastResource = null;

                if (action.type == "ADDED") {
                    update(object);
                } else if (action.type == "MODIFIED") {
                    update(object);
                } else if (action.type == "DELETED") {
                    remove(object);

                    /* The watch failed, likely due to invalid resourceVersion */
                } else if (action.type == "ERROR") {
                    if (lastResource) {
                        lastResource = null;
                        start_watch();
                    }

                } else {
                    console.warn("invalid watch action type: " + action.type);
                    continue;
                }
            }
        }

        function start_watch() {
            var uri = "/api/v1beta3/watch/" + type;

            /*
             * If we have a last resource we can guarantee that we don't miss
             * any objects or changes to objects. If we don't have one, then we
             * have to list everything again. Still watch at the same time though.
             */
            if (requested && lastResource)
                uri += "?resourceVersion=" + encodeURIComponent(lastResource);

            /* Tell caller to remove all sources */
            else if (!requested)
                remove(null);

            /*
             * As a precaution, watch must take at least 1 second
             * to complete. Otherwise we could be in a tight loop here.
             * eg: if the API of Kubernetes changes unpredictably.
             */
            var waited = false;
            window.setTimeout(function() {
                waited = true;
            }, 1000);

            if (req) {
                req.cancelled = true;
                req.close();
            }

            req = api.get(uri)
                .stream(handle_watch)
                .fail(function(ex) {
                    req = null;
                    if (!stopping)
                        console.warn("watching kubernetes " + type + " failed: " + ex);
                })
                .done(function(data) {
                    var cancelled = req && req.cancelled;
                    req = null;
                    if (!stopping && !cancelled) {
                        if (!waited)
                            console.warn("watching kubernetes " + type + " didn't block");
                        else
                            start_watch();
                    }
                });
            requested = true;
        }

        start_watch();

        self.stop = function stop() {
            stopping = true;
            if (req)
                req.close();
        };
    }

    function KubernetesClient() {
        var self = this;

        var api = cockpit.http(8080);
        var watches = [ ];

        function bind(type, items) {
            var flat = null;
            var timeout;

            /* Always delay the update event a bit */
            function trigger() {
                flat = null;
                if (!timeout) {
                    timeout = window.setTimeout(function() {
                        timeout = null;
                        $(self).triggerHandler(type, self[type]);
                    }, 100);
                }
            }

            function update(items, item) {
                var key = item.metadata ? item.metadata.uid : null;
                if (!key) {
                    console.warn("kubernetes item without uid");
                    return;
                }
                items[key] = item;
                trigger();
            }

            function remove(items, item) {
                var key;
                if (!item) {
                    for (key in items)
                        delete items[key];
                } else {
                    key = item.metadata ? item.metadata.uid : null;
                    if (!key) {
                        console.warn("kubernetes item without uid");
                        return;
                    }
                    delete items[key];
                }
                trigger();
            }

            Object.defineProperty(self, type, {
                enumerable: true,
                get: function get() {
                    if (!flat) {
                        flat = [];
                        for (var key in items)
                            flat.push(items[key]);
                        flat.sort(function(a1, a2) {
                            return (a1.metadata.name || "").localeCompare(a2.metadata.name || "");
                        });
                    }
                    return flat;
                }
            });

            var wc = new KubernetesWatch(api, type,
                           function(item) { update(items, item); },
                           function(item) { remove(items, item); });
            watches.push(wc);
        }

        /* Define and bind various properties which are arrays of objects */

        var nodes = { };
        bind("nodes", nodes);

        var pods =  { };
        bind("pods", pods);

        var services = { };
        bind("services", services);

        var replicationcontrollers = { };
        bind("replicationcontrollers", replicationcontrollers);

        this.delete_pod = function delete_pod(pod_name) {
            api.request({"method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/default/pods/" + encodeURIComponent(pod_name)
            }).fail(failure);
        };

        this.delete_node = function delete_node(nodes_name) {
            api.request({"method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/default/nodes/" + encodeURIComponent(nodes_name)
            }).fail(failure);
        };

        this.delete_replicationcontroller = function delete_replicationcontroller(rc_name) {
            api.request({"method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/default/replicationcontrollers/" + encodeURIComponent(rc_name)
            }).fail(failure);
        };

        this.delete_service = function delete_service(service_name) {
            api.request({"method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/default/services/" + encodeURIComponent(service_name)
            }).fail(failure);
        };

        this.create_replicationcontroller = function create_replicationcontroller(replicationcontroller_json) {
            api.post("/api/v1beta3/namespaces/default/replicationcontrollers", replicationcontroller_json)
               .fail(failure);
        };

        this.create_node = function create_node(node_json) {
            api.post("/api/v1beta3/namespaces/default/nodes", node_json)
               .fail(failure);
        };

        this.create_pod = function create_pod(pod_json) {
            api.post("/api/v1beta3/namespaces/default/pods", pod_json)
               .fail(failure);
        };

        this.create_service = function create_pod(service_json) {
            api.post("/api/v1beta3/namespaces/default/services", service_json)
               .fail(failure);
        };

        this.update_replicationcontroller = function update_replicationcontroller(rc_json, rc_name) {
            api.request({"method": "PUT",
                "body": rc_json,
                "path": "/api/v1beta3/namespaces/default/replicationcontrollers/" + encodeURIComponent(rc_name)
            }).fail(failure);
        };

        self.close = function close() {
            var w = watches;
            watches = [ ];
            $.each(w, function(i, wc) {
                wc.stop();
            });
        };
    }

    function EtcdClient() {
        var self = this;

        var etcd_api = cockpit.http(7001);
        var first = true;
        var later;

        function receive(data, what ,kind) {
            var resp = JSON.parse(data);
            self[what] = resp;

            if (!first)
                $(self).triggerHandler(what, [ self[what] ]);
        }

        function update() {
            var reqs = [];

            reqs.push(etcd_api.get("/v2/admin/machines")
                .fail(failure)
                .done(function(data) {
                    receive(data, "etcdHosts");
                }));

            reqs.push(etcd_api.get("/v2/keys/coreos.com/network/config")
                .fail(failure)
                .done(function(data) {
                    receive(data, "flannelConfig");
                }));

            if (first) {
                $.when.apply($, reqs)
                    .always(function() {
                        first = false;
                        $(self).triggerHandler("etcdHosts", [ self.etcdHosts ]);
                    });
            }
        }

        update();
    }

    kubernetes.k8client = function client() {
        return new KubernetesClient();
    };

    kubernetes.etcdclient = function client() {
        return new EtcdClient();
    };

    return kubernetes;
});
