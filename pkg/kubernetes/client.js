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
    "base1/cockpit",
    "kubernetes/config"
], function($, cockpit, config) {
    "use strict";

    var kubernetes = { };
    var _ = cockpit.gettext;

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
    function KubernetesWatch(api, prefix, type, update, remove) {
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

                /* The watch failed, likely due to invalid resourceVersion */
                if (action.type == "ERROR") {
                    if (lastResource) {
                        lastResource = null;
                        start_watch();
                    }
                    continue;
                }

                var meta = object.metadata;
                if (!meta || !meta.uid || object.apiVersion != "v1beta3" || !object.kind) {
                    console.warn("invalid kubernetes object: ", object);
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
                } else {
                    console.warn("invalid watch action type: " + action.type);
                }
            }
        }

        function start_watch() {
            var uri = "/" + prefix + "/v1beta3/watch/" + type;
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
                    var msg;
                    req = null;
                    if (!stopping) {
                        msg = "watching kubernetes " + type + " failed: " + ex;
                        if (ex.problem !== "disconnected")
                            console.warn(msg);
                        else
                            debug(msg);
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

    /*
     * A helper function that returns a Promise which tries to
     * connect to a kube-apiserver in various ways in turn.
     */
    function connect_api_server() {
        var dfd = $.Deferred();
        var req;

        var schemes = [
            { port: 8080 },
            { port: 8443, tls: { } },
            { port: 6443, tls: { } }
        ];

        function step() {
            var scheme = schemes.shift();

            /* No further ports to try? */
            if (!scheme) {
                var ex = new Error(_("Couldn't find running kube-apiserver"));
                ex.problem = "not-found";
                dfd.reject(ex);
                return;
            }

            var http = cockpit.http(scheme.port, scheme);

            /* The openshift request is done in parallel */
            var openshift = http.get("/osapi");

            req = http.get("/api")
                .done(function(data) {
                    req = null;

                    /*
                     * We expect a response that looks something like:
                     * { "versions": [ "v1beta1", "v1beta2", "v1beta3" ] }
                     */
                    var response;
                    try {
                        response = JSON.parse(data);
                    } catch(ex) {
                        debug("not an api endpoint without JSON data on:", scheme);
                        step();
                        return;
                    }
                    if (response && response.versions) {
                        debug("found kube-apiserver endpoint on:", scheme);
                        openshift.always(function() {
                            if (this.state() === "resolved")
                                response.flavor = "openshift";
                            else
                                response.flavor = "kubernetes";
                            dfd.resolve(http, response);
                        });
                    } else {
                        debug("not a kube-apiserver endpoint on:", scheme);
                        step();
                    }
                })
                .fail(function(ex) {
                    req = null;

                    if (ex.problem === "not-found") {
                        debug("api endpoint not found on:", scheme);
                        step();
                    } else {
                        if (ex.problem !== "cancelled")
                            debug("connecting to endpoint failed:", scheme, ex);
                        dfd.reject(ex);
                    }
                });
        }

        /* Load the kube config, and then try to start connecting */
        cockpit.spawn(["/usr/bin/kubectl", "config", "view", "--output=json", "--raw"])
            .fail(function(ex, output) {
                if (output)
                    console.warn(output);
                else
                    console.warn(ex);
            })
            .done(function(data) {
                var scheme = config.parse_scheme(data);
                debug("kube config scheme:", scheme);
                schemes.unshift(scheme);
            })
            .always(step);

        var promise = dfd.promise();
        promise.cancel = function cancel() {
            if (req)
                req.close("cancelled");
            return promise;
        };
        return promise;
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

        self.flavor = null;
        self.objects = { };

        /* Holds the connect api promise */
        var connected;

        /* The API info returned from /api */
        var apis;

        /*
         * connect:
         *
         * Starts connecting to the kube-apiserver if not connected.
         * This means figuring out which port kube-apiserver is
         * listening on, and retrieving API information.
         *
         * Returns a Promise.
         *
         * If already connected, the promise will already be
         * complete, and any done callbacks will happen
         * immediately.
         */
        self.connect = function connect() {
            if (connected)
                return connected;

            connected = connect_api_server();
            return connected
                .done(function(http, response) {
                    self.flavor = response.flavor;
                    watches.push(new KubernetesWatch(http, "api", "nodes",
                                                     handle_updated, handle_removed));
                    watches.push(new KubernetesWatch(http, "api", "pods",
                                                     handle_updated, handle_removed));
                    watches.push(new KubernetesWatch(http, "api", "services",
                                                     handle_updated, handle_removed));
                    watches.push(new KubernetesWatch(http, "api", "replicationcontrollers",
                                                     handle_updated, handle_removed));
                    watches.push(new KubernetesWatch(http, "api", "namespaces",
                                                     handle_updated, handle_removed));
                    watches.push(new KubernetesWatch(http, "api", "events",
                                                     handle_event, handle_removed));
                })
                .fail(function(ex) {
                    console.warn("Couldn't connect to kubernetes:", ex);
                });
        };

        /*
         * request:
         * @req: Object contaning cockpit.http().request() parameter
         *
         * Makes a request to kube-apiserver after connecting to it.
         * This API only supports req/resp style REST calls. For
         * others use the connect() method directly. In particular there
         * is no support for streaming.
         *
         * The promise returned will resolve when the request is done
         * with the full response data. Or fail when either connecting
         * to kubernetes fails, or the request itself fails.
         *
         * The returned Promise has a cancel() method.
         */
        self.request = function request(options) {
            var dfd = $.Deferred();

            var req = self.connect();
            req.done(function(http) {
                req = http.request(options)
                    .done(function() {
                        dfd.resolve.apply(dfd, arguments);
                    })
                .fail(function() {
                    dfd.reject.apply(dfd, arguments);
                });
            })
            .fail(function() {
                dfd.reject.apply(dfd, arguments);
            });

            var promise = dfd.promise();
            promise.cancel = function cancel() {
                if (req.cancel)
                    req.cancel();
                else
                    req.close("cancelled");
                return promise;
            };

            return promise;
        };

        /*
         * close:
         *
         * Close the connection to kubernetes, cancel any watches.
         * You can use connect() to connect again.
         */
        self.close = function close() {
            var w = watches;
            watches = [ ];
            $.each(w, function(i, wc) {
                wc.stop();
            });
            if (connected) {
                connected.cancel();
                connected = null;
            }
        };

        /* The watch objects we have open */
        var watches = [];

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

        function index_labels(uid, labels, namespace) {
            var keys, i;
            if (labels) {
                keys = [];
                for (i in labels)
                    keys.push(namespace + i + labels[i]);
                index.add(keys, uid);
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
            index_labels(uid, meta.labels, namespace);

            var spec = item.spec;
            if (spec) {
                index_labels(uid, spec.selector, namespace);
                if (spec.template && spec.template.metadata)
                    index_labels(uid, spec.template.metadata.labels, namespace);
            }

            /* Add the type for quick lookup */
            index.add( [ item.kind ], uid);

            /* Index the host for quick lookup */
            var status = item.status;
            if (spec && spec.host)
                index.add([ spec.host ], uid);

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

            self.request({ method: "GET", body: "", path: uri })
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
         * @template: Match the spec.template instead of labels directly
         *
         * Select objects that match the given labels.
         *
         * Returns: an array of objects
         */
        this.select = function select(selector, namespace, kind, template) {
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
            var meta, spec, labels, obj, uid, j, length = possible.length;
            for (j = 0; j < length; j++) {
                uid = possible[j];
                obj = self.objects[uid];
                if (!obj || !obj.metadata)
                    continue;
                meta = obj.metadata;
                if (meta.namespace !== namespace)
                    continue;

                labels = null;
                if (template) {
                    spec = obj.spec;
                    if (spec && spec.template && spec.template.metadata)
                        labels = spec.template.metadata.labels;
                } else {
                    labels = meta.labels;
                }

                if (selector && !labels)
                    continue;
                if (kind && obj.kind !== kind)
                    continue;
                match = true;
                for (i in selector) {
                    if (labels[i] !== selector[i]) {
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
         * @kind: limit to this kind of object
         *
         * Find out which objects are being hosted at the given node. These
         * have a obj.status.host property equal to the @host name passed into
         * this function.
         *
         * Returns: an array of kubernetes objects
         */
        this.hosting = function hosting(host, kind) {
            var possible = index.select([ host ]);
            var obj, j, length = possible.length;
            var results = [];
            for (j = 0; j < length; j++) {
                obj = self.objects[possible[j]];
                if (!obj || !obj.spec || obj.spec.host != host)
                    continue;
                if (kind && obj.kind !== kind)
                    continue;
                results.push(obj);
            }
            return results;
        };

        this.delete_pod = function delete_pod(ns, pod_name) {
            self.request({
                "method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/" + ns + "/pods/" + encodeURIComponent(pod_name)
            }).fail(failure);
        };

        this.delete_node = function delete_node(ns, nodes_name) {
            self.request({
                "method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/" + ns + "/nodes/" + encodeURIComponent(nodes_name)
            }).fail(failure);
        };

        this.delete_replicationcontroller = function delete_replicationcontroller(ns, rc_name) {
            self.request({
                "method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/" + ns + "/replicationcontrollers/" + encodeURIComponent(rc_name)
            }).fail(failure);
        };

        this.delete_service = function delete_service(ns, service_name) {
            self.request({
                "method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/" + ns + "/services/" + encodeURIComponent(service_name)
            }).fail(failure);
        };

        function DataError(message, ex) {
            this.problem = "invalid-data";
            this.message = message;
            this.cause = ex;
        }

        function kind_is_namespaced(kind) {
            return kind != "Node" && kind != "Namespace";
        }

        /**
         * create:
         * @items: A JSON string, array of kubernetes items, or one kubernetes item.
         * @namespace: Optional namespace, defaults to 'default'
         *
         * Create the @items in kubernetes.
         *
         * If the items are namespaced then the @namespace is used to place
         * them in. The @namespace defaults to the 'default' namespace. If
         * @namespace doesn't exist, then it is created first.
         *
         * Returns a Promise. The promise is done when all items are created.
         * If a failure occurs when creating the items, then the promise will
         * fail with the exception for the failed item, and item creation stops.
         *
         * The Promise progress is triggered with a descriptive string, and the
         * item being created.
         */
        this.create = function create(items, namespace) {
            var dfd = $.Deferred();
            var request = null;

            var promise = dfd.promise();

            if (typeof items == "string") {
                try {
                    items = JSON.parse(items);
                } catch(ex) {
                    console.warn(ex);
                    dfd.reject(new DataError(_("Invalid kubernetes application manifest"), ex));
                    return promise;
                }
            }

            if (!$.isArray(items)) {
                if (items.kind == "List")
                    items = items.items;
                else
                    items = [ items ];
            }

            var valid = true;
            var need_ns = false;
            var have_ns = false;

            if (!namespace)
                namespace = "default";

            /* Find the namespace in the items */
            items.forEach(function(item) {
                if (valid) {
                    /* The remainder of the errors are handled by kubernetes itself */
                    if (!item.kind || !item.metadata ||
                        item.apiVersion != "v1beta3" ||
                        typeof item.kind !== "string") {
                        dfd.reject(new DataError(_("Unsupported kubernetes object in data")));
                        valid = false;
                    }
                }
                if (item.metadata)
                    delete item.metadata.namespace;
                if (kind_is_namespaced (item.kind))
                    need_ns = true;
                if (item.kind == "Namespace" && item.metadata && item.metadata.name == namespace)
                    have_ns = true;
            });

            if (!valid)
                return promise;

            /* Shallow copy of the array, we modify it below */
            items = items.slice();

            /* Create the namespace if it exists */
            if (!have_ns && need_ns) {
                items.unshift({
                    "apiVersion" : "v1beta3",
                    "kind" : "Namespace",
                    "metadata" : {
                        "name": namespace
                    }
                });
            }

            function step() {
                var item = items.shift();
                if (!item) {
                    dfd.resolve();
                    return;
                }

                var kind = item.kind;
                var name = item.metadata.name || "";
                dfd.notify(kind + " " + name, item);

                /* Sad but true */
                var type = kind.toLowerCase() + "s";
                var url = "/api/v1beta3";
                if (kind_is_namespaced (kind))
                    url += "/namespaces/" + encodeURIComponent(namespace);
                url += "/" + type;

                debug("create item:", url, item);

                request = self.request({ method: "POST", path: url, body: JSON.stringify(item) })
                    .done(function(data) {
                        request = null;
                        var item;

                        try {
                            item = JSON.parse(data);
                        } catch(ex) {
                            console.log("received invalid JSON response from kubernetes", ex);
                            return;
                        }

                        debug("created item:", url, item);

                        handle_updated(item, type);
                        step();
                    })
                    .fail(function(ex, data) {
                        var response = null;
                        request = null;

                        if (data) {
                            try {
                                response = JSON.parse(data);
                            } catch(e) { }
                        }

                        /* Ignore failures to create the namespace if it already exists */
                        if (kind == "Namespace" && response && response.code === 409) {
                            debug("skipping namespace creation");
                            step();
                        } else {
                            debug("create failed:", url, ex, response);
                            if (ex.problem == "not-found") {
                                if (ex.status == 404)
                                    ex.message = _("Unsupported or incompatible kubernetes API server.");
                                else
                                    ex.message = _("Could not connect to kubernetes API server.");
                            }
                            dfd.reject(ex, response);
                        }
                    });
            }

            step();

            promise.cancel = function cancel() {
                if (request)
                    request.cancel();
            };
            return promise;
        };

        this.modify = function modify(link, callback) {
            var dfd = $.Deferred();

            if (link.metadata)
                link = link.metadata.selfLink;

            var req = self.request({ method: "GET", path: link, body: "" })
                .fail(function(ex) {
                    dfd.reject(ex);
                })
                .done(function(data) {
                    var item = JSON.parse(data);

                    if (callback(item) === false) {
                        dfd.resolve();
                        return;
                    }

                    req = self.request({ method: "PUT", body: JSON.stringify(item), path: link })
                        .fail(function(ex) {
                            dfd.reject(ex);
                        })
                        .done(function() {
                            dfd.resolve();
                        });
                });

            var promise = dfd.promise();
            promise.cancel = function cancel() {
                req.cancel();
            };

            return promise;
        };

        self.connect();
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

    function CAdvisor(node) {
        var self = this;

        /* cAdvisor has second intervals */
        var interval = 1000;

        var kube = kubernetes.k8client();

        var last = null;

        var unique = 0;

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
            var signal, id;
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
                    signal = !(id in self.specs);
                    self.specs[id] = container.spec;
                    if (signal) {
                        $(self).triggerHandler("container", [ id ]);
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
                        names[name] = name;
                    }
                }
            }

            /* Make sure each offset has something */
            len = items.length;
            for (i = 0; i < len; i++) {
                if (items[i] === undefined)
                    items[i] = { };
            }

            /* Now for each offset, if it's a duplicate, put in a copy */
            for(name in names) {
                len = items.length;
                last = undefined;
                for (i = 0; i < len; i++) {
                    if (items[i][name] === undefined)
                        items[i][name] = last;
                    else
                        last = items[i][name];
                }
            }

            self.series.input(base, items, mapping);
        }

        function request(query) {
            var body = JSON.stringify(query);

            /* Only one request active at a time for any given body */
            if (body in requests)
                return;

            var req = kube.request({
                method: "POST",
                path: "/api/v1beta3/proxy/nodes/" + encodeURIComponent(node) + ":4194/api/v1.2/docker",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(query)
            });

            requests[body] = req;
            req.always(function() {
                delete requests[body];
            })
            .done(function(data) {
                feed(JSON.parse(data));
            })
            .fail(function(ex) {
                console.warn(ex);
            });
        }

        self.fetch = function fetch(beg, end) {
            var query;
            if (!beg || !end) {
                query = { num_stats: 60 };
            } else {
                query = {
                    start: new Date(beg * interval).toISOString(),
                    end: new Date(end * interval).toISOString()
                };
            }
            request(query);
        };

        self.close = function close() {
            for (var body in requests)
                requests[body].close();
            kube.close();
            kube = null;
        };

        var cache = "cadv1-" + (node || null);
        self.series = cockpit.series(interval, cache, self.fetch);
    }

    kubernetes.cadvisor = singleton(CAdvisor);

    return kubernetes;
});
