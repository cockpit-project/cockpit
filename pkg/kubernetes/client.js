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

    var API_KUBE = "/api";
    var API_OPENSHIFT = "/oapi";

    var TYPE_APIS = {
        "nodes" : {
            is_namespaced: false
         },
        "namespaces" : {
            is_namespaced: false
         },
        "images" : {
            endpoint: API_OPENSHIFT,
            is_namespaced: false
         },
        "imagestreams" : {
            endpoint: API_OPENSHIFT
         },
        "deploymentconfigs" : {
            endpoint: API_OPENSHIFT
         },
        "routes" : {
            endpoint: API_OPENSHIFT,
         },
    };

    function type_option(type, option, default_value) {
        var type_info = TYPE_APIS[type] || {};
        var ret = type_info[option];
        if (ret === undefined)
            ret = default_value;
        return ret;
    }

    function debug() {
        if (window.debugging == "all" || window.debugging == "kubernetes")
            console.debug.apply(console, arguments);
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

    function search(arr, val) {
        var low = 0;
        var high = arr.length - 1;
        var mid, v;

        while (low <= high) {
            mid = (low + high) / 2 | 0;
            v = arr[mid];
            if (v < val)
                low = mid + 1;
            else if (v > val)
                high = mid - 1;
            else
                return mid; /* key found */
        }
        return low;
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
            var i, j, p, x, length = keys.length;
            for (j = 0; j < length; j++) {
                i = hash("" + keys[j]) % size;
                p = array[i];
                if (p === undefined)
                    p = array[i] = [];
                x = search(p, value);
                if (p[x] != value)
                    p.splice(x, 0, value);
            }
        };

        self.all = function all(keys) {
            var i, j, p, result, n;
            var rl, rv, pv, ri, px;

            for (j = 0, n = keys.length; j < n; j++) {
                i = hash("" + keys[j]) % size;
                p = array[i];

                /* No match for this key, short cut out */
                if (!p) {
                    result = [];
                    break;
                }

                /* First key */
                if (!result) {
                    result = p.slice();

                /* Calculate intersection */
                } else {
                    for (ri = 0, px = 0, rl = result.length; ri < rl; ) {
                        rv = result[ri];
                        pv = p[ri + px];
                        if (pv < rv) {
                            px += 1;
                        } else if (rv !== pv) {
                            result.splice(ri, 1);
                            rl -= 1;
                        } else {
                            ri += 1;
                        }
                    }
                }
            }

            return result || [];
        };

        self.any = function any(keys) {
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

    function update_error_message(ex, response) {
        if (!response)
            return;

        var obj;
        try {
            obj = JSON.parse(response);
        } catch(e) {
            return;
        }

        if (obj && obj.message)
            ex.message = obj.message;
    }

    /*
     * KubernetesWatch:
     * @kind: a string like 'Pod' or 'Node'
     * @update: invoked when ADDED or MODIFIED happens
     * @remove: invoked when DELETED happens
     *
     * Generates callbacks based on a Kubernetes watch.
     *
     * Each KubernetesWatch object watches a single kind of object
     * in Kubernetes.
     *
     * In addition to the above noted invocations of the callbacks,
     * if there is an ERROR, we restart the watch and invoke the
     * @remove callback with a null argument to indicate we are
     * starting over.
     */
    function KubernetesWatch(type, update, remove) {
        var self = this;

        /* Used to track the last resource for restarting query */
        var lastResource;

        /* Whether close has been called */
        var stopping = false;

        /* The current HTTP request */
        var req = null;

        /* The API that we make HTTP requests to */
        var api = null;

        /* The namespace to restrict watches to */
        var namespace = null;

        /* The base api endpoint */
        var endpoint = type_option(type, "endpoint", API_KUBE);

        /*
         * Loading logic.
         *
         * For performance, we only use watches here. So we have
         * to guess when loading is finished and when updates begin.
         * There are several heuristics:
         *
         *  1) Receiving a MODIFY or DELETE means loading has finished.
         *  2) A timeout after last ADDED
         *  3) Error or connection closed.
         *
         * Remember that a watch object can restart its request for a number
         * of reasons, and so the loading/loaded state may go back and forth.
         *
         * When transitioning from a loading to a loaded state, we have to:
         *  a) Notify the caller if not already done
         *  b) See if any objects present before load need to be removed.
         */

        var loaded = $.Deferred();
        var objects = { };
        var previous;
        var loading;

        function load_begin(full) {
            if (full) {
                previous = objects;
                objects = { };
            } else {
                previous = null;
            }
            load_poke(true);
        }

        function load_poke(force) {
            if (force || loading !== undefined) {
                window.clearTimeout(loading);
                loading = window.setTimeout(load_ready, 100);
            }
        }

        function load_ready() {
            var key, prev;

            if (loading !== undefined) {
                window.clearTimeout(loading);
                loading = undefined;

                /* Notify caller about objects gone after reload */
                prev = previous;
                previous = null;
                if (prev) {
                    for (key in prev) {
                        if (!(key in objects)) {
                            remove(prev[key], type);
                        }
                    }
                }
            }

            if (!loaded.called) {
                loaded.called = true;
                if (loaded.state() == 'pending')
                    loaded.resolve();
            }
        }

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
                    console.warn(ex);
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
                if (!meta || !meta.uid || object.apiVersion != "v1" || !object.kind) {
                    console.warn("invalid kubernetes object: ", object);
                    continue;
                }

                lastResource = meta.resourceVersion;

                var uid = meta.uid;
                if (action.type == "ADDED") {
                    objects[uid] = object;
                    update(object, type);
                } else if (action.type == "MODIFIED") {
                    load_ready();
                    objects[uid] = object;
                    update(object, type);
                } else if (action.type == "DELETED") {
                    load_ready();
                    delete objects[uid];
                    remove(object, type);
                } else {
                    console.warn("invalid watch action type: " + action.type);
                }
            }

            load_poke();
        }

        function start_watch() {
            if (req)
                return;

            var full = true;
            var uri = endpoint + "/v1/watch";
            var params = {};

            if (namespace)
                uri += "/namespaces/" + namespace;

            uri += "/" + type;

            /*
             * If we have a last resource we can guarantee that we don't miss
             * any objects or changes to objects. If we don't have one, then we
             * have to list everything again. Still watch at the same time though.
             */
            if (lastResource) {
                params["resourceVersion"] = lastResource;
                full = false;
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

            req = api.get(uri, params)
                .stream(handle_watch)
                .response(function() {
                    load_begin(full);
                })
                .always(function() {
                    req = null;
                })
                .fail(function(ex, response) {
                    if (stopping)
                        return;

                    update_error_message(ex, response);
                    var msg = "watching kubernetes " + type + " failed: " + ex.message;
                    if (ex.problem !== "disconnected" && ex.status !== 404)
                        console.warn(msg);
                    else
                        debug(msg);
                    if (loaded.state() == 'pending')
                        loaded.reject(ex);

                    if (ex.status != 404)
                        start_watch_later();
                })
                .done(function(data) {
                    if (stopping)
                        return;
                    if (!blocked) {
                        console.warn("watching kubernetes " + type + " didn't block");
                        start_watch_later();
                    } else {
                        start_watch();
                    }
                });
        }

        /* Waiting to do the next http request */
        var wait = null;

        function start_watch_later() {
            if (!wait) {
                wait = window.setTimeout(function() {
                    wait = null;
                    start_watch();
                }, 5000);
            }
        }

        self.start = function start(http) {
            stopping = false;
            if (loaded.state() != 'pending')
                loaded = $.Deferred();
            api = http;
            start_watch();
        };

        self.change_namespace = function change_namespace(new_namespace) {
            if (new_namespace === namespace)
                return;

            stopping = true;
            if (req) {
                req.close("disconnected");
                req = null;
            }
            namespace = new_namespace;
            lastResource = null;

            window.clearTimeout(wait);
            wait = null;

            if (api !== null)
                self.start(api);
        };

        self.wait = function wait() {
            return loaded.promise();
        };

        self.stop = function stop(ex) {
            stopping = true;
            var problem;
            if (req) {
                if (ex)
                    problem = ex.problem;
                req.close(problem || "disconnected");
                req = null;
            }
            if (loaded.state() == 'pending')
                loaded.reject(ex);
            window.clearTimeout(wait);
            wait = null;
            api = null;
        };
    }

    /*
     * A helper function that returns a Promise which tries to
     * connect to a kube-apiserver in various ways in turn.
     */
    function connect_api_server() {
        var dfd = $.Deferred();
        var req;
        var aux;

        var schemes = [
            { port: 8080 },
            { port: 8443, tls: { }, capabilities: ['tls-certificates'] },
            { port: 6443, tls: { }, capabilities: ['tls-certificates'] }
        ];

        function step() {
            var scheme = schemes.shift();
            var kubeconfig = null;

            /* No further ports to try? */
            if (!scheme) {
                var ex = new Error(_("Couldn't find running kube-apiserver"));
                ex.problem = "not-found";
                dfd.reject(ex);
                return;
            }
            if (scheme.kubeconfig) {
                kubeconfig = scheme.kubeconfig;
                scheme.kubeconfig = null;
            }

            var http = cockpit.http(scheme.port, scheme);
            var openshift = null;

            /* A supplementary request to check if openshift */
            aux = http.get(API_OPENSHIFT)
                .always(function() {
                    openshift = (this.state() == "resolved");
                });

            /* The main /api request */
            req = http.get(API_KUBE)
                .done(function(data) {
                    req = null;

                    /*
                     * We expect a response that looks something like:
                     * { "versions": [ "v1beta1", "v1beta2", "v1" ] }
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
                        aux.always(function() {
                            response.flavor = openshift ? "openshift" : "kubernetes";
                            response.kubeconfig = kubeconfig;
                            dfd.resolve(http, response);
                        });

                    } else {
                        debug("not a kube-apiserver endpoint on:", scheme);
                        step();
                    }
                })
                .fail(function(ex, response) {
                    req = null;

                    if (ex.problem === "not-found") {
                        debug("api endpoint not found on:", scheme);
                        step();
                    } else {
                        if (ex.problem !== "cancelled")
                            debug("connecting to endpoint failed:", scheme, ex);
                        dfd.reject(ex, response);
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
     * KubeList
     *
     * An object that contains and optionally tracks a list of
     * of kubernetes items. The items are indexed by a key
     * directly on the KubeList. In addition there is a .items
     * array which presents the objects in a stable array.
     *
     * This is returned from client.select() and friends.
     *
     * Use with client.track() to subscribe to changes.
     *
     * The implementation should make all properties other
     * than item keys be non-enumerable, so you can enumerate the
     * properties on this object and only get keys/items.
     */
    function KubeList(matcher, client, possible) {
        var self = this;

        Object.defineProperty(self, "data", {
            enumerable: false,
            writable: false,
            value: { }
        });

        /* Predefine the jQuery expando as non-enumerable */
        Object.defineProperty(self, $.expando, {
            enumerable: false,
            writable: false,
            value: self.data
        });

        self.data.matcher = matcher;

        if (possible) {
            var i, len, item, key;
            for (i = 0, len = possible.length; i < len; i++) {
                key = possible[i];
                item = client.objects[key];
                if (matcher(item))
                    self[key] = item;
            }
        }
    }

    /* Public functions */
    Object.defineProperties(KubeList.prototype, {
        items: {
            enumerable: false,
            get: function items() {
                var self = this;
                var i, l, keys, flat = self.data.flat;
                if (!flat) {
                    keys = Object.keys(self).sort();
                    for (i = 0, l = keys.length, flat = []; i < l; i++)
                        flat.push(self[keys[i]]);
                    self.data.flat = flat;
                }
                return flat;
            }
        },
        count: {
            enumerable: false,
            get: function length() {
                var self = this;
                return Object.keys(self).length;
            }
        }
    });

    /* Hidden functions */
    function kubelist_remove(self, key, item) {
        var last = self[key];
        if (last) {
            delete self[key];
            kubelist_trigger(self, "removed", [last, key]);
        }
    }

    function kubelist_update(self, key, item) {
        var matched = self.data.matcher(item);
        var last = self[key];
        if (!last && matched) {
            self[key] = item;
            kubelist_trigger(self, "added", [item, key]);
        } else if (last && !matched) {
            delete self[key];
            kubelist_trigger(self, "removed", [last, key]);
        } else if (last && matched) {
            self[key] = item;
            kubelist_trigger(self, "updated", [item, key, last]);
        }
    }

    function kubelist_trigger(self, name, args) {
        self.data.flat = null;
        var $self = $(self);
        $self.triggerHandler(name, args);
        if (!self.data.timer) {
            self.data.timer = window.setTimeout(function() {
                self.data.timer = null;
                $self.triggerHandler("changed");
            }, 100);
        }
    }


    /**
     * KubernetesClient
     *
     * Properties:
     *  * objects: a dict of all the loaded kubernetes objects,
     *             with unique keys
     *  * resourceVersion: latest resourceVersion seen
     *  * flavor: either 'kubernetes' or 'openshift'
     */
    function KubernetesClient() {
        var self = this;

        self.objects = { };
        self.resourceVersion = null;
        self.flavor = null;
        self.config = null;

        /* Holds the connect api promise */
        var connected;

        /* The API info returned from /api */
        var apis;

        /* The namespace to operate in */
        var selected_namespace = null;

        /*
         * connect:
         * @force: Force a new connection
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
        self.connect = function connect(force) {
            if (force || !connected) {
                connected = connect_api_server()
                    .done(function(http, response) {
                        self.flavor = response.flavor;
                        self.config = response.kubeconfig;
                        for (var type in self.watches)
                            self.watches[type].start(http);
                    })
                    .fail(function(ex, response) {
                        update_error_message(ex, response);
                        console.warn("Couldn't connect to kubernetes:", ex);
                        for (var type in self.watches)
                            self.watches[type].stop(ex);
                    });
            }

            return connected;
        };

        /**
         * namespace:
         * @namespace: a kubernetes namespace string
         *
         * If called with an namespace argument changes
         * the currently selected namespace for all
         * watches.
         *
         * Returns the current selected namespace.
         */
        self.namespace = function namespace(new_namespace) {
            if (new_namespace !== undefined) {
                if (!new_namespace)
                    new_namespace = null;

                selected_namespace = new_namespace;
                for (var type in self.watches) {
                    if (type_is_namespaced(type))
                        self.watches[type].change_namespace(selected_namespace);
                }
                $(self).triggerHandler("namespace", [ new_namespace ]);
            }

            return selected_namespace;
        };

        /*
         * include:
         * @type: The type of watch to add
         *
         * Adds a watcher for a given type.
         */
        self.include = function include(type) {
            if (!self.watches[type]) {
                self.watches[type] = new KubernetesWatch(type, handle_updated, handle_removed);
                if (selected_namespace && type_is_namespaced(type))
                    self.watches[type].change_namespace(selected_namespace);

                if (connected) {
                    connected.done(function(http) {
                        self.watches[type].start(http);
                    });
                }
            }
        };

        /* The watch objects we have open */
        self.watches = { "events": new KubernetesWatch("events", handle_event, handle_removed) };
        [ "nodes", "pods", "services", "replicationcontrollers",
          "namespaces", "endpoints" ].forEach(self.include);

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
            for (var type in self.watches)
                self.watches[type].stop();
            tracked = [ ];
            if (connected) {
                connected.cancel();
                connected = null;
            }
        };

        /* The tracked objects */
        var tracked = [];

        /* TODO: Derive this value from cluster size */
        var index = new HashIndex(262139);

        /* Invoked when a an item is added or changed */
        function handle_updated(item, type) {
            var meta = item.metadata;

            var key = item.kind + ":" + meta.uid;
            debug("item", key, item);

            var prev = self.objects[key];
            if (prev && prev.metadata.resourceVersion === version)
                return;

            /* Place this on the item as a hidden property */
            Object.defineProperty(item, 'key', {
                enumerable: false,
                configurable: false,
                value: key
            });

            var version = meta.resourceVersion;
            if (version && version > self.resourceVersion)
                self.resourceVersion = version;

            self.objects[key] = item;

            /* Add various bits to index, for quick lookup */
            var keys = [ item.kind, meta.name, meta.namespace ];
            var labels, i;

            if (meta.labels) {
                labels = meta.labels;
                for (i in labels)
                    keys.push(i + labels[i]);
            }

            var spec = item.spec;
            if (spec) {
                if (spec.selector) {
                    labels = spec.selector;
                    for (i in labels)
                        keys.push(i + labels[i]);
                }
                if (spec.template && spec.template.metadata && spec.template.metadata.labels) {
                    labels = spec.template.metadata.labels;
                    for (i in labels)
                        keys.push(i + labels[i]);
                }
            }

            var status = item.status;
            if (spec && spec.nodeName)
                keys.push(spec.nodeName);

            index.add(keys, key);

            /* Fire off any tracked */
            var len;
            for (i = 0, len = tracked.length; i < len; i++)
                kubelist_update(tracked[i], key, item);
        }

        function handle_removed(item, type) {
            var meta = item.metadata;
            var key = item.kind + ":" + meta.uid;

            debug("remove", key, item);
            delete self.objects[key];

            var i, len = tracked.length;
            for (i = 0; i < len; i++)
                kubelist_remove(tracked[i], key, item);
        }

        var pulls = { };
        var pull_timeout;

        function pull_later(involved) {
            var ikey = involved.kind + ":" + involved.uid;
            pulls[ikey] = involved;

            if (!pull_timeout) {
                pull_timeout = window.setTimeout(function() {
                    var items = Object.keys(pulls).map(function(key) {
                        return pulls[ikey];
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
            var ikey = involved.kind + ":" + involved.uid;
            var item = self.objects[ikey];

            if (item && involved.resourceVersion < item.metadata.resourceVersion)
                return;

            var type = involved.kind.toLowerCase() + "s";
            var endpoint = type_option(type, "endpoint", API_KUBE);
            var uri = endpoint + "/v1";

            if (involved.namespace)
                uri += "/namespaces/" + encodeURIComponent(involved.namespace);

            uri += "/" + type + "/" + involved.name;

            debug("pulling", uri);

            self.request({ method: "GET", body: "", path: uri })
                .fail(function(ex) {
                    if (ex.status == 404) {
                        item = self.objects[ikey];
                        if (item) {
                            handle_removed(item, type);
                        }
                    } else {
                        console.warn("couldn't get involved object", uri, involved.name, ex);
                    }
                })
                .done(function(data) {
                    var meta, key, item;
                    try {
                        item = JSON.parse(data);
                    } catch(ex) {
                        item = null;
                    }
                    if (!item || typeof (item) !== "object") {
                        console.log("got invalid JSON response from kubernetes");
                        return;
                    }
                    if (item) {
                        meta = item.metadata;
                        if (meta) {
                            key = item.kind + ":" + meta.uid;
                            if (key == ikey)
                                handle_updated(item, type);
                        }
                    }
                });
        }

        function handle_event(item, type) {
            var involved = item.involvedObject;
            if (involved)
                pull_later(involved);
            handle_updated(item, type);
        }

        function match_nothing(item) {
            return false;
        }

        function match_everything(item) {
            return true;
        }

        /**
         * client.lookup()
         * @kind: kind of object
         * @name: name of the object
         * @namespace: the namespace of the object
         */
        this.lookup = function lookup(kind, name, namespace) {
            var keys = [];
            if (kind !== undefined)
                keys.push(kind);
            if (name !== undefined)
                keys.push(name);
            if (namespace !== undefined)
                keys.push(namespace);
            var possible = index.all(keys);
            var item, len = possible.length;
            for (var i = 0; i < len; i++) {
                item = self.objects[possible[i]];
                if (item && item.metadata &&
                    (kind === undefined || kind === item.kind) &&
                    (name === undefined || name === item.metadata.name) &&
                    (namespace === undefined || namespace === item.metadata.namespace)) {
                    return item;
                }
            }
            return null;
        };

        /**
         * client.select()
         * @kind: optional kind string (eg: 'Pod')
         * @namespace: optional namespace to select from
         * @selector: optional plain javascript object, JSON label selector
         * @template: Match the spec.template instead of labels directly
         *
         * Select objects that match the given labels.
         *
         * Returns: kubernetes items
         */
        this.select = function select(kind, namespace, selector, template) {
            var i, possible, keys = [];
            if (selector) {
                for (i in selector)
                    keys.push(i + selector[i]);

                /* Empty selectors should never match anything */
                if (i === undefined)
                    return new KubeList(match_nothing, self);
            }
            if (kind)
                keys.push(kind);
            if (namespace)
                keys.push(namespace);
            if (keys.length)
                possible = index.all(keys);
            else
                possible = Object.keys(self.objects);

            function match_select(item) {
                if (!item || !item.metadata)
                    return false;
                if (kind && item.kind !== kind)
                    return false;
                var meta = item.metadata;
                if (namespace && meta.namespace !== namespace)
                    return false;
                var labels, spec;
                if (template) {
                    spec = item.spec;
                    if (spec && spec.template && spec.template.metadata)
                        labels = spec.template.metadata.labels;
                } else {
                    labels = meta.labels;
                }
                if (selector && !labels)
                    return false;
                for (var i in selector) {
                    if (labels[i] !== selector[i])
                        return false;
                }
                return true;
            }

            return new KubeList(match_select, self, possible);
        };

        /**
         * client.infer()
         * @kind: optional kind string
         * @namespace: the namespace to act in
         * @labels: plain javascript object, JSON labels
         *
         * Infer which objects that have selectors would have
         * matched the given labels.
         */
        this.infer = function infer(kind, namespace, labels) {
            var i, possible, keys = [];
            if (labels) {
                for (i in labels)
                    keys.push(i + labels[i]);
            }
            if (keys.length)
                possible = index.any(keys);
            else
                possible = Object.keys(self.objects);

            function match_infer(item) {
                if (!item || !item.metadata || !item.spec || !item.spec.selector)
                    return false;
                if (namespace && item.metadata.namespace !== namespace)
                    return false;
                if (kind && item.kind !== kind)
                    return false;
                var i;
                if (labels) {
                    for (i in item.spec.selector) {
                        if (labels[i] !== item.spec.selector[i])
                            return false;
                    }
                }
                return true;
            }

            return new KubeList(match_infer, self, possible);
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
         * Returns: kubernetes items
         */
        this.hosting = function hosting(kind, host) {
            var possible = index.all([ host ]);

            function match_hosting(item) {
                if (!item || !item.spec || item.spec.nodeName != host)
                    return false;
                if (kind && item.kind !== kind)
                    return false;
                return true;
            }

            return new KubeList(match_hosting, self, possible);
        };

        /*
         * Maps an array of objects with a name property to a
         * map with the name as the key.
         */
        function map_named_array(array) {
            var result = { };
            var i, len;
            if (array) {
                for (i = 0, len = array.length; i < len; i++)
                    result[array[i].name] = array[i];
            }
            return result;
        }

        /**
         * client.containers()
         * @pod: The pod javascript to build container objects for.
         *
         * Build fake container objects with a spec/status for the various
         * containers in the pod. The resulting objects are not real kubernetes
         * objects, but are useful when dealing with information about a
         * container.
         *
         * They look like this:
         *   { spec: pod.spec.containers[n], status: pod.status.containerStatuses[n] }
         *
         * The returned array will not change once created for a given pod item.
         */
        this.containers = function containers(pod) {
            var results = pod.containers;

            var specs, statuses;
            if (!results) {
                if (pod.spec)
                    specs = map_named_array(pod.spec.containers);
                else
                    specs = { };
                if (pod.status)
                    statuses = map_named_array(pod.status.containerStatuses);
                else
                    statuses = { };
                results = Object.keys(specs).map(function(name) {
                    return { spec: specs[name], status: statuses[name] };
                });

                /* Note that the returned value has to be stable, so stash it on the pod */
                Object.defineProperty(pod, "containers", { enumerable: false, value: results });
            }

            return results;
        };

        /**
         * client.track(items)
         * client.track(items, false)
         * @items: a set of items returned by client.select() or friends
         * @add: whether to add or remove subscription, default add
         *
         * Updates the set of items when stuff that they match changes.
         */
        self.track = function track(items, add) {
            if (add === false) {
                tracked = tracked.filter(function(l) {
                    return items !== l;
                });
                return null;
            } else {
                tracked.push(items);
            }
        };

        function DataError(message, ex) {
            this.problem = "invalid-data";
            this.message = message;
            this.cause = ex;
        }

        function kind_is_namespaced(kind) {
            return kind != "Node" && kind != "Namespace";
        }

        function type_is_namespaced(type) {
            return type_option(type, "is_namespaced", true);
        }

        function create_preference(kind) {
            switch(kind) {

            /*
             * Namespaces should be created first, as they must
             * exist before objects in them are created.
             */
            case "Namespace":
                return 0;

            /*
             * Services should be created before pods (or replication controllers
             * that make pods. This is because of the environment variables that
             * pods get when they want to access a service.
             */
            case "Service":
                return 1;

            /*
             * Create these before replication controllers ... corner case, but
             * keeps things sane.
             */
            case "Pod":
                return 2;

            default:
                return 5;
            }
        }

        function create_compare(a, b) {
            return create_preference(a.kind) - create_preference(b.kind);
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
                        item.apiVersion != "v1" ||
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
                    "apiVersion" : "v1",
                    "kind" : "Namespace",
                    "metadata" : {
                        "name": namespace
                    }
                });
            }

            /* Now sort the array with create preference */
            items.sort(create_compare);

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
                var url = "/api/v1";
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

        /**
         * remove:
         * @link: a kubernetes item, or selfLink path
         *
         * Remove the item from Kubernetes.
         *
         * Returns a promise.
         */
        self.remove = function remove(link) {
            if (link.metadata)
                link = link.metadata.selfLink;
            return self.request({
                method: "DELETE",
                path: link,
                body: ""
            });
        };

        self.connect();
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

    function CAdvisor(node) {
        var self = this;

        /* cAdvisor has second intervals */
        var interval = 1000;

        var kube = kubernetes.k8client();

        var last = { };

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
            if (!kube || body in requests)
                return;

            var req = kube.request({
                method: "POST",
                path: "/api/v1/proxy/nodes/" + encodeURIComponent(node) + ":4194/api/v1.2/docker",
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
                if (ex.status != 503)
                    console.warn(ex);
            });
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
                if (req && req.close)
                    req.close();
            }
            kube.close();
            kube = null;
        };

        var cache = "cadv1-" + (node || null);
        self.series = cockpit.series(interval, cache, self.fetch);
    }

    kubernetes.cadvisor = singleton(CAdvisor);

    return kubernetes;
});
