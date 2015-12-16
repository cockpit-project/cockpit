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

/* globals cockpit */

(function() {
    "use strict";

    function debug() {
        if (window.debugging == "all" || window.debugging == "kube")
            console.debug.apply(console, arguments);
    }

    function updateMessage(response) {
        if (!response)
            return;

        var obj;
        try {
            obj = JSON.parse(response.data);
        } catch(e) {
            return;
        }

        if (obj && obj.message)
            response.message = response.statusText = obj.message;
    }

    /*
     * Currently we assume that the certificates in the kube config
     * file are:
     *
     * base64(PEM(data))
     *
     * Since our http-stream1 expects PEM certificates (although they're
     * nasty, they're better than all the alternatives) so we strip out
     * the outer base64 layer.
     */

    function parseCertOption(object, option) {
        var match, data, blob = object[option + "-data"];
        if (blob !== undefined)
            return { data: window.atob(blob) };

        var file = object[option];
        if (file !== undefined)
            return { file: file };

        return undefined;
    }

    function basicToken(user, pass) {
        return window.btoa(window.unescape(encodeURIComponent(user + ":" + pass)));
    }

    function parseKubeConfig(data, contextName) {
        var config, blob, parser;
        var options = { port: 8080, headers: { }, payload: "http-stream2" };

        try {
            config = JSON.parse(data);
        } catch(ex) {
            console.warn("received invalid kubectl config", ex);
            return null;
        }

        if (!contextName)
            contextName = config["current-context"];
        var contexts = config["contexts"] || [];

        /* Find the cluster info */
        var userName, clusterName;
        contexts.forEach(function(info) {
            if (info.name === contextName) {
                var context = info.context || { };
                userName = context.user;
                clusterName = context.cluster;
            }
        });

        /* Find the user info */
        var user, users = config["users"] || [];
        users.forEach(function(info) {
            if (info.name === userName)
                user = info.user;
        });

        /* Find the cluster info */
        var cluster, clusters = config["clusters"] || [];
        clusters.forEach(function(info) {
            if (info.name == clusterName)
                cluster = info.cluster;
        });


        if (cluster) {
            if (cluster.server) {
                parser = document.createElement('a');
                parser.href = cluster.server;
                if (parser.hostname)
                    options.address = parser.hostname;
                if (parser.port)
                    options.port = parseInt(parser.port, 10);
                if (parser.protocol == 'https:') {
                    options.port = parseInt(parser.port, 10) || 6443;
                    options.tls = { };

                    options.tls.authority = parseCertOption(cluster, "certificate-authority");
                    options.tls.validate = !cluster["insecure-skip-tls-verify"];
                }
            }
        }

        /* Currently only certificate auth is supported */
        if (user) {
            if (user.token)
                options.headers["Authorization"] = "Bearer " + user.token;
            if (user.username)
                options.headers["Authorization"] = "Basic " + basicToken(user.username, user.password || "");
            if (options.tls) {
                options.tls.certificate = parseCertOption(user, "client-certificate");
                options.tls.key = parseCertOption(user, "client-key");
            }
        }

        debug("parsed kube config", options);
        return options;
    }

    angular.module("kubeClient.cockpit", [
        "kubeClient",
    ])

    .factory("CockpitKubeWatch", [
        "$q",
        "KUBE_SCHEMA",
        "cockpitKubeDiscover",
        function($q, KUBE_SCHEMA, cockpitKubeDiscover) {
            return function CockpitKubeWatch(path, callback) {
                debug("creating watch:", path);

                /* Used to track the last resource for restarting query */
                var lastResource;

                /* Whether close has been called */
                var stopping = false;

                /* The current HTTP request */
                var channel = null;

                /* The http options */
                var http = null;

                /* Waiting to do the next http request */
                var wait = null;

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

                var defer = $q.defer();
                var promise = defer.promise;
                var loaded = false;
                var objects = { };
                var previous;
                var loading;

                function loadBegin(full) {
                    if (full) {
                        previous = objects;
                        objects = { };
                    } else {
                        previous = null;
                    }
                    loadPoke(true);
                }

                function loadPoke(force) {
                    if (force || loading !== undefined) {
                        window.clearTimeout(loading);
                        loading = window.setTimeout(loadFinish, 100);
                    }
                }

                function loadFinish(ex) {
                    if (loaded)
                        return;
                    loaded = true;

                    var key, prev, frames = [];
                    prev = previous;
                    previous = null;
                    for (key in prev) {
                        if (!(key in objects))
                            frames.push({ type: "DELETED", object: prev[key] });
                    }

                    /* Simulated delete frames */
                    if (frames.length)
                        callback(frames);

                    /* Tell callback to flush */
                    callback([]);

                    if (ex)
                        defer.reject(ex);
                    else
                        defer.resolve();
                }

                /*
                 * Each change is sent as an individual line from Kubernetes
                 * but they may not arrive exactly that way, so we buffer
                 * and split lines again.
                 */

                var buffer;
                function handleWatch(data) {
                    if (buffer)
                        data = buffer + data;

                    var lines = data.split("\n");
                    var i, length = lines.length - 1;

                    /* Last line is incomplete save for later */
                    buffer = lines[length];

                    var frames = [];

                    /* Process all the others */
                    var frame, object;
                    for (i = 0; i < length; i++) {
                        try {
                            frame = JSON.parse(lines[i]);
                        } catch (ex) {
                            console.warn(lines[i], ex);
                            channel.close();
                            continue;
                        }

                        object = frame.object;
                        if (!object) {
                            console.warn("invalid watch without object");
                            continue;
                        }

                        /* The watch failed, likely due to invalid resourceVersion */
                        if (frame.type == "ERROR") {
                            if (lastResource) {
                                lastResource = null;
                                startWatch();
                            }
                            continue;
                        }

                        var meta = object.metadata;
                        if (!meta || !meta.uid || !object.kind) {
                            console.warn("invalid kube object: ", object);
                            continue;
                        }

                        lastResource = meta.resourceVersion;

                        /* We track objects here so we can restart watches */
                        var uid = meta.uid;
                        if (frame.type == "DELETED")
                            delete objects[uid];
                        else
                            objects[uid] = object;

                        debug(frame.type, object.kind, meta.uid);
                        frames.push(frame);
                    }

                    callback(frames);
                    loadPoke();
                }

                function startWatch() {
                    if (channel)
                        return;

                    var full = true;
                    var uri = path + "?watch=true";

                    /*
                     * If we have a last resource we can guarantee that we don't miss
                     * any objects or changes to objects. If we don't have one, then we
                     * have to list everything again. Still watch at the same time though.
                     */
                    if (lastResource) {
                        uri += "&resourceVersion=" + encodeURIComponent(lastResource);
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

                    var opts = angular.extend({ }, http, {
                        path: uri,
                        method: "GET"
                    });

                    channel = cockpit.channel(opts);

                    var response = { };
                    var failed = false;
                    channel.addEventListener("control", function(ev, options) {
                        if (options.command == "response") {
                            response = options;
                            if (response.status > 299)
                                failed = true;
                            loadBegin(full);
                        }
                    });

                    channel.addEventListener("message", function(ev, payload) {
                        if (failed)
                            response.data = (response.data || "") + payload;
                        else
                            handleWatch(payload);
                    });

                    channel.addEventListener("close", function(ev, options) {
                        channel = null;
                        loading = false;
                        if (stopping)
                            return;

                        var msg = "watching " + path + " failed: ";
                        var problem = options.problem;
                        var status = response.status;

                        if (problem) {
                            msg += problem;
                            if (problem == "disconnected")
                                debug(msg);
                            else
                                console.warn(msg);
                            response.problem = problem;
                            response.status = 999;
                            loadFinish(response);

                        } else if (failed) {
                            updateMessage(response);
                            msg += (response.message || response.reason || status);
                            if (status === 404 || status === 410) {
                                debug(msg);
                                return; /* don't try watch again if we get a 404 */
                            } else {
                                console.warn(msg);
                            }
                            if (status === 403)
                                return; /* don't try again for forbidden */
                            loadFinish(response);

                        } else if (!blocked) {
                            console.warn("watching kube " + path + " didn't block");

                        } else {
                            startWatch();
                            return;
                        }

                        startWatchLater();
                    });

                    /* No http request body */
                    channel.control({ command: "done" });
                }

                function startWatchLater() {
                    if (!wait) {
                        wait = window.setTimeout(function() {
                            wait = null;
                            startWatch();
                        }, 5000);
                    }
                }

                $q.when(cockpitKubeDiscover(), function(options) {
                    http = options;
                    startWatch();
                });

                promise.cancel = function cancel(ex) {
                    stopping = true;
                    var problem;
                    if (channel) {
                        if (ex)
                            problem = ex.problem;
                        channel.close(problem || "disconnected");
                        channel = null;
                    }
                    window.clearTimeout(wait);
                    wait = null;
                    http = null;
                    loadFinish(ex);
                };

                return promise;
            };
        }
    ])

    .factory("CockpitKubeRequest", [
        "$q",
        "$injector",
        function($q, $injector) {
            var CONTENT_TYPE = "Content-Type";
            var JSON_TYPE = "application/json";
            return function CockpitKubeRequest(method, path, body, config) {
                var defer = $q.defer();
                var promise = defer.promise;
                var connect, channel;

                var heads = { };
                if (body && typeof body == "object") {
                    body = JSON.stringify(body);
                    heads[CONTENT_TYPE] = JSON_TYPE;
                }

                /*
                 * If we're called with fully formed options, then don't do
                 * connect discovery stuff. Otherwise ask our connect service
                 * for connection info, and do discovery.
                 */
                if (config && config.port)
                    connect = config;
                else
                    connect = $injector.get('cockpitKubeDiscover')();

                $q.when(connect, function connected(options) {
                    var opts = angular.extend({ }, config, options, {
                        path: path,
                        method: method,
                        payload: "http-stream2"
                    });

                    opts.headers = angular.extend(heads, opts.headers || { });
                    channel = cockpit.channel(opts);

                    var response = { };
                    channel.addEventListener("control", function(ev, options) {
                        if (options.command == "response") {
                            response = options;
                            response.statusText = response.reason;
                        }
                    });

                    channel.addEventListener("message", function(ev, payload) {
                        response.data = (response.data || "") + payload;
                    });

                    channel.addEventListener("close", function(ev, options) {
                        var type;
                        channel = null;

                        if (options.problem) {
                            response.problem = response.statusText = options.problem;
                            response.status = 999;
                        }

                        var headers = response.headers || { };
                        if (headers[CONTENT_TYPE] == JSON_TYPE) {
                            try {
                                response.data = JSON.parse(response.data);
                            } catch (ex) {
                                /* it's not JSON, just leave as text */
                            }
                        }

                        if (response.status > 299) {
                            updateMessage(response);
                            defer.reject(response);
                        } else {
                            defer.resolve(response);
                        }
                    });

                    if (body)
                        channel.send(body);
                    channel.control({ command: "done" });

                /* Failed to connect */
                }, function failed(response) {
                    defer.reject(response);
                });

                /* Helpful function on the promise */
                promise.cancel = function cancel() {
                    if (connect.cancel)
                        connect.cancel();
                    if (channel)
                        channel.close("cancelled");
                };

                return promise;
            };
        }
    ])

    .factory("cockpitKubectlConfig", [
        '$q',
        function($q) {
            return function cockpitKubectlConfig() {
                var defer = $q.defer();
                var promise = defer.promise;
                var channel = cockpit.channel({
                    "payload": "stream",
                    "spawn": ["kubectl", "config", "view", "--output=json", "--raw"],
                    "err": "message"
                });

                var result = "";
                channel.addEventListener("message", function(ev, payload) {
                    result += payload;
                });
                channel.addEventListener("close", function(ev, options) {
                    channel = null;
                    if (options.problem)
                        defer.reject(options);
                    else
                        defer.resolve(result);
                });

                promise.cancel = function cancel(options) {
                    if (channel)
                        channel.close(options || "cancelled");
                };
                return promise;
            };
        }
    ])

    .factory("cockpitKubeDiscover", [
        "$q",
        "CockpitKubeRequest",
        "cockpitKubectlConfig",
        function($q, CockpitKubeRequest, cockpitKubectlConfig) {
            var defer = null;
            return function cockpitKubeDiscover(force) {
                if (!force && defer)
                    return defer.promise;

                var last, aux, req;
                defer = $q.defer();

                var schemes = [
                    { port: 8080 },
                    { port: 8443, tls: { } },
                    { port: 6443, tls: { } },
                ];

                function step(options, kubeConfig) {
                    if (!options)
                        options = schemes.shift();

                    /* No further ports to try? */
                    if (!options) {
                        last.statusText = "Couldn't find running kube-apiserver";
                        last.problem = "not-found";
                        defer.reject(last);
                        return;
                    }

                    debug("trying kube at:", options);
                    req = new CockpitKubeRequest("GET", "/api", "", options);
                    req.then(function(response) {
                        req = null;
                        var resp = response.data;
                        if (resp && resp.versions) {
                            debug("discovered kube api", resp);
                            defer.resolve(options, kubeConfig);
                        } else {
                            debug("not an api endpoint:", options);
                            last = response;
                            step();
                        }
                    })
                    .catch(function(response) {
                        req = null;
                        last = response;
                        if (response.problem === "not-found") {
                            debug("api endpoint not found on:", options);
                            step();
                        } else {
                            debug("connecting to kube failed:", response);
                            defer.reject(response);
                        }
                    });
                }

                var kubectl = cockpitKubectlConfig()
                    .then(function(data) {
                        var options = parseKubeConfig(data);
                        step(options, options ? data : null);
                    })
                    .catch(function(options) {
                        console.warn("kubectl failed: " + (options.message || options.problem));
                        step();
                    });

                defer.promise.cancel = function cancel() {
                    kubectl.cancel("cancelled");
                    if (req)
                        req.close("cancelled");
                };
                return defer.promise;
            };
        }
    ]);

}());
