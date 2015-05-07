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
    "base1/cockpit"
], function($, cockpit) {
    "use strict";

    var kubernetes = { };

    function debug() {
        if (window.debugging == "all" || window.debugging == "kubernetes")
            console.debug.apply(console, arguments);
    }

    function failure(ex) {
        console.warn(ex);
    }

    function hash(str) {
        var h, i, chr, len;
        if (str.length === 0)
            return 0;
        for (h = 0, i = 0, len = str.length; i < len; i++) {
            chr = str.charCodeAt(i);
            h = ((h << 5) - h) + chr;
            h |= 0; // Convert to 32bit integer
        }
        return Math.abs(h);
    }

    /**
     * HashIndex
     * @size: the number of slots for hashing into
     *
     * A probablisting hash index, where items are added with
     * various keys, and probable matches are returned. Similar
     * to bloom filters, false positives are possible, but never
     * false negatives.
     */
    function HashIndex(size) {
        var self = this;
        var array = [];

        self.add = function add(keys, value) {
            var i, j, p, length = keys.length;
            for (j = 0; j < length; j++) {
                i = hash("" + keys[j]) % size;
                p = array[i];
                if (p === undefined)
                    p = array[i] = [];
                p.push(value);
            }
        };

        self.select = function select(keys) {
            var i, j, interim = [], length = keys.length;
            for (j = 0; j < length; j++) {
                i = hash("" + keys[j]) % size;
                interim.push.apply(interim, array[i] || []);
            }

            /* Filter unique out */
            var result = [];
            interim.sort();
            length = interim.length;
            for (j = 0; j < length; j++) {
                if (interim[j - 1] !== interim[j])
                    result.push(interim[j]);
            }
            return result;
        };
    }

    /*
     * KubernetesWatch:
     * @api: a cockpit.http() object for the api server
     * @type: a string like 'pods' or 'nodes'
     * @update: invoked when ADDED or MODIFIED happens
     * @remove: invoked when DELETED happens
     *
     * Generates callbacks based on a Kubernetes watch.
     *
     * Each KubernetesWatch object watches a single type of object
     * in Kubernetes. The URI watched is /api/v1beta3/watch/<type>
     *
     * In addition to the above noted invocations of the callbacks,
     * if there is an ERROR, we restart the watch and invoke the
     * @remove callback with a null argument to indicate we are
     * starting over.
     */
    function KubernetesWatch(api, type, update, remove) {
        var self = this;

        var lastResource;
        var stopping = false;
        var req = null;
        var wait = null;
        var objects = { };

        /*
         * Each change is sent as an individual line from Kubernetes
         * but they may not arrive exactly that way, so we buffer
         * and split lines again.
         */

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

                var meta = object.metadata;
                if (!meta || !meta.uid || object.apiVersion != "v1beta3" || !object.kind) {
                    console.warn("invalid kubernetes object: ", Object.keys(object).join(", "));
                    continue;
                }

                lastResource = meta.resourceVersion;

                if (action.type == "ADDED") {
                    objects[meta.uid] = object;
                    update(object, type);
                } else if (action.type == "MODIFIED") {
                    objects[meta.uid] = object;
                    update(object, type);
                } else if (action.type == "DELETED") {
                    delete objects[meta.uid];
                    remove(object, type);

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
            var all, uid;

            /*
             * If we have a last resource we can guarantee that we don't miss
             * any objects or changes to objects. If we don't have one, then we
             * have to list everything again. Still watch at the same time though.
             */
            if (lastResource) {
                uri += "?resourceVersion=" + encodeURIComponent(lastResource);

            /* Tell caller to remove all objects */
            } else {
                all = objects;
                objects = { };
                for (uid in all)
                    remove(all[uid], type);
            }

            /*
             * As a precaution, watch must take at least 1 second
             * to complete. Otherwise we could be in a tight loop here.
             * eg: if the API of Kubernetes changes unpredictably.
             */
            var blocked = false;
            window.setTimeout(function() {
                blocked = true;
            }, 1000);

            if (req) {
                req.cancelled = true;
                req.close();
            }

            req = api.get(uri)
                .stream(handle_watch)
                .fail(function(ex) {
                    req = null;
                    if (!stopping) {
                        console.warn("watching kubernetes " + type + " failed: " + ex);
                        wait = window.setTimeout(function() { wait = null; start_watch(); }, 5000);
                    }
                })
                .done(function(data) {
                    var cancelled = req && req.cancelled;
                    req = null;
                    if (!stopping && !cancelled) {
                        if (!blocked) {
                            console.warn("watching kubernetes " + type + " didn't block");
                            wait = window.setTimeout(function() { wait = null; start_watch(); }, 5000);
                        } else {
                            start_watch();
                        }
                    }
                });
        }

        start_watch();

        self.stop = function stop() {
            stopping = true;
            if (req)
                req.close();
            window.clearTimeout(wait);
            wait = null;
        };
    }

    /**
     * KubernetesClient
     *
     * Properties:
     *  * objects: a dict of all the loaded kubernetes objects,
     *             with the 'uid' as the key
     *  * resourceVersion: latest resourceVersion seen
     */
    function KubernetesClient() {
        var self = this;

        var api = cockpit.http(8080);
        self.objects = { };

        /* TODO: Derive this value from cluster size */
        var index = new HashIndex(262139);
        self.resourceVersion = null;

        /* Flattened properties by type, see getters below */
        var flats = { };

        /* Event timeouts, for collapsing events */
        var timeouts = { };

        function trigger(type, kind) {
            delete flats[kind];
            if (!(type in timeouts)) {
                timeouts[type] = window.setTimeout(function() {
                    delete timeouts[type];
                    $(self).triggerHandler(type);
                }, 100);
            }
        }

        function handle_updated(item, type) {
            var meta = item.metadata;

            debug("item", item);

            if (meta.resourceVersion && meta.resourceVersion > self.resourceVersion)
                self.resourceVersion = meta.resourceVersion;

            var uid = meta.uid;
            var namespace = meta.namespace;

            self.objects[uid] = item;

            /* Add various bits to index, for quick lookup */
            var i, keys, length;
            if (meta.labels) {
                keys = [];
                for (i in meta.labels)
                    keys.push(namespace + i + meta.labels[i]);
                index.add(keys, uid);
            }
            var spec = item.spec;
            if (spec && spec.selector) {
                keys = [];
                for (i in spec.selector)
                    keys.push(namespace + i + spec.selector[i]);
                index.add(keys, uid);
            }

            /* Add the type for quick lookup */
            index.add( [ item.kind ], uid);

            /* Index the host for quick lookup */
            var status = item.status;
            if (status && status.host)
                index.add([ status.host ], uid);

            trigger(type, item.kind);
        }

        function handle_removed(item, type) {
            var key = item.metadata.uid;
            debug("remove", item);
            delete self.objects[key];
            trigger(type, item.kind);
        }

        var pulls = { };
        var pull_timeout;

        function pull_later(involved) {
            pulls[involved.uid] = involved;

            if (!pull_timeout) {
                pull_timeout = window.setTimeout(function() {
                    var items = Object.keys(pulls).map(function(uid) {
                        return pulls[uid];
                    });

                    pulls = { };
                    pull_timeout = null;

                    items.forEach(function(item) {
                        pull_involved(item);
                    });
                }, 500);
            }
        }

        function pull_involved(involved) {
            var item = self.objects[involved.uid];

            if (item && involved.resourceVersion < item.metadata.resourceVersion)
                return;

            var uri = "/api/v1beta3";

            if (involved.namespace)
                uri += "/namespaces/" + encodeURIComponent(involved.namespace);

            var type = involved.kind.toLowerCase() + "s";
            uri += "/" + type + "/" + involved.name;

            debug("pulling", uri);

            api.get(uri)
                .fail(function(ex) {
                    if (ex.status == 404) {
                        item = self.objects[involved.uid];
                        if (item) {
                            handle_removed(item, type);
                        }
                    } else {
                        console.warn("couldn't get involved object", uri, involved.name, ex);
                    }
                })
                .done(function(data) {
                    var item = JSON.parse(data);
                    if (item && item.metadata && item.metadata.uid == involved.uid) {
                        handle_updated(item, type);
                    }
                });
        }

        function handle_event(item, type) {
            var involved = item.involvedObject;
            if (involved)
                pull_later(involved);
            handle_updated(item, type);
        }

        var watches = [
            new KubernetesWatch(api, "nodes", handle_updated, handle_removed),
            new KubernetesWatch(api, "pods", handle_updated, handle_removed),
            new KubernetesWatch(api, "services", handle_updated, handle_removed),
            new KubernetesWatch(api, "replicationcontrollers", handle_updated, handle_removed),
            new KubernetesWatch(api, "namespaces", handle_updated, handle_removed),
            new KubernetesWatch(api, "events", handle_event, handle_removed),
        ];

        function name_compare(a1, a2) {
            return (a1.metadata.name || "").localeCompare(a2.metadata.name || "");
        }

        function timestamp_compare(a1, a2) {
            return (a1.firstTimestamp || "").localeCompare(a2.firstTimestamp || "");
        }

        function basic_items_getter(kind, compare) {
            var possible, item, i, len;
            var flat = flats[kind];
            if (!flat) {
                flat = [];
                possible = index.select([kind]);
                len = possible.length;
                for (i = 0; i < len; i++) {
                    item = self.objects[possible[i]];
                    if (item && item.kind == kind)
                        flat.push(item);
                }
                flat.sort(compare);
                flats[kind] = flat;
            }
            return flat;
        }

        Object.defineProperties(self, {
            nodes: {
                enumerable: true,
                get: function() { return basic_items_getter("Node", name_compare); }
            },
            pods: {
                enumerable: true,
                get: function() { return basic_items_getter("Pod", name_compare); }
            },
            services: {
                enumerable: true,
                get: function() { return basic_items_getter("Service", name_compare); }
            },
            replicationcontrollers: {
                enumerable: true,
                get: function() { return basic_items_getter("ReplicationController", name_compare); }
            },
            namespaces: {
                enumerable: true,
                get: function() { return basic_items_getter("Namespace", name_compare); }
            },
            events: {
                enumerable: true,
                get: function() { return basic_items_getter("Event", timestamp_compare); }
            }
        });

        /**
         * client.select()
         * @selector: plain javascript object, JSON label selector
         * @namespace: the namespace to act in
         * @type: optional kind string (eg: 'Pod')
         *
         * Select objects that match the given labels.
         *
         * Returns: an array of objects
         */
        this.select = function select(selector, namespace, kind) {
            var i, keys;
            var possible, match, results = [];
            if (selector) {
                keys = [];
                for (i in selector)
                    keys.push(namespace + i + selector[i]);
                possible = index.select(keys);
            } else {
                possible = Object.keys(self.objects);
            }
            var meta, obj, uid, j, length = possible.length;
            for (j = 0; j < length; j++) {
                uid = possible[j];
                obj = self.objects[uid];
                if (!obj || !obj.metadata)
                    continue;
                meta = obj.metadata;
                if (meta.namespace !== namespace)
                    continue;
                if (selector && !meta.labels)
                    continue;
                if (kind && obj.kind !== kind)
                    continue;
                match = true;
                for (i in selector) {
                    if (meta.labels[i] !== selector[i]) {
                        match = false;
                        break;
                    }
                }
                if (match)
                    results.push(obj);
            }
            return results;
        };

        /**
         * client.infer()
         * @labels: plain javascript object, JSON labels
         * @namespace: the namespace to act in
         * @kind: optional kind string
         *
         * Infer which objects that have selectors would have
         * matched the given labels.
         */
        this.infer = function infer(labels, namespace, kind) {
            var i, keys;
            var possible, match, results = [];
            if (labels) {
                keys = [];
                for (i in labels)
                    keys.push(namespace + i + labels[i]);
                possible = index.select(keys);
            } else {
                possible = Object.keys(self.objects);
            }
            var obj, uid, j, length = possible.length;
            for (j = 0; j < length; j++) {
                uid = possible[j];
                obj = self.objects[uid];
                if (!obj || !obj.metadata || !obj.spec || !obj.spec.selector)
                    continue;
                if (obj.metadata.namespace !== namespace)
                    continue;
                if (kind && obj.kind !== kind)
                    continue;
                match = true;
                if (labels) {
                    for (i in obj.spec.selector) {
                        if (labels[i] !== obj.spec.selector[i]) {
                            match = false;
                            break;
                        }
                    }
                }
                if (match)
                    results.push(obj);
            }
            return results;
        };

        /**
         * client.hosting()
         * @host: the node host name, required
         *
         * Find out which objects are being hosted at the given node. These
         * have a obj.status.host property equal to the @host name passed into
         * this function.
         *
         * Returns: an array of kubernetes objects
         */
        this.hosting = function hosting(host) {
            var possible = index.select([ host ]);
            var obj, j, length = possible.length;
            var results = [];
            for (j = 0; j < length; j++) {
                obj = self.objects[possible[j]];
                if (obj && obj.status && obj.status.host === host)
                    results.push(obj);
            }
            return results;
        };

        this.delete_pod = function delete_pod(ns, pod_name) {
            api.request({
                "method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/" + ns + "/pods/" + encodeURIComponent(pod_name)
            }).fail(failure);
        };

        this.delete_node = function delete_node(ns, nodes_name) {
            api.request({
                "method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/" + ns + "/nodes/" + encodeURIComponent(nodes_name)
            }).fail(failure);
        };

        this.delete_replicationcontroller = function delete_replicationcontroller(ns, rc_name) {
            api.request({
                "method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/" + ns + "/replicationcontrollers/" + encodeURIComponent(rc_name)
            }).fail(failure);
        };

        this.delete_service = function delete_service(ns, service_name) {
            api.request({
                "method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/" + ns + "/services/" + encodeURIComponent(service_name)
            }).fail(failure);
        };

        this.create_ns = function create_ns(ns_json) {
            return api.post("/api/v1beta3/namespaces", ns_json);
        };

        this.create_replicationcontroller = function create_replicationcontroller(ns, replicationcontroller_json) {
            return api.post("/api/v1beta3/namespaces/" + ns + "/replicationcontrollers", replicationcontroller_json);
        };

        this.create_node = function create_node(ns, node_json) {
            api.post("/api/v1beta3/namespaces/" + ns + "/nodes", node_json)
                .fail(failure);
        };

        this.create_pod = function create_pod(ns, pod_json) {
            return api.post("/api/v1beta3/namespaces/" + ns + "/pods", pod_json);
        };

        this.create_service = function create_service(ns, service_json) {
            return api.post("/api/v1beta3/namespaces/" + ns + "/services", service_json);
        };

        this.update_replicationcontroller = function update_replicationcontroller(ns, rc_json, rc_name) {
            api.request({
                "method": "PUT",
                "body": rc_json,
                "path": "/api/v1beta3/namespaces/" + ns + "/replicationcontrollers/" + encodeURIComponent(rc_name)
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
        var reqs = [];
        var later;

        function receive(data, what ,kind) {
            var resp = JSON.parse(data);
            self[what] = resp;

            if (!first)
                $(self).triggerHandler(what, [ self[what] ]);
        }

        function update() {

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

        self.close = function close() {
            var r = reqs;
            reqs = [];
            r.forEach(function(req) {
                req.close();
            });
        };
    }

    /*
     * Returns a new instance of Constructor for each
     * key passed into the returned function. Multiple
     * callers for the same key will get the same instance.
     *
     * Overrides .close() on the instances, to close when
     * all callers have closed.
     *
     * Instances must accept zero or one primitive arguments,
     * and must have zero arguments in their .close() method.
     */
    function singleton(Constructor) {
        var cached = { };

        return function(key) {
            var str = key + "";

            var item = cached[str];
            if (item) {
                item.refs += 1;
                return item.obj;
            }

            item = { refs: 1, obj: new Constructor(key) };
            var close = item.obj.close;
            item.obj.close = function close_singleton() {
                item.refs -= 1;
                if (item.refs === 0) {
                    delete cached[str];
                    if (close)
                        close.apply(item.obj);
                }
            };

            cached[str] = item;
            return item.obj;
        };
    }

    kubernetes.k8client = singleton(KubernetesClient);
    kubernetes.etcdclient = singleton(EtcdClient);

    return kubernetes;
});
