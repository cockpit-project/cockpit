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

var mock = mock || { };

var phantom_checkpoint = phantom_checkpoint || function () { };

(function() {
"use strict";

if (typeof window.debugging === "undefined") {
    var match = /debugging=([^;]*)/.exec(document.cookie);
    if (match)
        window.debugging = match[1];
}

function in_array(array, val) {
    var length = array.length;
    for (var i = 0; i < length; i++) {
        if (val === array[i])
            return true;
    }
    return false;
}

/* HACK: http://web.mit.edu/jwalden/www/isArray.html */
function is_array(it) {
    return Object.prototype.toString.call(it) === '[object Array]';
}

function BasicError(problem) {
    this.problem = problem;
    this.message = problem;
    this.toString = function() {
        return this.message;
    };
}

/* -------------------------------------------------------------------------
 * Host discovery
 */

/*
 * TODO: We will expose standard client side url composability
 * utilities soon, for now this is private.
 */

function decode_options(hash) {
    var opts = { };

    if (hash[0] == '#')
        hash = hash.substr(1);

    var query = hash.split('?');
    if (query.length > 1) {
        var params = query[1].split("&");
        for (var i = 0; i < params.length; i++) {
            var vals = params[i].split('=');
            opts[decodeURIComponent(vals[0])] = decodeURIComponent(vals[1]);
        }
    }

    return opts;
}

function get_page_host() {
    /*
     * HACK: Mozilla will unescape 'window.location.hash' before returning
     * it, which is broken.
     *
     * https://bugzilla.mozilla.org/show_bug.cgi?id=135309
     */
    var hash = (window.location.href.split('#')[1] || '');

    /* This is a temporary HACK to pass the default host into embedded
     * components.
     */
    var opts = decode_options(hash);
    return opts["_host_"];
}

/* -------------------------------------------------------------------------
 * Channels
 *
 * Public: https://files.cockpit-project.org/guide/api-cockpit.html
 */

var default_transport = null;
var reload_after_disconnect = false;
var expect_disconnect = false;
var init_callback = null;
var filters = [ ];

var origin = window.location.origin;
if (!origin) {
    origin = window.location.protocol + "//" + window.location.hostname +
        (window.location.port ? ':' + window.location.port: '');
}

window.addEventListener('beforeunload', function() {
    expect_disconnect = true;
}, false);

function transport_debug() {
    if (window.debugging == "all" || window.debugging == "channel")
        console.debug.apply(console, arguments);
}

function event_mixin(obj, handlers) {
    obj.addEventListener = function addEventListener(type, handler) {
        if (handlers[type] === undefined)
            handlers[type] = [ ];
        handlers[type].push(handler);
    };
    obj.removeEventListener = function removeEventListener(type, handler) {
        var length = handlers[type] ? handlers[type].length : 0;
        for (var i = 0; i < length; i++) {
            if (handlers[type][i] == handler) {
                handlers[type][i] = null;
                break;
            }
        }
    };
    obj.dispatchEvent = function dispatchEvent(event) {
        var type = event.type;
        if (typeof obj['on' + type] === "function")
            obj['on' + type].apply(obj, arguments);
        var length = handlers[type] ? handlers[type].length : 0;
        for (var i = 0; i < length; i++) {
            if (handlers[type][i])
                handlers[type][i].apply(obj, arguments);
        }
    };
}

function calculate_url() {
    if (window.mock && window.mock.url)
        return window.mock.url;
    var window_loc = window.location.toString();
    if (window_loc.indexOf('http:') === 0) {
        return "ws://" + window.location.host + "/socket";
    } else if (window_loc.indexOf('https:') === 0) {
        return "wss://" + window.location.host + "/socket";
    } else {
        transport_debug("Cockpit must be used over http or https");
        return null;
    }
}

/* Private Transport class */
function Transport() {
    var self = this;

    /* We can trigger events */
    event_mixin(self, { });

    var last_channel = 0;
    var channel_seed = "";

    if (window.mock)
        window.mock.last_transport = self;

    var ws_loc = calculate_url();

    transport_debug("Connecting to " + ws_loc);

    var ws;
    if (ws_loc) {
        if ("WebSocket" in window) {
            ws = new WebSocket(ws_loc, "cockpit1");
        } else if ("MozWebSocket" in window) { // Firefox 6
            ws = new MozWebSocket(ws_loc);
        } else {
            console.error("WebSocket not supported, application will not work!");
        }
    }

    if (!ws) {
        ws = { close: function() { } };
        window.setTimeout(function() {
            self.close({"reason": "no-cockpit"});
        }, 50);
    }

    var control_cbs = { };
    var message_cbs = { };
    var got_message = false;
    var waiting_for_init = true;
    self.ready = false;

    var check_health_timer = window.setInterval(function () {
        if (!got_message) {
            console.log("health check failed");
            self.close({ "reason": "timeout" });
        }
        got_message = false;
    }, 10000);

    /* Called when ready for channels to interact */
    function ready_for_channels() {
        if (!self.ready) {
            self.ready = true;
            var event = document.createEvent("CustomEvent");
            event.initCustomEvent("ready", false, false, null);
            self.dispatchEvent(event);
        }
    }

    ws.onopen = function() {
        if (ws) {
            ws.send("\n{ \"command\": \"init\", \"version\": 0 }");
        }
    };

    ws.onclose = function(event) {
        transport_debug("WebSocket onclose");
        ws = null;
        if (reload_after_disconnect) {
            expect_disconnect = true;
            window.location.reload(true);
        }
        if (expect_disconnect)
            return;
        self.close();
    };

    ws.onmessage = function(event) {
        got_message = true;

        var data = event.data;

        /* Call all the filters */
        var length = filters.length;
        for (var i = 0; i < length; i++) {
            if (filters[i](data) === false)
                return;
        }

        /* The first line of a message is the channel */
        var pos = data.indexOf("\n");
        var channel = data.substring(0, pos);
        var payload = data.substring(pos + 1);

        if (!channel) {
            transport_debug("recv control:", payload);
            process_control(JSON.parse(payload));
        } else {
            transport_debug("recv " + channel + ":", payload);
            process_message(channel, payload);
        }

        phantom_checkpoint();
    };

    self.close = function close(options) {
        if (self === default_transport)
            default_transport = null;
        if (!options)
            options = { "reason": "disconnected" };
        options.command = "close";
        clearInterval(check_health_timer);
        var ows = ws;
        ws = null;
        if (ows)
            ows.close();
        ready_for_channels(); /* ready to fail */
        process_control(options);
    };

    self.next_channel = function next_channel() {
        last_channel++;
        return channel_seed + String(last_channel);
    };

    function process_init(options) {
        if (options.version !== 0) {
            console.error("received invalid version in init message");
            self.close({"reason": "protocol-error"});
            return;
        }

        if (options["channel-seed"])
            channel_seed = String(options["channel-seed"]);
        cockpit.transport.options = options;

        if (waiting_for_init) {
            waiting_for_init = false;
            ready_for_channels();
        }

        if (init_callback)
            init_callback(options);
    }

    function process_control(data) {
        var channel = data.channel;
        var func;

        /* Init message received */
        if (data.command == "init") {
            process_init(data);
            return;
        }

        if (waiting_for_init) {
            waiting_for_init = false;
            if (data.command != "close" || data.channel) {
                console.error ("received message before init");
                data = { "reason": "protocol-error" };
            }
            self.close(data);
            return;
        }

        /* 'ping' messages are ignored */
        if (data.command == "ping")
            return;

        /* Broadcast to everyone if no channel */
        if (channel === undefined) {
            for (var chan in control_cbs) {
                func = control_cbs[chan];
                func.apply(null, [data]);
            }
        } else {
            func = control_cbs[channel];
            if (func)
                func.apply(null, [data]);
        }
    }

    function process_message(channel, payload) {
        var func = message_cbs[channel];
        if (func)
            func.apply(null, [payload]);
    }

    self.send_data = function send_data(data) {
        if (!ws) {
            console.log("transport closed, dropped message: " + data);
            return false;
        }
        ws.send(data);
        return true;
    };

    self.send_message = function send_message(channel, payload) {
        if (channel)
            transport_debug("send " + channel + ":", payload);
        else
            transport_debug("send control:", payload);
        return self.send_data(channel.toString() + "\n" + payload);
    };

    self.send_control = function send_control(data) {
        if(!ws && data.command == "close")
            return; /* don't complain if closed and closing */
        self.send_message("", JSON.stringify(data));
    };

    self.register = function register(channel, control_cb, message_cb) {
        control_cbs[channel] = control_cb;
        message_cbs[channel] = message_cb;
    };

    self.unregister = function unregister(channel) {
        delete control_cbs[channel];
        delete message_cbs[channel];
    };
}

function ensure_transport(callback) {
    var transport;
    if (!default_transport)
        default_transport = new Transport();
    transport = default_transport;
    if (transport.ready) {
        callback(transport);
    } else {
        transport.addEventListener("ready", function() {
            callback(transport);
        });
    }
}

function Channel(options) {
    var self = this;

    /* We can trigger events */
    event_mixin(self, { });

    var transport;
    var valid = true;
    var queue = [ ];
    var id = null;

    /* Handy for callers, but not used by us */
    self.valid = valid;
    self.options = options;
    self.id = id;

    function on_message(payload) {
        var event = document.createEvent("CustomEvent");
        event.initCustomEvent("message", false, false, payload);
        self.dispatchEvent(event, payload);
    }

    function on_close(data) {
        self.valid = valid = false;
        if (transport && id)
            transport.unregister(id);
        var event = document.createEvent("CustomEvent");
        event.initCustomEvent("close", false, false, data);
        self.dispatchEvent(event, data);
    }

    function on_control(data) {
        if (data.command == "close")
            on_close(data);
        else
            console.log("unhandled control message: '" + data.command + "'");
    }

    ensure_transport(function(trans) {
        transport = trans;
        if (!valid)
            return;

        id = transport.next_channel();
        self.id = id;

        /* Register channel handlers */
        transport.register(id, on_control, on_message);

        /* Now open the channel */
        var command = {
            "command" : "open",
            "channel": id
        };
        for (var i in options) {
            if (options.hasOwnProperty(i) && command[i] === undefined)
                command[i] = options[i];
        }
        if (command.host === undefined)
            command.host = get_page_host();
        transport.send_control(command);

        /* Now drain the queue */
        while(queue.length > 0)
            transport.send_message(id, queue.shift());
    });

    self.send = function send(message) {
        if (!valid)
            console.log("sending message on closed channel: " + self);
        else if (!transport)
            queue.push(message);
        else
            transport.send_message(id, message);
    };

    self.close = function close(options) {
        self.valid = valid = false;
        if (!options)
            options = { };
        else if (typeof options == "string")
            options = { "reason" : options + "" };
        options["command"] = "close";
        options["channel"] = id;
        if (transport) {
            transport.send_control(options);
            transport.unregister(id);
        }
        on_close(options);
    };

    self.toString = function toString() {
        var host = options["host"] || "localhost";
        return "[Channel " + (valid ? id : "<invalid>") + " -> " + host + "]";
    };
}

/* ----------------------------------------------------------------------------------
 * Package Lookup
 */

var host_packages = { };

function Package(names, pkg) {
    this.name = names[0] || null;
    this.checksum = null;
    this.manifest = pkg.manifest || { };
    this.manifest.alias = [];

    var i, length = names.length;
    for (i = 1; i < length; i++) {
        if (names[i].indexOf("$") === 0)
            this.checksum = names[i];
        else
            this.manifest.alias.push(names[i]);
    }
}

function package_debug() {
    if (window.debugging == "all" || window.debugging == "package")
        console.debug.apply(console, arguments);
}

function build_packages(packages) {
    var result = { };
    package_debug("packages: ", packages);
    for (var i = 0; i < packages.length; i++) {
        var pkg = packages[i];
        var names = pkg.id || [ ];
        pkg = new Package(names, packages[i]);
        for (var j = 0; j < names.length; j++)
            result[names[j]] = pkg;
        package_debug("package: ", pkg.name, pkg);
    }
    return result;
}

function package_table(host, callback) {
    if (!host)
        host = get_page_host();
    var table = host_packages[host];
    if (table) {
        callback(table, null);
        return;
    }
    var channel = new Channel({ "host": host, "payload": "resource1" });
    channel.onclose = function(event, options) {
        if (options.reason) {
            package_debug("package listing failed: " + options.reason);
            callback(null, options.reason);
        } else {
            host_packages[host] = table = build_packages(options.packages || []);
            callback(table, null);
        }
    };
}

function package_info(name, callback) {
    var parts = name.split('@');
    name = parts[0];
    var host = parts[1];

    package_table(host, function(table, problem) {
        if (table && name in table)
            callback(table[name], null);
        else
            callback(null, problem || "not-found");
    });
}

function basic_scope(cockpit) {
    cockpit.channel = function channel(options) {
        return new Channel(options);
    };

    cockpit.logout = function logout(reload) {
        if (reload !== false)
            reload_after_disconnect = true;
        ensure_transport(function(transport) {
            transport.send_control({ "command": "logout", "disconnect": true });
        });
    };

    /* Not public API ... yet? */
    cockpit.drop_privileges = function drop_privileges() {
        ensure_transport(function(transport) {
            transport.send_control({ "command": "logout", "disconnect": false });
        });
    };

    cockpit.transport = {
        inject: function inject(message) {
            if (!default_transport)
                return false;
            return default_transport.send_data(message);
        },
        filter: function filter(callback) {
            filters.push(callback);
        },
        close: function close(reason) {
            if (!default_transport)
                return;
            var options;
            if (reason)
                options = {"reason": reason };
            default_transport.close(options);
        },
        origin: origin,
        options: { }
    };
}


function full_scope(cockpit, $) {

    /* ---------------------------------------------------------------------
     * User and system information
     */

    cockpit.user = { };
    cockpit.info = { };
    init_callback = function(options) {
        if (options.user)
            $.extend(cockpit.user, options.user);
        if (options.system)
            $.extend(cockpit.info, options.system);
        if (options.user)
            $(cockpit.user).trigger("changed");
        if (options.system)
            $(cockpit.info).trigger("changed");
    };

    /* ----------------------------------------------------------------------------
     * Packages
     *
     * Public: XXXXXXXXX
     */

    cockpit.packages = {
        lookup: function(name) {
            var dfd = $.Deferred();
            package_info(name, function(pkg, problem) {
                if (problem) {
                    package_debug("lookup failed: " + problem);
                    dfd.reject(new BasicError(problem));
                } else {
                    package_debug("lookup succeeded: " + pkg.name);
                    dfd.resolve(pkg);
                }
            });
            return dfd.promise();
        }
    };

    /* ---------------------------------------------------------------------
     * Spawning
     *
     * Public: https://files.cockpit-project.org/guide/api-cockpit.html
     */

    function ProcessError(arg0, signal) {
        var status = parseInt(arg0, 10);
        if (arg0 !== undefined && isNaN(status)) {
            this.problem = arg0;
            this.exit_status = NaN;
            this.exit_signal = null;
            this.message = arg0;
        } else {
            this.exit_status = status;
            this.exit_signal = signal;
            this.problem = null;
            if (this.exit_signal)
                this.message = "Process killed with signal " + this.exit_signal;
            else
                this.message = "Process exited with code " + this.exit_status;
        }
        this.toString = function() {
            return this.message;
        };
    }

    function spawn_debug() {
        if (window.debugging == "all" || window.debugging == "spawn")
            console.debug.apply(console, arguments);
    }

    /* public */
    cockpit.spawn = function(command, options) {
        var dfd = new $.Deferred();

        var args = { "payload": "text-stream", "spawn": [] };
        if (command instanceof Array) {
            for (var i = 0; i < command.length; i++)
                args["spawn"].push(String(command[i]));
        } else {
            args["spawn"].push(String(command));
        }
        if (options !== undefined)
            $.extend(args, options);

        var channel = cockpit.channel(args);

        /* Callbacks that want to stream response, see below */
        var streamers = null;

        var buffer = "";
        $(channel).
            on("message", function(event, payload) {
                spawn_debug("process output:", payload);
                buffer += payload;
                if (streamers && buffer) {
                    streamers.fire(buffer);
                    buffer = "";
                }
            }).
            on("close", function(event, options) {
                spawn_debug("process closed:", JSON.stringify(options));
                if (options.reason)
                    dfd.reject(new ProcessError(options.reason));
                else if (options["exit-status"] || options["exit-signal"])
                    dfd.reject(new ProcessError(options["exit-status"], options["exit-signal"]));
                else
                    dfd.resolve(buffer);
            });

        var promise = dfd.promise();
        promise.stream = function(callback) {
            if (streamers === null)
               streamers = $.Callbacks("" /* no flags */);
            streamers.add(callback);
            return this;
        };

        promise.write = function(message) {
            spawn_debug("process input:", message);
            channel.send(message);
            return this;
        };

        promise.close = function(reason) {
            spawn_debug("process closing:", reason);
            if (channel.valid)
                channel.close(reason);
            return this;
        };

        return promise;
    };

} /* full_scope */

/* ----------------------------------------------------------------------------
 * A simple AMD javascript loader
 * - Used if no other AMD loader is available
 */

(function(){

    function loader_debug() {
        if (window.debugging == "all" || window.debugging == "loader")
            console.debug.apply(console, arguments);
    }

    var loader = {
        /* A list of define() Module queued until a script or block has loaded */
        defined: [ ],

        /* Modules waiting for deps */
        waiting: [ ],

        /* defined id -> Module whether waiting or not */
        modules: { },

        /* requested id -> script tag */
        scripts: { },

        /* Cockpit specific packages */
        packages: null,

        /* Base url to load against */
        base: undefined
    };

    function Module(id, dependencies, factory) {
        this.id = id; /* module identifier or null if require() */
        this.dependencies = dependencies; /* array of dependencies */

        /* The factory function or exported value */
        if (typeof factory == "function") {
            this.factory = factory;   /* module callback function */
            this.exports = undefined; /* what the module exports */
            this.ready = false;       /* this.exports is valid? */
        } else {
            this.factory = undefined; /* no callback function */
            this.exports = factory;   /* explicit prepared value */
            this.ready = true;        /* already ready */
        }
    }

    function canonicalize(id) {
        if (id.indexOf("cockpit/") !== 0)
            return id;
        var parts = id.split("/");
        var pkg = loader.packages[parts[1]];
        if (pkg && pkg.name)
            parts[1] = pkg.name;
        return parts.join("/");
    }

    /* Qualify a possibly relative path with base */
    function qualify(path, base) {
        if (!path)
            return null;

        /* Add to base if necessary */
        if (path[0] == '.') {
            if (!base)
                return null;
            var pos = base.lastIndexOf('/');
            if (pos != -1)
                path = base.substring(0, pos + 1) + path;
        }

        /* Resolve dots and double dots */
        var out = [ ];
        var parts = path.split("/");
        var length = parts.length;
        for (var i = 0; i < length; i++) {
            var part = parts[i];
            if (part === "" || part == ".") {
                continue;
            } else if (part == "..") {
                if (out.length === 0)
                    return null;
                out.pop();
            } else {
                out.push(part);
            }
        }

        return out.join("/");
    }

    /* Qualify an array of possibly relative paths */
    function qualify_all(ids, base) {
        return ids.map(function(id) {
            var out = qualify(id, base);
            if (!out)
                throw "failed to qualify relative module id: " + id;
            return out;
        });
    }

    function resolve_url(id) {
        var base = loader.base;
        if (window.mock && window.mock.loader_base)
            base = window.mock.loader_base;

        /* Special jquery path, go figure */
        if (id == "jquery")
            id = "cockpit/base/jquery";

        /* Not a cockpit path */
        if (id.indexOf("cockpit/") !== 0) {
            return base + id + ".js";

        } else {
            var parts = id.split("/");
            var pkg = loader.packages[parts[1]];
            if (pkg) {
                if (pkg.checksum)
                    parts[1] = pkg.checksum;
                else if (pkg.name)
                    parts[1] = pkg.name;
            }
            return base + parts.join("/") + ".js";
        }
    }

    /* Create a script tag for the given module id */
    function load_script(id) {
        var url = resolve_url(id);
        var script = loader.scripts[id];
        if (!script)
            script = loader.scripts[url];
        if (script) {
            if (script.loaded)
                throw "script loaded but didn't define module " + id + ": " + script.src;
            return;
        }

        loader_debug("loading " + url + " for " + id);
        script = document.createElement("script");
        script.loaded = false;
        script.async = true;
        script.type = 'text/javascript';
        script.src = url;

        var timeout;
        script.onload = function() {
            process_defined(id, url);
            script.loaded = true;
            window.clearTimeout(timeout);
            timeout = null;
        };
        script.onerror = function() {
            if (!script.loaded)
                console.warn("script loading failed: " + url);
            window.clearTimeout(timeout);
            timeout = null;
        };
        timeout = window.setTimeout(function() {
            if (!script.loaded)
                console.warn("script loading timed out: " + url);
            timeout = null;
        }, 7000);

        document.head.appendChild(script);
        loader.scripts[id] = loader.scripts[url] = script;
    }

    /* Load dependencies if necessary */
    function check_dependencies(dependencies, loadable, seen) {
        var present = true;
        var length = dependencies.length;
        for (var i = 0; i < length; i++) {
            var id = dependencies[i] = canonicalize(dependencies[i]);
            if (id == "require" || id == "exports" || id == "module")
                continue;

            if (id in seen)
                continue;
            seen[id] = id;

            var dependency = loader.modules[id];
            if (dependency) {
                if (!check_dependencies(dependency.dependencies, loadable, seen))
                    present = false;
            } else {
                present = false;
                if (loadable)
                    load_script(id);
            }
        }
        return present;
    }

    /* Load dependencies if necessary */
    function ensure_dependencies(module, dependencies, number, seen, loadable) {
        if (!loader.packages)
            return null;

        if (!check_dependencies(dependencies, loadable, { }))
            return null;

        var result = [ ];
        var length = dependencies.length;
        var had_require = false;

        /* First make sure we can resolve everything */
        for (var i = 0; i < length; i++) {
            var id = dependencies[i];

            /* A bad id, already warned */
            if (!id) {
                result.push(null);

            /* Special id 'require' defined by AMD */
            } else if (id == "require") {
                var func = function require_local(arg0, arg1) {
                    return require_with_context(module, arg0, arg1);
                };
                func.toUrl = function(str) {
                    return qualify(str, module.id);
                };
                result.push(func);
                had_require = true;

            /* Special id 'exports' defined by AMD */
            } else if (id == "exports") {
                module.exports = { };
                result.push(module.exports);

            /* Special id 'module' defined by AMD */
            } else if (id == "module") {
                result.push({ id: module.id });

            /* A circular dependency */
            } else if (in_array(seen, id)) {
                loader_debug("circular dependency with " + module.id + " and " + id);
                result.push(null);

            /* A normal module dependency */
            } else {
                var dependency = loader.modules[id];

                /* A dependency that is called using another require('module') */
                if (had_require && i >= number) {
                    result.push(null);

                /* A dependency passed in as an argument */
                } else {
                    var exports = ensure_module(dependency, seen);
                    result.push.apply(result, exports);
                }
            }
        }

        /* If we return null, then dependencies not ready yet */
        return result;
    }

    function ensure_module(module, seen) {
        if (module.id)
            seen.push(module.id);

        /* Already have a value for this module */
        if (module.ready)
            return [ module.exports ];

        /* The number of arguments required? */
        var number = module.factory.length;

        /* Try to figure out dependency arguments */
        var args = ensure_dependencies(module, module.dependencies, number, seen, true);
        if (args === null) {
            loader.waiting.push(module);
            return null;
        }

        /* Ready to run the module factory */
        var factory = module.factory;
        module.factory = null;
        module.ready = true;

        /* This may throw an exception */
        var exports = factory.apply(window, args);
        if (exports !== undefined)
            module.exports = exports;

        if (typeof module.exports == "function")
            loader_debug("executed " + module.id + " = function " + module.exports.name);
        else if (typeof module.exports == "undefined")
            loader_debug("executed " + module.id);
        else
            loader_debug("executed " + module.id + " = " + module.exports);

        if (module.id)
            seen.pop();

        /* Anything that this module factory did require() or define()? */
        process_defined(module.id, module.url);

        return [ module.exports ];
    }

    function process_waiting() {
        var waiting = loader.waiting;
        loader.waiting = [];
        var length = waiting.length;
        for (var i = 0; i < length; i++)
            ensure_module(waiting[i], [ ]);
    }

    function process_defined(id, url) {
        var modules = loader.defined;
        loader.defined = [];

        var i, module, length = modules.length;
        for (i = 0; i < length; i++) {
            module = modules[i];

            /* We now know the id of the anonymous define() module */
            if (module.id === undefined)
                module.id = id;

            module.id = canonicalize(module.id);
            if (loader.modules[module.id]) {
                console.warn("module " + module.id + " is a duplicate");
                continue;
            }

            module.url = url;
            if (url)
                loader_debug("module " + module.id + " in " + url);
            else
                loader_debug("module " + module.id);

            module.dependencies = qualify_all(module.dependencies, module.id);
            loader.modules[module.id] = module;
        }

        process_waiting();
    }

    function require_with_context(context, arg0, arg1) {
        if (context === null)
            context = new Module(null, null, []);

        /* require('string') */
        if (typeof arg0 === "string") {
            if (typeof arg1 !== "undefined")
                throw "invalid require call";
            var result = ensure_dependencies(context, [qualify(arg0, context.id)], undefined, [ ], false);
            if (result === null)
                throw "cannot syncronously require module: " + arg0;
            return result[0];

        /* require([dependencies], function callback() { }) */
        } else {
            if (!is_array(arg0) || typeof arg1 !== "function")
                throw "invalid require call";
            ensure_module(new Module(null, qualify_all(arg0, context.id), arg1), [ ]);
            return undefined;
        }
    }

    function define_module(id, dependencies, factory) {
        if (typeof id !== 'string') {
            factory = dependencies;
            dependencies = id;
            id = undefined;
        }
        if (!is_array(dependencies)) {
            factory = dependencies;
            dependencies = undefined;
        }
        if (typeof dependencies === "undefined")
            dependencies = [ "require", "exports", "module" ];
        loader.defined.push(new Module(id, dependencies, factory));
    }

    function prepare_startup() {
        var id = null;
        var path = window.location.pathname;
        var pos = path.lastIndexOf("/");
        if (path.indexOf("/cockpit") === 0 || pos <= 0) {
            loader.base = "/";
            id = path.substring(1, path.lastIndexOf("."));
        } else {
            loader.base = path.substring(0, pos + 1);
        }

        var started = false;
        function process_start() {
            if (!started) {
                started = true;
                package_table(null, function(packages, problem) {
                    if (problem)
                        console.warn("couldn't load cockpit package info: " + problem);
                    loader.packages = packages || { };
                    process_defined(id, null);
                });
            }
        }

        document.addEventListener('DOMContentLoaded', process_start, false);
        document.addEventListener('load', process_start, false);
    }

    if (!window.require && !window.define) {
        prepare_startup();

        window.require = function(arg0, arg1) {
            require_with_context(null, arg0, arg1);
        };

        window.define = define_module;
        window.define.amd = { "implementation": "cockpit" };
    }

}()); /* end AMD loader */

/*
 * Register this script as a module and/or with globals
 */

function loading_via_tag() {
    var last = document.scripts[document.scripts.length - 1].src || "";
    return (last.indexOf("/cockpit.js") !== -1 || last.indexOf("/cockpit.min.js") !== -1);
}

var cockpit = { };
var basics = false;
var extra = false;
function factory(require) {
    if (!basics) {
        basic_scope(cockpit);
        basics = true;
    }
    if (!extra) {
        var jq = null;
        if (typeof jQuery !== "undefined") {
            jq = jQuery;
        } else if (require) {
            try {
                jq = require("jquery");
            } catch(ex) {
                console.log("ignoring jquery dependency");
                jq = null;
            }
        }
        if (jq) {
            full_scope(cockpit, jq);
            extra = true;
        }
    }
    return cockpit;
}

var module_id = null;
if (loading_via_tag()) {
    module_id = "cockpit/base/cockpit";

    /* Traditional tags, we register the global */
    window.cockpit = factory();
}

if (typeof define === 'function' && define.amd)
    define(module_id, factory);

})();
