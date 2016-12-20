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

var url_root;

try {
    // Sometimes this throws a SecurityError such as during testing
    url_root = window.localStorage.getItem('url-root');
} catch(e) { }

var mock = mock || { };

var phantom_checkpoint = phantom_checkpoint || function () { };

(function() {
"use strict";

var cockpit = { };
event_mixin(cockpit, { });

if (typeof window.debugging === "undefined") {
    try {
        // Sometimes this throws a SecurityError such as during testing
        window.debugging = window.sessionStorage["debugging"] ||
                           window.localStorage["debugging"];
    } catch(e) { }
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

function is_function(x) {
    return typeof x === 'function';
}

function is_object(x) {
    return x !== null && typeof x === 'object';
}

function is_plain_object(x) {
    return is_object(x) && Object.prototype.toString.call(x) === '[object Object]';
}

/* Also works for negative zero */
function is_negative(n) {
    return ((n = +n) || 1 / n) < 0;
}

/* Object.assign() workalike */
function extend(to/* , from ... */) {
    var j, len, key, from;
    for (j = 1, len = arguments.length; j < len; j++) {
        from = arguments[j];
        if (from) {
            for (key in from) {
                if (from[key] !== undefined)
                    to[key] = from[key];
            }
        }
    }
    return to;
}

function invoke_functions(functions, self, args) {
    var length = functions ? functions.length : 0;
    for (var i = 0; i < length; i++) {
        if (functions[i])
            functions[i].apply(self, args);
    }
}

/* -------------------------------------------------------------------------
 * Channels
 *
 * Public: https://files.cockpit-project.org/guide/api-cockpit.html
 */

var default_transport = null;
var public_transport = null;
var reload_after_disconnect = false;
var expect_disconnect = false;
var init_callback = null;
var default_host = null;
var process_hints = null;
var incoming_filters = null;
var outgoing_filters = null;

var have_array_buffer = !!window.ArrayBuffer;

var transport_origin = window.location.origin;

if (!transport_origin) {
    transport_origin = window.location.protocol + "//" + window.location.hostname +
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

/*
 * Extends an object to have the standard DOM style addEventListener
 * removeEventListener and dispatchEvent methods. The dispatchEvent
 * method has the additional capability to create a new event from a type
 * string and arguments.
 */
function event_mixin(obj, handlers) {
    Object.defineProperties(obj, {
        addEventListener: {
            enumerable: false,
            value: function addEventListener(type, handler) {
                if (handlers[type] === undefined)
                    handlers[type] = [ ];
                handlers[type].push(handler);
            }
        },
        removeEventListener: {
            enumerable: false,
            value: function removeEventListener(type, handler) {
                var length = handlers[type] ? handlers[type].length : 0;
                for (var i = 0; i < length; i++) {
                    if (handlers[type][i] === handler) {
                        handlers[type][i] = null;
                        break;
                    }
                }
            }
        },
        dispatchEvent: {
            enumerable: false,
            value: function dispatchEvent(event) {
                var type, args;
                if (typeof event === "string") {
                    type = event;
                    args = Array.prototype.slice.call(arguments, 1);
                    event = document.createEvent("CustomEvent");
                    if (arguments.length == 2)
                        event.initCustomEvent(type, false, false, arguments[1]);
                    else if (arguments.length > 2)
                        event.initCustomEvent(type, false, false, args);
                    else
                        event.initCustomEvent(type, false, false, null);
                    args.unshift(event);
                } else {
                    type = event.type;
                    args = arguments;
                }
                if (is_function(obj['on' + type]))
                    obj['on' + type].apply(obj, args);
                invoke_functions(handlers[type], obj, args);
            }
        }
    });
}

function calculate_application() {
    var path = window.location.pathname || "/";
    var _url_root = url_root;
    if (window.mock && window.mock.pathname)
        path = window.mock.pathname;
    if (window.mock && window.mock.url_root)
        _url_root = window.mock.url_root;

    if (_url_root && path.indexOf('/' + _url_root) === 0)
        path = path.replace('/' + _url_root, '') || '/';

    if (path.indexOf("/cockpit/") !== 0 && path.indexOf("/cockpit+") !== 0) {
        if (path.indexOf("/=") === 0)
            path = "/cockpit+" + path.split("/")[1];
        else
            path = "/cockpit";
    }

    return path.split("/")[1];
}

function calculate_url(suffix) {
    if (!suffix)
        suffix = "socket";
    var window_loc = window.location.toString();
    var _url_root = url_root;

    if (window.mock && window.mock.url)
        return window.mock.url;
    if (window.mock && window.mock.url_root)
        _url_root = window.mock.url_root;

    var prefix = calculate_application();
    if (_url_root)
        prefix = _url_root + "/" + prefix;

    if (window_loc.indexOf('http:') === 0) {
        return "ws://" + window.location.host + "/" + prefix + "/" + suffix;
    } else if (window_loc.indexOf('https:') === 0) {
        return "wss://" + window.location.host + "/" + prefix + "/" + suffix;
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
    self.readyState = 0;

    window.addEventListener("message", function receive(event) {
        if (event.origin !== transport_origin || event.source !== parent)
            return;
        var data = event.data;
        if (data === undefined || data.length === undefined)
            return;
        if (data.length === 0) {
            self.readyState = 3;
            self.onclose();
        } else {
            self.onmessage(event);
        }
    }, false);

    self.send = function send(message) {
        parent.postMessage(message, transport_origin);
    };

    self.close = function close() {
        self.readyState = 3;
        parent.postMessage("", transport_origin);
        self.onclose();
    };

    window.setTimeout(function() {
        self.readyState = 1;
        self.onopen();
    }, 0);
}

function parse_channel(data) {
    var binary, length, pos, channel;

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
            return null;
        } else if (pos === 0) {
            console.warn("binary control message");
            return null;
        } else {
            channel = String.fromCharCode.apply(null, binary.subarray(0, pos));
        }

    /* A textual message */
    } else {
        pos = data.indexOf('\n');
        if (pos === -1) {
            console.warn("text message without channel");
            return null;
        }
        channel = data.substring(0, pos);
    }

    return channel;
}

/* Private Transport class */
function Transport() {
    var self = this;
    self.application = calculate_application();

    /* We can trigger events */
    event_mixin(self, { });

    var last_channel = 0;
    var channel_seed = "";

    if (window.mock)
        window.mock.last_transport = self;

    var ws;
    var check_health_timer;
    var ignore_health_check = false;
    var got_message = false;

    /* See if we should communicate via parent */
    if (window.parent !== window && window.name.indexOf("cockpit1:") === 0)
        ws = new ParentWebSocket(window.parent);

    /* HACK: Compatibility if we're hosted by older Cockpit versions */
    try {
           /* See if we should communicate via parent */
           if (!ws && window.parent !== window && window.parent.options &&
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
                if (ignore_health_check) {
                    console.log("health check failure ignored");
                } else {
                    console.log("health check failed");
                    self.close({ "problem": "timeout" });
                }
            }
            got_message = false;
        }, 30000);
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
            self.dispatchEvent("ready");
        }
    }

    ws.onopen = function() {
        if (ws) {
            if (typeof ws.binaryType !== "undefined" && have_array_buffer) {
                ws.binaryType = "arraybuffer";
                binary_type_available = true;
            }
            ws.send("\n{ \"command\": \"init\", \"version\": 1 }");
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

    ws.onmessage = self.dispatch_data = function(arg) {
        got_message = true;

        /* The first line of a message is the channel */
        var message = arg.data;

        var channel = parse_channel(message);
        if (channel === null)
            return false;

        var payload, control;
        if (have_array_buffer && message instanceof window.ArrayBuffer)
            payload = new window.Uint8Array(message, channel.length + 1);
        else
            payload = message.substring(channel.length + 1);

        /* A control message, always string */
        if (!channel) {
            transport_debug("recv control:", payload);
            control = JSON.parse(payload);
        } else  {
            transport_debug("recv " + channel + ":", payload);
        }

        var i, length = incoming_filters ? incoming_filters.length : 0;
        for (i = 0; i < length; i++) {
            if (incoming_filters[i](message, channel, control) === false)
                return false;
        }

        if (!channel)
            process_control(control);
        else
            process_message(channel, payload);

        phantom_checkpoint();
        return true;
    };

    self.close = function close(options) {
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

        if (options.version !== 1) {
            console.error("received unsupported version in init message: " + options.version);
            self.close({"problem": "not-supported"});
            return;
        }

        if (in_array(options["capabilities"] || [], "binary"))
            self.binary = binary_type_available;
        if (options["channel-seed"])
            channel_seed = String(options["channel-seed"]);
        if (options["host"])
            default_host = options["host"];

        if (public_transport) {
            public_transport.options = options;
            public_transport.csrf_token = options["csrf-token"];
            public_transport.host = default_host;
        }

        if (init_callback)
            init_callback(options);

        if (waiting_for_init) {
            waiting_for_init = false;
            ready_for_channels();
        }
    }

    function process_control(data) {
        var channel = data.channel;
        var func;

        /* Init message received */
        if (data.command == "init") {
            process_init(data);

        } else if (waiting_for_init) {
            waiting_for_init = false;
            if (data.command != "close" || channel) {
                console.error("received message before init: ", data.command);
                data = { "problem": "protocol-error" };
            }
            self.close(data);

        } else if (data.command == "ping") {
            /* 'ping' messages are ignored */

        } else if (data.command == "hint") {
            if (process_hints)
                process_hints(data);

        } else if (channel !== undefined) {
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

    /* The channel/control arguments is used by filters, and auto-populated if necessary */
    self.send_data = function send_data(data, channel, control) {
        if (!ws) {
            console.log("transport closed, dropped message: ", data);
            return false;
        }

        var i, length = outgoing_filters ? outgoing_filters.length : 0;
        for (i = 0; i < length; i++) {
            if (channel === undefined)
                channel = parse_channel(data);
            if (!channel && control === undefined)
                control = JSON.parse(data);
            if (outgoing_filters[i](data, channel, control) === false)
                return false;
        }

        ws.send(data);
        return true;
    };

    /* The control arguments is used by filters, and auto populated if necessary */
    self.send_message = function send_message(payload, channel, control) {
        if (channel)
            transport_debug("send " + channel, payload);
        else
            transport_debug("send control:", payload);

        /* A binary message */
        if (payload.byteLength || is_array(payload)) {
            if (payload instanceof window.ArrayBuffer)
                payload = new window.Uint8Array(payload);
            var output = join_data([array_from_raw_string(channel), [ 10 ], payload ], true);
            return self.send_data(output.buffer, channel, control);

        /* A string message */
        } else {
            return self.send_data(channel.toString() + "\n" + payload, channel, control);
        }
    };

    self.send_control = function send_control(data) {
        if(!ws && (data.command == "close" || data.command == "kill"))
            return; /* don't complain if closed and closing */
        if (check_health_timer &&
            data.command == "hint" && data.hint == "ignore_transport_health_check") {
            /* This is for us, process it directly. */
            ignore_health_check = data.data;
            return;
        }
        self.send_message(JSON.stringify(data), "", data);
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
    var ready = null;
    var closed = null;
    var waiting = null;
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
    self.valid = true;
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
            self.dispatchEvent("message", payload);
        }
    }

    function on_close(data) {
        closed = data;
        self.valid = false;
        if (transport && id)
            transport.unregister(id);
        if (closed.message)
            console.warn(closed.message);
        self.dispatchEvent("close", closed);
        if (waiting)
            waiting.resolve(closed);
    }

    function on_ready(data) {
        ready = data;
        self.dispatchEvent("ready", ready);
    }

    function on_control(data) {
        if (data.command == "close") {
            on_close(data);
            return;
        } else if (data.command == "ready") {
            on_ready(data);
        }

        var done = data.command === "done";
        if (done && received_done) {
            console.warn("received two done commands on channel");
            self.close("protocol-error");

        } else {
            if (done)
                received_done = true;
            self.dispatchEvent("control", data);
        }
    }

    function send_payload(payload) {
        if (binary && base64) {
            payload = base64_encode(payload);
        } else if (!binary) {
            if (typeof payload !== "string")
                payload = String(payload);
        }
        transport.send_message(payload, id);
    }

    ensure_transport(function(trans) {
        transport = trans;
        if (closed)
            return;

        id = transport.next_channel();
        self.id = id;

        /* Register channel handlers */
        transport.register(id, on_control, on_message);

        /* Now open the channel */
        var command = { };
        for (var i in options)
            command[i] = options[i];
        command.command = "open";
        command.channel = id;

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
        } else {
            delete command.binary;
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
        if (closed)
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

    self.wait = function wait(callback) {
        if (!waiting) {
            waiting = cockpit.defer();
            if (closed) {
                waiting.reject(closed);
            } else if (ready) {
                waiting.resolve(ready);
            } else {
                self.addEventListener("ready", function(event, data) {
                    waiting.resolve(data);
                });
                self.addEventListener("close", function(event, data) {
                    waiting.reject(data);
                });
            }
        }
        var promise = waiting.promise;
        if (callback)
            promise.then(callback, callback);
        return promise;
    };

    self.close = function close(options) {
        if (closed)
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

        function on_message(event, data) {
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
        }

        function on_close() {
            self.removeEventListener("message", on_message);
            self.removeEventListener("close", on_close);
        }

        self.addEventListener("message", on_message);
        self.addEventListener("close", on_close);

        return buffers;
    };

    self.toString = function toString() {
        var host = options["host"] || "localhost";
        return "[Channel " + (self.valid ? id : "<invalid>") + " -> " + host + "]";
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

function factory() {

    cockpit.channel = function channel(options) {
        return new Channel(options);
    };

    cockpit.event_target = function event_target(obj) {
        event_mixin(obj, { });
        return obj;
    };

    cockpit.extend = extend;

    /* These can be filled in by loading ../manifests.js */
    cockpit.manifests = { };

    /* ------------------------------------------------------------
     * Text Encoding
     */

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

    cockpit.kill = function kill(host, group) {
        var options = { "command": "kill" };
        if (host)
            options.host = host;
        if (group)
            options.group = group;
        ensure_transport(function(transport) {
            transport.send_control(options);
        });
    };

    /* Not public API ... yet? */
    cockpit.hint = function hint(name, options) {
        if (!options)
            options = default_host;
        if (typeof options == "string")
            options = { "host": options };
        options["command"] = "hint";
        options["hint"] = name;
        ensure_transport(function(transport) {
            transport.send_control(options);
        });
    };

    cockpit.transport = public_transport = {
        wait: ensure_transport,
        inject: function inject(message, out) {
            if (!default_transport)
                return false;
            if (out === undefined || out)
                return default_transport.send_data(message);
            else
                return default_transport.dispatch_data({ data: message });
        },
        filter: function filter(callback, out) {
            if (out) {
                if (!outgoing_filters)
                    outgoing_filters = [ ];
                outgoing_filters.push(callback);
            } else {
                if (!incoming_filters)
                    incoming_filters = [ ];
                incoming_filters.push(callback);
            }
        },
        close: function close(problem) {
            var options;
            if (problem)
                options = {"problem": problem };
            if (default_transport)
                default_transport.close(options);
            default_transport = null;
            this.options = { };
        },
        origin: transport_origin,
        options: { },
        uri: calculate_url,
        application: function () {
            if (!default_transport || window.mock)
                return calculate_application();
            return default_transport.application;
        },
    };

    /* ------------------------------------------------------------------------------------
     * An ordered queue of functions that should be called later.
     */

    var later_queue = [];
    var later_timeout = null;

    function later_drain() {
        var func, queue = later_queue;
        later_timeout = null;
        later_queue = [];
        for (;;) {
            func = queue.shift();
            if (!func)
                break;
            func();
        }
    }

    function later_invoke(func) {
        if (func)
            later_queue.push(func);
        if (later_timeout === null)
            later_timeout = window.setTimeout(later_drain, 0);
    }

    /* ------------------------------------------------------------------------------------
     * Promises.
     * Based on Q and angular promises, with some jQuery compatibility. See the angular
     * license in COPYING.bower for license lineage. There are some key differences with
     * both Q and jQuery.
     *
     *  * Exceptions thrown in handlers are not treated as rejections or failures.
     *    Exceptions remain actual exceptions.
     *  * Unlike jQuery callbacks added to an already completed promise don't execute
     *    immediately. Wait until control is returned to the browser.
     */

    function promise_then(state, fulfilled, rejected, updated) {
        if (fulfilled === undefined && rejected === undefined && updated === undefined)
            return null;
        var result = new Deferred();
        state.pending = state.pending || [];
        state.pending.push([result, fulfilled, rejected, updated]);
        if (state.status > 0)
            schedule_process_queue(state);
        return result.promise;
    }

    function create_promise(state) {

        /* Like jQuery the promise object is callable */
        var self = function Promise(target) {
            if (target) {
                extend(target, self);
                return target;
            }
            return self;
        };

        state.status = 0;

        self.then = function then(fulfilled, rejected, updated) {
            return promise_then(state, fulfilled, rejected, updated) || self;
        };

        self["catch"] = function catch_(callback) {
            return promise_then(state, null, callback) || self;
        };

        self["finally"] = function finally_(callback, updated) {
            return promise_then(state, function() {
                return handle_callback(arguments, true, callback);
            }, function() {
                return handle_callback(arguments, false, callback);
            }, updated) || self;
        };

        /* Basic jQuery Promise compatibility */
        self.done = function done(fulfilled) {
            promise_then(state, fulfilled);
            return self;
        };

        self.fail = function fail(rejected) {
            promise_then(state, null, rejected);
            return self;
        };

        self.always = function always(callback) {
            promise_then(state, callback, callback);
            return self;
        };

        self.progress = function progress(updated) {
            promise_then(state, null, null, updated);
            return self;
        };

        self.state = function state_() {
            if (state.status == 1)
                return "resolved";
            if (state.status == 2)
                return "rejected";
            return "pending";
        };

        /* Promises are recursive like jQuery */
        self.promise = self;

        return self;
    }

    function process_queue(state) {
        var fn, deferred, pending;

        pending = state.pending;
        state.process_scheduled = false;
        state.pending = undefined;
        for (var i = 0, ii = pending.length; i < ii; ++i) {
            state.pur = true;
            deferred = pending[i][0];
            fn = pending[i][state.status];
            if (is_function(fn)) {
                deferred.resolve(fn.apply(state.promise, state.values));
            } else if (state.status === 1) {
                deferred.resolve.apply(deferred.resolve, state.values);
            } else {
                deferred.reject.apply(deferred.reject, state.values);
            }
        }
    }

    function schedule_process_queue(state) {
        if (state.process_scheduled || !state.pending)
            return;
        state.process_scheduled = true;
        later_invoke(function() { process_queue(state); });
    }

    function deferred_resolve(state, values) {
        var then, done = false;
        if (is_object(values[0]) || is_function(values[0]))
            then = values[0] && values[0].then;
        if (is_function(then)) {
            state.status = -1;
            then.call(values, function(/* ... */) {
                if (done)
                    return;
                done = true;
                deferred_resolve(state, arguments);
            }, function(/* ... */) {
                if (done)
                    return;
                done = true;
                deferred_reject(state, arguments);
            }, function(/* ... */) {
                deferred_notify(state, arguments);
            });
        } else {
            state.values = values;
            state.status = 1;
            schedule_process_queue(state);
        }
    }

    function deferred_reject(state, values) {
        state.values = values;
        state.status = 2;
        schedule_process_queue(state);
    }

    function deferred_notify(state, values) {
        var callbacks = state.pending;
        if ((state.status <= 0) && callbacks && callbacks.length) {
            later_invoke(function() {
                var callback, result;
                for (var i = 0, ii = callbacks.length; i < ii; i++) {
                    result = callbacks[i][0];
                    callback = callbacks[i][3];
                    if (is_function(callback))
                        result.notify(callback.apply(state.promise, values));
                    else
                        result.notify.apply(result, values);
                }
            });
        }
    }

    function Deferred() {
        var self = this;
        var state = { };
        self.promise = state.promise = create_promise(state);

        self.resolve = function resolve(/* ... */) {
            if (arguments[0] === state.promise)
                throw new Error("Expected promise to be resolved with other value than itself");
            if (!state.status)
                deferred_resolve(state, arguments);
            return self;
        };

        self.reject = function reject(/* ... */) {
            if (state.status)
                return;
            deferred_reject(state, arguments);
            return self;
        };

        self.notify = function notify(/* ... */) {
            deferred_notify(state, arguments);
            return self;
        };
    }

    function prep_promise(values, resolved) {
        var result = cockpit.defer();
        if (resolved)
            result.resolve.apply(result, values);
        else
            result.reject.apply(result, values);
        return result.promise;
    }

    function handle_callback(values, is_resolved, callback) {
        var callback_output = null;
        if (is_function(callback))
            callback_output = callback();
        if (callback_output && is_function (callback_output.then)) {
            return callback_output.then(function() {
                return prep_promise(values, is_resolved);
            }, function() {
                return prep_promise(arguments, false);
            });
        } else {
            return prep_promise(values, is_resolved);
        }
    }

    cockpit.when = function when(value, fulfilled, rejected, updated) {
        var result = cockpit.defer();
        result.resolve(value);
        return result.promise.then(fulfilled, rejected, updated);
    };

    cockpit.all = function all(promises) {
        var deferred = cockpit.defer();
        var counter = 0;
        var results = [];

        if (arguments.length != 1 && !is_array (promises))
            promises = Array.prototype.slice.call(arguments);

        promises.forEach(function(promise, key) {
            counter++;
            cockpit.when(promise).then(function(value) {
                results[key] = value;
                if (!(--counter))
                    deferred.resolve.apply(deferred, results);
            }, function(/* ... */) {
                deferred.reject.apply(deferred, arguments);
            });
        });

        if (counter === 0)
            deferred.resolve(results);
        return deferred.promise;
    };

    cockpit.resolve = function resolve(result) {
        return cockpit.defer().resolve(result).promise;
    };

    cockpit.reject = function reject(ex) {
        return cockpit.defer().reject(ex).promise;
    };

    cockpit.defer = function() {
        return new Deferred();
    };

    /* ---------------------------------------------------------------------
     * Utilities
     */

    var fmt_re = /\$\{([^}]+)\}|\$([a-zA-Z0-9_]+)/g;
    cockpit.format = function format(fmt, args) {
        if (arguments.length != 2 || !is_object(args) || args === null)
            args = Array.prototype.slice.call(arguments, 1);
        return fmt.replace(fmt_re, function(m, x, y) { return args[x || y] || ""; });
    };

    cockpit.format_number = function format_number(number) {
        /* non-zero values should never appear zero */
        if (number > 0 && number < 0.1)
            number = 0.1;
        else if (number < 0 && number > -0.1)
            number = -0.1;

        /* TODO: Make the decimal separator translatable */

        /* only show as integer if we have a natural number */
        if (!number && number !== 0)
            return "";
        else if (number % 1 === 0)
            return number.toString();
        else
            return number.toFixed(1);
    };

    function format_units(number, suffixes, factor, separate) {
        var quotient;
        var suffix = null;
        var key, keys;
        var divisor;
        var y, x, i;

        /* Find that factor string */
        if (!number && number !== 0) {
            suffix = null;

        } else if (typeof (factor) === "string") {
            /* Prefer larger factors */
            keys = [];
            for (key in suffixes)
                keys.push(key);
            keys.sort().reverse();
            for (y = 0; y < keys.length; y++) {
                for (x = 0; x < suffixes[keys[y]].length; x++) {
                    if (factor == suffixes[keys[y]][x]) {
                        number = number / Math.pow(keys[y], x);
                        suffix = factor;
                        break;
                    }
                }
                if (suffix)
                    break;
            }

        /* @factor is a number */
        } else if (factor in suffixes) {
            divisor = 1;
            for (i = 0; i < suffixes[factor].length; i++) {
                quotient = number / divisor;
                if (quotient < factor) {
                    number = quotient;
                    suffix = suffixes[factor][i];
                    break;
                }
                divisor *= factor;
            }
        }

        var string_representation = cockpit.format_number(number);
        var ret;

        if (string_representation && suffix)
            ret = [string_representation, suffix];
        else
            ret = [string_representation];

        if (!separate)
            ret = ret.join(" ");

        return ret;
    }

    var byte_suffixes = {
        1000: [ null, "KB", "MB", "GB", "TB", "PB", "EB", "ZB" ],
        1024: [ null, "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB" ]
    };

    cockpit.format_bytes = function format_bytes(number, factor, separate) {
        if (factor === undefined)
            factor = 1024;
        return format_units(number, byte_suffixes, factor, separate);
    };

    cockpit.get_byte_units = function get_byte_units(guide_value, factor) {
        if (factor === undefined || ! (factor in byte_suffixes))
            factor = 1024;

        function unit(index) {
            return { name: byte_suffixes[factor][index],
                     factor: Math.pow(factor, index)
                   };
        }

        var units = [ unit(2), unit(3), unit(4) ];

        // The default unit is the largest one that gives us at least
        // two decimal digits in front of the comma.

        for (var i = units.length-1; i >= 0; i--) {
            if (i === 0 || (guide_value / units[i].factor) >= 10) {
                units[i].selected = true;
                break;
            }
        }

        return units;
    };

    var byte_sec_suffixes = {
        1024: [ "B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s", "PiB/s", "EiB/s", "ZiB/s" ]
    };

    cockpit.format_bytes_per_sec = function format_bytes_per_sec(number, factor, separate) {
        if (factor === undefined)
            factor = 1024;
        return format_units(number, byte_sec_suffixes, factor, separate);
    };

    var bit_suffixes = {
        1000: [ "bps", "Kbps", "Mbps", "Gbps", "Tbps", "Pbps", "Ebps", "Zbps" ]
    };

    cockpit.format_bits_per_sec = function format_bits_per_sec(number, factor, separate) {
        if (factor === undefined)
            factor = 1000;
        return format_units(number, bit_suffixes, factor, separate);
    };

    /* ---------------------------------------------------------------------
     * Storage Helper.
     *
     * Use application to prefix data stored in browser storage
     * with helpers for compatibility.
     */
    function StorageHelper(storage) {
        var self = this;

        self.prefixedKey = function (key) {
            return cockpit.transport.application() + ":" + key;
        };

        self.getItem = function (key, both) {
            var value = storage.getItem(self.prefixedKey(key));
            if (!value && both)
                value = storage.getItem(key);
            return value;
        };

        self.setItem = function (key, value, both) {
            storage.setItem(self.prefixedKey(key), value);
            if (both)
                storage.setItem(key, value);
        };

        self.removeItem = function(key, both) {
            storage.removeItem(self.prefixedKey(key));
            if (both)
                storage.removeItem(key);
        };

        /* Instead of clearing, purge anything that isn't prefixed with an application
         * and anything prefixed with our application.
         */
        self.clear = function(full) {
            var i = 0;
            while (i < storage.length) {
                var k = storage.key(i);
                if (full && k.indexOf("cockpit") !== 0)
                    storage.removeItem(k);
                else if (k.indexOf(cockpit.transport.application()) === 0)
                    storage.removeItem(k);
                else
                    i++;
            }
        };
    }

    cockpit.localStorage = new StorageHelper(window.localStorage);
    cockpit.sessionStorage = new StorageHelper(window.sessionStorage);

    /* ---------------------------------------------------------------------
     * Shared data cache.
     *
     * We cannot use sessionStorage when keeping lots of data in memory and
     * sharing it between frames. It has a rather paltry limit on the amount
     * of data it can hold ... so we use window properties instead.
     */

    function lookup_storage(win) {
        var storage;
        if (win.parent && win.parent !== win)
            storage = lookup_storage(win.parent);
        if (!storage) {
            try {
                storage = win["cv1-storage"];
                if (!storage)
                    win["cv1-storage"] = storage = { };
            } catch(ex) { }
        }
        return storage;
    }

    function StorageCache(org_key, provider, consumer) {
        var self = this;
        var key = cockpit.transport.application() + ":" + org_key;

        /* For triggering events and ownership */
        var trigger = window.sessionStorage;
        var last;

        var storage = lookup_storage(window);

        var claimed = false;
        var source;

        function callback() {
            var value;

            /* Only run the callback if we have a result */
            if (storage[key] !== undefined) {
                value = storage[key];
                window.setTimeout(function() {
                    if (consumer(value, org_key) === false)
                        self.close();
                });
            }
        }

        function result(value) {
            if (source && !claimed)
                claimed = true;
            if (!claimed)
                return;

            // use a random number to avoid races by separate instances
            var version = Math.floor(Math.random() * 10000000) + 1;

            /* Event for the local window */
            var ev = document.createEvent("StorageEvent");
            ev.initStorageEvent("storage", false, false, key, null,
                                version, window.location, trigger);

            storage[key] = value;
            trigger.setItem(key, version);
            ev.self = self;
            window.dispatchEvent(ev);
        }

        self.claim = function claim() {
            if (source)
                return;

            /* In case we're unclaimed during the callback */
            var claiming = { close: function() { } };
            source = claiming;

            var changed = provider(result, org_key);
            if (source === claiming)
                source = changed;
            else
                changed.close();
        };

        function unclaim() {
            if (source && source.close)
                source.close();
            source = null;

            if (!claimed)
                return;

            claimed = false;

            var current_value = trigger.getItem(key);
            if (current_value)
                current_value = parseInt(current_value, 10);
            else
                current_value = null;

            if (last && last === current_value) {
                var ev = document.createEvent("StorageEvent");
                var version = trigger[key];
                ev.initStorageEvent("storage", false, false, key, version,
                                    null, window.location, trigger);
                delete storage[key];
                trigger.removeItem(key);
                ev.self = self;
                window.dispatchEvent(ev);
            }
        }

        function changed(event) {
            if (event.key !== key)
                return;

            /* check where the event came from
               - it came from someone else:
                   if it notifies their unclaim (new value null) and we haven't already claimed, do so
               - it came from ourselves:
                   if the new value doesn't match the actual value in the cache, and
                   we tried to claim (from null to a number), cancel our claim
             */
            if (event.self !== self) {
                if (!event.newValue && !claimed) {
                    self.claim();
                    return;
                }
            } else if (claimed && !event.oldValue && (event.newValue !== trigger.getItem(key))) {
                unclaim();
            }

            var new_value = null;
            if (event.newValue)
                new_value = parseInt(event.newValue, 10);
            if (last !== new_value) {
                last = new_value;
                callback();
            }
        }

        self.close = function() {
            window.removeEventListener("storage", changed, true);
            unclaim();
        };

        window.addEventListener("storage", changed, true);

        /* Always clear this data on unload */
        window.addEventListener("beforeunload", function() {
            self.close();
        });
        window.addEventListener("unload", function() {
            self.close();
        });

        if (trigger.getItem(key))
            callback();
        else
            self.claim();
    }

    cockpit.cache = function cache(key, provider, consumer) {
        return new StorageCache(key, provider, consumer);
    };

    /* ---------------------------------------------------------------------
     * Metrics
     *
     * Implements the cockpit.series and cockpit.grid. Part of the metrics
     * implementations that do not require jquery.
     */

    function SeriesSink(interval, identifier, fetch_callback) {
        var self = this;

        self.interval = interval;
        self.limit = identifier ? 64 * 1024 : 1024;

        /*
         * The cache sits on a window, either our own or a parent
         * window whichever we can access properly.
         *
         * Entries in the index are:
         *
         * { beg: N, items: [], mapping: { }, next: item }
         */
        var index = setup_index(identifier);

        /*
         * A linked list through the index, that we use for expiry
         * of the cache.
         */
        var count = 0;
        var head = null;
        var tail = null;

        function setup_index(id) {
            if (!id)
                return [];

            /* Try and find a good place to cache data */
            var storage = lookup_storage(window);

            var index = storage[id];
            if (!index)
                storage[id] = index = [];
            return index;
        }

        function search(idx, beg) {
            var low = 0;
            var high = idx.length - 1;
            var mid, val;

            while (low <= high) {
                mid = (low + high) / 2 | 0;
                val = idx[mid].beg;
                if (val < beg)
                    low = mid + 1;
                else if (val > beg)
                    high = mid - 1;
                else
                    return mid; /* key found */
            }
            return low;
        }

        function fetch(beg, end, for_walking) {
            if (fetch_callback) {
                if (!for_walking) {
                    /* Stash some fake data synchronously so that we don't ask
                     * again for the same range while they are still fetching
                     * it asynchronously.
                     */
                    stash(beg, new Array(end-beg), { });
                }
                fetch_callback(beg, end, for_walking);
            }
        }

        self.load = function load(beg, end, for_walking) {
            if (end <= beg)
                return;

            var at = search(index, beg);

            var entry;
            var b, e, eb, en, i, len = index.length;
            var last = beg;

            /* We do this in two phases: First, we walk the index to
             * process what we already have and at the same time make
             * notes about what we need to fetch.  Then we go over the
             * notes and actually fetch what we need.  That way, the
             * fetch callbacks in the second phase can modify the
             * index data structure without disturbing the walk in the
             * first phase.
             */

            var fetches = [ ];

            /* Data relevant to this range can be at the found index, or earlier */
            for (i = at > 0 ? at - 1 : at; i < len; i++) {
                entry = index[i];
                en = entry.items.length;
                if (!en)
                    continue;

                eb = entry.beg;
                b = Math.max(eb, beg);
                e = Math.min(eb + en, end);

                if (b < e) {
                    if (b > last)
                        fetches.push([ last, b ]);
                    process(b, entry.items.slice(b - eb, e - eb), entry.mapping);
                    last = e;
                } else if (i >= at) {
                    break; /* no further intersections */
                }
            }

            for (i = 0; i < fetches.length; i++)
                fetch(fetches[i][0], fetches[i][1], for_walking);

            if (last != end)
                fetch(last, end, for_walking);
        };

        function stash(beg, items, mapping) {
            if (!items.length)
                return;

            var at = search(index, beg);

            var end = beg + items.length;
            var remove = [ ];
            var entry;
            var num;

            var b, e, eb, en, i, len = index.length;
            for (i = at > 0 ? at - 1 : at; i < len; i++) {
                entry = index[i];
                en = entry.items.length;
                if (!en)
                    continue;

                eb = entry.beg;
                b = Math.max(eb, beg);
                e = Math.min(eb + en, end);

                /*
                 * We truncate blocks that intersect with this one
                 *
                 * We could adjust them, but in general the loaders are
                 * intelligent enough to only load the required data, so
                 * not doing this optimization yet.
                 */

                if (b < e) {
                    num = e - b;
                    entry.items.splice(b - eb, num);
                    count -= num;
                    if (b - eb === 0)
                        entry.beg += (e - eb);
                } else if (i >= at) {
                    break; /* no further intersections */
                }
            }

            /* Insert our item into the array */
            entry = { beg: beg, items: items, mapping: mapping };
            if (!head)
                head = entry;
            if (tail)
                tail.next = entry;
            tail = entry;
            count += items.length;
            index.splice(at, 0, entry);

            /* Remove any items with zero length around insertion point */
            for (at--; at <= i; at++) {
                entry = index[at];
                if (entry && !entry.items.length) {
                    index.splice(at, 1);
                    at--;
                }
            }

            /* If our index has gotten too big, expire entries */
            while (head && count > self.limit) {
                count -= head.items.length;
                head.items = [];
                head.mapping = null;
                head = head.next || null;
            }

            /* Remove any entries with zero length at beginning */
            len = index.length;
            for (i = 0; i < len; i++) {
                if (index[i].items.length > 0)
                    break;
            }
            index.splice(0, i);
        }

        /*
         * Used to populate grids, the keys are grid ids and
         * the values are objects: { grid, rows, notify }
         *
         * The rows field is an object indexed by paths
         * container aliases, and the values are: [ row, path ]
         */
        var registered = { };

        /* An undocumented function called by DataGrid */
        self._register = function _register(grid, id) {
            if (grid.interval != interval)
                throw "mismatched metric interval between grid and sink";
            var gdata = registered[id];
            if (!gdata) {
                gdata = registered[id] = { grid: grid, links: [ ] };
                gdata.links.remove = function remove() {
                    delete registered[id];
                };
            }
            return gdata.links;
        };

        function process(beg, items, mapping) {
            var i, j, jlen, k, klen;
            var data, path, row, map;
            var id, gdata, grid;
            var f, t, n, b, e;

            var end = beg + items.length;

            for (id in registered) {
                gdata = registered[id];
                grid = gdata.grid;

                b = Math.max(beg, grid.beg);
                e = Math.min(end, grid.end);

                /* Does this grid overlap the bounds of item? */
                if (b < e) {

                    /* Where in the items to take from */
                    f = b - beg;

                    /* Where and how many to place */
                    t = b - grid.beg;

                    /* How many to process */
                    n = e - b;

                    for (i = 0; i < n; i++) {
                        klen = gdata.links.length;
                        for (k = 0; k < klen; k++) {
                            path = gdata.links[k][0];
                            row = gdata.links[k][1];

                            /* Calulate the data field to fill in */
                            data = items[f + i];
                            map = mapping;
                            jlen = path.length;
                            for (j = 0; data !== undefined && j < jlen; j++) {
                                if (!data) {
                                    data = undefined;
                                } else if (map !== undefined && map !== null) {
                                    map = map[path[j]];
                                    if (map)
                                        data = data[map[""]];
                                    else
                                        data = data[path[j]];
                                } else {
                                    data = data[path[j]];
                                }
                            }

                            row[t + i] = data;
                        }
                    }

                    /* Notify the grid, so it can call any functions */
                    grid.notify(t, n);
                }
            }
        }

        self.input = function input(beg, items, mapping) {
            process(beg, items, mapping);
            stash(beg, items, mapping);
        };
    }

    cockpit.series = function series(interval, cache, fetch) {
        return new SeriesSink(interval, cache, fetch);
    };

    var unique = 1;

    function SeriesGrid(interval, beg, end) {
        var self = this;

        /* We can trigger events */
        event_mixin(self, { });

        var rows = [];

        self.interval = interval;
        self.beg = 0;
        self.end = 0;

        /*
         * Used to populate table data, the values are:
         * [ callback, row ]
         */
        var callbacks = [ ];

        var sinks = [ ];

        var suppress = 0;

        var id = "g1-" + unique;
        unique += 1;

        /* Used while walking */
        var walking = null;
        var offset = null;

        self.notify = function notify(x, n) {
            if (suppress)
                return;
            if (x + n > self.end - self.beg)
                n = (self.end - self.beg) - x;
            if (n <= 0)
                return;
            var j, jlen = callbacks.length;
            var callback, row;
            for (j = 0; j < jlen; j++) {
                callback = callbacks[j][0];
                row = callbacks[j][1];
                callback.call(self, row, x, n);
            }

            self.dispatchEvent("notify", x, n);
        };

        self.add = function add(/* sink, path */) {
            var row = [];
            rows.push(row);

            var registered, sink, path, links, cb;

            /* Called as add(sink, path) */
            if (is_object(arguments[0])) {
                sink = arguments[0];
                sink = sink["series"] || sink;

                /* The path argument can be an array, or a dot separated string */
                path = arguments[1];
                if (!path)
                    path = [];
                else if (typeof (path) === "string")
                    path = path.split(".");

                links = sink._register(self, id);
                if (!links.length)
                    sinks.push({ sink: sink, links: links });
                links.push([path, row]);

            /* Called as add(callback) */
            } else if (is_function(arguments[0])) {
                cb = [ arguments[0], row ];
                if (arguments[1] === true)
                    callbacks.unshift(cb);
                else
                    callbacks.push(cb);

            /* Not called as add() */
            } else if (arguments.length !== 0) {
                throw "invalid args to grid.add()";
            }

            return row;
        };

        self.remove = function remove(row) {
            var j, i, ilen, jlen;

            /* Remove from the sinks */
            ilen = sinks.length;
            for (i = 0; i < ilen; i++) {
                jlen = sinks[i].links.length;
                for (j = 0; j < jlen; j++) {
                    if (sinks[i].links[j][1] === row) {
                        sinks[i].links.splice(j, 1);
                        break;
                    }
                }
            }

            /* Remove from our list of rows */
            ilen = rows.length;
            for (i = 0; i < ilen; i++) {
                if (rows[i] === row) {
                    rows.splice(i, 1);
                    break;
                }
            }
        };

        self.sync = function sync(for_walking) {
            /* Suppress notifications */
            suppress++;

            /* Ask all sinks to load data */
            var sink, i, len = sinks.length;
            for (i = 0; i < len; i++) {
                sink = sinks[i].sink;
                sink.load(self.beg, self.end, for_walking);
            }

            suppress--;

            /* Notify for all rows */
            self.notify(0, self.end - self.beg);
        };

        function move_internal(beg, end, for_walking) {
            if (end === undefined)
                end = beg + (self.end - self.beg);

            if (end < beg)
                beg = end;

            self.beg = beg;
            self.end = end;

            if (!rows.length)
                return;

            rows.forEach(function(row) {
                row.length = 0;
            });

            self.sync(for_walking);
        }

        function stop_walking() {
            window.clearInterval(walking);
            walking = null;
            offset = null;
        }

        self.move = function move(beg, end) {
            stop_walking();
            /* Some code paths use now twice.
             * They should use the same value.
             */
            var now = null;

            /* Treat negative numbers relative to now */
            if (beg === undefined) {
                beg = 0;
            } else if (is_negative(beg)) {
                now = Date.now();
                beg = Math.floor(now / self.interval) + beg;
            }
            if (end !== undefined && is_negative(end)) {
                if (now === null)
                    now = Date.now();
                end = Math.floor(now / self.interval) + end;
            }

            move_internal(beg, end, false);
        };

        self.walk = function walk() {
            /* Don't overflow 32 signed bits with the interval since
             * many browsers will mishandle it.  This means that plots
             * that would make about one step every month don't walk
             * at all, but I guess that is ok.
             *
             * For example,
             * https://developer.mozilla.org/en-US/docs/Web/API/WindowTimers/setTimeout
             * says:
             *
             *    Browsers including Internet Explorer, Chrome,
             *    Safari, and Firefox store the delay as a 32-bit
             *    signed Integer internally. This causes an Integer
             *    overflow when using delays larger than 2147483647,
             *    resulting in the timeout being executed immediately.
             */

            var start = Date.now();
            if (self.interval > 2000000000)
                return;

            stop_walking();
            offset = start - self.beg * self.interval;
            walking = window.setInterval(function() {
                var now = Date.now();
                move_internal(Math.floor((now - offset) / self.interval), undefined, true);
            }, self.interval);
        };

        self.close = function close() {
            stop_walking();
            while (sinks.length)
                (sinks.pop()).links.remove();
        };

        self.move(beg, end);
    }

    cockpit.grid = function grid(interval, beg, end) {
        return new SeriesGrid(interval, beg, end);
    };

    /* --------------------------------------------------------------------
     * Basic utilities.
     */

    function BasicError(problem, message) {
        this.problem = problem;
        this.message = message || cockpit.message(problem);
        this.toString = function() {
            return this.message;
        };
    }

    cockpit.logout = function logout(reload) {
        /* fully clear session storage */
        cockpit.sessionStorage.clear(true);

        /* Only clean application data from localStorage,
         * except for login-data. Clear that completely */
        cockpit.localStorage.removeItem('login-data', true);
        cockpit.localStorage.clear(false);

        if (reload !== false)
            reload_after_disconnect = true;
        ensure_transport(function(transport) {
            transport.send_control({ "command": "logout", "disconnect": true });
        });
        window.sessionStorage.setItem("logout-intent", "explicit");
    };

    /* Not public API ... yet? */
    cockpit.drop_privileges = function drop_privileges() {
        ensure_transport(function(transport) {
            transport.send_control({ "command": "logout", "disconnect": false });
        });
    };

    /* ---------------------------------------------------------------------
     * User and system information
     */

    cockpit.info = { };
    event_mixin(cockpit.info, { });

    init_callback = function(options) {
        if (options.system)
            extend(cockpit.info, options.system);
        if (options.system)
            cockpit.info.dispatchEvent("changed");
    };

    var the_user = null;
    cockpit.user = function () {
        var dfd = cockpit.defer();
        var dbus;
        if (!the_user) {
            dbus = cockpit.dbus(null, { "bus": "internal" });
            dbus.call("/user", "org.freedesktop.DBus.Properties", "GetAll",
                      [ "cockpit.User" ], { "type": "s" })
                .done(function(reply) {
                    var user = reply[0];
                    dfd.resolve({
                        id: user.Id.v,
                        name: user.Name.v,
                        full_name: user.Full.v,
                        groups: user.Groups.v,
                        home: user.Home.v,
                        shell: user.Shell.v
                    });
                })
                .fail(function(ex) {
                    dfd.reject(ex);
                })
                .always(function() {
                    dbus.close();
                });
        } else {
            dfd.resolve(the_user);
        }

        return dfd.promise;
    };

    /* ------------------------------------------------------------------------
     * Override for broken browser behavior
     */

    document.addEventListener("click", function(ev) {
        if (in_array(ev.target.classList, 'disabled'))
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
        var application = cockpit.transport.application();
        self.url_root = url_root || "";
        if (application.indexOf("cockpit+=") === 0) {
            if (self.url_root)
                self.url_root += '/';
            self.url_root = self.url_root + application.replace("cockpit+", '');
        }

        var href = get_window_location_hash();
        var options = { };
        var path = decode(href, options);

        function decode_path(input) {
            var parts = input.split('/').map(decodeURIComponent);
            var result, i, pre_parts = [];

            if (self.url_root)
                pre_parts = self.url_root.split('/').map(decodeURIComponent);

            if (input && input[0] !== "/") {
                result = [].concat(path);
                result.pop();
                result = result.concat(parts);
            } else {
                result = parts;
            }

            result = resolve_path_dots(result);
            for (i = 0; i < pre_parts.length; i++) {
                if (pre_parts[i] !== result[i])
                    break;
            }
            if (i == pre_parts.length)
                result.splice(0, pre_parts.length);

            return result;
        }

        function encode(path, options, with_root) {
            if (typeof path == "string")
                path = decode_path(path, self.path);

            var href = "/" + path.map(encodeURIComponent).join("/");
            if (with_root && self.url_root && href.indexOf("/" + self.url_root + "/" !== 0))
                href = "/" + self.url_root + href;

            /* Undo unnecessary encoding of these */
            href = href.replace("%40", "@");
            href = href.replace("%3D", "=");

            var i, opt, value, query = [];
            function push_option(v) {
                query.push(encodeURIComponent(opt) + "=" + encodeURIComponent(v));
            }

            if (options) {
                for (opt in options) {
                    value = options[opt];
                    if (!is_array(value))
                        value = [ value ];
                    value.forEach(push_option);
                }
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
                href.substring(pos + 1).split("&").forEach(function(opt) {
                    var last, parts = opt.split('=');
                    var name = decodeURIComponent(parts[0]);
                    var value = decodeURIComponent(parts[1]);
                    if (options.hasOwnProperty(name)) {
                        last = options[name];
                        if (!is_array(value))
                            last = options[name] = [ last ];
                        last.push(value);
                    } else {
                        options[name] = value;
                    }
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

    window.addEventListener("hashchange", function() {
        last_loc = null;
        cockpit.dispatchEvent("locationchanged");
    });

    /* ------------------------------------------------------------------------
     * Cockpit jump
     */

    cockpit.jump = function jump(path, host) {
        if (is_array(path))
            path = "/" + path.map(encodeURIComponent).join("/").replace("%40", "@").replace("%3D", "=");
        else
            path = "" + path;
        var options = { command: "jump", location: path, host: host };
        cockpit.transport.inject("\n" + JSON.stringify(options));
    };

    /* ---------------------------------------------------------------------
     * Cockpit Page Visibility
     */

    (function() {
        var hiddenProp;
        var hiddenHint = false;

        function visibility_change() {
            var value = document[hiddenProp];
            if (!hiddenProp || typeof value === "undefined")
                value = false;
            if (value === false)
                value = hiddenHint;
            if (cockpit.hidden !== value) {
                cockpit.hidden = value;
                cockpit.dispatchEvent("visibilitychange");
            }
        }

        if (typeof document.hidden !== "undefined") {
            hiddenProp = "hidden";
            document.addEventListener("visibilitychange", visibility_change);
        } else if (typeof document.mozHidden !== "undefined") {
            hiddenProp = "mozHidden";
            document.addEventListener("mozvisibilitychange", visibility_change);
        } else if (typeof document.msHidden !== "undefined") {
            hiddenProp = "msHidden";
            document.addEventListener("msvisibilitychange", visibility_change);
        } else if (typeof document.webkitHidden !== "undefined") {
            hiddenProp = "webkitHidden";
            document.addEventListener("webkitvisibilitychange", visibility_change);
        }

        /*
         * Wait for changes in visibility of just our iframe. These are delivered
         * via a hint message from the parent. For now we are the only handler of
         * hint messages, so this is implemented rather simply on purpose.
         */
        process_hints = function(data) {
            if ("hidden" in data) {
                hiddenHint = data.hidden;
                visibility_change();
            }
        };

        /* The first time */
        visibility_change();
    }());

    /* ---------------------------------------------------------------------
     * Spawning
     *
     * Public: https://files.cockpit-project.org/guide/api-cockpit.html
     */

    function ProcessError(options, name) {
        this.problem = options.problem || null;
        this.exit_status = options["exit-status"];
        if (this.exit_status === undefined)
            this.exit_status = null;
        this.exit_signal = options["exit-signal"];
        if (this.exit_signal === undefined)
            this.exit_signal = null;
        this.message = options.message;

        if (this.message === undefined) {
            if (this.problem)
                this.message = cockpit.message(options.problem);
            else if (this.exit_signal !== null)
                this.message = cockpit.format(_("$0 killed with signal $1"), name, this.exit_signal);
            else if (this.exit_status !== undefined)
                this.message = cockpit.format(_("$0 exited with code $1"), name, this.exit_status);
            else
                this.message = cockpit.format(_("$0 failed"), name);
        } else {
            this.message = this.message.trim();
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
        var dfd = cockpit.defer();

        var args = { "payload": "stream", "spawn": [] };
        if (command instanceof Array) {
            for (var i = 0; i < command.length; i++)
                args["spawn"].push(String(command[i]));
        } else {
            args["spawn"].push(String(command));
        }
        if (options !== undefined)
            extend(args, options);

        var name = args["spawn"][0] || "process";
        var channel = cockpit.channel(args);

        /* Callback that wants a stream response, see below */
        var buffer = channel.buffer(null);

        channel.addEventListener("close", function(event, options) {
            var data = buffer.squash();
            spawn_debug("process closed:", JSON.stringify(options));
            if (data)
                spawn_debug("process output:", data);
            if (options.message !== undefined)
                spawn_debug("process error:", options.message);

            if (options.problem)
                dfd.reject(new ProcessError(options, name));
            else if (options["exit-status"] || options["exit-signal"])
                dfd.reject(new ProcessError(options, name), data);
            else if (options.message !== undefined)
                dfd.resolve(data, options.message);
            else
                dfd.resolve(data);
        });

        var ret = dfd.promise;
        ret.stream = function(callback) {
            buffer.callback = callback.bind(ret);
            return this;
        };

        ret.input = function(message, stream) {
            if (message !== null && message !== undefined) {
                spawn_debug("process input:", message);
                channel.send(message);
            }
            if (!stream)
                channel.control({ command: "done" });
            return this;
        };

        ret.close = function(problem) {
            spawn_debug("process closing:", problem);
            if (channel.valid)
                channel.close(problem);
            return this;
        };

        return ret;
    };

    /* public */
    cockpit.script = function(script, args, options) {
        if (!options && is_plain_object(args)) {
            options = args;
            args = [];
        }
        var command = [ "/bin/sh", "-c", script, "--" ];
        command.push.apply(command, args);
        return cockpit.spawn(command, options);
    };

    function dbus_debug() {
        if (window.debugging == "all" || window.debugging == "dbus")
            console.debug.apply(console, arguments);
    }

    function DBusError(arg, arg1) {
        if (typeof(arg) == "string") {
            this.problem = arg;
            this.name = null;
            this.message = arg1 || cockpit.message(arg);
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
                props = extend(self.data[path][iface], props);
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
            var path, ifa;
            for (path in self.data) {
                for (iface in self.data[path]) {
                    if (ifa == iface)
                        callback(self.data[path][iface], path);
                }
            }
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
        event_mixin(self, { });

        var valid = false;
        var defined = false;
        var waits = cockpit.defer();

        /* No enumeration on these properties */
        Object.defineProperties(self, {
            "client": { value: client, enumerable: false, writable: false },
            "path": { value: path, enumerable: false, writable: false },
            "iface": { value: iface, enumerable: false, writable: false },
            "valid": { get: function() { return valid; }, enumerable: false },
            "wait": { enumerable: false, writable: false,
                value: function(func) {
                    if (func)
                        waits.promise.always(func);
                    return waits.promise;
                }
            },
            "call": { value: function(name, args) { return client.call(path, iface, name, args); },
                      enumerable: false, writable: false },
            "data": { value: { }, enumerable: false }
        });

        if (typeof window.$ === "function") {
            Object.defineProperty(self, window.$.expando, {
                value: { }, writable: true, enumerable: false
            });
        }

        if (!options)
            options = { };

        function define() {
            if (!cache.meta[iface])
                return;

            var meta = cache.meta[iface];
            defined = true;

            Object.keys(meta.methods || { }).forEach(function(name) {
                if (name[0].toLowerCase() == name[0])
                    return; /* Only map upper case */

                /* Again, make sure these don't show up in enumerations */
                Object.defineProperty(self, name, {
                    enumerable: false,
                    value: function() {
                        var dfd = cockpit.defer();
                        client.call(path, iface, name, Array.prototype.slice.call(arguments)).
                            done(function(reply) { dfd.resolve.apply(dfd, reply); }).
                            fail(function(ex) { dfd.reject(ex); });
                        return dfd.promise;
                    }
                });
            });

            Object.keys(meta.properties || { }).forEach(function(name) {
                if (name[0].toLowerCase() == name[0])
                    return; /* Only map upper case */

                var config = {
                    enumerable: true,
                    get: function() { return self.data[name]; },
                    set: function(v) { throw name + "is not writable"; }
                };

                var prop = meta.properties[name];
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
                extend(self.data, props);
                if (!defined)
                    define();
                valid = true;
            } else {
                valid = false;
            }
            self.dispatchEvent("changed", props);
        }

        cache.connect(path, iface, update, true);
        update(cache.lookup(path, iface));

        function signal(path, iface, name, args) {
            self.dispatchEvent("signal", name, args);
            if (name[0].toLowerCase() != name[0]) {
                args = args.slice();
                args.unshift(name);
                self.dispatchEvent.apply(self, args);
            }
        }

        client.subscribe({ "path": path, "interface": iface }, signal, options.subscribe !== false);

        function waited(ex) {
            if (valid)
                waits.resolve();
            else
                waits.reject(ex);
        }

        /* If watching then do a proper watch, otherwise object is done */
        if (options.watch !== false)
            client.watch({ "path": path, "interface": iface }).always(waited);
        else
            waited();
    }

    function DBusProxies(client, cache, iface, path_namespace, options) {
        var self = this;
        event_mixin(self, { });

        var waits;

        Object.defineProperties(self, {
            "client": { value: client, enumerable: false, writable: false },
            "iface": { value: iface, enumerable: false, writable: false },
            "path_namespace": { value: path_namespace, enumerable: false, writable: false },
            "wait": { enumerable: false, writable: false,
                value: function(func) {
                    if (func)
                        waits.always(func);
                    return waits;
                }
            }
        });

        if (typeof window.$ === "function") {
            Object.defineProperty(self, window.$.expando, {
                value: { }, writable: true, enumerable: false
            });
        }

        /* Subscribe to signals once for all proxies */
        var match = { "interface": iface, "path_namespace": path_namespace };

        /* Callbacks added by proxies */
        client.subscribe(match);

        /* Watch for property changes */
        if (options.watch !== false) {
            waits = client.watch(match);
        } else {
            waits = cockpit.defer().resolve().promise;
        }

        /* Already added watch/subscribe, tell proxies not to */
        options = extend({ watch: false, subscribe: false }, options);

        function update(props, path) {
            var proxy = self[path];
            if (!path) {
                return;
            } else if (!props && proxy) {
                delete self[path];
                self.dispatchEvent("removed", proxy);
            } else if (props) {
                if (!proxy) {
                    proxy = self[path] = client.proxy(iface, path, options);
                    self.dispatchEvent("added", proxy);
                }
                self.dispatchEvent("changed", proxy);
            }
        }

        cache.connect(null, iface, update, false);
        cache.each(iface, update);
    }

    function DBusClient(name, options) {
        var self = this;
        event_mixin(self, { });

        var args = { };
        var track = false;
        var owner = null;

        if (options) {
            if (options.track)
                track = true;

            delete options['track'];
            extend(args, options);
        }
        args.payload = "dbus-json3";
        if (name)
            args.name = name;
        self.options = options;
        self.unique_name = null;

        dbus_debug("dbus open: ", args);

        var channel = cockpit.channel(args);
        var subscribers = { };
        var published = { };
        var calls = { };
        var cache;

        /* The problem we closed with */
        var closed;

        self.constructors = { "*": DBusProxy };

        /* Allows waiting on the channel if necessary */
        self.wait = channel.wait;

        function ensure_cache() {
            if (!cache)
                cache = new DBusCache();
        }

        function send(payload) {
            if (channel && channel.valid) {
                dbus_debug("dbus:", payload);
                channel.send(payload);
                return true;
            }
            return false;
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
            if (match.arg0 && (!signal[3] || signal[3][0] !== match.arg0))
                return false;
            return true;
        }

        function on_message(event, payload) {
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
            var dfd, options;
            if (msg.id !== undefined)
                dfd = calls[msg.id];
            if (msg.reply) {
                if (dfd) {
                    options = { };
                    if (msg.type)
                        options.type = msg.type;
                    if (msg.flags)
                        options.flags = msg.flags;
                    dfd.resolve(msg.reply[0] || [], options);
                    delete calls[msg.id];
                }
                return;

            } else if (msg.error) {
                if (dfd) {
                    dfd.reject(new DBusError(msg.error));
                    delete calls[msg.id];
                }
                return;
            }

            /*
             * The above promise resolutions or failures are triggered via
             * later_invoke(). In order to preserve ordering guarantees we
             * also have to process other events that way too.
             */
            later_invoke(function() {
                var id, subscription;
                if (msg.signal) {
                    for (id in subscribers) {
                        subscription = subscribers[id];
                        if (subscription.callback) {
                            if (matches(msg.signal, subscription.match))
                                subscription.callback.apply(self, msg.signal);
                        }
                    }
                } else if (msg.call) {
                    handle(msg.call, msg.id);
                } else if (msg.notify) {
                    notify(msg.notify);
                } else if (msg.meta) {
                    meta(msg.meta);
                } else if (msg.owner !== undefined) {
                    self.dispatchEvent("owner", msg.owner);

                    /*
                     * We won't get this signal with the same
                     * owner twice so if we've seen an owner
                     * before that means it has changed.
                     */
                    if (track && owner)
                        self.close();

                    owner = msg.owner;
                } else {
                    dbus_debug("received unexpected dbus json message:", payload);
                }
            });
        }

        function meta(data) {
            ensure_cache();
            extend(cache.meta, data);
            self.dispatchEvent("meta", data);
        }

        self.meta = function(data, options) {
            if (!channel || !channel.valid)
                return;

            var message = extend({ }, options, {
                "meta": data
            });

            send(JSON.stringify(message));
            meta(data);
        };

        function notify(data) {
            ensure_cache();
            var path, iface, props;
            for (path in data) {
                for (iface in data[path]) {
                    props = data[path][iface];
                    if (!props)
                        cache.remove(path, iface);
                    else
                        cache.update(path, iface, props);
                }
            }
            self.dispatchEvent("notify", data);
        }

        this.notify = notify;

        function close_perform(options) {
            closed = options.problem || "disconnected";
            var id, outstanding = calls;
            calls = { };
            for (id in outstanding) {
                outstanding[id].reject(new DBusError(closed, options.message));
            }
            self.dispatchEvent("close", options);
        }

        this.close = function close(options) {
            if (typeof options == "string")
                options = { "problem": options };
            if (!options)
                options = { };
            if (channel)
                channel.close(options);
            else
                close_perform(options);
        };

        function on_ready(event, message) {
            dbus_debug("dbus ready:", options);
            self.unique_name = message["unique-name"];
        }

        function on_close(event, options) {
            dbus_debug("dbus close:", options);
            channel.removeEventListener("ready", on_ready);
            channel.removeEventListener("message", on_message);
            channel.removeEventListener("close", on_close);
            channel = null;
            close_perform(options);
        }

        channel.addEventListener("control", on_ready);
        channel.addEventListener("message", on_message);
        channel.addEventListener("close", on_close);

        var last_cookie = 1;

        this.call = function call(path, iface, method, args, options) {
            var dfd = cockpit.defer();
            var id = String(last_cookie);
            last_cookie++;
            var method_call = extend({ }, options, {
                "call": [ path, iface, method, args || [] ],
                "id": id
            });

            var msg = JSON.stringify(method_call);
            if (send(msg))
                calls[id] = dfd;
            else
                dfd.reject(new DBusError(closed));

            return dfd.promise;
        };

        self.signal = function signal(path, iface, member, args, options) {
            if (!channel || !channel.valid)
                return;

            var message = extend({ }, options, {
                "signal": [ path, iface, member, args || [] ]
            });

            send(JSON.stringify(message));
        };

        this.subscribe = function subscribe(match, callback, rule) {
            var msg, subscription = {
                match: extend({ }, match),
                callback: callback
            };

            if (rule !== false)
                send(JSON.stringify({ "add-match": subscription.match }));

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
                    if (rule !== false && prev)
                        send(JSON.stringify({ "remove-match": prev.match }));
                }
            };
        };

        self.watch = function watch(path) {
            var match;
            if (is_plain_object(path))
                match = extend({ }, path);
            else
                match = { path: String(path) };

            var id = String(last_cookie);
            last_cookie++;
            var dfd = cockpit.defer();

            var msg = JSON.stringify({ "watch": match, "id": id });
            if (send(msg))
                calls[id] = dfd;
            else
                dfd.reject(new DBusError(closed));

            var ret = dfd.promise;
            ret.remove = function remove() {
                if (id in calls) {
                    dfd.reject(new DBusError("cancelled"));
                    delete calls[id];
                }
                send(JSON.stringify({ "unwatch": match }));
            };
            return ret;
        };

        function unknown_interface(path, iface) {
            var message = "DBus interface " + iface + " not available at " + path;
            return cockpit.reject(new DBusError([ "org.freedesktop.DBus.Error.UnknownInterface", [ message ] ]));
        }

        function unknown_method(path, iface, method) {
            var message = "DBus method " + iface + " " + method + " not available at " + path;
            return cockpit.reject(new DBusError([ "org.freedesktop.DBus.Error.UnknownMethod", [ message ] ]));
        }

        function not_implemented(path, iface, method) {
            console.warn("method is not implemented properly: ", path, iface, method);
            return unknown_method(path, iface, method);
        }

        function invoke(call) {
            var path = call[0];
            var iface = call[1];
            var method = call[2];
            var object = published[path + "\n" + iface];
            var info = cache.meta[iface];
            if (!object || !info)
                return unknown_interface(path, iface);
            if (!info.methods || !(method in info.methods))
                return unknown_method(path, iface, method);
            if (typeof object[method] != "function")
                return not_implemented(path, iface, method);
            return object[method].apply(object, call[3]);
        }

        function handle(call, cookie) {
            var result = invoke(call);
            if (!cookie)
                return; /* Discard result */
            cockpit.when(result).then(function() {
                var out = Array.prototype.slice.call(arguments, 0);
                if (out.length == 1 && typeof out[0] == "undefined")
                    out = [ ];
                send(JSON.stringify({ "reply": [ out ], "id": cookie }));
            }, function(ex) {
                var error = [ ];
                error[0] = ex.name || " org.freedesktop.DBus.Error.Failed";
                error[1] = [ cockpit.message(ex) || error[0] ];
                send(JSON.stringify({ "error": error, "id": cookie }));
            });
        }

        self.publish = function(path, iface, object, options) {
            var publish = [ path, iface ];

            var id = String(last_cookie);
            last_cookie++;
            var dfd = calls[id] = cockpit.defer();

            var payload = JSON.stringify(extend({ }, options, {
                "publish": publish,
                "id": id,
            }));

            if (send(payload))
                calls[id] = dfd;
            else
                dfd.reject(new DBusError(closed));

            var key = path + "\n" + iface;
            dfd.promise.then(function() {
                published[key] = object;
            });

            /* Return a way to remove this object */
            var ret = dfd.promise;
            ret.remove = function remove() {
                if (id in calls) {
                    dfd.reject(new DBusError("cancelled"));
                    delete calls[id];
                }
                delete published[key];
                send(JSON.stringify({ "unpublish": publish }));
            };
            return ret;
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

        self.proxies = function proxies(iface, path_namespace, options) {
            if (!iface)
                iface = name;
            if (!path_namespace)
                path_namespace = "/";
            if (!options)
                options = { };
            ensure_cache();
            return new DBusProxies(self, cache, String(iface), String(path_namespace), options);
        };

    }

    /* Well known busses */
    var shared_dbus = {
        internal: null,
        session: null,
        system: null,
    };

    /* public */
    cockpit.dbus = function dbus(name, options) {
        if (!options)
            options = { "bus": "system" };

        /*
         * Figure out if this we should use a shared bus.
         *
         * This is only the case if a null name *and* the
         * options are just a simple { "bus": "xxxx" }
         */
        var keys = Object.keys(options);
        var bus = options.bus;
        var shared = !name && keys.length == 1 && bus in shared_dbus;

        if (shared && shared_dbus[bus])
            return shared_dbus[bus];

        var client = new DBusClient(name, options);

        /*
         * Store the shared bus for next time. Override the
         * close function to only work when a problem is
         * indicated.
         */
        var old_close;
        if (shared) {
            client.close = function() {
                if (arguments.length > 0)
                    old_close.apply(client, arguments);
            };
            client.addEventListener("close", function() {
                if (shared_dbus[bus] == client)
                    shared_dbus[bus] = null;
            });
            shared_dbus[bus] = client;
        }

        return client;
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
            path: path,
            read: read,
            replace: replace,
            modify: modify,

            watch: watch,

            close: close
        };

        var base_channel_options = extend({ }, options);
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

            var dfd = cockpit.defer();
            var opts = extend({ }, base_channel_options, {
                payload: "fsread1",
                path: path
            });

            function try_read() {
                read_channel = cockpit.channel(opts);
                var content_parts = [ ];
                read_channel.addEventListener("message", function (event, message) {
                    content_parts.push(message);
                });
                read_channel.addEventListener("close", function (event, message) {
                    read_channel = null;

                    if (message.problem == "change-conflict") {
                        try_read();
                        return;
                    }

                    read_promise = null;

                    if (message.problem) {
                        var error = new BasicError(message.problem, message.message);
                        fire_watch_callbacks(null, null, error);
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
                            fire_watch_callbacks(null, null, e);
                            dfd.reject(e);
                            return;
                        }
                    }

                    fire_watch_callbacks(content, message.tag);
                    dfd.resolve(content, message.tag);
                });
            }

            try_read();

            read_promise = dfd.promise;
            return read_promise;
        }

        var replace_channel = null;

        function replace(new_content, expected_tag) {
            var dfd = cockpit.defer();

            var file_content;
            try {
                if (new_content === null)
                    file_content = null;
                else
                    file_content = stringify(new_content);
            }
            catch (e) {
                dfd.reject(e);
                return dfd.promise;
            }

            if (replace_channel)
                replace_channel.close("abort");

            var opts = extend({ }, base_channel_options, {
                payload: "fsreplace1",
                path: path,
                tag: expected_tag
            });
            replace_channel = cockpit.channel(opts);

            replace_channel.addEventListener("close", function (event, message) {
                replace_channel = null;
                if (message.problem) {
                    dfd.reject(new BasicError(message.problem, message.message));
                } else {
                    fire_watch_callbacks(new_content, message.tag);
                    dfd.resolve(message.tag);
                }
            });

            var len = 0, binary = false;
            if (file_content) {
                if (file_content.byteLength) {
                    len = file_content.byteLength;
                    binary = true;
                } else if (file_content.length) {
                    len = file_content.length;
                }
            }

            var i, n, batch = 16 * 1024;
            for (i = 0; i < len; i += batch) {
                n = Math.min(len - i, batch);
                if (binary)
                    replace_channel.send(new window.Uint8Array(file_content.buffer, i, n));
                else
                    replace_channel.send(file_content.substr(i, n));
            }

            replace_channel.control({ command: "done" });
            return dfd.promise;
        }

        function modify(callback, initial_content, initial_tag) {
            var dfd = cockpit.defer();

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

            return dfd.promise;
        }

        var watch_callbacks = [];
        var n_watch_callbacks = 0;

        var watch_channel = null;
        var watch_tag;

        function ensure_watch_channel() {
            if (n_watch_callbacks > 0) {
                if (watch_channel)
                    return;

                var opts = extend({ }, base_channel_options, {
                    payload: "fswatch1",
                    path: path
                });
                watch_channel = cockpit.channel(opts);
                watch_channel.addEventListener("message", function (event, message_string) {
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

        function fire_watch_callbacks(/* content, tag, error */) {
            watch_tag = arguments[1] || null;
            invoke_functions(watch_callbacks, self, arguments);
        }

        function watch(callback) {
            if (callback)
                watch_callbacks.push(callback);
            n_watch_callbacks += 1;
            ensure_watch_channel();

            watch_tag = null;
            read();

            return {
                remove: function () {
                    var index;
                    if (callback) {
                        index = watch_callbacks.indexOf(callback);
                        if (index > -1)
                            watch_callbacks[index] = null;
                    }
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
            extend(po_data, po);
            header = po[""];
        } else if (po === null) {
            po_data = { };
        }

        if (header) {
            if (header["plural-forms"])
                po_plural = header["plural-forms"];
            if (header["language"])
                lang = header["language"];
        }

        cockpit.language = lang;
    };

    cockpit.translate = function translate(/* ... */) {
	var what;

        /* Called without arguments, entire document */
	if (arguments.length === 0)
            what = [ document ];

        /* Called with a single array like argument */
        else if (arguments.length === 1 && arguments[0].length)
            what = arguments[0];

        /* Called with 1 or more element arguments */
        else
            what = arguments;

        /* Translate all the things */
        var w, wlen, val, i, ilen, t, tlen, list, tasks, el;
	for (w = 0, wlen = what.length; w < wlen; w++) {

            /* The list of things to translate */
            list = null;
            if (what[w].querySelectorAll)
                list = what[w].querySelectorAll("[translatable], [translate]");
            if (!list)
                continue;

            /* Each element */
            for (i = 0, ilen = list.length; i < ilen; i++) {
                el = list[i];

                val = el.getAttribute("translate") || el.getAttribute("translatable") || "yes";
                if (val == "no")
                    continue;

                /* Each thing to translate */
                tasks = val.split(" ");
                val = el.getAttribute("translate-context") || el.getAttribute("context");
                for (t = 0, tlen = tasks.length; t < tlen; t++) {
                    if (tasks[t] == "yes" || tasks[t] == "translate")
                        el.textContent = cockpit.gettext(val, el.textContent);
                    else if (tasks[t])
                        el.setAttribute(tasks[t], cockpit.gettext(val, el.getAttribute(tasks[t]) || ""));
                }

                /* Mark this thing as translated */
                el.removeAttribute("translatable");
                el.removeAttribute("translate");
            }
        }
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
        else if (problem == "access-denied")
            return _("Not permitted to perform this action.");
        else if (problem == "authentication-failed")
            return _("Login failed");
        else if (problem == "authentication-not-supported")
            return _("The server refused to authenticate using any supported methods.");
        else if (problem == "unknown-hostkey")
            return _("Untrusted host");
        else if (problem == "invalid-hostkey")
            return _("Host key is incorrect");
        else if (problem == "internal-error")
            return _("Internal error");
        else if (problem == "timeout")
            return _("Connection has timed out.");
        else if (problem == "no-cockpit")
            return _("Cockpit is not installed on the system.");
        else if (problem == "no-forwarding")
            return _("Cannot forward login credentials");
        else if (problem == "disconnected")
            return _("Server has closed the connection.");
        else if (problem == "not-supported")
            return _("Cockpit is not compatible with the software on the system.");
        else if (problem == "no-host")
            return _("Cockpit could not contact the given host.");
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

        self.options = options;
        options.payload = "http-stream1";

        var active_requests = [ ];

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

        if (options.address) {
            if (!options.capabilities)
                options.capabilities = [];
            options.capabilities.push("address");
        }

        function param(obj) {
            return Object.keys(obj).map(function(k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
            }).join('&').split('%20').join('+'); /* split/join because phantomjs */
        }

        self.request = function request(req) {
            var dfd = cockpit.defer();
            var ret = dfd.promise;

            if (!req.path)
                req.path = "/";
            if (!req.method)
                req.method = "GET";
            if (req.params) {
                if (req.path.indexOf("?") === -1)
                    req.path += "?" + param(req.params);
                else
                    req.path += "&" + param(req.params);
            }
            delete req.params;

            var input = req.body;
            delete req.body;

            var headers = req.headers;
            delete req.headers;

            extend(req, options);

            /* Combine the headers */
            if (options.headers && headers)
                req.headers = extend({ }, options.headers, headers);
            else if (options.headers)
                req.headers = options.headers;
            else
                req.headers = headers;

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
                        invoke_functions(responsers, ret, [resp.status, resp.headers]);
                    }
                    return true;
                }

                /* Fire any streamers */
                if (resp.status >= 200 && resp.status <= 299 && streamer)
                    return streamer.call(ret, data);

                return 0;
            });

            function on_close(event, options) {
                var pos = active_requests.indexOf(ret);
                if (pos >= 0)
                    active_requests.splice(pos, 1);

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
                        dfd.reject(new HttpError(resp.status, resp.reason, message), body);

                    } else {
                        http_debug("http done");
                        dfd.resolve(body);
                    }
                }

                channel.removeEventListener("close", on_close);
            }

            channel.addEventListener("close", on_close);

            ret.stream = function(callback) {
                streamer = callback;
                return ret;
            };
            ret.response = function(callback) {
                if (responsers === null)
                    responsers = [];
                responsers.push(callback);
                return ret;
            };
            ret.input = function(message, stream) {
                if (message !== null && message !== undefined) {
                    http_debug("http input:", message);
                    channel.send(message);
                }
                if (!stream) {
                    http_debug("http done");
                    channel.control({ command: "done" });
                }
                return ret;
            };
            ret.close = function(problem) {
                http_debug("http closing:", problem);
                channel.close(problem);
                return ret;
            };

            active_requests.push(ret);
            return ret;
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

            if (is_plain_object(body) || is_array(body)) {
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

        self.close = function close(problem) {
            var reqs = active_requests.slice();
            for (var i = 0; i < reqs.length; i++)
                reqs[i].close(problem);
        };

    }

    /* public */
    cockpit.http = function(endpoint, options) {
        if (is_plain_object(endpoint) && options === undefined) {
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
        event_mixin(self, { });

        self.allowed = null;
        self.user = options ? options.user : null;

        var group = null;
        var admin = false;

        if (options)
            group = options.group;

        if (options && options.admin)
            admin = true;

        function decide(user) {
            if (user.id === 0)
                return true;

            if (user.groups) {
                var allowed = false;
                user.groups.forEach(function(name) {
                    if (name == group) {
                        allowed = true;
                        return false;
                    }
                    if (admin && (name == "wheel" || name == "sudo")) {
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

        if (self.user) {
            self.allowed = decide(self.user);
        } else {
            cockpit.user().done(function (user) {
                self.user = user;
                var allowed = decide(user);
                if (self.allowed !== allowed) {
                    self.allowed = allowed;
                    self.dispatchEvent("changed");
                }
            });
        }

        self.close = function close() {
            /* no-op for now */
        };
    }

    cockpit.permission = function permission(arg) {
        return new Permission(arg);
    };

    /* ---------------------------------------------------------------------
     * Metrics
     *
     */

    function timestamp(when, interval) {
        if (typeof when == "number")
            return when * interval;
        else if (typeof when == "string")
            when = new Date(when);
        if (when instanceof Date)
            return when.getTime();
        else
            throw "invalid date or offset";
    }

    function MetricsChannel(interval, options_list, cache) {
        var self = this;
        event_mixin(self, { });

        if (options_list.length === undefined)
            options_list = [ options_list ];

        var channels = [ ];
        var following = false;

        self.series = cockpit.series(interval, cache, fetch_for_series);
        self.archives = null;
        self.meta = null;

        function fetch_for_series(beg, end, for_walking) {
            if (!for_walking)
                self.fetch(beg, end);
            else
                self.follow();
        }

        function transfer(options_list, callback, is_archive) {
            if (options_list.length === 0)
                return;

            if (!is_archive) {
                if (following)
                    return;
                following = true;
            }

            var options = extend({
                payload: "metrics1",
                interval: interval,
                source: "internal"
            }, options_list[0]);

            delete options.archive_source;

            var channel = cockpit.channel(options);
            channels.push(channel);

            var meta = null;
            var last = null;
            var beg;

            channel.addEventListener("close", function(ev, close_options) {
                if (!is_archive)
                    following = false;

                if (options_list.length > 1 &&
                    (close_options.problem == "not-supported" || close_options.problem == "not-found")) {
                    transfer(options_list.slice(1), callback);
                } else if (close_options.problem) {
                    if (close_options.problem != "terminated" &&
                        close_options.problem != "disconnected" &&
                        close_options.problem != "authentication-failed" &&
                        (close_options.problem != "not-found" || !is_archive) &&
                        (close_options.problem != "not-supported" || !is_archive)) {
                        console.warn("metrics channel failed: " + close_options.problem);
                    }
                } else if (is_archive) {
                    if (!self.archives) {
                        self.archives = true;
                        self.dispatchEvent('changed');
                    }
                }
            });

            channel.addEventListener("message", function(ev, payload) {
                var message = JSON.parse(payload);

                var data, data_len, last_len, dataj, dataj_len, lastj, lastj_len;
                var i, j, k;
                var timestamp;

                /* A meta message? */
                var message_len = message.length;
                if (message_len === undefined) {
                    meta = message;
                    timestamp = 0;
                    if (meta.now && meta.timestamp)
                        timestamp = meta.timestamp + (Date.now() - meta.now);
                    beg = Math.floor(timestamp / interval);
                    callback(beg, meta, null, options_list[0]);

                    /* Trigger to outside interest that meta changed */
                    self.meta = meta;
                    self.dispatchEvent('changed');

                /* A data message */
                } else if (meta) {

                    /* Data decompression */
                    for (i = 0; i < message_len; i++) {
                        data = message[i];
                        if (last) {
                            data_len = data.length;
                            last_len = last.length;
                            for (j = 0; j < last_len; j++) {
                                dataj = data[j];
                                if (dataj === null || dataj === undefined) {
                                    data[j] = last[j];
                                } else {
                                    dataj_len = dataj.length;
                                    if (dataj_len !== undefined) {
                                        lastj = last[j];
                                        lastj_len = last[j].length;
                                        for (k = 0; k < dataj_len; k++) {
                                            if (dataj[k] === null)
                                                dataj[k] = lastj[k];
                                        }
                                        for (; k < lastj_len; k++)
                                            dataj[k] = lastj[k];
                                    }
                                }
                            }
                        }
                        last = data;
                    }

                    /* Return the data */
                    callback(beg, meta, message, options_list[0]);

                    /* Bump timestamp for the next message */
                    beg += message_len;
                    meta.timestamp += (interval * message_len);
                }
            });
        }

        function drain(beg, meta, message, options) {
            var mapping, map, name;

            /* Generate a mapping object if necessary */
            mapping = meta.mapping;
            if (!mapping) {
                mapping = { };
                meta.metrics.forEach(function(metric, i) {
                    map = { "": i };
                    if (options.metrics_path_names)
                        name = options.metrics_path_names[i];
                    else
                        name = metric.name;
                    mapping[name] = map;
                    if (metric.instances) {
                        metric.instances.forEach(function(instance, i) {
                            if (instance === "")
                                instance = "/";
                            map[instance] = { "": i };
                        });
                    }
                });
                meta.mapping = mapping;
            }

            if (message)
                self.series.input(beg, message, mapping);
        }

        self.fetch = function fetch(beg, end) {
            var timestamp = beg * interval - Date.now();
            var limit = end - beg;

            var archive_options_list = [ ];
            for (var i = 0; i < options_list.length; i++) {
                if (options_list[i].archive_source) {
                    archive_options_list.push(extend({}, options_list[i],
                                                       { "source": options_list[i].archive_source,
                                                         timestamp: timestamp,
                                                         limit: limit
                                                       }));
                }
            }

            transfer(archive_options_list, drain, true);
        };

        self.follow = function follow() {
            transfer(options_list, drain);
        };

        self.close = function close(options) {
            var i, len = channels.length;
            for (i = 0; i < len; i++)
                channels[i].close(options);
        };
    }

    cockpit.metrics = function metrics(interval, options) {
        return new MetricsChannel(interval, options);
    };

    /* ---------------------------------------------------------------------
     * Ooops handling.
     *
     * If we're embedded, send oops to parent frame. Since everything
     * could be broken at this point, just do it manually, without
     * involving cockpit.transport or any of that logic.
     */

    cockpit.oops = function oops() {
        if (window.parent !== window && window.name.indexOf("cockpit1:") === 0)
            window.parent.postMessage("\n{ \"command\": \"oops\" }", transport_origin);
    };

    var old_onerror;

    if (window.navigator.userAgent.indexOf("PhantomJS") == -1) {
        old_onerror = window.onerror;
        window.onerror = function(msg, url, line) {
            cockpit.oops();
            if (old_onerror)
                return old_onerror(msg, url, line);
            return false;
        };
    }

    return cockpit;
} /* scope end */

/*
 * Register this script as a module and/or with globals
 */

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
    window.cockpit = factory();
}

/* Cockpit loaded via AMD loader */
if (is_function(window.define) && window.define.amd) {
    if (self_module_id)
        define(self_module_id, [], window.cockpit);
    else
        define([], factory);
}

})();
