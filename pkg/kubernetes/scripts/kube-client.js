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

    /*
     * Some notes on the create fields.
     *
     * Namespaces should be created first, as they must exist before objects in
     * them are created.
     *
     * Services should be created before pods (or replication controllers that
     * make pods. This is because of the environment variables that pods get
     * when they want to access a service.
     *
     * Create pods before replication controllers ... corner case, but keeps
     * things sane.
     */

    var KUBE = "/api/v1";
    var OPENSHIFT = "/oapi/v1";
    var DEFAULT = { api: KUBE, create: 0 };
    var SCHEMA = flatSchema([
        { kind: "DeploymentConfig", type: "deploymentconfigs", api: OPENSHIFT },
        { kind: "Endpoints", type: "endpoints", api: KUBE },
        { kind: "Group", type: "groups", api: OPENSHIFT, global: true },
        { kind: "Image", type: "images", api: OPENSHIFT, global: true },
        { kind: "ImageStream", type: "imagestreams", api: OPENSHIFT },
        { kind: "ImageStreamImage", type: "imagestreamimages", api: OPENSHIFT },
        { kind: "ImageStreamTag", type: "imagestreamtags", api: OPENSHIFT },
        { kind: "LocalResourceAccessReview", type: "localresourceaccessreviews", api: OPENSHIFT },
        { kind: "Namespace", type: "namespaces", api: KUBE, global: true, create: -100 },
        { kind: "Node", type: "nodes", api: KUBE, global: true },
        { kind: "Pod", type: "pods", api: KUBE, create: -20 },
        { kind: "PolicyBinding", type: "policybindings", api: OPENSHIFT },
        { kind: "RoleBinding", type: "rolebindings", api: OPENSHIFT },
        { kind: "Route", type: "routes", api: OPENSHIFT },
        { kind: "PersistentVolume", type: "persistentvolumes", api: KUBE, global: true, create: -100 },
        { kind: "PersistentVolumeClaim", type: "persistentvolumeclaims", api: KUBE, create: -50 },
        { kind: "Project", type: "projects", api: OPENSHIFT, global: true, create: -90 },
        { kind: "ProjectRequest", type: "projectrequests", api: OPENSHIFT, global: true, create: -90 },
        { kind: "ReplicationController", type: "replicationcontrollers", api: KUBE, create: -60 },
        { kind: "Service", type: "services", api: KUBE, create: -80 },
        { kind: "User", type: "users", api: OPENSHIFT, global: true },
    ]);

    var NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

    /* Timeout for non-GET requests */
    var REQ_TIMEOUT = "120s";

    function debug() {
        if (window.debugging == "all" || window.debugging == "kube")
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

        self.get = function get(key) {
            var p = array[hash("" + key) % size];
            if (!p)
                return [];
            return p.slice();
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
    }

    /*
     * A WeakMap implementation
     *
     * This works on ES5 browsers, with the caveat that the mapped
     * items are discoverable with enough work.
     *
     * To be clear, the principal use of a WeakMap is to associate
     * an value with an object, the object is the key. And then have
     * that value go away when the object does. This is very, very
     * similar to properties.
     *
     * The main difference is that any assigned values are not
     * garbage collected if the *weakmap* itself is collected,
     * and of course one can actually access the non-enumerable
     * property that makes this work.
     */

    var weak_property = Math.random().toString(36).slice(2);
    var local_seed = 1;

    function SimpleWeakMap() {
        var local_property = "weakmap" + local_seed;
        local_seed += 1;

        var self = this;

        self.delete = function delete_(obj) {
            var x, map = obj[weak_property];
            if (map)
                delete map[local_property];
        };

        self.has = function has(obj) {
            var map = obj[weak_property];
            return (map && local_property in map);
        };

        self.get = function has(obj) {
            var map = obj[weak_property];
            if (!map)
                return undefined;
            return map[local_property];
        };

        self.set = function set(obj, value) {
            var map = obj[weak_property];
            if (!map) {
                map = function WeakMapData() { };
                Object.defineProperty(obj, weak_property, {
                    enumerable: false, configurable: false,
                    writable: false, value: map,
                });
            }

            map[local_property] = value;
        };
    }

    function flatSchema(items) {
        var i, len, ret = { "": DEFAULT };
        for (i = 0, len = items.length; i < len; i++) {
            ret[items[i].type] = items[i];
            ret[items[i].kind] = items[i];
        }
        return ret;
    }

    /*
     * Accepts:
     *  1. an object
     *  2. an involved object
     *  2. a path string
     *  3. type/kind, name, namespace
     */
    function resourcePath(args) {
        var one = args[0];
        if (one && typeof one === "object") {
            if (one.metadata) {
                /* An object with a link */
                if (one.metadata.selfLink)
                    return one.metadata.selfLink;

                /* Pull out the arguments */
                args = [ one.kind, one.metadata.name, one.metadata.namespace ];
            } else if (one.name && one.kind) {
                /* An involved object */
                args = [ one.kind, one.name, one.namespace ];
            }


        /* Already a path */
        } else if (one && one[0] == '/') {
            return one;
        }

        /*
         * Combine into a path.
         *
         * Kubernetes names and namespaces are quite limited in their contents
         * and do not need escaping to be used in a URI path.
         */
        var schema = SCHEMA[args[0]] || SCHEMA[""];
        var path = schema.api;
        if (!schema.global && args[2])
            path += "/namespaces/" + args[2];
        path += "/" + schema.type;
        if (args[1])
            path += "/" + args[1];
        return path;
    }

    /*
     * Angular definitions start here
     */

    angular.module("kubeClient", [])

    /**
     * KUBE_SCHEMA
     *
     * A dict of schema information. The keys are both object types
     * and resource kinds. The values are objects with the following
     * properties:
     *
     *  schema.kind    The object kind
     *  schema.type    The resource type (ie: used in urls)
     *  schema.api     The api endpoint to use
     *  schema.global  Set to true if resource is not namespaced.
     */

    .value("KUBE_SCHEMA", SCHEMA)

    /**
     * KUBE_NAME_RE
     *
     * Regular Expression that names in kubernetes must match.
     */
    .value("KUBE_NAME_RE", NAME_RE)

    /**
     * kubeLoader
     *
     * Loads kubernetes objects either by watching them or loading
     * objects explicitly. The loaded objects are available at
     * the .objects property, although you probably want to
     * use kubeSelect() to interact with these objects.
     *
     * loader.handle(objects, [removed])
     *
     * Tell the loader about a objects that has been loaded
     * or removed elsewhere.
     *
     * loader.listen(callback, until)
     *
     * Register a callback to be invoked some time after new
     * objects have been loaded. Returns an object with a
     * .cancel() method, that can be used to stop listening.
     *
     * promise = loader.load(path)
     * promise = loader.load(involvedObject)
     * promise = loader.load(resource)
     * promise = loader.load(kind, [name], [namespace])
     *
     * Load the resource at the path. Returns a promise that will
     * resolve with the resource or an array of objects at the
     * given path.
     *
     * loader.limits
     *
     * Contains various limits that govern what the loader loads
     * from watches. Of note is loader.limits.namespace which is set
     * to null for the loader to load all objects, or a namespace
     * string or array of namespace strings for the loader to watch
     * objects from specific namespaces.
     *
     * loader.limit(options)
     *
     * Adjust the loader limits that govern what the loader loads
     * from watches. Options can contain a "namespace" field to
     * set the namespace or namespaces to limit watching to.
     *
     * loader.reset()
     *
     * Clear out all loaded objects, and clear all watches. Also
     * clears the limits and other state.
     *
     * loader.objects
     *
     * A dict of all loaded objects.
     *
     * promise = loader.watch(type, until)
     *
     * Start watching the given resource type. The returned promise
     * will be resolved when an initial set of objects have been
     * loaded for the watch, or rejected if the watch has failed.
     */

    .factory("kubeLoader", [
        "$q",
        "$timeout",
        "KubeWatch",
        "KubeRequest",
        "KUBE_SCHEMA",
        function($q, $timeout, KubeWatch, KubeRequest, KUBE_SCHEMA) {
            var callbacks = [];
            var limits = { namespace: null };

            /* All the current watches */
            var watching = { };

            /* All the loaded objects */
            var objects = { };

            /* Timeout batching */
            var batch = null;
            var batchTimeout = null;

            function ensureWatch(what, namespace, increment) {
                var schema = SCHEMA[what] || SCHEMA[""];
                var watch, path = schema.api;
                if (!schema.global && namespace)
                    path += "/namespaces/" + namespace;
                path += "/" + schema.type;

                if (!(path in watching)) {
                    watch = new KubeWatch(path, handleFrames);
                    watch.what = what;
                    watch.global = schema.global;
                    watch.namespace = namespace;
                    watch.cancelWatch = watch.cancel;

                    /* Replace the cancel function with one that does ref counting */
                    watch.cancel = function() {
                        var w = watching[path];
                        if (w) {
                            w.references -= 1;
                            if (w.references <= 0) {
                                w.cancelWatch();
                                delete watching[path];
                            }
                        }
                    };
                    watching[path] = watch;
                }

                /* Increase the references here */
                watching[path].references += increment;
                return watching[path];
            }

            function ensureWatches(what, increment) {
                var namespace = limits.namespace;
                if (!angular.isArray(namespace))
                    return ensureWatch(what, namespace, increment);

                var parts = [];
                angular.forEach(namespace, function(val) {
                    parts.push(ensureWatch(what, val, increment));
                });
                var ret = $q.all(parts);
                ret.cancel = function() {
                    angular.forEach(parts, function(val) {
                        val.cancel();
                    });
                };
                return ret;
            }

            function handleFrames(frames) {
                if (batch === null)
                    batch = frames;
                else
                    batch.push.apply(batch, frames);

                /* When called with empty data, flush, don't wait */
                if (frames.length > 0) {
                    if (batchTimeout === null)
                        batchTimeout = window.setTimeout(handleTimeout, 150);
                    else
                        return; /* called again later */
                }

                handleFlush(invokeCallbacks);
            }

            function resourceVersion(resource) {
                var version;
                if (resource && resource.metadata)
                    version = parseInt(resource.metadata.resourceVersion, 10);

                if (!isNaN(version))
                    return version;
            }

            function handleFlush(invoke) {
                var drain = batch;
                batch = null;

                if (!drain)
                    return;

                var present = { };
                var removed = { };
                var i, len, frame, link, resource, key;
                var cVersion, lVersion;
                for (i = 0, len = drain.length; i < len; i++) {
                    resource = drain[i].object;
                    if (resource) {
                        link = resourcePath([resource]);
                        if (drain[i].type == "DELETED") {
                            delete objects[link];
                            removed[link] = resource;
                        } else if (drain[i].checkResourceVersion) {
                            /* There is a race between items loaded from
                             * watchers and items loaded other ways such as
                             * from KubeMethods callbacks, where we might
                             * end up saving the older item if loader.load is
                             * called after the watcher has already loaded fresher
                             * data. Look at the resourceVersion and only add
                             * if it is the same or newer than what we already have.
                             */
                            cVersion = resourceVersion(resource);
                            lVersion = resourceVersion(objects[link]);
                            if (!cVersion || !lVersion || cVersion >= lVersion) {
                                present[link] = resource;
                                objects[link] = resource;
                            }
                        } else {
                            present[link] = resource;
                            objects[link] = resource;
                        }
                    }
                }

                /* Run all the listeners and then digest */
                invoke(present, removed);
            }

            function invokeCallbacks(/* ... */) {
                var i, len, func;
                for (i = 0, len = callbacks.length; i < len; i++) {
                    func = callbacks[i];
                    if (func)
                        func.apply(self, arguments);
                }
            }

            function handleTimeout() {
                batchTimeout = null;
                handleFlush(invokeCallbacks);
            }

            function resetLoader() {
                var link, path;

                /* We drop any batched objects in flight */
                window.clearTimeout(batchTimeout);
                batchTimeout = null;
                batch = null;

                /* Cancel all the watches  */
                var old = watching;
                watching = { };
                angular.forEach(old, function(w) {
                    w.cancelWatch();
                });

                /* Clear out everything */
                for (link in objects)
                    delete objects[link];

                for (link in limits)
                    delete limits[link];
                limits.namespace = null;

                /* Tell the callbacks we're resetting */
                invokeCallbacks();
            }

            function handleObjects(objects, removed, kind) {
                handleFrames(objects.map(function(resource) {
                    if (kind)
                        resource.kind = kind;

                    return {
                        type: removed ? "DELETED" : "ADDED",
                        object: resource,
                        checkResourceVersion: true
                    };
                }));
                handleFlush(invokeCallbacks);
            }

            function loadObjects(/* ... */) {
                var path = resourcePath(arguments);
                var req = new KubeRequest("GET", path);
                var promise = req.then(function(response) {
                    req = null;
                    var resource = response.data;
                    if (!resource || !resource.kind) {
                        return null;
                    } else if (resource.kind.indexOf("List") === resource.kind.length - 4) {
                        handleObjects(resource.items, false, resource.kind.slice(0, -4));
                        return resource.items;
                    } else {
                        handleObjects([resource]);
                        return resource;
                    }
                }, function(response) {
                    req = null;
                    var resp = response.data;
                    return $q.reject(resp || response);
                });
                promise.cancel = function cancel(ex) {
                    req.cancel(ex);
                };
                return promise;
            }

            function adjustNamespace(value) {
                window.clearTimeout(batchTimeout);
                batchTimeout = null;

                /* Convert this to our native format */
                var i, len, only = { };
                if (value === null) {
                    only = null;
                } else if (angular.isArray(value)) {
                    angular.forEach(value, function(namespace) {
                        only[namespace] = true;
                    });
                } else {
                    only[value] = true;
                }
                limits.namespace = value;

                /* Flush everything that's outstanding */
                var present = { }, removed = { };
                handleFlush(function(a, b) {
                    present = a;
                    removed = b;
                });

                /* Remove objects that are not in these namespaces */
                var meta, link;
                for (link in objects) {
                    meta = objects[link].metadata;
                    if (only && meta.namespace && !(meta.namespace in only)) {
                        removed[link] = objects[link];
                        delete objects[link];
                        delete present[link];
                    }
                }

                /* Cancel any watches not applicable to these namespaces */
                var path, w, reconnect = [ ];
                for (path in watching) {
                    w = watching[path];
                    if ((!only && w.namespace) || (only && !w.global && !(w.namespace in only))) {
                        w.cancelWatch();
                        delete watching[path];
                        reconnect.push(w);
                    }
                }

                /* Tell the world what we did */
                invokeCallbacks(present, removed);

                /* Reconnect all the watches we cancelled with proper namespace */
                angular.forEach(reconnect, function(w) {
                    ensureWatches(w.what, w.references);
                });
            }

            function connectUntil(ret, until) {
                if (until) {
                    if (until.$on) {
                        until.$on("destroy", function() {
                            ret.cancel();
                        });
                    } else {
                        console.warn("invalid until passed to watch", until);
                    }
                }
            }

            var self = {
                watch: function watch(what, until) {
                    var ret = ensureWatches(what, 1);
                    connectUntil(ret, until);
                    return ret;
                },
                load: function load(/* ... */) {
                    return loadObjects.apply(this, arguments);
                },
                limit: function limit(options) {
                    if ("namespace" in options)
                        adjustNamespace(options.namespace);
                },
                reset: resetLoader,
                listen: function listen(callback, until) {
                    if (callback.early)
                        callbacks.unshift(callback);
                    else
                        callbacks.push(callback);
                    var timeout = $timeout(function() {
                        timeout = null;
                        callback.call(self, objects);
                    }, 0);
                    var ret = {
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
                    connectUntil(ret, until);
                    return ret;
                },
                handle: function handle(objects, removed, kind) {
                    if (!angular.isArray(objects))
                        objects = [ objects ];
                    handleObjects(objects, removed, kind);
                },
                resolve: function resolve(/* ... */) {
                    return resourcePath(arguments);
                },
                objects: objects,
                limits: limits,
            };

            return self;
        }
    ])

    /**
     * kubeSelect
     *
     * Allows selecting loaded objects based on various criteria. The
     * goal here is to allow selection to be fast enough that it can be
     * done repeatedly and regularly, without keeping caches of objects
     * all over the place.
     *
     * Resources may be filtered in a chain by calling various filter
     * functions. Lets start with an example that finds a pod:
     *
     *   pod = kubeSelect()
     *      .kind("Pod")
     *      .namespace("default")
     *      .name("docker-registry")
     *      .one();
     *
     * Calling kubeSelect() will return a dict with all loaded objects,
     * containing unique keys, and then various filters can be called to
     * further narrow results.
     *
     * You can also pass a dict of objects into kubeSelect() and then
     * perform actions on it.
     *
     * The following filters are available by default:
     *
     *  .kind(kind)       Limit to specified kind
     *  .namespace(ns)    Limit to specified namespace
     *  .name(name)       Limit to this name
     *  .host(name)       Limit to this host
     *  .label(selector)  Limit to objects whose label match selector
     *  .one()            Choose one of results, or null
     *  .extend(obj)      Extend obj with the results
     *
     * Additional filters can be registered by calling the function:
     *
     *   kubeSelect.register(name, function)
     *   kubeSelect.register(filterobj)
     *
     * Ask on FreeNode #cockpit for documentation on filters.
     */

    .factory("kubeSelect", [
        "kubeLoader",
        function(loader) {
            /* A list of all registered filters */
            var filters = { };

            /* A hash index */
            var index = null;

            /* The filter prototype for functions available on selector */
            var proto = null;

            /* Cache data */
            var weakmap = new SimpleWeakMap();
            var version = 1;

            function listener(present, removed) {
                version += 1;

                /* Get called like this when reset */
                if (!present) {
                    index = null;

                /* Called like this when more objects arrive */
                } else if (index) {
                    indexObjects(present);
                }
            }

            listener.early = true;
            loader.listen(listener);

            /* Create a new index and populate */
            function indexCreate() {
                var name, filter;

                /* TODO: Derive this value from cluster size */
                index = new HashIndex(262139);

                /* And index all the objects */
                indexObjects(loader.objects);
            }

            /* Populate index for the given objects and current filters */
            function indexObjects(objects) {
                var link, object, name, key, keys, filter;
                for (link in objects) {
                    object = objects[link];
                    for (name in filters) {
                        filter = filters[name];
                        if (filter.digest) {
                            key = filter.digest.call(null, object);
                            if (key)
                                index.add([ key ], link);
                        } else if (filter.digests) {
                            keys = filter.digests.call(null, object);
                            if (keys.length)
                                index.add(keys, link);
                        }
                    }
                }
            }

            /* Return a place to cache data related to obj */
            function cached(obj) {
                var data = weakmap.get(obj);
                if (!data || data.version !== version) {
                    data = { version: version, length: data ? data.length : undefined };
                    weakmap.set(obj, data);
                }
                return data;
            }

            function makePrototypeCall(filter) {
                return function() {
                    var cache = cached(this);

                    /*
                     * Do this early, since some browsers cannot pass
                     * arguments to JSON.stringify()
                     */
                    var args = Array.prototype.slice.call(arguments);

                    /* Fast path, already calculated results */
                    var desc = filter.name + ": " + JSON.stringify(args);
                    if (desc in cache)
                        return cache[desc];

                    var results;
                    if (filter.filter) {
                        results = filter.filter.apply(this, args);

                    } else {
                        if (!index)
                            indexCreate();
                        if (!cache.indexed) {
                            indexObjects(this);
                            cache.indexed = true;
                        }
                        if (filter.digests) {
                            results = digestsFilter(filter, this, args);
                        } else if (filter.digest) {
                            results = digestFilter(filter, this, args);
                        } else {
                            console.warn("invalid filter: " + filter.name);
                            results = { };
                        }
                    }

                    cache[desc] = results;
                    return results;
                };
            }

            function makePrototype() {
                var name, ret = {
                    length: {
                        enumerable: false,
                        configurable: true,
                        get: function() { return cached(this).length; }
                    }
                };
                for (name in filters) {
                    ret[name] = {
                        enumerable: false,
                        configurable: true,
                        value: makePrototypeCall(filters[name])
                    };
                }
                return ret;
            }

            function mixinSelection(results, length, indexed) {
                var link, data;
                if (length === undefined) {
                    length = 0;
                    for (link in results)
                        length += 1;
                }
                proto = proto || makePrototype();
                Object.defineProperties(results, proto);
                data = cached(results);
                data.length = length;
                data.selection = results;
                data.indexed = indexed;
                return results;
            }

            function digestFilter(filter, what, criteria) {
                var p, pl, key, keyo, possible, link, object;
                var results = { }, count = 0;

                key = filter.digest.apply(null, criteria);
                if (key !== null && key !== undefined) {
                    possible = index.get(key);
                } else {
                    possible = [];
                }

                for (p = 0, pl = possible.length; p < pl; p++) {
                    link = possible[p];
                    object = what[link];
                    if (object) {
                        if (key === filter.digest.call(null, object)) {
                            results[link] = object;
                            count += 1;
                        }
                    }
                }

                return mixinSelection(results, count, true);
            }

            function digestsFilter(filter, what, criteria) {
                var keys, keyn, keyo, k, link, match, object, possible;
                var p, pl, j, jl;
                var results = { }, count = 0;

                keys = filter.digests.apply(null, criteria);
                keyn = keys.length;
                if (keyn > 0) {
                    possible = index.all(keys);
                    keys.sort();
                } else {
                    possible = [];
                }

                for (p = 0, pl = possible.length; p < pl; p++) {
                    link = possible[p];
                    object = what[link];
                    if (object) {
                        keyo = filter.digests.call(null, object);
                        keyo.sort();
                        match = false;

                        /* Search for first key */
                        for (j = 0, jl = keyo.length; !match && j < jl; j++) {
                            if (keys[0] === keyo[j]) {
                                match = true;
                                for (k = 0; match && k < keyn; k++) {
                                    if (keys[k] !== keyo[j + k])
                                        match = false;
                                }
                            }
                        }

                        if (match) {
                            results[link] = object;
                            count += 1;
                        }
                    }
                }

                return mixinSelection(results, count, true);
            }

            function registerFilter(filter, optional) {
                if (typeof (optional) == "function") {
                    filter = {
                        name: filter,
                        filter: optional,
                    };
                }

                filters[filter.name] = filter;
                index = null;
                proto = null;
                version += 1;
            }

            /* The one filter */
            registerFilter("one", function() {
                var link;
                for (link in this)
                    return this[link];
                return null;
            });

            /* The extend filter */
            registerFilter("extend", function(target) {
                var link;
                for (link in this)
                    target[link] = this[link];
                return target;
            });

            /* The label filter */
            registerFilter({
                name: "label",
                digests: function(arg) {
                    var ret = [];
                    if (!arg)
                        return ret;
                    var i, meta = arg.metadata;
                    var labels = meta ? meta.labels : arg;
                    for (i in labels || [])
                        ret.push(i + "=" + labels[i]);
                    return ret;
                }
            });

            /* The namespace filter */
            registerFilter({
                name: "namespace",
                digest: function(arg) {
                    if (!arg)
                        return null;
                    if (typeof arg === "string")
                        return arg;
                    var meta = arg.metadata;
                    return meta ? meta.namespace : null;
                }
            });

            /* The name filter */
            registerFilter({
                name: "name",
                digest: function(arg) {
                    if (!arg)
                        return null;
                    if (typeof arg === "string")
                        return arg;
                    var meta = arg.metadata;
                    return meta ? meta.name : null;
                }
            });

            /* The kind filter */
            registerFilter({
                name: "kind",
                digest: function(arg) {
                    if (!arg)
                        return null;
                    if (typeof arg === "string")
                        return arg;
                    return arg.kind;
                }
            });

            /* The host filter */
            registerFilter({
                name: "host",
                digest: function(arg) {
                    if (!arg)
                        return null;
                    if (typeof arg === "string")
                        return arg;
                    var spec = arg.spec;
                    return spec ? spec.nodeName : null;
                }
            });

            /* The namespace filter */
            registerFilter({
                name: "uid",
                digest: function(arg) {
                    if (!arg)
                        return null;
                    if (typeof arg === "string")
                        return arg;
                    var meta = arg.metadata;
                    return meta ? meta.uid : null;
                }
            });

            /* The statusPhase filter */
            registerFilter({
                name: "statusPhase",
                digest: function(arg) {
                    var status;
                    if (typeof arg == "string") {
                        return arg;
                    } else {
                        status = arg.status || { };
                        return status.phase ? status.phase : null;
                    }
                }
            });

            var empty = { };

            function select(arg) {
                var cache, indexed = false;
                if (arg === undefined) {
                    arg = loader.objects;
                    indexed = true;
                } else if (!arg) {
                    arg = empty;
                }

                /* Next the specific object */
                if (typeof arg !== "object") {
                    console.warn("Pass resources or resource dicts or null to kubeSelect()");
                    arg = empty;
                }

                cache = cached(arg);
                if (cache.selection)
                    return cache.selection;

                /* A single resource object */
                var meta, single;
                if (typeof arg.kind === "string") {
                    if (!cache.single) {
                        meta = arg.meta || { };
                        single = { };
                        single[meta.selfLink || 1] = arg;
                        cache.single = mixinSelection(single, undefined, false);
                    }
                    return cache.single;
                }

                return mixinSelection(arg, undefined, indexed);
            }

            /* A seldom used 'static' method */
            select.register = registerFilter;

            return select;
        }
    ])

    /**
     * kubeMethods
     *
     * Methods that operate on kubernetes objects.
     *
     * promise = methods.create(objects, namespace)
     *
     * Create the given resource or objects in the specified namespace.
     *
     * promise = methods.remove(resource)
     * promise = methods.remove(path)
     * promise = methods.remove(type, name, namespace)
     *
     * Delete the given resource from kubernetes.
     */
    .factory("kubeMethods", [
        "$q",
        "KUBE_SCHEMA",
        "KubeRequest",
        "kubeLoader",
        function($q, KUBE_SCHEMA, KubeRequest, loader) {
            function createCompare(a, b) {
                var sa = KUBE_SCHEMA[a.kind].create || 0;
                var sb = KUBE_SCHEMA[b.kind].create || 0;
                return sa - sb;
            }

            function createObjects(objects, namespace) {
                var defer = $q.defer();
                var promise = defer.promise;
                var request = null;

                if (!angular.isArray(objects)) {
                    if (objects.kind == "List")
                        objects = objects.items;
                    else
                        objects = [ objects ];
                }

                var haveNs = false;
                var wantNs = false;

                objects.forEach(function(resource) {
                    var meta = resource.metadata || { };
                    if ((resource.kind == "Namespace" || resource.kind == "Project") && meta.name === namespace)
                        haveNs = true;
                    var schema = SCHEMA[resource.kind] || SCHEMA[""];
                    if (!schema.global)
                        wantNs = true;
                });

                /* Shallow copy of the array, we modify it below */
                objects = objects.slice();

                /* Create the namespace  */
                if (namespace && wantNs && !haveNs) {
                    objects.unshift({
                        apiVersion : "v1",
                        kind : "Namespace",
                        metadata : { name: namespace }
                    });
                }

                /* Now sort the array with create preference */
                objects.sort(createCompare);

                function step() {
                    var resource = objects.shift();
                    if (!resource) {
                        defer.resolve();
                        return;
                    }

                    var path = resourcePath([resource.kind, null, namespace || "default"]);
                    path += "?timeout=" + REQ_TIMEOUT;

                    request = new KubeRequest("POST", path, JSON.stringify(resource))
                        .then(function(response) {
                            var meta;

                            debug("created resource:", path, response.data);
                            if (response.data.kind) {
                                /* HACK: https://github.com/openshift/origin/issues/8167 */
                                if (response.data.kind == "Project") {
                                    meta = response.data.metadata || { };
                                    delete meta.selfLink;
                                }
                                loader.handle(response.data);
                            }
                            step();
                        }, function(response) {
                            var resp = response.data;

                            /* Ignore failures creating the namespace if it already exists */
                            if (resource.kind == "Namespace" && resp && (resp.code === 409 || resp.code === 403)) {
                                debug("skipping namespace creation");
                                step();
                            } else {
                                debug("create failed:", path, resp || response);
                                defer.reject(resp || response);
                            }
                        });
                }

                step();

                promise.cancel = function cancel() {
                    if (request)
                        request.cancel();
                };
                return promise;
            }

            function deleteResource(/* ... */) {
                var path = resourcePath(arguments);
                var resource = loader.objects[path];
                path += "?timeout=" + REQ_TIMEOUT;
                var promise = new KubeRequest("DELETE", path);
                return promise.then(function() {
                    debug("deleted resource:", path, resource);
                    if (resource)
                        loader.handle(resource, true);
                }, function(response) {
                    var resp = response.data;
                    return $q.reject(resp || response);
                });
            }

            function patchResource(resource, patch) {
                var path = resourcePath([resource]);
                path += "?timeout=" + REQ_TIMEOUT;
                var body = JSON.stringify(patch);
                var config = { headers: { "Content-Type": "application/strategic-merge-patch+json" } };
                var promise = new KubeRequest("PATCH", path, body, config);
                return promise.then(function(response) {
                    debug("patched resource:", path, response.data);
                    if (response.data.kind)
                        loader.handle(response.data);
                }, function(response) {
                    var resp = response.data;
                    return $q.reject(resp || response);
                });
            }

            function generalMethodRequest(method, resource, body, config) {
                var path = resourcePath([resource]);
                if (method != "GET")
                    path += "?timeout=" + REQ_TIMEOUT;
                var promise = new KubeRequest(method, path, JSON.stringify(body), config);
                return promise.then(function(response) {
                    var resp = response.data;
                    return resp || response;
                }, function(response) {
                    var resp = response.data;
                    return $q.reject(resp || response);
                });
            }

            function putResource(resource, body, config) {
                return generalMethodRequest("PUT", resource, body, config);
            }

            function postResource(resource, body, config) {
                return generalMethodRequest("POST", resource, body, config);
            }

            function checkResource(resource, targets) {
                var defer = $q.defer();
                var ex, exs = [];

                if (!targets)
                    targets = { };

                /* Some simple metadata checks */
                var meta = resource.metadata;
                if (meta) {
                    ex = null;
                    if (meta.name !== undefined) {
                        if (!meta.name)
                            ex = new Error("The name cannot be empty");
                        else if (!NAME_RE.test(meta.name))
                            ex = new Error("The name contains invalid characters");
                    }
                    if (ex) {
                        ex.target = targets["metadata.name"];
                        exs.push(ex);
                    }

                    ex = null;
                    if (meta.namespace !== undefined) {
                        if (!meta.namespace)
                            ex = new Error("The namespace cannot be empty");
                        else if (!NAME_RE.test(meta.namespace))
                            ex = new Error("The name contains invalid characters");
                    }
                    if (ex) {
                        ex.target = targets["metadata.namespace"];
                        exs.push(ex);
                    }
                }

                if (exs.length)
                    defer.reject(exs);
                else
                    defer.resolve();
                return defer.promise;
            }

            return {
                "create": createObjects,
                "delete": deleteResource,
                "check": checkResource,
                "patch": patchResource,
                post: postResource,
                put: putResource,
            };
        }
    ])

    /**
     * KubeRequest
     *
     * Create a new low level kubernetes request. These are instantiated
     * by kubeLoader or kubeMethods, and typically not used directly.
     *
     * An implementation of KubeRequest must be provided. It has the
     * following characteristics.
     *
     * promise = KubeRequest(method, path, [body, [config]])
     *
     * Creates a new request, for the given HTTP method and path. If body
     * is present it will be sent as the request body. If it an object or
     * array it will be encoded as JSON before being sent.
     *
     * If present the config object may include the following properties:
     *
     *  headers    An dict of headers to include
     *
     * In addition the config object can include implementation specific
     * settings or data.
     *
     * If successful the promise will resolve with a response object that
     * includes the following:
     *
     * status      Status code
     * statusText  Status reason or message
     * data        Response body, JSON decoded if response is json
     * headers     Response headers
     *
     * Implementation specific fields may also be present
     */

    .provider("KubeRequest", [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeRequestFactory = "MissingKubeRequest";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "KubeRequest");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeRequestFactory);
                }
            ];
        }
    ])

    .factory("MissingKubeRequest", [
        function() {
            return function MissingKubeRequest(path, callback) {
                throw new Error("no KubeRequestFactory set");
            };
        }
    ])

    /**
     * KubeSocket
     *
     * Create a new low level kubernetes websocket request
     *
     * An implementation of KubeSocket must be provided. It has the
     * following characteristics.
     *
     * ws = KubeSocket(path, [config])
     *
     * Creates a new websocket request, for the given path.
     *
     *  headers    An dict of headers to include
     *  protocals  An list or string of websocket protocols
     *
     * In addition the config object can include implementation specific
     * settings or data.
     *
     * A object is returned that implements the Web API
     * Websocket interface. Specifically it should
     * expose a 'readyState' attribute, provide
     * open and close functions, and emit open, close and
     * message events.
     *
     * Implementation specific fields may also be present
     */

    .provider("KubeSocket", [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeSocketFactory = "MissingKubeSocket";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "KubeSocket");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeSocketFactory);
                }
            ];
        }
    ])

    .factory("MissingKubeSocket", [
        function() {
            return function MissingKubeSocket(path, callback) {
                throw Error("no KubeSocketFactory set");
            };
        }
    ])

    /**
     * KubeWatch
     *
     * Create a new low level kubernetes watch. These are instantiated
     * by kubeLoader, and typically not used directly.
     *
     * An implementation of the KubeWatch must be provided. It has the
     * following characteristics:
     *
     * promise = KubeWatch(path, callback)
     *
     * The watch is given two arguments. The first is the kube resource
     * url to watch (without query string) a callback to invoke with
     * watch frames.
     *
     * The watch returns a deferred promise which will resolve when the initial
     * set of items has loaded, it will fail if the watch fails. The promise
     * should also have a promise.cancel() method which is invoked when the
     * watch should be stopped.
     *
     * callback(frames)
     *
     * The callback is invoked with an array of kubernetes watch frames that
     * look like: { type: "ADDED", object: { ... } }
     */

    .provider("KubeWatch", [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeWatchFactory = "MissingKubeWatch";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "KubeWatch");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeWatchFactory);
                }
            ];
        }
    ])

    .factory("MissingKubeWatch", [
        function() {
            return function MissingKubeWatch(path, callback) {
                throw Error("no KubeWatchFactory set");
            };
        }
    ])

    .provider("KubeDiscoverSettings", [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeDiscoverSettingsFactory = "MissingKubeDiscoverSettings";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "KubeDiscoverSettings");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeDiscoverSettingsFactory);
                }
            ];
        }
    ])

    .factory("MissingKubeDiscoverSettings", [
        function() {
            return function MissingKubeDiscoverSettings(path, callback) {
                throw Error("no KubeDiscoverSettingsFactory set");
            };
        }
    ]);
}());
