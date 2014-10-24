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

var cockpit = cockpit || { };
var mock = mock || { };

var phantom_checkpoint = phantom_checkpoint || function () { };

(function(cockpit) {
"use strict";

if (typeof window.debugging === "undefined") {
    var match = /debugging=([^;]*)/.exec(document.cookie);
    if (match)
        window.debugging = match[1];
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
        console.error("Cockpit must be used over http or https");
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

        /* The first line of a message is the channel */
        var data = event.data;
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
        return String(last_channel) + channel_seed;
    };

    function process_init(options) {
        if (options.version !== 0) {
            console.error("received invalid version in init message");
            self.close({"reason": "protocol-error"});
            return;
        }

        if (options["channel-seed"])
            channel_seed = ":" + String(options["channel-seed"]);

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

    self.send_message = function send_message(channel, payload) {
        if (!ws) {
            console.log("transport closed, dropped message: " + payload);
            return;
        }
        if (channel)
            transport_debug("send " + channel + ":", payload);
        else
            transport_debug("send control:", payload);
        var msg = channel.toString() + "\n" + payload;
        ws.send(msg);
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
    close: function close(reason) {
        if (!default_transport)
            return;
        var options;
        if (reason)
            options = {"reason": reason };
        default_transport.close(options);
    }
};

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

if (typeof jQuery !== "undefined")
    full_scope(cockpit, jQuery);

}(cockpit));
