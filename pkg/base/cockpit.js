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
 * Channels
 *
 * Public: https://files.cockpit-project.org/guide/api-cockpit.html
 */

var default_transport = null;
var reload_after_disconnect = false;
var expect_disconnect = false;
var init_callback = null;
var default_host = null;
var filters = [ ];

var have_array_buffer = !!window.ArrayBuffer;

var origin = window.location.origin;
if (!origin) {
    origin = window.location.protocol + "//" + window.location.hostname +
        (window.location.port ? ':' + window.location.port: '');
}

function array_from_raw_string(str, constructor) {
    var length = str.length;
    /* jshint -W056 */
    var data = new (constructor || Array)(length);
    for (var i = 0; i < length; i++)
        data[i] = str.charCodeAt(i) & 0xFF;
    return data;
}

function array_to_raw_string(data) {
    var length = data.length, str = "";
    for (var i = 0; i < length; i++)
        str += String.fromCharCode(data[i]);
    return str;
}

/*
 * These are the polyfills from Mozilla. It's pretty nasty that
 * these weren't in the typed array standardization.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/WindowBase64/Base64_encoding_and_decoding
 */

function uint6_to_b64 (x) {
    return x < 26 ? x + 65 : x < 52 ? x + 71 : x < 62 ? x - 4 : x === 62 ? 43 : x === 63 ? 47 : 65;
}

function base64_encode(data) {
    if (typeof data === "string")
        return window.btoa(data);
    /* For when the caller has chosen to use ArrayBuffer */
    if (have_array_buffer && data instanceof window.ArrayBuffer)
        data = new window.Uint8Array(data);
    var length = data.length, mod3 = 2, str = "";
    for (var uint24 = 0, i = 0; i < length; i++) {
        mod3 = i % 3;
        uint24 |= data[i] << (16 >>> mod3 & 24);
        if (mod3 === 2 || length - i === 1) {
            str += String.fromCharCode(uint6_to_b64(uint24 >>> 18 & 63),
                                       uint6_to_b64(uint24 >>> 12 & 63),
                                       uint6_to_b64(uint24 >>> 6 & 63),
                                       uint6_to_b64(uint24 & 63));
            uint24 = 0;
        }
    }

    return str.substr(0, str.length - 2 + mod3) + (mod3 === 2 ? '' : mod3 === 1 ? '=' : '==');
}

function b64_to_uint6 (x) {
    return x > 64 && x < 91 ? x - 65 : x > 96 && x < 123 ?
        x - 71 : x > 47 && x < 58 ? x + 4 : x === 43 ? 62 : x === 47 ? 63 : 0;
}

function base64_decode(str, constructor) {
    if (constructor === String)
        return window.atob(str);
    var ilen = str.length;
    for (var eq = 0; eq < 3; eq++) {
        if (str[ilen - (eq + 1)] != '=')
            break;
    }
    var olen = (ilen * 3 + 1 >> 2) - eq;
    /* jshint -W056 */
    var data = new (constructor || Array)(olen);
    for (var mod3, mod4, uint24 = 0, oi = 0, ii = 0; ii < ilen; ii++) {
        mod4 = ii & 3;
        uint24 |= b64_to_uint6(str.charCodeAt(ii)) << 18 - 6 * mod4;
        if (mod4 === 3 || ilen - ii === 1) {
            for (mod3 = 0; mod3 < 3 && oi < olen; mod3++, oi++)
                data[oi] = uint24 >>> (16 >>> mod3 & 24) & 255;
            uint24 = 0;
        }
    }
    return data;
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

/*
 * A WebSocket that connects to parent frame. The mechanism
 * for doing this will eventually be documented publicly,
 * but for now:
 *
 *  * Forward raw cockpit1 string protocol messages via window.postMessage
 *  * Listen for cockpit1 string protocol messages via window.onmessage
 *  * Never accept or send messages to another origin
 *  * An empty string message means "close" (not completely used yet)
 */
function ParentWebSocket(parent) {
    var self = this;

    window.addEventListener("message", function receive(event) {
        if (event.origin !== origin || event.source !== parent)
            return;
        var data = event.data;
        if (data === undefined || data.length === undefined)
            return;
        if (data.length === 0)
            self.onclose();
        else
            self.onmessage(event);
    }, false);

    self.send = function send(message) {
        parent.postMessage(message, origin);
    };

    self.close = function close() {
        parent.postMessage("", origin);
    };

    window.setTimeout(function() { self.onopen(); }, 0);
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

    var ws;
    var check_health_timer;
    var got_message = false;

    /* See if we should communicate via parent */
    if (window.parent !== window &&
        window.parent.options && window.parent.options.sink &&
        window.parent.options.protocol == "cockpit1") {
        ws = new ParentWebSocket(window.parent);

    } else {
        var ws_loc = calculate_url();
        transport_debug("connecting to " + ws_loc);

        if (ws_loc) {
            if ("WebSocket" in window) {
                ws = new WebSocket(ws_loc, "cockpit1");
            } else if ("MozWebSocket" in window) { // Firefox 6
                ws = new MozWebSocket(ws_loc);
            } else {
                console.error("WebSocket not supported, application will not work!");
            }
        }

        check_health_timer = window.setInterval(function () {
            if (!got_message) {
                console.log("health check failed");
                self.close({ "problem": "timeout" });
            }
            got_message = false;
        }, 10000);
    }

    if (!ws) {
        ws = { close: function() { } };
        window.setTimeout(function() {
            self.close({"problem": "no-cockpit"});
        }, 50);
    }

    var control_cbs = { };
    var message_cbs = { };
    var waiting_for_init = true;
    var binary_type_available = false;
    self.ready = false;
    self.binary = false;

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
            if (typeof ws.binaryType !== "undefined" && have_array_buffer) {
                ws.binaryType = "arraybuffer";
                binary_type_available = true;
            }
            ws.send("\n{ \"command\": \"init\", \"version\": 0 }");
        }
    };

    ws.onclose = function() {
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
        var binary = null;
        var length;
        var channel;
        var pos;

        /* A binary message, split out the channel */
        if (have_array_buffer && data instanceof window.ArrayBuffer) {
            binary = window.Uint8Array(data);
            length = binary.length;
            for (pos = 0; pos < length; pos++) {
                if (binary[pos] == 10) /* new line */
                    break;
            }
            if (pos === length) {
                console.warn("binary message without channel");
                return;
            } else if (pos === 0) {
                console.warn("binary control message");
                return;
            } else {
                channel = String.fromCharCode.apply(null, binary.subarray(0, pos));
            }

        /* A textual message */
        } else {
            pos = data.indexOf('\n');
            if (pos === -1) {
                console.warn("text message without channel");
                return;
            }
            channel = data.substring(0, pos);
        }

        var payload, control;
        if (binary)
            payload = new window.Uint8Array(binary.buffer, pos + 1);
        else
            payload = data.substring(pos + 1);

        /* A control message, always string */
        if (!channel) {
            transport_debug("recv control:", payload);
            control = JSON.parse(payload);
        } else  {
            transport_debug("recv " + channel + ":", payload);
        }

        length = filters.length;
        for (var i = 0; i < length; i++) {
            if (filters[i](data, channel, control) === false)
                return;
        }

        if (!channel)
            process_control(control);
        else
            process_message(channel, payload);

        phantom_checkpoint();
    };

    self.close = function close(options) {
        if (self === default_transport)
            default_transport = null;
        if (!options)
            options = { "problem": "disconnected" };
        options.command = "close";
        clearInterval(check_health_timer);
        var ows = ws;
        ws = null;
        if (ows)
            ows.close();
        ready_for_channels(); /* ready to fail */

        /* Broadcast to everyone */
        for (var chan in control_cbs)
            control_cbs[chan].apply(null, [options]);
    };

    self.next_channel = function next_channel() {
        last_channel++;
        return channel_seed + String(last_channel);
    };

    function process_init(options) {
        if (options.problem){
            self.close({ "problem": options.problem });
            return;
        }

        if (options.version !== 0) {
            console.error("received invalid version in init message");
            self.close({"problem": "protocol-error"});
            return;
        }

        if (in_array(options["capabilities"] || [], "binary"))
            self.binary = binary_type_available;
        if (options["channel-seed"])
            channel_seed = String(options["channel-seed"]);
        if (options["default-host"])
            default_host = options["default-host"];
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
                data = { "problem": "protocol-error" };
            }
            self.close(data);
            return;
        }

        /* 'ping' messages are ignored */
        if (data.command == "ping")
            return;

        if (channel !== undefined) {
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
            console.log("transport closed, dropped message: ", data);
            return false;
        }
        ws.send(data);
        return true;
    };

    self.send_message = function send_message(channel, payload) {
        if (channel)
            transport_debug("send " + channel, payload);
        else
            transport_debug("send control:", payload);

        /* A binary message */
        if (payload.byteLength || is_array(payload)) {
            if (payload instanceof window.ArrayBuffer)
                payload = new window.Uint8Array(payload);
            var i;
            var channel_length = channel.length;
            var payload_length = payload.length;
            var output = new window.Uint8Array(channel_length + 1 + payload_length);
            for (i = 0; i < channel_length; i++)
                output[i] = channel.charCodeAt(i) & 0xFF;
            output[i] = 10; /* new line */
            i += 1;
            for (var x = 0; x < payload_length; x++, i++)
                output[i] = payload[x];
            return self.send_data(output.buffer);

        /* A string message */
        } else {
            return self.send_data(channel.toString() + "\n" + payload);
        }
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
    var received_eof = false;
    var sent_eof = false;
    var id = null;
    var base64 = false;
    var binary = false;

    /*
     * Queue while waiting for transport, items are tuples:
     * [is_control ? true : false, payload]
     */
    var queue = [ ];

    /* Handy for callers, but not used by us */
    self.valid = valid;
    self.options = options;
    self.id = id;

    function on_message(payload) {
        if (received_eof) {
            console.warn("received message after eof");
            self.close("protocol-error");
        } else {
            if (base64)
                payload = base64_decode(payload, window.Uint8Array || Array);
            var event = document.createEvent("CustomEvent");
            event.initCustomEvent("message", false, false, payload);
            self.dispatchEvent(event, payload);
        }
    }

    function on_close(data) {
        self.valid = valid = false;
        if (transport && id)
            transport.unregister(id);
        var event = document.createEvent("CustomEvent");
        event.initCustomEvent("close", false, false, data);
        self.dispatchEvent(event, data);
    }

    function on_eof() {
        if (received_eof) {
            console.warn("received two eof messages on channel");
            self.close("protocol-error");
        } else {
            received_eof = true;
            var event = document.createEvent("CustomEvent");
            event.initCustomEvent("eof", false, false, null);
            self.dispatchEvent(event, null);
        }
    }

    function on_control(data) {
        if (data.command == "close")
            on_close(data);
        else if (data.command == "eof")
            on_eof();
        else
            console.log("unhandled control message: '" + data.command + "'");
    }

    function send_payload(payload) {
        if (binary && base64) {
            payload = base64_encode(payload);
        } else if (!binary) {
            if (typeof payload !== "string")
                payload = String(payload);
        }
        transport.send_message(id, payload);
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

        if (command.host === undefined) {
            var host = default_host;
            /* HACK until we migrate all the pages from shell */
            if ("shell" in window && typeof window.shell.get_page_machine == "function")
                host = window.shell.get_page_machine();
            if (host)
                command.host = host;
        }

        if (options.binary === true) {
            binary = true;
            if (transport.binary) {
                command.binary = "raw";
            } else {
                command.binary = "base64";
                base64 = true;
            }
        }

        transport.send_control(command);

        /* Now drain the queue */
        while(queue.length > 0) {
            var item = queue.shift();
            if (item[0]) {
                item[1]["channel"] = id;
                transport.send_control(item[1]);
            } else {
                send_payload(item[1]);
            }
        }
    });

    self.send = function send(message) {
        if (!valid)
            console.warn("sending message on closed channel");
        else if (sent_eof)
            console.warn("sending message after eof");
        else if (!transport)
            queue.push([false, message]);
        else
            send_payload(message);
    };

    self.eof = function eof() {
        var message = { "command": "eof", "channel": id };
        if (sent_eof)
            console.warn("already sent eof");
        else if (!transport)
            queue.push([true, message]);
        else
            transport.send_control(message);
    };

    self.close = function close(options) {
        if (!valid)
            return;

        if (!options)
            options = { };
        else if (typeof options == "string")
            options = { "problem" : options };
        options["command"] = "close";
        options["channel"] = id;

        if (!transport)
            queue.push([true, options]);
        else
            transport.send_control(options);
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
        host = default_host;
    var table = host_packages[host];
    if (table) {
        callback(table, null);
        return;
    }
    var channel = new Channel({ "host": host, "payload": "resource2" });
    channel.onclose = function(event, options) {
        if (options.problem) {
            package_debug("package listing failed: " + options.problem);
            callback(null, options.problem);
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

/* Resolve dots and double dots */
function resolve_path_dots(parts) {
    var out = [ ];
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
    return out;
}

function basic_scope(cockpit) {
    cockpit.channel = function channel(options) {
        return new Channel(options);
    };

    function Utf8TextEncoder(constructor) {
        var self = this;
        self.encoding = "utf-8";

        self.encode = function encode(string, options) {
            var data = unescape(encodeURIComponent(string));
            if (constructor === String)
                return data;
            return array_from_raw_string(data, constructor);
        };
    }

    function Utf8TextDecoder(fatal) {
        var self = this;
        var buffer = null;
        self.encoding = "utf-8";

        self.decode = function decode(data, options) {
            var stream = options && options.stream;

            if (data === null || data === undefined)
                data = "";
            if (typeof data !== "string")
                data = array_to_raw_string(data);
            if (buffer) {
                data = buffer + data;
                buffer = null;
            }

            /* We have to scan to do non-fatal and streaming */
            var beg = 0, i = 0, len = data.length;
            var p, x, j, ok;
            var str = "";

            while (i < len) {
                p = data.charCodeAt(i);
                x = p == 255 ? 0 :
                    p > 251 && p < 254 ? 6 :
                    p > 247 && p < 252 ? 5 :
                    p > 239 && p < 248 ? 4 :
                    p > 223 && p < 240 ? 3 :
                    p > 191 && p < 224 ? 2 :
                    p < 128 ? 1 : 0;

                ok = (i + x <= len);
                if (!ok && stream) {
                    buffer = data.substring(i);
                    break;
                }
                if (x === 0)
                    ok = false;
                for (j = 1; ok && j < x; j++)
                    ok = (data.charCodeAt(i + j) & 0x80) !== 0;

                if (!ok) {
                    if (fatal) {
                        i = len;
                        break;
                    }

                    str += decodeURIComponent(escape(data.substring(beg, i)));
                    str += "\ufffd";
                    i++;
                    beg = i;
                } else {
                    i += x;
                }
            }

            str += decodeURIComponent(escape(data.substring(beg, i)));
            return str;
        };
    }

    cockpit.utf8_encoder = function utf8_encoder(constructor) {
        return new Utf8TextEncoder(constructor);
    };

    cockpit.utf8_decoder = function utf8_decoder(fatal) {
        return new Utf8TextDecoder(!!fatal);
    };

    cockpit.base64_encode = base64_encode;
    cockpit.base64_decode = base64_decode;

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
        close: function close(problem) {
            if (!default_transport)
                return;
            var options;
            if (problem)
                options = {"problem": problem };
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
        },
        all: function(expand) {
            var dfd = $.Deferred();
            package_table(null, function(packages, problem) {
                if (problem) {
                    package_debug("lookup failed: " + problem);
                    dfd.reject(new BasicError(problem));
                } else {
                    var res = { };
                    $.each(packages, function(name, pkg) {
                        if (expand || pkg.name === name)
                            res[name] = pkg;
                    });
                    dfd.resolve(res);
                }
            });
            return dfd.promise();
        }
    };

    /* ------------------------------------------------------------------------
     * Cockpit location
     */

    /* HACK: Mozilla will unescape 'window.location.hash' before returning
     * it, which is broken.
     *
     * https://bugzilla.mozilla.org/show_bug.cgi?id=135309
     */

    var last_loc = null;

    function get_window_location_hash() {
        return (window.location.href.split('#')[1] || '');
    }

    function Location() {
        var self = this;

        var href = get_window_location_hash();
        var options = { };
        var path = decode(href, options);

        function decode_path(input) {
            var parts = input.split('/').map(decodeURIComponent);
            var result;
            if (input && input[0] !== "/") {
                result = [].concat(path);
                result.pop();
                result = result.concat(parts);
            } else {
                result = parts;
            }
            return resolve_path_dots(result);
        }

        function encode(path, options) {
            if (typeof path == "string")
                path = decode_path(path, self.path);
            var href = "/" + path.map(encodeURIComponent).join("/");
            if (options) {
                var query = [];
                $.each(options, function(opt, value) {
                    query.push(encodeURIComponent(opt) + "=" + encodeURIComponent(value));
                });
                if (query.length > 0)
                    href += "?" + query.join("&");
            }
            return href;
        }

        function decode(href, options) {
            if (href[0] == '#')
                href = href.substr(1);

            var pos = href.indexOf('?');
            var first = href;
            if (pos === -1)
                first = href;
            else
                first = href.substr(0, pos);
            var path = decode_path(first);
            if (pos !== -1 && options) {
                $.each(href.substring(pos + 1).split("&"), function(i, opt) {
                    var parts = opt.split('=');
                    options[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
                });
            }

            return path;
        }

        function href_for_go_or_replace(/* ... */) {
            var href;
            if (arguments.length == 1 && arguments[0] instanceof Location) {
                href = String(arguments[0]);
            } else if (typeof arguments[0] == "string") {
                var options = arguments[1] || { };
                href = encode(decode(arguments[0], options), options);
            } else {
                href = encode.apply(self, arguments);
            }
            return href;
        }

        function replace(/* ... */) {
            if (self !== last_loc)
                return;
            var href = href_for_go_or_replace.apply(self, arguments);
            window.location.replace(window.location.pathname + '#' + href);
        }

        function go(/* ... */) {
            if (self !== last_loc)
                return;
            var href = href_for_go_or_replace.apply(self, arguments);
            window.location.hash = '#' + href;
        }

        Object.defineProperties(self, {
            path: {
                enumerable: true,
                writable: false,
                value: path
            },
            options: {
                enumerable: true,
                writable: false,
                value: options
            },
            href: {
                enumerable: true,
                value: href
            },
            go: { value: go },
            replace: { value: replace },
            encode: { value: encode },
            decode: { value: decode },
            toString: { value: function() { return href; } }
        });
    }

    Object.defineProperty(cockpit, "location", {
        enumerable: true,
        get: function() {
            if (!last_loc || last_loc.href !== get_window_location_hash())
                last_loc = new Location();
            return last_loc;
        },
        set: function(v) {
            cockpit.location.go(v);
        }
    });

    $(window).on("hashchange", function() {
        last_loc = null;
        $(cockpit).triggerHandler("locationchanged");
    });

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

        var args = { "payload": "stream", "spawn": [] };
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
                if (options.problem)
                    dfd.reject(new ProcessError(options.problem));
                else if (options["exit-status"] || options["exit-signal"])
                    dfd.reject(new ProcessError(options["exit-status"], options["exit-signal"]));
                else
                    dfd.resolve(buffer);
            });

        var jpromise = dfd.promise;
        dfd.promise = function() {
            return $.extend(jpromise.apply(this, arguments), {
                stream: function(callback) {
                    if (streamers === null)
                        streamers = $.Callbacks("" /* no flags */);
                    streamers.add(callback);
                    return this;
                },
                write: function(message) {
                    spawn_debug("process input:", message);
                    if (message === null)
                        channel.eof();
                    else
                        channel.send(message);
                    return this;
                },
                close: function(problem) {
                    spawn_debug("process closing:", problem);
                    if (channel.valid)
                        channel.close(problem);
                    return this;
                },
                promise: this.promise
            });
        };

        return dfd.promise();
    };

    function dbus_debug() {
        if (window.debugging == "all" || window.debugging == "dbus")
            console.debug.apply(console, arguments);
    }

    function DBusError(arg) {
        if (typeof(arg) == "string") {
            this.problem = arg;
            this.name = null;
            this.message = arg;
        } else {
            this.problem = null;
            this.name = arg[0];
            this.message = arg[1][0] || arg[0];
        }
        this.toString = function() {
            return this.message;
        };
    }

    function DBusCache() {
        var self = this;

        var callbacks = [ ];
        self.data = { };
        self.meta = { };

        self.connect = function connect(path, iface, callback, first) {
            var cb = [path, iface, callback];
            if (first)
                callbacks.unshift(cb);
            else
                callbacks.push(cb);
            return {
                remove: function remove() {
                    var i, length = callbacks.length;
                    for (i = 0; i < length; i++) {
                        var cb = callbacks[i];
                        if (cb[0] === path && cb[1] === iface && cb[2] === callback) {
                            delete cb[i];
                            break;
                        }
                    }
                }
            };
        };

        function emit(path, iface, props) {
            var copy = callbacks.slice();
            var i, length = copy.length;
            for (i = 0; i < length; i++) {
                var cb = copy[i];
                if ((!cb[0] || cb[0] === path) &&
                    (!cb[1] || cb[1] === iface)) {
                    cb[2](props, path);
                }
            }
        }

        self.update = function update(path, iface, props) {
            if (!self.data[path])
                self.data[path] = { };
            if (!self.data[path][iface])
                self.data[path][iface] = props;
            else
                props = $.extend(self.data[path][iface], props);
            emit(path, iface, props);
        };

        self.remove = function remove(path, iface) {
            if (self.data[path]) {
                delete self.data[path][iface];
                emit(path, iface, null);
            }
        };

        self.lookup = function lookup(path, iface) {
            if (self.data[path])
                return self.data[path][iface];
            return undefined;
        };

        self.each = function each(iface, callback) {
            $.each(self.data, function(path, ifaces) {
                $.each(ifaces, function(iface, props) {
                    callback(props, path);
                });
            });
        };

        self.close = function close() {
            self.data = { };
            var copy = callbacks;
            callbacks = [ ];
            var i, length = copy.length;
            for (i = 0; i < length; i++)
                copy[i].callback();
        };
    }

    function DBusProxy(client, cache, iface, path, options) {
        var self = this;

        var valid = false;
        var defined = false;
        var waits = $.Callbacks("once memory");

        /* No enumeration on these properties */
        Object.defineProperties(self, {
            "client": { value: client, enumerable: false, writable: false },
            "path": { value: path, enumerable: false, writable: false },
            "iface": { value: iface, enumerable: false, writable: false },
            "valid": { get: function() { return valid; }, enumerable: false },
            "wait": { value: function(func) { waits.add(func); return this; },
                      enumerable: false, writable: false },
            "call": { value: function(name, args) { return client.call(path, iface, name, args); },
                      enumerable: false, writable: false },
            "data": { value: { }, enumerable: false }
        });

        Object.defineProperty(self, jQuery.expando, {
            value: { }, writable: true, enumerable: false
        });

        if (!options)
            options = { };

        function define() {
            if (!cache.meta[iface])
                return;

            var meta = cache.meta[iface];
            defined = true;

            $.each(meta.methods || { }, function(name) {
                if (name[0].toLowerCase() == name[0])
                    return; /* Only map upper case */

                /* Again, make sure these don't show up in enumerations */
                Object.defineProperty(self, name, {
                    enumerable: false,
                    value: function() {
                        var dfd = $.Deferred();
                        client.call(path, iface, name, Array.prototype.slice.call(arguments)).
                            done(function(reply) { dfd.resolve.apply(dfd, reply); }).
                            fail(function(ex) { dfd.reject(ex); });
                        return dfd.promise();
                    }
                });
            });

            $.each(meta.properties || { }, function(name, prop) {
                if (name[0].toLowerCase() == name[0])
                    return; /* Only map upper case */

                var config = {
                    enumerable: true,
                    get: function() { return self.data[name]; },
                    set: function(v) { throw name + "is not writable"; }
                };

                if (prop.flags && prop.flags.indexOf('w') !== -1) {
                    config.set = function(v) {
                        client.call(path, "org.freedesktop.DBus.Properties", "Set",
                                [ iface, name, cockpit.variant(prop.type, v) ]).
                            fail(function(ex) {
                                console.log("Couldn't set " + iface + " " + name +
                                            " at " + path + ": " + ex);
                            });
                    };
                }

                /* Again, make sure these don't show up in enumerations */
                Object.defineProperty(self, name, config);
            });
        }

        function update(props) {
            if (props) {
                $.extend(self.data, props);
                if (!defined)
                    define();
                valid = true;
            } else {
                valid = false;
            }
            $(self).triggerHandler("changed", [ props ]);
        }

        cache.connect(path, iface, update, true);
        update(cache.lookup(path, iface));

        function signal(path, iface, name, args) {
            $(self).triggerHandler("signal", [name, args]);
            if (name[0].toLowerCase() != name[0])
                $(self).triggerHandler(name, args);
        }

        client.subscribe({ "path": path, "interface": iface }, signal, options.subscribe !== false);

        /* If watching then do a proper watch, otherwise object is done */
        if (options.watch !== false)
            client.watch(path).always(function() { waits.fire(); });
        else
            waits.fire();
    }

    function DBusProxies(client, cache, iface, path_namespace) {
        var self = this;

        var waits = $.Callbacks("once memory");

        Object.defineProperties(self, {
            "client": { value: client, enumerable: false, writable: false },
            "iface": { value: iface, enumerable: false, writable: false },
            "path_namespace": { value: path_namespace, enumerable: false, writable: false },
            "wait": { value: function(func) { waits.add(func); return this; },
                      enumerable: false, writable: false }
        });

        Object.defineProperty(self, jQuery.expando, {
            value: { }, writable: true, enumerable: false
        });

        /* Subscribe to signals once for all proxies */
        var match = { "interface": iface, "path_namespace": path_namespace };

        /* Callbacks added by proxies */
        client.subscribe(match);

        /* Watch for property changes */
        client.watch(match).always(function() { waits.fire(); });

        /* Already added watch/subscribe, tell proxies not to */
        var options = { watch: false, subscribe: false };

        function update(props, path) {
            var proxy = self[path];
            if (!path) {
                return;
            } else if (!props && proxy) {
                delete self[path];
                $(self).triggerHandler("removed", [ proxy ]);
            } else if (props) {
                if (!proxy) {
                    proxy = self[path] = client.proxy(iface, path, options);
                    $(self).triggerHandler("added", [ proxy ]);
                }
                $(self).triggerHandler("changed", [ proxy ]);
            }
        }

        cache.connect(null, iface, update, false);
        cache.each(iface, update);
    }

    function DBusClient(name, options) {
        var self = this;
        var args = { };
        if (options)
            $.extend(args, options);
        args.payload = "dbus-json3";
        args.name = name;
        self.options = options;

        dbus_debug("dbus open: ", args);

        var channel = cockpit.channel(args);
        var subscribers = { };
        var calls = { };
        var cache;

        self.constructors = { "*": DBusProxy };

        function ensure_cache() {
            if (!cache)
                cache = new DBusCache();
        }

        function matches(signal, match) {
            if (match.path && signal[0] !== match.path)
                return false;
            if (match.path_namespace && signal[0].indexOf(match.path_namespace) !== 0)
                return false;
            if (match["interface"] && signal[1] !== match["interface"])
                return false;
            if (match.member && signal[2] !== match.member)
                return false;
            if (match.arg0 && signal[3] !== match.arg0)
                return false;
            return true;
        }

        $(channel).on("message", function(event, payload) {
            dbus_debug("dbus:", payload);
            var msg;
            try {
                msg = JSON.parse(payload);
            } catch(ex) {
                console.warn("received invalid dbus json message:", ex);
            }
            if (msg === undefined) {
                channel.close({"problem": "protocol-error"});
                return;
            }
            var dfd;
            if (msg.id !== undefined)
                dfd = calls[msg.id];
            if (msg.reply) {
                if (dfd) {
                    var options = { };
                    if (msg.type)
                        options.type = msg.type;
                    if (msg.flags)
                        options.flags = msg.flags;
                    dfd.resolve(msg.reply[0] || [], options);
                    delete calls[msg.id];
                }
            } else if (msg.error) {
                if (dfd) {
                    dfd.reject(new DBusError(msg.error));
                    delete calls[msg.id];
                }
            } else if (msg.signal) {
                $.each(subscribers, function(id, subscription) {
                    if (subscription.callback) {
                        if (matches(msg.signal, subscription.match))
                            subscription.callback.apply(self, msg.signal);
                    }
                });
            } else if (msg.notify) {
                ensure_cache();
                $.each(msg.notify, function(path, ifaces) {
                    $.each(ifaces, function(iface, props) {
                        if (!props)
                            cache.remove(path, iface);
                        else
                            cache.update(path, iface, props);
                    });
                });
                $(self).triggerHandler("notify", [ msg.notify ]);
            } else if (msg.meta) {
                ensure_cache();
                $.extend(cache.meta, msg.meta);
            } else {
                console.warn("received unexpected dbus json message:", payload);
                channel.close({"problem": "protocol-error"});
            }
        });

        this.close = function close(options) {
            var problem;
            if (typeof options == "string") {
                problem = options;
                options = { "problem": problem };
            } else if (options) {
                problem = options.problem;
            }
            if (!problem)
                problem = "disconnected";
            if (channel)
                channel.close(options);
            var outstanding = calls;
            calls = { };
            $.each(outstanding, function(id, dfd) {
                dfd.reject(new DBusError(problem));
            });
            $(self).triggerHandler("close", [ problem ]);
        };

        $(channel).on("close", function(event, options) {
            dbus_debug("dbus close:", options);
            $(channel).off();
            channel = null;
            self.close(options);
        });

        var last_cookie = 1;

        this.call = function call(path, iface, method, args, options) {
            var dfd = $.Deferred();
            var id = String(last_cookie);
            last_cookie++;
            var method_call = {
                "call": [ path, iface, method, args || [] ],
                "id": id
            };
            if (options) {
                if (options.type)
                    method_call.type = options.type;
                if (options.flags !== undefined)
                    method_call.flags = options.flags;
            }

            var msg = JSON.stringify(method_call);
            dbus_debug("dbus:", msg);
            channel.send(msg);
            calls[id] = dfd;

            return dfd.promise();
        };

        this.subscribe = function subscribe(match, callback, rule) {
            var subscription = {
                match: match || { },
                callback: callback
            };

            if (rule !== false && channel && channel.valid) {
                var msg = JSON.stringify({ "add-match": subscription.match });
                dbus_debug("dbus:", msg);
                channel.send(msg);
            }

            var id;
            if (callback) {
                id = String(last_cookie);
                last_cookie++;
                subscribers[id] = subscription;
            }

            return {
                remove: function() {
                    var prev;
                    if (id) {
                        prev = subscribers[id];
                        if (prev)
                            delete subscribers[id];
                    }
                    if (rule !== false && channel && channel.valid && prev) {
                        var msg = JSON.stringify({ "remove-match": prev.match });
                        dbus_debug("dbus:", msg);
                        channel.send(msg);
                    }
                }
            };
        };

        self.watch = function watch(path) {
            var match;
            if ($.isPlainObject(path))
                match = path;
            else
                match = { path: String(path) };

            var id = String(last_cookie);
            last_cookie++;
            var dfd = $.Deferred();
            calls[id] = dfd;

            var msg = JSON.stringify({ "watch": match, "id": id });
            dbus_debug("dbus:", msg);
            channel.send(msg);

            var jpromise = dfd.promise;
            dfd.promise = function() {
                return $.extend(jpromise.apply(this, arguments), {
                    remove: function remove() {
                        delete calls[id];
                        if (channel.valid) {
                            msg = JSON.stringify({ "unwatch": match });
                            dbus_debug("dbus:", msg);
                            channel.send(msg);
                        }
                    },
                    promise: this.promise
                });
            };

            return dfd.promise();
        };

        self.proxy = function proxy(iface, path, options) {
            if (!iface)
                iface = name;
            iface = String(iface);
            if (!path)
                path = "/" + iface.replace(/\./g, "/");
            var Constructor = self.constructors[iface];
            if (!Constructor)
                Constructor = self.constructors["*"];
            if (!options)
                options = { };
            ensure_cache();
            return new Constructor(self, cache, iface, String(path), options);
        };

        self.proxies = function proxies(iface, path_namespace) {
            if (!iface)
                iface = name;
            if (!path_namespace)
                path_namespace = "/";
            ensure_cache();
            return new DBusProxies(self, cache, String(iface), String(path_namespace));
        };
    }

    /* public */
    cockpit.dbus = function dbus(name, options) {
        return new DBusClient(name, options);
    };

    cockpit.variant = function variant(type, value) {
        return { 'v': value, 't': type };
    };

    cockpit.byte_array = function byte_array(string) {
        return window.btoa(string);
    };

    /* ---------------------------------------------------------------------
     * Localization
     */

    function Locale(po) {
        var self = this;

        function imply( val ) {
            return (val === true ? 1 : val ? val : 0);
        }

        var plural;
        var lang = "en";
        var header = po[""];

        if (header) {
            if (header["plural-forms"]) {
                /*
                 * This code has been cross checked when it was compiled by our
                 * po2json tool. Therefore ignore warnings about eval being evil.
                 */

                /* jshint ignore:start */
                plural = new Function("n", "var nplurals, plural; " +
                                      header["plural-forms"] + "; return plural;");
                /* jshint ignore:end */
            }
            if (header["language"])
                lang = header["language"];
        }

        self.lang = lang;

        self.gettext = function gettext(context, string) {
            /* Missing first parameter */
            if (arguments.length == 1) {
                string = context;
                context = undefined;
            }

            var key = context ? context + '\u0004' + string : string;
            if (po) {
                var translated = po[key];
                if (translated && translated[1])
                    return translated[1];
            }
            return string;
        };

        self.ngettext = function ngettext(context, string1, stringN, num) {
            /* Missing first parameter */
            if (arguments.length == 3) {
                num = stringN;
                stringN = string1;
                string1 = context;
                context = undefined;
            }

            var key = context ? context + '\u0004' + string1 : string1;
            if (po && plural) {
                var translated = po[key];
                if (translated) {
                    var i = imply(plural(num)) + 1;
                    if (translated[i])
                        return translated[i];
                }
            }
            if (num == 1)
                return string1;
            return stringN;
        };
    }

    function translate_page(locale) {
        $("[translatable=\"yes\"]").each(function(i, e) {
            var $e = $(e);
            var translated = locale.gettext(e.getAttribute("context"), $e.text());
            $(e).removeAttr("translatable").text(translated);
        });
    }

    cockpit.locale = function locale(po, translate) {
        var loc = new Locale(po);
        if (translate)
            $(function() {translate_page(loc); });
        return loc;
    };

    var fmt_re = /\$\{([^}]+)\}|\$([a-zA-Z0-9_]+)/g;
    cockpit.format = function format(fmt, args) {
        if (arguments.length != 2 || typeof(args) !== "object")
            args = Array.prototype.slice.call(arguments, 1);
        return fmt.replace(fmt_re, function(m, x, y) { return args[x || y] || ""; });
    };

} /* full_scope */

/* ----------------------------------------------------------------------------
 * A simple AMD javascript loader
 * - Used if no other AMD loader is available
 */

var self_module_id = null;

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
        if (window.mock && window.mock.loader_base)
            return id;
        var parts = id.split("/");
        var pkg = loader.packages[parts[0]];
        if (pkg && pkg.name)
            parts[0] = pkg.name;
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
        path = resolve_path_dots(path.split("/"));
        if (path)
            path = path.join("/");
        return path;
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

        /* Special jquery path, go figure */
        if (id == "jquery")
            id = "base/jquery";

        /* Overridden base, just be simple */
        if (window.mock && window.mock.loader_base)
            return window.mock.loader_base + id + ".js";

        /* Resolve packages here */
        var parts = id.split("/");
        var pkg = loader.packages[parts[0]];
        if (pkg) {
            if (pkg.checksum)
                parts[0] = pkg.checksum;
            else if (pkg.name)
                parts[0] = pkg.name;
        }
        return loader.base + parts.join("/") + ".js";
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
    function ensure_dependencies(module, dependencies, seen, loadable) {
        if (!loader.packages)
            return null;

        if (!check_dependencies(dependencies, loadable, { }))
            return null;

        var result = [ ];
        var length = dependencies.length;

        var func = function require_local(arg0, arg1) {
            return require_with_context(module, arg0, arg1);
        };
        func.toUrl = function(str) {
            return qualify(str, module.id);
        };

        /* First make sure we can resolve everything */
        for (var i = 0; i < length; i++) {
            var id = dependencies[i];

            /* A bad id, already warned */
            if (!id) {
                result.push(null);

            /* Special id 'require' defined by AMD */
            } else if (id == "require") {
                result.push(func);

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
                var exports = ensure_module(dependency, seen);
                result.push.apply(result, exports);
            }
        }

        /* If we return null, then dependencies not ready yet */
        return result;
    }

    function ensure_module(module, seen) {
        if (module.ready)
            return [ module.exports ];

        if (module.id)
            seen.push(module.id);

        /* Try to figure out dependency arguments */
        var args = ensure_dependencies(module, module.dependencies, seen, true);
        if (args === null) {
            loader.waiting.push(module);
            if (module.id)
                seen.pop();
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
            var result = ensure_dependencies(context, [qualify(arg0, context.id)], [ ], false);
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
        if (typeof dependencies === "undefined") {
            if (typeof factory === "function")
                dependencies = [ "require", "exports", "module" ];
            else
                dependencies = [ ];
        }
        loader.defined.push(new Module(id, dependencies, factory));
    }

    var started = false;

    function process_start() {
        if (started)
            return;
        started = true;
        package_table(null, function(packages, problem) {
            if (problem)
                console.warn("couldn't load cockpit package info: " + problem);
            loader.packages = packages || { };
            process_defined(null, null);
        });
    }

    /* Check how we're being loaded */
    var last = document.scripts[document.scripts.length - 1].src || "";
    var pos = last.indexOf("/cockpit.js");
    if (pos === -1)
        pos = last.indexOf("/cockpit.min.js");
    if (pos !== -1)
        pos = last.substring(0, pos).lastIndexOf("/");

    /* cockpit.js is being loaded as a <script>  and no other loader around? */
    if (pos !== -1 && !window.define && !window.require) {
        loader.base = last.substring(0, pos + 1);
        loader_debug("loader base: " + loader.base);

        self_module_id = last.substring(pos + 1, last.indexOf(".", pos + 1));
        loader_debug("loader cockpit id: " + self_module_id);


        document.addEventListener('DOMContentLoaded', process_start, false);
        document.addEventListener('load', process_start, false);

        window.require = function(arg0, arg1) {
            require_with_context(null, arg0, arg1);
        };

        window.define = define_module;
        window.define.amd = { "implementation": "cockpit" };

        if (window.jQuery)
            window.define('jquery', function() { return window.jQuery; });
    }

}()); /* end AMD loader */

/*
 * Register this script as a module and/or with globals
 */

var cockpit = { };
var basics = false;
var extra = false;
function factory(jquery) {
    if (!basics) {
        basic_scope(cockpit);
        basics = true;
    }
    if (!extra) {
        if (jquery) {
            full_scope(cockpit, jquery);
            extra = true;
        }
    }
    return cockpit;
}

/* Cockpit loader with a <script> tag we register the global */
if (self_module_id) {
    window.cockpit = factory(window.jQuery);
    define(self_module_id, ['jquery'], factory);

/* Cockpit loaded via another AMD loader */
} else if (typeof define === 'function' && define.amd) {
    define(['jquery'], factory);
}

})();
