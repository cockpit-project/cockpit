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
    window.debugging = window.sessionStorage["debugging"] ||
                       window.localStorage["debugging"];
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

function BasicError(problem, message) {
    this.problem = problem;
    this.message = message || cockpit.message(problem);
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

function join_data(buffers, binary) {
    if (!binary)
        return buffers.join("");

    var data;
    var j, k, total = 0;
    var i, length = buffers.length;
    for (i = 0; i < length; i++)
        total += buffers[i].length;

    if (window.Uint8Array)
        data = new window.Uint8Array(total);
    else
        data = new Array(total);

    if (data.set) {
        for (j = 0, i = 0; i < length; i++) {
            data.set(buffers[i], j);
            j += buffers[i].length;
        }
    } else {
        for (j = 0, i = 0; i < length; i++) {
            for (k = 0; k < buffers[i].length; k++)
                data[i + j] = buffers[i][k];
            j += buffers[i].length;
        }
    }

    return data;
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

    try {
	    /* See if we should communicate via parent */
	    if (window.parent !== window &&
                window.parent.options && window.parent.options.sink &&
                window.parent.options.protocol == "cockpit1") {
               ws = new ParentWebSocket(window.parent);
            }
    } catch (ex) {
	/* permission access errors */
    }

    if (!ws) {
        var ws_loc = calculate_url();
        transport_debug("connecting to " + ws_loc);

        if (ws_loc) {
            if ("WebSocket" in window) {
                ws = new window.WebSocket(ws_loc, "cockpit1");
            } else if ("MozWebSocket" in window) { // Firefox 6
                ws = new window.MozWebSocket(ws_loc);
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
            binary = new window.Uint8Array(data);
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
        window.clearInterval(check_health_timer);
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
            var output = join_data([array_from_raw_string(channel), [ 10 ], payload ], true);
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
    var received_done = false;
    var sent_done = false;
    var id = null;
    var base64 = false;
    var binary = (options.binary === true);

    /*
     * Queue while waiting for transport, items are tuples:
     * [is_control ? true : false, payload]
     */
    var queue = [ ];

    /* Handy for callers, but not used by us */
    self.valid = valid;
    self.options = options;
    self.binary = binary;
    self.id = id;

    function on_message(payload) {
        if (received_done) {
            console.warn("received message after done");
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

    function on_control(data) {
        if (data.command == "close") {
            on_close(data);
            return;
        }

        var done = data.command === "done";
        if (done && received_done) {
            console.warn("received two done commands on channel");
            self.close("protocol-error");

        } else {
            if (done)
                received_done = true;
            var event = document.createEvent("CustomEvent");
            event.initCustomEvent("control", false, false, data);
            self.dispatchEvent(event, data);
        }
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

        if (!command.host) {
            if (default_host)
                command.host = default_host;
        }

        if (binary) {
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
        else if (sent_done)
            console.warn("sending message after done");
        else if (!transport)
            queue.push([false, message]);
        else
            send_payload(message);
    };

    self.control = function control(options) {
        options = options || { };
        if (!options.command)
            options.command = "options";
	if (options.command === "done")
            sent_done = true;
        options.channel = id;
        if (!transport)
            queue.push([true, options]);
        else
            transport.send_control(options);
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

    self.buffer = function buffer(callback) {
        var buffers = [];
        buffers.callback = callback;
        buffers.squash = function squash() {
            return join_data(buffers, binary);
        };

        self.addEventListener("message", function(event, data) {
            var consumed, block;
            buffers.push(data);
            if (buffers.callback) {
                block = join_data(buffers, binary);
                if (block.length > 0) {
                    consumed = buffers.callback.call(self, block);
                    if (typeof consumed !== "number" || consumed === block.length) {
                        buffers.length = 0;
                    } else if (consumed === 0) {
                        buffers.length = 1;
                        buffers[0] = block;
                    } else if (consumed !== 0) {
                        buffers.length = 1;
                        if (block.subarray)
                            buffers[0] = block.subarray(consumed);
                        else if (block.substring)
                            buffers[0] = block.substring(consumed);
                        else
                            buffers[0] = block.slice(consumed);
                    }
                }
            }
        });

        return buffers;
    };

    self.toString = function toString() {
        var host = options["host"] || "localhost";
        return "[Channel " + (valid ? id : "<invalid>") + " -> " + host + "]";
    };
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
            var data = window.unescape(encodeURIComponent(string));
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

                    str += decodeURIComponent(window.escape(data.substring(beg, i)));
                    str += "\ufffd";
                    i++;
                    beg = i;
                } else {
                    i += x;
                }
            }

            str += decodeURIComponent(window.escape(data.substring(beg, i)));
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
        options: { },
        uri: calculate_url,
    };
}


function full_scope(cockpit, $, po) {

    /* ---------------------------------------------------------------------
     * User and system information
     */

    cockpit.info = { };
    init_callback = function(options) {
        if (options.system)
            $.extend(cockpit.info, options.system);
        if (options.system)
            $(cockpit.info).trigger("changed");
    };

    function User() {
        var self = this;
        self["user"] = null;
        self["name"] = null;

        var dbus = cockpit.dbus(null, { "bus": "internal" });
        dbus.call("/user", "org.freedesktop.DBus.Properties",
                  "GetAll", [ "cockpit.User" ],
                  { "type": "s" })
            .done(function(reply) {
                var user = reply[0];
                self["user"] = user.Name.v;
                self["name"] = user.Full.v;
                self["id"] = user.Id.v;
                self["groups"] = user.Groups.v;
                self["home"] = user.Home.v;
                self["shell"] = user.Shell.v;
            })
            .fail(function(ex) {
                console.warn("couldn't load user info: " + ex.message);
            })
            .always(function() {
                dbus.close();
                $(self).triggerHandler("changed");
            });
    }

    var the_user = null;
    Object.defineProperty(cockpit, "user", {
        enumerable: true,
        get: function user_get() {
            if (!the_user)
                the_user = new User();
            return the_user;
        }
    });

    document.addEventListener("click", function(ev) {
        if ($(ev.target).hasClass('disabled'))
          ev.stopPropagation();
    }, true);

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

            /* Undo unnecessary encoding of these */
            href = href.replace("%40", "@");

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

    /* ------------------------------------------------------------------------
     * Cockpit jump
     */

    cockpit.jump = function jump(path, host) {
        if ($.isArray(path))
            path = "/" + path.map(encodeURIComponent).join("/").replace("%40", "@");
        else
            path = "" + path;
        var options = { command: "jump", location: path };
        if (host)
            options.host = host;
        cockpit.transport.inject("\n" + JSON.stringify(options));
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
            this.message = cockpit.message(arg0);
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

        /* Callback that wants a stream response, see below */
        var buffer = channel.buffer(null);

        $(channel).
            on("close", function(event, options) {
                spawn_debug("process closed:", JSON.stringify(options));
                if (options.problem) {
                    dfd.reject(new ProcessError(options.problem));
                } else if (options["exit-status"] || options["exit-signal"]) {
                    dfd.reject(new ProcessError(options["exit-status"], options["exit-signal"]));
                } else {
                    var data = buffer.squash();
                    spawn_debug("process output:", data);
                    dfd.resolve(data);
                }
            });

        var jpromise = dfd.promise;
        dfd.promise = function() {
            return $.extend(jpromise.apply(this, arguments), {
                stream: function(callback) {
                    buffer.callback = callback;
                    return this;
                },
                input: function(message, stream) {
                    if (message !== null && message !== undefined) {
                        spawn_debug("process input:", message);
                        channel.send(message);
                    }
                    if (!stream)
                        channel.control({ command: "done" });
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
            this.message = cockpit.message(arg);
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

        Object.defineProperty(self, $.expando, {
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

        Object.defineProperty(self, $.expando, {
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

    /* File access
     */

    cockpit.file = function file(path, options) {
        options = options || { };
        var binary = options.binary;

        var self = {
            read: read,
            replace: replace,
            modify: modify,

            watch: watch,

            close: close
        };

        var base_channel_options = $.extend({ }, options);
        delete base_channel_options.syntax;

        function parse(str) {
            if (options.syntax && options.syntax.parse)
                return options.syntax.parse(str);
            else
                return str;
        }

        function stringify(obj) {
            if (options.syntax && options.syntax.stringify)
                return options.syntax.stringify(obj);
            else
                return obj;
        }

        var read_promise = null;
        var read_channel;

        function read() {
            if (read_promise)
                return read_promise;

            var dfd = $.Deferred();
            var opts = $.extend({ }, base_channel_options, {
                payload: "fsread1",
                path: path
            });

            function try_read() {
                read_channel = cockpit.channel(opts);
                var content_parts = [ ];
                $(read_channel).on("message", function (event, message) {
                    content_parts.push(message);
                });
                $(read_channel).on("close", function (event, message) {
                    read_channel = null;

                    if (message.problem == "change-conflict") {
                        try_read();
                        return;
                    }

                    read_promise = null;

                    if (message.problem) {
                        var error = new BasicError(message.problem, message.message);
                        fire_watch_error_callbacks(error);
                        dfd.reject(error);
                        return;
                    }

                    var content;
                    if (message.tag == "-")
                        content = null;
                    else {
                        try {
                            content = parse(join_data(content_parts, binary));
                        } catch (e) {
                            fire_watch_error_callbacks(e);
                            dfd.reject(e);
                            return;
                        }
                    }

                    fire_watch_content_callbacks(content, message.tag);
                    dfd.resolve(content, message.tag);
                });
            }

            try_read();

            read_promise = dfd.promise();
            return read_promise;
        }

        var replace_channel = null;

        function replace(new_content, expected_tag) {
            var dfd = $.Deferred();

            var file_content;
            try {
                if (new_content === null)
                    file_content = null;
                else
                    file_content = stringify(new_content);
            }
            catch (e) {
                dfd.reject(e);
                return dfd.promise();
            }

            if (replace_channel)
                replace_channel.close("abort");

            var opts = $.extend({ }, base_channel_options, {
                payload: "fsreplace1",
                path: path,
                tag: expected_tag
            });
            replace_channel = cockpit.channel(opts);

            $(replace_channel).on("close", function (event, message) {
                replace_channel = null;
                if (message.problem) {
                    dfd.reject(new BasicError(message.problem, message.message));
                } else {
                    fire_watch_content_callbacks(new_content, message.tag);
                    dfd.resolve(message.tag);
                }
            });

            /* TODO - don't flood the channel when file_content is
             *        very large.
             */
            if (file_content !== null)
                replace_channel.send(file_content);
            replace_channel.control({ command: "done" });

            return dfd.promise();
        }

        function modify(callback, initial_content, initial_tag) {
            var dfd = $.Deferred();

            function update(content, tag) {
                var new_content = callback(content);
                if (new_content === undefined)
                    new_content = content;
                replace(new_content, tag).
                    done(function (new_tag) {
                        dfd.resolve(new_content, new_tag);
                    }).
                    fail(function (error) {
                        if (error.problem == "change-conflict")
                            read_then_update();
                        else
                            dfd.reject(error);
                    });
            }

            function read_then_update() {
                read().
                    done(update).
                    fail (function (error) {
                        dfd.reject(error);
                    });
            }

            if (initial_content === undefined)
                read_then_update();
            else
                update(initial_content, initial_tag);

            return dfd.promise();
        }

        var watch_content_callbacks = $.Callbacks();
        var watch_error_callbacks = $.Callbacks();
        var n_watch_callbacks = 0;

        var watch_channel = null;
        var watch_tag;

        function ensure_watch_channel() {
            if (n_watch_callbacks > 0) {
                if (watch_channel)
                    return;

                var opts = $.extend({ }, base_channel_options, {
                    payload: "fswatch1",
                    path: path
                });
                watch_channel = cockpit.channel(opts);
                $(watch_channel).on("message", function (event, message_string) {
                    var message;
                    try      { message = JSON.parse(message_string); }
                    catch(e) { message = null; }
                    if (message && message.path == path && message.tag && message.tag != watch_tag)
                        read();
                });
            } else {
                if (watch_channel) {
                    watch_channel.close();
                    watch_channel = null;
                }
            }
        }

        function fire_watch_content_callbacks(content, tag) {
            watch_tag = tag;
            watch_content_callbacks.fire(content, tag);
        }

        function fire_watch_error_callbacks(error) {
            watch_error_callbacks.fire(error);
        }

        function watch(callback, error) {
            if (callback)
                watch_content_callbacks.add(callback);
            if (error)
                watch_error_callbacks.add(error);
            n_watch_callbacks += 1;
            ensure_watch_channel();

            watch_tag = null;
            read();

            return {
                remove: function () {
                    if (callback)
                        watch_content_callbacks.remove(callback);
                    if (error)
                        watch_error_callbacks.remove(error);
                    n_watch_callbacks -= 1;
                    ensure_watch_channel();
                }
            };
        }

        function close() {
            if (read_channel)
                read_channel.close("cancelled");
            if (replace_channel)
                replace_channel.close("cancelled");
            if (watch_channel)
                watch_channel.close("cancelled");
        }

        return self;
    };

    /* ---------------------------------------------------------------------
     * Localization
     */

    var po_data = { };
    var po_plural;

    cockpit.language = undefined;

    cockpit.locale = function locale(po) {
        var lang = cockpit.language || "en";
        var header;

        if (po) {
            $.extend(po_data, po);
            header = po[""];
        } else {
            po_data = { };
        }

        if (header) {
            if (header["plural-forms"]) {
                /*
                 * This code has been cross checked when it was compiled by our
                 * po2json tool. Therefore ignore warnings about eval being evil.
                 */

                /* jshint ignore:start */
                po_plural = new Function("n", "var nplurals, plural; " +
                                         header["plural-forms"] + "; return plural;");
                /* jshint ignore:end */
            }
            if (header["language"])
                lang = header["language"];
        }

        cockpit.language = lang;
    };

    cockpit.translate = function translate(sel) {
        $("[translatable=\"yes\"]", sel).each(function(i, e) {
            var $e = $(e);
            var translated = cockpit.gettext(e.getAttribute("context"), $e.text());
            $(e).removeAttr("translatable").text(translated);
        });
    };

    cockpit.gettext = function gettext(context, string) {
        /* Missing first parameter */
        if (arguments.length == 1) {
            string = context;
            context = undefined;
        }

        var key = context ? context + '\u0004' + string : string;
        if (po_data) {
            var translated = po_data[key];
            if (translated && translated[1])
                return translated[1];
        }
        return string;
    };

    function imply( val ) {
        return (val === true ? 1 : val ? val : 0);
    }

    cockpit.ngettext = function ngettext(context, string1, stringN, num) {
        /* Missing first parameter */
        if (arguments.length == 3) {
            num = stringN;
            stringN = string1;
            string1 = context;
            context = undefined;
        }

        var key = context ? context + '\u0004' + string1 : string1;
        if (po_data && po_plural) {
            var translated = po_data[key];
            if (translated) {
                var i = imply(po_plural(num)) + 1;
                if (translated[i])
                    return translated[i];
            }
        }
        if (num == 1)
            return string1;
        return stringN;
    };

    cockpit.noop = function noop(arg0, arg1) {
        return arguments[arguments.length - 1];
    };

    /* Only for _() calls here in the cockpit code */
    var _ = cockpit.gettext;

    /* ---------------------------------------------------------------------
     * Utilities
     */

    var fmt_re = /\$\{([^}]+)\}|\$([a-zA-Z0-9_]+)/g;
    cockpit.format = function format(fmt, args) {
        if (arguments.length != 2 || typeof args !== "object" || args === null)
            args = Array.prototype.slice.call(arguments, 1);
        return fmt.replace(fmt_re, function(m, x, y) { return args[x || y] || ""; });
    };

    function format_units(number, suffixes, factor, separate) {
        var divided = false;
        var quotient;
        var suffix = null;

        /* Find that factor string */
        if (typeof (factor) === "string") {
            /* Prefer larger factors */
            var keys = [];
            for (var key in suffixes)
                keys.push(key);
            keys.sort().reverse();
            for (var y = 0; y < keys.length; y++) {
                for (var x = 0; x < suffixes[keys[y]].length; x++) {
                    if (factor == suffixes[keys[y]][x]) {
                        number = number / Math.pow(keys[y], x);
                        suffix = factor;
                        divided = x > 0;
                        break;
                    }
                }
                if (suffix)
                    break;
            }

        /* @factor is a number */
        } else if (factor in suffixes) {
            var divisor = 1;
            for (var i = 0; i < suffixes[factor].length; i++) {
                quotient = number / divisor;
                if (quotient < factor) {
                    number = quotient;
                    suffix = suffixes[factor][i];
                    divided = divisor > 1;
                    break;
                }
                divisor *= factor;
            }
        }

        var ret;

        if (!suffix) {
            ret = [number.toString()];
            if (!separate)
                ret = ret.join(" ");
            return ret;
        }

        /* non-zero values should never appear zero */
        if (number > 0 && number < 0.1)
            number = 0.1;

        /* TODO: Make the decimal separator translatable */
        if (number === 0 || !divided)
            ret = [number.toString(), suffix];
        else
            ret = [number.toFixed(1), suffix];
        if (!separate)
            ret = ret.join(" ");
        return ret;
    }

    var byte_suffixes = {
        1024: [ null, "KB", "MB", "GB", "TB", "PB", "EB", "ZB" ],
        1000: [ null, "KB", "MB", "GB", "TB", "PB", "EB", "ZB" ]
        /* 1024: [ null, "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB" ] */
    };

    cockpit.format_bytes = function format_bytes(number, factor, separate) {
        if (factor === undefined)
            factor = 1024;
        return format_units(number, byte_suffixes, factor, separate);
    };

    var byte_sec_suffixes = {
        1024: [ "B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB" ]
    };

    cockpit.format_bytes_per_sec = function format_bytes_per_sec(number) {
        return format_units(number, byte_sec_suffixes, 1024, false) + "/s";
    };

    var bit_suffixes = {
        1000: [ "bps", "Kbps", "Mbps", "Gbps", "Tbps", "Pbps", "Ebps", "Zbps" ]
    };

    cockpit.format_bits_per_sec = function format_bits_per_sec(number) {
        return format_units(number, bit_suffixes, 1000, false);
    };

    cockpit.message = function message(arg) {
        if (arg.message)
            return arg.message;

        var problem = null;
        if (arg.problem)
            problem = arg.problem;
        else
            problem = arg + "";
        if (problem == "terminated")
            return _("Your session has been terminated.");
        else if (problem == "no-session")
            return _("Your session has expired. Please log in again.");
        else if (problem == "not-authorized")
            return _("Login failed");
        else if (problem == "unknown-hostkey")
            return _("Untrusted host");
        else if (problem == "internal-error")
            return _("Internal error");
        else if (problem == "timeout")
            return _("Connection has timed out.");
        else if (problem == "no-cockpit")
            return _("Cockpit is not installed on the host.");
        else if (problem == "no-forwarding")
            return _("Cannot forward login credentials");
        else if (problem == "disconnected")
            return _("Server has closed the connection.");
        else
            return problem;
    };

    function HttpError(arg0, arg1, message) {
        this.status = parseInt(arg0, 10);
        this.reason = arg1;
        this.message = message || arg1;
        this.problem = null;

        this.valueOf = function() {
            return this.status;
        };
        this.toString = function() {
            return this.status + " " + this.message;
        };
    }

    function http_debug() {
        if (window.debugging == "all" || window.debugging == "http")
            console.debug.apply(console, arguments);
    }

    function find_header(headers, name) {
        if (!headers)
            return undefined;
        name = name.toLowerCase();
        for (var head in headers) {
            if (head.toLowerCase() == name)
                return headers[head];
        }
        return undefined;
    }

    function HttpClient(endpoint, options) {
        var self = this;

        options.payload = "http-stream1";

        if (endpoint !== undefined) {
            if (endpoint.indexOf && endpoint.indexOf("/") === 0) {
                options.unix = endpoint;
            } else {
                var port = parseInt(endpoint, 10);
                if (!isNaN(port))
                    options.port = port;
                else
                    throw "The endpoint must be either a unix path or port number";
            }
        }

        self.request = function request(req) {
            var dfd = new $.Deferred();

            if (!req.path)
                req.path = "/";
            if (!req.method)
                req.method = "GET";
            if (req.params) {
                if (req.path.indexOf("?") === -1)
                    req.path += "?" + $.param(req.params);
                else
                    req.path += "&" + $.param(req.params);
            }
            delete req.params;

            var input = req.body;
            delete req.body;

            if (!req.headers)
                delete req.headers;

            $.extend(req, options);
            http_debug("http request:", JSON.stringify(req));

            /* We need a channel for the request */
            var channel = cockpit.channel(req);

            if (input !== undefined) {
                if (input !== "") {
                    http_debug("http input:", input);
                    channel.send(input);
                }
                http_debug("http done");
                channel.control({ command: "done" });
            }

            /* Callbacks that want to stream or get headers */
            var streamer = null;
            var responsers = null;

            var count = 0;
            var resp = null;

            var buffer = channel.buffer(function(data) {
                count += 1;

                if (count === 1) {
                    if (channel.binary)
                        data = cockpit.utf8_decoder().decode(data);
                    resp = JSON.parse(data);

                    /* Anyone looking for response details? */
                    if (responsers) {
                        resp.headers = resp.headers || { };
                        responsers.fire(resp.status, resp.headers);
                    }
                    return true;
                }

                /* Fire any streamers */
                if (resp.status >= 200 && resp.status <= 299 && streamer)
                    return streamer(data);

                return 0;
            });

            $(channel).on("close", function(event, options) {
                if (options.problem) {
                    http_debug("http problem: ", options.problem);
                    dfd.reject(new BasicError(options.problem));

                } else {
                    var body = buffer.squash();

                    /* An error, fail here */
                    if (resp && (resp.status < 200 || resp.status > 299)) {
                        var message;
                        var type = find_header(resp.headers, "Content-Type");
                        if (type && !channel.binary) {
                            if (type.indexOf("text/plain") === 0)
                                message = body;
                        }
                        http_debug("http status: ", resp.status);
                        dfd.reject(new HttpError(resp.status, resp.reason, message));

                    } else {
                        http_debug("http done");
                        dfd.resolve(body);
                    }
                }

                $(channel).off();
            });

            var jpromise = dfd.promise;
            dfd.promise = function mypromise() {
                var ret = $.extend(jpromise.apply(this, arguments), {
                    stream: function(callback) {
                        streamer = callback;
                        return this;
                    },
                    response: function(callback) {
                        if (responsers === null)
                            responsers = $.Callbacks("" /* no flags */);
                        responsers.add(callback);
                        return this;
                    },
                    input: function(message, stream) {
                        if (message !== null && message !== undefined) {
                            http_debug("http input:", message);
                            channel.send(message);
                        }
                        if (!stream) {
                            http_debug("http done");
                            channel.control({ command: "done" });
                        }
                        return this;
                    },
                    close: function(problem) {
                        http_debug("http closing:", problem);
                        channel.close(problem);
                        $(channel).off("message");
                        return this;
                    },
                    promise: this.promise
                });
                return ret;
            };

            return dfd.promise();
        };

        self.get = function get(path, params, headers) {
            return self.request({
                "method": "GET",
                "params": params,
                "path": path,
                "body": "",
                "headers": headers
            });
        };

        self.post = function post(path, body, headers) {
            headers = headers || { };

            if ($.isPlainObject(body) || $.isArray(body)) {
                body = JSON.stringify(body);
                if (find_header(headers, "Content-Type") === undefined)
                    headers["Content-Type"] = "application/json";
            } else if (body === undefined || body === null) {
                body = "";
            } else if (typeof body !== "string") {
                body = String(body);
            }

            return self.request({
                "method": "POST",
                "path": path,
                "body": body,
                "headers": headers
            });
        };
    }

    /* public */
    cockpit.http = function(endpoint, options) {
        if ($.isPlainObject(endpoint) && options === undefined) {
            options = endpoint;
            endpoint = undefined;
        }
        return new HttpClient(endpoint, options || { });
    };

    /* ---------------------------------------------------------------------
     * Permission
     */

    var authority = null;

    function Permission(options) {
        var self = this;
        self.allowed = null;

        var user = cockpit.user;
        var group = null;

        if (options)
            group = options.group;

        function decide() {
            if (user.id === 0)
                return true;

            if (group && user.groups) {
                var allowed = false;
                $.each(user.groups, function(i, name) {
                    if (name == group) {
                        allowed = true;
                        return false;
                    }
                });
                return allowed;
            }

            if (user.id === undefined)
                return null;

            return false;
        }

        function user_changed() {
            var allowed = decide();
            if (self.allowed !== allowed) {
                self.allowed = allowed;
                $(self).triggerHandler("changed");
            }
        }

        $(user).on("changed", user_changed);
        user_changed();

        self.close = function close() {
            $(user).off("changed", user_changed);
        };
    }

    cockpit.permission = function permission(arg) {
        return new Permission(arg);
    };

    /*
     * If we're embedded, send oops to parent frame. Since everything
     * could be broken at this point, just do it manually, without
     * involving cockpit.transport or any of that logic.
     */

    var old_onerror;

    if (window.navigator.userAgent.indexOf("PhantomJS") == -1 &&
        window.parent !== window &&
        window.parent.options && window.parent.options.sink &&
        window.parent.options.protocol == "cockpit1") {
        old_onerror = window.onerror;
        window.onerror = function(msg, url, line) {
            window.parent.postMessage("\n{ \"command\": \"oops\" }", origin);
            if (old_onerror)
                return old_onerror(msg, url, line);
            return false;
        };
    }

} /* full_scope */

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

var self_module_id;

/* Check how we're being loaded */
var last = document.scripts[document.scripts.length - 1].src || "";
var pos = last.indexOf("/cockpit.js");
if (pos === -1)
    pos = last.indexOf("/cockpit.min.js");
if (pos !== -1)
    pos = last.substring(0, pos).lastIndexOf("/");

/* cockpit.js is being loaded as a <script>  and no other loader around? */
if (pos !== -1) {
    self_module_id = last.substring(pos + 1, last.indexOf(".", pos + 1));
    window.cockpit = factory(window.jQuery);
}

/* Cockpit loaded via AMD loader */
if (typeof define === 'function' && define.amd) {
    if (self_module_id)
        define(self_module_id, ['jquery'], window.cockpit);
    else
        define(['jquery'], factory);
}

})();
