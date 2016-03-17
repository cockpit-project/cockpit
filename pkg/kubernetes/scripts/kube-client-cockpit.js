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
        var options = { port: 8080, headers: { } };

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
                    if (!parser.port || parser.port === "0")
                        options.port = parser.href == cluster.server ? 6443 : 443;

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
        "kubeUtils",
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
                            console.warn("invalid watch without object", frame);
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
                            if (status === 404 || status === 410 || status === 403 ) {
                                debug(msg);
                                loadFinish(response);
                                return; /* don't try watch again if we get a 404/410/403 */
                            } else {
                                console.warn(msg);
                            }
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
                }, function(resp) {
                    loadFinish(resp);
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

    /*
     * A WebSocket factory for the kubernetes-container-terminal
     * that uses the kubectl command with a fake websocket
     */
    .factory("CockpitKubectlWebSocket", [
        function() {

            function decode(href, options) {
                var pos = href.indexOf('?');
                var first = href;
                var path;
                if (pos === -1)
                    first = href;
                else
                    first = href.substr(0, pos);

                path = first.split('/').map(decodeURIComponent);

                if (pos !== -1) {
                    angular.forEach(href.substring(pos + 1).split("&"), function(opt) {
                        var last, parts = opt.split('=');
                        var name = decodeURIComponent(parts[0]);
                        var value = decodeURIComponent(parts[1]);
                        if (options.hasOwnProperty(name)) {
                            last = options[name];
                            if (!angular.isArray(last))
                                last = options[name] = [ last ];
                            last.push(value);
                        } else {
                            options[name] = value;
                        }
                    });
                }

                return path;
            }

            function parser(url) {
                var options = { };
                var path = decode(url, options);

                var command = [ ];
                var args = [ ];
                var namespace = "default";
                var container = null;
                var cmd = "log";
                var pod = "";

                var i, len;
                for (i = 0, len = path.length; i < len; i++) {
                    if (path[i] === "namespaces") {
                        namespace = path[++i];
                    } else if (path[i] === "pods") {
                        pod = path[++i];
                        if (path[i + 1] == "exec")
                            cmd = "exec";
                        else if (path[i + 1] == "log")
                            cmd = "logs";
                    }
                }

                for (i in options) {
                    if (i == "container") {
                        container = options[i];
                    } else if (i == "command") {
                        if (angular.isArray(options[i]))
                            command = options[i];
                        else
                            command.push(options[i]);
                    } else if (i == "stdin" || i == "tty" || i == "follow") {
                        args.push("--" + i);
                    }
                }

                var ret = [ "kubectl", cmd, "--namespace=" + namespace ];
                if (container)
                    ret.push("--container=" + container);
                ret.push.apply(ret, args);
                ret.push(pod, "--");
                ret.push.apply(ret, command);
                return ret;
            }

            return function KubeFakeWebSocket(url, protocols) {
                var cmd = parser(url);
                var base64 = false;

                /* A fake WebSocket */
                var channel;
                var state = 0; /* CONNECTING */
                var ws = { };
                cockpit.event_target(ws);

                function open() {
                    channel = cockpit.channel({
                        payload: "stream",
                        spawn: cmd,
                        pty: true
                    });

                    channel.addEventListener("close", function(ev, options) {
                        var problem = options.problem || "";
                        channel = null;

                        state = 3;
                        var cev = document.createEvent('Event');
                        cev.initEvent('close', false, false, !!problem, 1000, problem);
                        ws.dispatchEvent(cev);
                    });

                    channel.addEventListener("message", function(ev, data) {
                        if (base64)
                            data = "1" + window.btoa(data);
                        /* It's because of phantomjs */
                        var mev = document.createEvent('MessageEvent');
                        if (!mev.initMessageEvent)
                            mev = new window.MessageEvent('message', { 'data': data });
                        else
                            mev.initMessageEvent('message', false, false, data, null, null, window, null);
                        ws.dispatchEvent(mev);
                    });

                    state = 1;
                    var oev = document.createEvent('Event');
                    oev.initEvent('open', false, false);
                    ws.dispatchEvent(oev);
                }

                function fail() {
                    var ev = document.createEvent('Event');
                    ev.initEvent('close', false, false, false, 1002, "protocol-error");
                    ws.dispatchEvent(ev);
                }

                function close(code, reason) {
                    if (channel)
                        channel.close(reason);
                }

                function send(data) {
                    if (base64)
                        data = window.atob(data.slice(1));
                    if (channel)
                        channel.send(data);
                }

                /* A fake WebSocket */
                Object.defineProperties(ws, {
                    binaryType: { value: "arraybuffer" },
                    bufferedAmount: { value: 0 },
                    extensions: { value: "" },
                    protocol: { value: base64 ? "base64.channel.k8s.io" : "" },
                    readyState: { get: function() { return state; } },
                    url: { value: url },
                    close: { value: close },
                    send: { value: send },
                });

                var valid = true;
                if (protocols) {
                    if (angular.isArray(protocols))
                        valid = base64 = protocols.indexOf("base64.channel.k8s.io") !== -1;
                    else
                        valid = base64 = "base64.channel.k8s.io";
                }

                if (valid) {
                    window.setTimeout(open);
                } else {
                    console.warn("Unsupported kubernetes container WebSocket subprotocol: " + protocols);
                    window.setTimeout(fail);
                }

                return ws;
            };
        }
    ])

    .factory("CockpitKubeSocket", [
        "$q",
        "$injector",
        function($q, $injector) {
            return function CockpitKubeSocket(url, config) {
                var connect;
                var state = 0; /* CONNECTING */
                var ws = { };
                var channel;

                var protocols = [];
                if (config && config.protocols) {
                    protocols = config.protocols;
                    if (!angular.isArray(protocols))
                        protocols = [ String(config.protocols) ];
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

                function fail() {
                    var ev = document.createEvent('Event');
                    ev.initEvent('close', false, false, false, 1002, "protocol-error");
                    ws.dispatchEvent(ev);
                }

                function close(code, reason) {
                    if (channel)
                        channel.close(reason);
                }

                function send(data) {
                    if (channel)
                        channel.send(data);
                }

                /* A fake WebSocket */
                Object.defineProperties(ws, {
                    binaryType: { value: "arraybuffer" },
                    bufferedAmount: { value: 0 },
                    extensions: { value: "" },
                    protocol: { value: protocols[0] },
                    readyState: { get: function() { return state; } },
                    url: { value: url },
                    close: { value: close },
                    send: { value: send },
                });

                $q.when(connect, function connected(options) {
                    cockpit.event_target(ws);

                    channel = cockpit.channel(angular.extend({ }, options, {
                        payload: "websocket-stream1",
                        path: url,
                        protocols: protocols,
                    }));

                    channel.addEventListener("close", function(ev, options) {
                        var problem = options.problem || "";
                        channel = null;

                        state = 3;
                        var cev = document.createEvent('Event');
                        cev.initEvent('close', false, false, !!problem, 1000, problem);
                        ws.dispatchEvent(cev);
                    });

                    channel.addEventListener("message", function(ev, data) {
                        /* It's because of phantomjs */
                        var mev = document.createEvent('MessageEvent');
                        if (!mev.initMessageEvent)
                            mev = new window.MessageEvent('message', { 'data': data });
                        else
                            mev.initMessageEvent('message', false, false, data, null, null, window, null);
                        ws.dispatchEvent(mev);
                    });

                    state = 1;
                    var oev = document.createEvent('Event');
                    oev.initEvent('open', false, false);
                    ws.dispatchEvent(oev);
                });

                return ws;
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

                if (!config)
                    config = { };

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

                    opts.headers = angular.extend(heads, config.headers || { }, options.headers || { });
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
        "cockpitConnectionInfo",
        function($q, CockpitKubeRequest, cockpitKubectlConfig, info) {
            var defer = null;

            return function cockpitKubeDiscover(force) {
                if (!force && defer)
                    return defer.promise;

                var last, req, kubectl, loginOptions;
                var loginData = window.sessionStorage.getItem('login-data');
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
                        last.statusText = "Couldn't find running API server";
                        last.problem = "not-found";
                        defer.reject(last);
                        return;
                    }

                    /* If options is a function call it, the function is
                     * responsible to call step again when ready */
                    if (typeof options === "function") {
                        options();
                        return;
                    }

                    options.payload = "http-stream2";
                    debug("trying kube at:", options);
                    req = new CockpitKubeRequest("GET", "/api", "", options);
                    req.then(function(response) {
                        req = null;
                        var resp = response.data;
                        if (resp && resp.versions) {
                            debug("discovered kube api", resp);
                            if (kubeConfig) {
                                info.kubeConfig = kubeConfig;
                                if (kubectl)
                                    info.type = "kubectl";
                                else
                                    info.type = "sessionData";
                            } else {
                                info.type = "open";
                            }

                            defer.resolve(options);
                        } else {
                            debug("not an api endpoint:", options);
                            last = response;
                            kubectl = null;
                            step();
                        }
                    })
                    .catch(function(response) {
                        req = null;
                        kubectl = null;
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

                function kubectlStep() {
                    kubectl = cockpitKubectlConfig()
                        .then(function(data) {
                            var options = parseKubeConfig(data);
                            step(options, options ? data : null);
                        })
                        .catch(function(options) {
                            console.warn("kubectl failed: " + (options.message || options.problem));
                            step();
                        });
                }

                schemes.unshift(kubectlStep);
                if (loginData)
                    loginOptions = parseKubeConfig(loginData);
                step(loginOptions, loginOptions ? loginData : null);

                defer.promise.cancel = function cancel() {
                    if (kubectl && kubectl.cancel)
                        kubectl.cancel("cancelled");

                    if (req)
                        req.close("cancelled");
                };
                return defer.promise;
            };
        }
    ])

    .factory("CockpitEnvironment", [
        "$q",
        function($q) {
            var defer = $q.defer();
            var settings = null;
            return function cockpitKubeSettings() {
                if (settings !== null)
                    return defer.promise;
                var channel = cockpit.channel({ payload: "dbus-json3", bus: "internal" });
                channel.addEventListener("close", function(ev, options) {
                    if (options.problem) {
                        console.warn("couldn't retrieve environment:", options.problem);
                        defer.reject(options);
                    } else {
                        defer.resolve(settings);
                    }
                });
                channel.addEventListener("message", function(ev, data) {
                    var result = JSON.parse(data);
                    if (result.reply) {
                        settings = result.reply[0][0].Variables.v;
                        channel.close(null);
                    } else if (result.error) {
                        console.warn("error retrieving environment:", result.error);
                        channel.close("internal-error");
                    }
                });
                channel.send(JSON.stringify({
                    id: "cookie",
                    call: [ "/environment", "org.freedesktop.DBus.Properties", "GetAll",
                                [ "cockpit.Environment" ] ]
                }));
                return defer.promise;
            };
        }
    ])

    .factory("cockpitKubeDiscoverSettings", [
        "$q",
        "CockpitKubeRequest",
        "cockpitKubeDiscover",
        "CockpitEnvironment",
        'kubeLoader',
        function($q, CockpitKubeRequest, cockpitKubeDiscover, CockpitEnvironment, loader) {
            var promise = null;
            return function kubeDiscoverSettings(force) {
                if (!force && promise)
                    return promise;

                var settings = {
                    registry: {},
                    flavor: "kubernetes",
                    isAdmin: false,
                };

                var env_p = CockpitEnvironment()
                    .then(function(result) {
                        var value = result["REGISTRY_HOST"];
                        if (value)
                            settings.registry.host = value;

                    }, function(ex) {});

                var discover_p = cockpitKubeDiscover(force)
                    .then(function(options) {
                        var req = new CockpitKubeRequest("GET", "/oapi", "", options)
                            .then(function() {
                                settings.flavor = "openshift";
                            }, function () {
                                settings.flavor = "kubernetes";
                            });

                        var watch = loader.watch("namespaces")
                            .then(function () {
                                settings.isAdmin = true;
                            },function () {
                                settings.isAdmin = false;
                            });

                        var authorization;
                        /* See if we have a bearer token to use */
                        if (options.headers) {
                            authorization = (options.headers['Authorization'] || "").trim();
                            if (authorization.toLowerCase().indexOf("bearer ") === 0)
                                settings.registry.password = authorization.substr(7).trim();
                        }
                        return $q.all([watch, req]);
                    });

                promise = $q.all([discover_p, env_p])
                    .then(function() {
                        return settings;
                    });

                return promise;
            };
        }
    ])

    .factory('cockpitConnectionInfo', function () {
        return {
            type: null,
            kubeConfig: null,
        };
    })

    .factory('cockpitContainerWebSocket', [
        'CockpitKubeSocket',
        'CockpitKubectlWebSocket',
        'cockpitConnectionInfo',
        function (socket, kubectlSocket, info) {
            return function(url, protocols) {
                /* config retrieved from kubectl? */
                if (info.type == "kubectl")
                    return kubectlSocket(url, protocols);
                else
                    return socket(url, protocols);
            };
        }
    ])

    .factory('CockpitFormat', function() {
        return {
            formatBytes: cockpit.format_bytes,
            formatBitsPerSec: cockpit.format_bits_per_sec,
            format: cockpit.format
        };
    })

    .factory('CockpitMetrics', function() {
        return {
            grid: cockpit.grid,
            series: cockpit.series,
        };
    })

    .factory('CockpitTranslate', function() {
        // TODO: Implement translations
        return {
            gettext: function (context, value) {
                if (arguments.length > 1)
                    return value;
                else
                    return context;
            },
        };
    });
}());
