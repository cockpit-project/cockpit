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

/* eslint-disable indent,no-empty */

let url_root;

const meta_url_root = document.head.querySelector("meta[name='url-root']");
if (meta_url_root) {
    url_root = meta_url_root.content.replace(/^\/+|\/+$/g, '');
} else {
    // fallback for cockpit-ws < 272
    try {
        // Sometimes this throws a SecurityError such as during testing
        url_root = window.localStorage.getItem('url-root');
    } catch (e) { }
}

/* injected by tests */
var mock = mock || { }; // eslint-disable-line no-use-before-define, no-var

const cockpit = { };
event_mixin(cockpit, { });

/*
 * The debugging property is a global that is used
 * by various parts of the code to show/hide debug
 * messages in the javascript console.
 *
 * We support using storage to get/set that property
 * so that it carries across the various frames or
 * alternatively persists across refreshes.
 */
if (typeof window.debugging === "undefined") {
    try {
        // Sometimes this throws a SecurityError such as during testing
        Object.defineProperty(window, "debugging", {
            get: function() { return window.sessionStorage.debugging || window.localStorage.debugging },
            set: function(x) { window.sessionStorage.debugging = x }
        });
    } catch (e) { }
}

function in_array(array, val) {
    const length = array.length;
    for (let i = 0; i < length; i++) {
        if (val === array[i])
            return true;
    }
    return false;
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

function invoke_functions(functions, self, args) {
    const length = functions?.length ?? 0;
    for (let i = 0; i < length; i++) {
        if (functions[i])
            functions[i].apply(self, args);
    }
}

function iterate_data(data, callback, batch) {
    let binary = false;
    let len = 0;

    if (!batch)
        batch = 64 * 1024;

    if (data) {
         if (data.byteLength) {
             len = data.byteLength;
             binary = true;
         } else if (data.length) {
             len = data.length;
         }
    }

    for (let i = 0; i < len; i += batch) {
        const n = Math.min(len - i, batch);
        if (binary)
            callback(new window.Uint8Array(data.buffer, i, n));
        else
            callback(data.substr(i, n));
    }
}

/* -------------------------------------------------------------------------
 * Channels
 *
 * Public: https://cockpit-project.org/guide/latest/api-base1.html
 */

let default_transport = null;
let public_transport = null;
let reload_after_disconnect = false;
let expect_disconnect = false;
let init_callback = null;
let default_host = null;
let process_hints = null;
let incoming_filters = null;
let outgoing_filters = null;

let transport_origin = window.location.origin;

if (!transport_origin) {
    transport_origin = window.location.protocol + "//" + window.location.hostname +
        (window.location.port ? ':' + window.location.port : '');
}

function array_from_raw_string(str, constructor) {
    const length = str.length;
    const data = new (constructor || Array)(length);
    for (let i = 0; i < length; i++)
        data[i] = str.charCodeAt(i) & 0xFF;
    return data;
}

function array_to_raw_string(data) {
    const length = data.length;
    let str = "";
    for (let i = 0; i < length; i++)
        str += String.fromCharCode(data[i]);
    return str;
}

/*
 * These are the polyfills from Mozilla. It's pretty nasty that
 * these weren't in the typed array standardization.
 *
 * https://developer.mozilla.org/en-US/docs/Glossary/Base64
 */

function uint6_to_b64 (x) {
    return x < 26 ? x + 65 : x < 52 ? x + 71 : x < 62 ? x - 4 : x === 62 ? 43 : x === 63 ? 47 : 65;
}

function base64_encode(data) {
    if (typeof data === "string")
        return window.btoa(data);
    /* For when the caller has chosen to use ArrayBuffer */
    if (data instanceof window.ArrayBuffer)
        data = new window.Uint8Array(data);
    const length = data.length;
    let mod3 = 2;
    let str = "";
    for (let uint24 = 0, i = 0; i < length; i++) {
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
    return x > 64 && x < 91
        ? x - 65
        : x > 96 && x < 123
        ? x - 71
        : x > 47 && x < 58 ? x + 4 : x === 43 ? 62 : x === 47 ? 63 : 0;
}

function base64_decode(str, constructor) {
    if (constructor === String)
        return window.atob(str);
    const ilen = str.length;
    let eq;
    for (eq = 0; eq < 3; eq++) {
        if (str[ilen - (eq + 1)] != '=')
            break;
    }
    const olen = (ilen * 3 + 1 >> 2) - eq;
    const data = new (constructor || Array)(olen);
    for (let mod3, mod4, uint24 = 0, oi = 0, ii = 0; ii < ilen; ii++) {
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
    if (window.debugging == "all" || window.debugging?.includes("channel"))
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
                    handlers[type] = [];
                handlers[type].push(handler);
            }
        },
        removeEventListener: {
            enumerable: false,
            value: function removeEventListener(type, handler) {
                const length = handlers[type] ? handlers[type].length : 0;
                for (let i = 0; i < length; i++) {
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
                let type, args;
                if (typeof event === "string") {
                    type = event;
                    args = Array.prototype.slice.call(arguments, 1);

                    let detail = null;
                    if (arguments.length == 2)
                        detail = arguments[1];
                    else if (arguments.length > 2)
                        detail = args;

                    event = new CustomEvent(type, {
                        bubbles: false,
                        cancelable: false,
                        detail
                    });

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
    let path = window.location.pathname || "/";
    let _url_root = url_root;
    if (window.mock?.pathname)
        path = window.mock.pathname;
    if (window.mock?.url_root)
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
    const window_loc = window.location.toString();
    let _url_root = url_root;

    if (window.mock?.url)
        return window.mock.url;
    if (window.mock?.url_root)
        _url_root = window.mock.url_root;

    let prefix = calculate_application();
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

    let total = 0;
    const length = buffers.length;
    for (let i = 0; i < length; i++)
        total += buffers[i].length;

    const data = window.Uint8Array ? new window.Uint8Array(total) : new Array(total);

    if (data.set) {
        for (let j = 0, i = 0; i < length; i++) {
            data.set(buffers[i], j);
            j += buffers[i].length;
        }
    } else {
        for (let j = 0, i = 0; i < length; i++) {
            for (let k = 0; k < buffers[i].length; k++)
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
    const self = this;
    self.readyState = 0;

    window.addEventListener("message", function receive(event) {
        if (event.origin !== transport_origin || event.source !== parent)
            return;
        const data = event.data;
        if (data === undefined || (data.length === undefined && data.byteLength === undefined))
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
    let channel;

    /* A binary message, split out the channel */
    if (data instanceof window.ArrayBuffer) {
        const binary = new window.Uint8Array(data);
        const length = binary.length;
        let pos;
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
        const pos = data.indexOf('\n');
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
    const self = this;
    self.application = calculate_application();

    /* We can trigger events */
    event_mixin(self, { });

    let last_channel = 0;
    let channel_seed = "";

    if (window.mock)
        window.mock.last_transport = self;

    let ws;
    let ignore_health_check = false;
    let got_message = false;

    /* See if we should communicate via parent */
    if (window.parent !== window && window.name.indexOf("cockpit1:") === 0)
        ws = new ParentWebSocket(window.parent);

    let check_health_timer;

    if (!ws) {
        const ws_loc = calculate_url();
        transport_debug("connecting to " + ws_loc);

        if (ws_loc) {
            if ("WebSocket" in window) {
                ws = new window.WebSocket(ws_loc, "cockpit1");
            } else {
                console.error("WebSocket not supported, application will not work!");
            }
        }

        check_health_timer = window.setInterval(function () {
            if (self.ready)
                ws.send("\n{ \"command\": \"ping\" }");
            if (!got_message) {
                if (ignore_health_check) {
                    console.log("health check failure ignored");
                } else {
                    console.log("health check failed");
                    self.close({ problem: "timeout" });
                }
            }
            got_message = false;
        }, 30000);
    }

    if (!ws) {
        ws = { close: function() { } };
        window.setTimeout(function() {
            self.close({ problem: "no-cockpit" });
        }, 50);
    }

    const control_cbs = { };
    const message_cbs = { };
    let waiting_for_init = true;
    self.ready = false;

    /* Called when ready for channels to interact */
    function ready_for_channels() {
        if (!self.ready) {
            self.ready = true;
            self.dispatchEvent("ready");
        }
    }

    ws.onopen = function() {
        if (ws) {
            if (typeof ws.binaryType !== "undefined")
                ws.binaryType = "arraybuffer";
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
        self.close();
    };

    ws.onmessage = self.dispatch_data = function(arg) {
        got_message = true;

        /* The first line of a message is the channel */
        const message = arg.data;

        const channel = parse_channel(message);
        if (channel === null)
            return false;

        const payload = message instanceof window.ArrayBuffer
            ? new window.Uint8Array(message, channel.length + 1)
            : message.substring(channel.length + 1);
        let control;

        /* A control message, always string */
        if (!channel) {
            transport_debug("recv control:", payload);
            control = JSON.parse(payload);
        } else {
            transport_debug("recv " + channel + ":", payload);
        }

        const length = incoming_filters ? incoming_filters.length : 0;
        for (let i = 0; i < length; i++) {
            if (incoming_filters[i](message, channel, control) === false)
                return false;
        }

        if (!channel)
            process_control(control);
        else
            process_message(channel, payload);

        return true;
    };

    self.close = function close(options) {
        if (!options)
            options = { problem: "disconnected" };
        options.command = "close";
        window.clearInterval(check_health_timer);
        const ows = ws;
        ws = null;
        if (ows)
            ows.close();
        if (expect_disconnect)
            return;
        ready_for_channels(); /* ready to fail */

        /* Broadcast to everyone */
        for (const chan in control_cbs)
            control_cbs[chan].apply(null, [options]);
    };

    self.next_channel = function next_channel() {
        last_channel++;
        return channel_seed + String(last_channel);
    };

    function process_init(options) {
        if (options.problem) {
            self.close({ problem: options.problem });
            return;
        }

        if (options.version !== 1) {
            console.error("received unsupported version in init message: " + options.version);
            self.close({ problem: "not-supported" });
            return;
        }

        if (options["channel-seed"])
            channel_seed = String(options["channel-seed"]);
        if (options.host)
            default_host = options.host;

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
        const channel = data.channel;

        /* Init message received */
        if (data.command == "init") {
            process_init(data);
        } else if (waiting_for_init) {
            waiting_for_init = false;
            if (data.command != "close" || channel) {
                console.error("received message before init: ", data.command);
                data = { problem: "protocol-error" };
            }
            self.close(data);

        /* Any pings get sent back as pongs */
        } else if (data.command == "ping") {
            data.command = "pong";
            self.send_control(data);
        } else if (data.command == "pong") {
            /* Any pong commands are ignored */

        } else if (data.command == "hint") {
            if (process_hints)
                process_hints(data);
        } else if (channel !== undefined) {
            const func = control_cbs[channel];
            if (func)
                func(data);
        }
    }

    function process_message(channel, payload) {
        const func = message_cbs[channel];
        if (func)
            func(payload);
    }

    /* The channel/control arguments is used by filters, and auto-populated if necessary */
    self.send_data = function send_data(data, channel, control) {
        if (!ws) {
            return false;
        }

        const length = outgoing_filters ? outgoing_filters.length : 0;
        for (let i = 0; i < length; i++) {
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
        if (payload.byteLength || Array.isArray(payload)) {
            if (payload instanceof window.ArrayBuffer)
                payload = new window.Uint8Array(payload);
            const output = join_data([array_from_raw_string(channel), [10], payload], true);
            return self.send_data(output.buffer, channel, control);

        /* A string message */
        } else {
            return self.send_data(channel.toString() + "\n" + payload, channel, control);
        }
    };

    self.send_control = function send_control(data) {
        if (!ws && (data.command == "close" || data.command == "kill"))
            return; /* don't complain if closed and closing */
        if (check_health_timer &&
            data.command == "hint" && data.hint == "ignore_transport_health_check") {
            /* This is for us, process it directly. */
            ignore_health_check = data.data;
            return;
        }
        return self.send_message(JSON.stringify(data), "", data);
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
    if (!default_transport)
        default_transport = new Transport();
    const transport = default_transport;
    if (transport.ready) {
        callback(transport);
    } else {
        transport.addEventListener("ready", function() {
            callback(transport);
        });
    }
}

/* Always close the transport explicitly: allows parent windows to track us */
window.addEventListener("unload", function() {
    if (default_transport)
        default_transport.close();
});

function Channel(options) {
    const self = this;

    /* We can trigger events */
    event_mixin(self, { });

    let transport;
    let ready = null;
    let closed = null;
    let waiting = null;
    let received_done = false;
    let sent_done = false;
    let id = null;
    const binary = (options.binary === true);

    /*
     * Queue while waiting for transport, items are tuples:
     * [is_control ? true : false, payload]
     */
    const queue = [];

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
            self.dispatchEvent("message", payload);
        }
    }

    function on_close(data) {
        closed = data;
        self.valid = false;
        if (transport && id)
            transport.unregister(id);
        if (closed.message && !options.err)
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

        const done = data.command === "done";
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
        if (!binary) {
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
        const command = { };
        for (const i in options)
            command[i] = options[i];
        command.command = "open";
        command.channel = id;

        if (!command.host) {
            if (default_host)
                command.host = default_host;
        }

        if (binary)
            command.binary = "raw";
        else
            delete command.binary;

        command["flow-control"] = true;
        transport.send_control(command);

        /* Now drain the queue */
        while (queue.length > 0) {
            const item = queue.shift();
            if (item[0]) {
                item[1].channel = id;
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
        const promise = waiting.promise;
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
            options = { problem: options };
        options.command = "close";
        options.channel = id;

        if (!transport)
            queue.push([true, options]);
        else
            transport.send_control(options);
        on_close(options);
    };

    self.buffer = function buffer(callback) {
        const buffers = [];
        buffers.callback = callback;
        buffers.squash = function squash() {
            return join_data(buffers, binary);
        };

        function on_message(event, data) {
            buffers.push(data);
            if (buffers.callback) {
                const block = join_data(buffers, binary);
                if (block.length > 0) {
                    const consumed = buffers.callback.call(self, block);
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
        const host = options.host || "localhost";
        return "[Channel " + (self.valid ? id : "<invalid>") + " -> " + host + "]";
    };
}

/* Resolve dots and double dots */
function resolve_path_dots(parts) {
    const out = [];
    const length = parts.length;
    for (let i = 0; i < length; i++) {
        const part = parts[i];
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

    /* obsolete backwards compatible shim */
    cockpit.extend = Object.assign;

    /* These can be filled in by loading ../manifests.js */
    cockpit.manifests = { };

    /* ------------------------------------------------------------
     * Text Encoding
     */

    function Utf8TextEncoder(constructor) {
        const self = this;
        self.encoding = "utf-8";

        self.encode = function encode(string, options) {
            const data = window.unescape(encodeURIComponent(string));
            if (constructor === String)
                return data;
            return array_from_raw_string(data, constructor);
        };
    }

    function Utf8TextDecoder(fatal) {
        const self = this;
        let buffer = null;
        self.encoding = "utf-8";

        self.decode = function decode(data, options) {
            const stream = options?.stream;

            if (data === null || data === undefined)
                data = "";
            if (typeof data !== "string")
                data = array_to_raw_string(data);
            if (buffer) {
                data = buffer + data;
                buffer = null;
            }

            /* We have to scan to do non-fatal and streaming */
            const len = data.length;
            let beg = 0;
            let i = 0;
            let str = "";

            while (i < len) {
                const p = data.charCodeAt(i);
                const x = p == 255
                    ? 0
                    : p > 251 && p < 254
                    ? 6
                    : p > 247 && p < 252
                    ? 5
                    : p > 239 && p < 248
                    ? 4
                    : p > 223 && p < 240
                    ? 3
                    : p > 191 && p < 224
                    ? 2
                    : p < 128 ? 1 : 0;

                let ok = (i + x <= len);
                if (!ok && stream) {
                    buffer = data.substring(i);
                    break;
                }
                if (x === 0)
                    ok = false;
                for (let j = 1; ok && j < x; j++)
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
        const options = { };
        if (host)
            options.host = host;
        if (group)
            options.group = group;
        cockpit.transport.control("kill", options);
    };

    /* Not public API ... yet? */
    cockpit.hint = function hint(name, options) {
        if (!default_transport)
            return;
        if (!options)
            options = default_host;
        if (typeof options == "string")
            options = { host: options };
        options.hint = name;
        cockpit.transport.control("hint", options);
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
                    outgoing_filters = [];
                outgoing_filters.push(callback);
            } else {
                if (!incoming_filters)
                    incoming_filters = [];
                incoming_filters.push(callback);
            }
        },
        close: function close(problem) {
            if (default_transport)
                default_transport.close(problem ? { problem } : undefined);
            default_transport = null;
            this.options = { };
        },
        origin: transport_origin,
        options: { },
        uri: calculate_url,
        control: function(command, options) {
            options = { ...options, command };
            ensure_transport(function(transport) {
                transport.send_control(options);
            });
        },
        application: function () {
            if (!default_transport || window.mock)
                return calculate_application();
            return default_transport.application;
        },
    };

    /* ------------------------------------------------------------------------------------
     * An ordered queue of functions that should be called later.
     */

    let later_queue = [];
    let later_timeout = null;

    function later_drain() {
        const queue = later_queue;
        later_timeout = null;
        later_queue = [];
        for (;;) {
            const func = queue.shift();
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
     * license in COPYING.node for license lineage. There are some key differences with
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
        const result = new Deferred();
        state.pending = state.pending || [];
        state.pending.push([result, fulfilled, rejected, updated]);
        if (state.status > 0)
            schedule_process_queue(state);
        return result.promise;
    }

    function create_promise(state) {
        /* Like jQuery the promise object is callable */
        const self = function Promise(target) {
            if (target) {
                Object.assign(target, self);
                return target;
            }
            return self;
        };

        state.status = 0;

        self.then = function then(fulfilled, rejected, updated) {
            return promise_then(state, fulfilled, rejected, updated) || self;
        };

        self.catch = function catch_(callback) {
            return promise_then(state, null, callback) || self;
        };

        self.finally = function finally_(callback, updated) {
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
        const pending = state.pending;
        state.process_scheduled = false;
        state.pending = undefined;
        for (let i = 0, ii = pending.length; i < ii; ++i) {
            state.pur = true;
            const deferred = pending[i][0];
            const fn = pending[i][state.status];
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
        later_invoke(function() { process_queue(state) });
    }

    function deferred_resolve(state, values) {
        let then;
        let done = false;
        if (is_object(values[0]) || is_function(values[0]))
            then = values[0]?.then;
        if (is_function(then)) {
            state.status = -1;
            then.call(values[0], function(/* ... */) {
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
        const callbacks = state.pending;
        if ((state.status <= 0) && callbacks?.length) {
            later_invoke(function() {
                for (let i = 0, ii = callbacks.length; i < ii; i++) {
                    const result = callbacks[i][0];
                    const callback = callbacks[i][3];
                    if (is_function(callback))
                        result.notify(callback.apply(state.promise, values));
                    else
                        result.notify.apply(result, values);
                }
            });
        }
    }

    function Deferred() {
        const self = this;
        const state = { };
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
        const result = cockpit.defer();
        if (resolved)
            result.resolve.apply(result, values);
        else
            result.reject.apply(result, values);
        return result.promise;
    }

    function handle_callback(values, is_resolved, callback) {
        let callback_output = null;
        if (is_function(callback))
            callback_output = callback();
        if (callback_output && is_function(callback_output.then)) {
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
        const result = cockpit.defer();
        result.resolve(value);
        return result.promise.then(fulfilled, rejected, updated);
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

    const fmt_re = /\$\{([^}]+)\}|\$([a-zA-Z0-9_]+)/g;
    cockpit.format = function format(fmt, args) {
        if (arguments.length != 2 || !is_object(args) || args === null)
            args = Array.prototype.slice.call(arguments, 1);

        function replace(m, x, y) {
            const value = args[x || y];

            /* Special-case 0 (also catches 0.0). All other falsy values return
             * the empty string.
             */
            if (value === 0)
                return '0';

            return value || '';
        }

        return fmt.replace(fmt_re, replace);
    };

    cockpit.format_number = function format_number(number, precision) {
        /* We show given number of digits of precision (default 3), but avoid scientific notation.
         * We also show integers without digits after the comma.
         *
         * We want to localise the decimal separator, but we never want to
         * show thousands separators (to avoid ambiguity).  For this
         * reason, for integers and large enough numbers, we use
         * non-localised conversions (and in both cases, show no
         * fractional part).
         */
        if (precision === undefined)
            precision = 3;
        const lang = cockpit.language === undefined ? undefined : cockpit.language.replace('_', '-');
        const smallestValue = 10 ** (-precision);

        if (!number && number !== 0)
            return "";
        else if (number % 1 === 0)
            return number.toString();
        else if (number > 0 && number <= smallestValue)
            return smallestValue.toLocaleString(lang);
        else if (number < 0 && number >= -smallestValue)
            return (-smallestValue).toLocaleString(lang);
        else if (number > 999 || number < -999)
            return number.toFixed(0);
        else
            return number.toLocaleString(lang, {
                maximumSignificantDigits: precision,
                minimumSignificantDigits: precision,
            });
    };

    function format_units(number, suffixes, factor, options) {
        // backwards compat: "options" argument position used to be a boolean flag "separate"
        if (!is_object(options))
            options = { separate: options };

        let suffix = null;

        /* Find that factor string */
        if (!number && number !== 0) {
            suffix = null;
        } else if (typeof (factor) === "string") {
            /* Prefer larger factors */
            const keys = [];
            for (const key in suffixes)
                keys.push(key);
            keys.sort().reverse();
            for (let y = 0; y < keys.length; y++) {
                for (let x = 0; x < suffixes[keys[y]].length; x++) {
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
            let divisor = 1;
            for (let i = 0; i < suffixes[factor].length; i++) {
                const quotient = number / divisor;
                if (quotient < factor) {
                    number = quotient;
                    suffix = suffixes[factor][i];
                    break;
                }
                divisor *= factor;
            }
        }

        const string_representation = cockpit.format_number(number, options.precision);
        let ret;

        if (string_representation && suffix)
            ret = [string_representation, suffix];
        else
            ret = [string_representation];

        if (!options.separate)
            ret = ret.join(" ");

        return ret;
    }

    const byte_suffixes = {
        1000: [null, "KB", "MB", "GB", "TB", "PB", "EB", "ZB"],
        1024: [null, "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB"]
    };

    cockpit.format_bytes = function format_bytes(number, factor, options) {
        if (factor === undefined)
            factor = 1000;
        return format_units(number, byte_suffixes, factor, options);
    };

    cockpit.get_byte_units = function get_byte_units(guide_value, factor) {
        if (factor === undefined || !(factor in byte_suffixes))
            factor = 1000;

        function unit(index) {
            return {
 name: byte_suffixes[factor][index],
                     factor: Math.pow(factor, index)
                   };
        }

        const units = [unit(2), unit(3), unit(4)];

        // The default unit is the largest one that gives us at least
        // two decimal digits in front of the comma.

        for (let i = units.length - 1; i >= 0; i--) {
            if (i === 0 || (guide_value / units[i].factor) >= 10) {
                units[i].selected = true;
                break;
            }
        }

        return units;
    };

    const byte_sec_suffixes = {
        1000: ["B/s", "kB/s", "MB/s", "GB/s", "TB/s", "PB/s", "EB/s", "ZB/s"],
        1024: ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s", "PiB/s", "EiB/s", "ZiB/s"]
    };

    cockpit.format_bytes_per_sec = function format_bytes_per_sec(number, factor, options) {
        if (factor === undefined)
            factor = 1000;
        return format_units(number, byte_sec_suffixes, factor, options);
    };

    const bit_suffixes = {
        1000: ["bps", "Kbps", "Mbps", "Gbps", "Tbps", "Pbps", "Ebps", "Zbps"]
    };

    cockpit.format_bits_per_sec = function format_bits_per_sec(number, factor, options) {
        if (factor === undefined)
            factor = 1000;
        return format_units(number, bit_suffixes, factor, options);
    };

    /* ---------------------------------------------------------------------
     * Storage Helper.
     *
     * Use application to prefix data stored in browser storage
     * with helpers for compatibility.
     */
    function StorageHelper(storageName) {
        const self = this;
        let storage;

        try {
            storage = window[storageName];
        } catch (e) { }

        self.prefixedKey = function (key) {
            return cockpit.transport.application() + ":" + key;
        };

        self.getItem = function (key, both) {
            let value = storage.getItem(self.prefixedKey(key));
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
            let i = 0;
            while (i < storage.length) {
                const k = storage.key(i);
                if (full && k.indexOf("cockpit") !== 0)
                    storage.removeItem(k);
                else if (k.indexOf(cockpit.transport.application()) === 0)
                    storage.removeItem(k);
                else
                    i++;
            }
        };
    }

    cockpit.localStorage = new StorageHelper("localStorage");
    cockpit.sessionStorage = new StorageHelper("sessionStorage");

    /* ---------------------------------------------------------------------
     * Shared data cache.
     *
     * We cannot use sessionStorage when keeping lots of data in memory and
     * sharing it between frames. It has a rather paltry limit on the amount
     * of data it can hold ... so we use window properties instead.
     */

    function lookup_storage(win) {
        let storage;
        if (win.parent && win.parent !== win)
            storage = lookup_storage(win.parent);
        if (!storage) {
            try {
                storage = win["cv1-storage"];
                if (!storage)
                    win["cv1-storage"] = storage = { };
            } catch (ex) { }
        }
        return storage;
    }

    function StorageCache(org_key, provider, consumer) {
        const self = this;
        const key = cockpit.transport.application() + ":" + org_key;

        /* For triggering events and ownership */
        const trigger = window.sessionStorage;
        let last;

        const storage = lookup_storage(window);

        let claimed = false;
        let source;

        function callback() {
            /* Only run the callback if we have a result */
            if (storage[key] !== undefined) {
                const value = storage[key];
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
            const version = Math.floor(Math.random() * 10000000) + 1;

            /* Event for the local window */
            const ev = document.createEvent("StorageEvent");
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
            const claiming = { close: function() { } };
            source = claiming;

            const changed = provider(result, org_key);
            if (source === claiming)
                source = changed;
            else
                changed.close();
        };

        function unclaim() {
            if (source?.close)
                source.close();
            source = null;

            if (!claimed)
                return;

            claimed = false;

            let current_value = trigger.getItem(key);
            if (current_value)
                current_value = parseInt(current_value, 10);
            else
                current_value = null;

            if (last && last === current_value) {
                const ev = document.createEvent("StorageEvent");
                const version = trigger[key];
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

            let new_value = null;
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
        const self = this;

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
        const index = setup_index(identifier);

        /*
         * A linked list through the index, that we use for expiry
         * of the cache.
         */
        let count = 0;
        let head = null;
        let tail = null;

        function setup_index(id) {
            if (!id)
                return [];

            /* Try and find a good place to cache data */
            const storage = lookup_storage(window);

            let index = storage[id];
            if (!index)
                storage[id] = index = [];
            return index;
        }

        function search(idx, beg) {
            let low = 0;
            let high = idx.length - 1;

            while (low <= high) {
                const mid = (low + high) / 2 | 0;
                const val = idx[mid].beg;
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
                    stash(beg, new Array(end - beg), { });
                }
                fetch_callback(beg, end, for_walking);
            }
        }

        self.load = function load(beg, end, for_walking) {
            if (end <= beg)
                return;

            const at = search(index, beg);

            const len = index.length;
            let last = beg;

            /* We do this in two phases: First, we walk the index to
             * process what we already have and at the same time make
             * notes about what we need to fetch.  Then we go over the
             * notes and actually fetch what we need.  That way, the
             * fetch callbacks in the second phase can modify the
             * index data structure without disturbing the walk in the
             * first phase.
             */

            const fetches = [];

            /* Data relevant to this range can be at the found index, or earlier */
            for (let i = at > 0 ? at - 1 : at; i < len; i++) {
                const entry = index[i];
                const en = entry.items.length;
                if (!en)
                    continue;

                const eb = entry.beg;
                const b = Math.max(eb, beg);
                const e = Math.min(eb + en, end);

                if (b < e) {
                    if (b > last)
                        fetches.push([last, b]);
                    process(b, entry.items.slice(b - eb, e - eb), entry.mapping);
                    last = e;
                } else if (i >= at) {
                    break; /* no further intersections */
                }
            }

            for (let i = 0; i < fetches.length; i++)
                fetch(fetches[i][0], fetches[i][1], for_walking);

            if (last != end)
                fetch(last, end, for_walking);
        };

        function stash(beg, items, mapping) {
            if (!items.length)
                return;

            let at = search(index, beg);

            const end = beg + items.length;

            const len = index.length;
            let i;
            for (i = at > 0 ? at - 1 : at; i < len; i++) {
                const entry = index[i];
                const en = entry.items.length;
                if (!en)
                    continue;

                const eb = entry.beg;
                const b = Math.max(eb, beg);
                const e = Math.min(eb + en, end);

                /*
                 * We truncate blocks that intersect with this one
                 *
                 * We could adjust them, but in general the loaders are
                 * intelligent enough to only load the required data, so
                 * not doing this optimization yet.
                 */

                if (b < e) {
                    const num = e - b;
                    entry.items.splice(b - eb, num);
                    count -= num;
                    if (b - eb === 0)
                        entry.beg += (e - eb);
                } else if (i >= at) {
                    break; /* no further intersections */
                }
            }

            /* Insert our item into the array */
            const entry = { beg, items, mapping };
            if (!head)
                head = entry;
            if (tail)
                tail.next = entry;
            tail = entry;
            count += items.length;
            index.splice(at, 0, entry);

            /* Remove any items with zero length around insertion point */
            for (at--; at <= i; at++) {
                const entry = index[at];
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
            const newlen = index.length;
            for (i = 0; i < newlen; i++) {
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
        const registered = { };

        /* An undocumented function called by DataGrid */
        self._register = function _register(grid, id) {
            if (grid.interval != interval)
                throw Error("mismatched metric interval between grid and sink");
            let gdata = registered[id];
            if (!gdata) {
                gdata = registered[id] = { grid, links: [] };
                gdata.links.remove = function remove() {
                    delete registered[id];
                };
            }
            return gdata.links;
        };

        function process(beg, items, mapping) {
            const end = beg + items.length;

            for (const id in registered) {
                const gdata = registered[id];
                const grid = gdata.grid;

                const b = Math.max(beg, grid.beg);
                const e = Math.min(end, grid.end);

                /* Does this grid overlap the bounds of item? */
                if (b < e) {
                    /* Where in the items to take from */
                    const f = b - beg;

                    /* Where and how many to place */
                    const t = b - grid.beg;

                    /* How many to process */
                    const n = e - b;

                    for (let i = 0; i < n; i++) {
                        const klen = gdata.links.length;
                        for (let k = 0; k < klen; k++) {
                            const path = gdata.links[k][0];
                            const row = gdata.links[k][1];

                            /* Calculate the data field to fill in */
                            let data = items[f + i];
                            let map = mapping;
                            const jlen = path.length;
                            for (let j = 0; data !== undefined && j < jlen; j++) {
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

        self.close = function () {
            for (const id in registered) {
                const grid = registered[id];
                if (grid?.grid)
                    grid.grid.remove_sink(self);
            }
        };
    }

    cockpit.series = function series(interval, cache, fetch) {
        return new SeriesSink(interval, cache, fetch);
    };

    let unique = 1;

    function SeriesGrid(interval, beg, end) {
        const self = this;

        /* We can trigger events */
        event_mixin(self, { });

        const rows = [];

        self.interval = interval;
        self.beg = 0;
        self.end = 0;

        /*
         * Used to populate table data, the values are:
         * [ callback, row ]
         */
        const callbacks = [];

        const sinks = [];

        let suppress = 0;

        const id = "g1-" + unique;
        unique += 1;

        /* Used while walking */
        let walking = null;
        let offset = null;

        self.notify = function notify(x, n) {
            if (suppress)
                return;
            if (x + n > self.end - self.beg)
                n = (self.end - self.beg) - x;
            if (n <= 0)
                return;
            const jlen = callbacks.length;
            for (let j = 0; j < jlen; j++) {
                const callback = callbacks[j][0];
                const row = callbacks[j][1];
                callback.call(self, row, x, n);
            }

            self.dispatchEvent("notify", x, n);
        };

        self.add = function add(/* sink, path */) {
            const row = [];
            rows.push(row);

            /* Called as add(sink, path) */
            if (is_object(arguments[0])) {
                const sink = arguments[0].series || arguments[0];

                /* The path argument can be an array, or a dot separated string */
                let path = arguments[1];
                if (!path)
                    path = [];
                else if (typeof (path) === "string")
                    path = path.split(".");

                const links = sink._register(self, id);
                if (!links.length)
                    sinks.push({ sink, links });
                links.push([path, row]);

            /* Called as add(callback) */
            } else if (is_function(arguments[0])) {
                const cb = [arguments[0], row];
                if (arguments[1] === true)
                    callbacks.unshift(cb);
                else
                    callbacks.push(cb);

            /* Not called as add() */
            } else if (arguments.length !== 0) {
                throw Error("invalid args to grid.add()");
            }

            return row;
        };

        self.remove = function remove(row) {
            /* Remove from the sinks */
            let ilen = sinks.length;
            for (let i = 0; i < ilen; i++) {
                const jlen = sinks[i].links.length;
                for (let j = 0; j < jlen; j++) {
                    if (sinks[i].links[j][1] === row) {
                        sinks[i].links.splice(j, 1);
                        break;
                    }
                }
            }

            /* Remove from our list of rows */
            ilen = rows.length;
            for (let i = 0; i < ilen; i++) {
                if (rows[i] === row) {
                    rows.splice(i, 1);
                    break;
                }
            }
        };

        self.remove_sink = function remove_sink(sink) {
            const len = sinks.length;
            for (let i = 0; i < len; i++) {
                if (sinks[i].sink === sink) {
                    sinks[i].links.remove();
                    sinks.splice(i, 1);
                    break;
                }
            }
        };

        self.sync = function sync(for_walking) {
            /* Suppress notifications */
            suppress++;

            /* Ask all sinks to load data */
            const len = sinks.length;
            for (let i = 0; i < len; i++) {
                const sink = sinks[i].sink;
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
            let now = null;

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
             * https://developer.mozilla.org/en-US/docs/Web/API/setTimeout
             * says:
             *
             *    Browsers including Internet Explorer, Chrome,
             *    Safari, and Firefox store the delay as a 32-bit
             *    signed Integer internally. This causes an Integer
             *    overflow when using delays larger than 2147483647,
             *    resulting in the timeout being executed immediately.
             */

            const start = Date.now();
            if (self.interval > 2000000000)
                return;

            stop_walking();
            offset = start - self.beg * self.interval;
            walking = window.setInterval(function() {
                const now = Date.now();
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

    cockpit.logout = function logout(reload, reason) {
        /* fully clear session storage */
        cockpit.sessionStorage.clear(true);

        /* Only clean application data from localStorage,
         * except for login-data. Clear that completely */
        cockpit.localStorage.removeItem('login-data', true);
        cockpit.localStorage.clear(false);

        if (reload !== false)
            reload_after_disconnect = true;
        ensure_transport(function(transport) {
            if (!transport.send_control({ command: "logout", disconnect: true }))
                window.location.reload(reload_after_disconnect);
        });
        window.sessionStorage.setItem("logout-intent", "explicit");
        if (reason)
            window.sessionStorage.setItem("logout-reason", reason);
    };

    /* Not public API ... yet? */
    cockpit.drop_privileges = function drop_privileges() {
        ensure_transport(function(transport) {
            transport.send_control({ command: "logout", disconnect: false });
        });
    };

    /* ---------------------------------------------------------------------
     * User and system information
     */

    cockpit.info = { };
    event_mixin(cockpit.info, { });

    init_callback = function(options) {
        if (options.system)
            Object.assign(cockpit.info, options.system);
        if (options.system)
            cockpit.info.dispatchEvent("changed");
    };

    let the_user = null;
    cockpit.user = function () {
            if (!the_user) {
                const dbus = cockpit.dbus(null, { bus: "internal" });
                return dbus.call("/user", "org.freedesktop.DBus.Properties", "GetAll",
                          ["cockpit.User"], { type: "s" })
                    .then(([user]) => {
                        the_user = {
                            id: user.Id.v,
                            name: user.Name.v,
                            full_name: user.Full.v,
                            groups: user.Groups.v,
                            home: user.Home.v,
                            shell: user.Shell.v
                        };
                        return the_user;
                    })
                    .finally(() => dbus.close());
            } else {
                return Promise.resolve(the_user);
            }
    };

    /* ------------------------------------------------------------------------
     * Override for broken browser behavior
     */

    document.addEventListener("click", function(ev) {
        if (ev.target.classList && in_array(ev.target.classList, 'disabled'))
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

    let last_loc = null;

    function get_window_location_hash() {
        return (window.location.href.split('#')[1] || '');
    }

    function Location() {
        const self = this;
        const application = cockpit.transport.application();
        self.url_root = url_root || "";

        if (window.mock?.url_root)
            self.url_root = window.mock.url_root;

        if (application.indexOf("cockpit+=") === 0) {
            if (self.url_root)
                self.url_root += '/';
            self.url_root = self.url_root + application.replace("cockpit+", '');
        }

        const href = get_window_location_hash();
        const options = { };
        self.path = decode(href, options);

        function decode_path(input) {
            const parts = input.split('/').map(decodeURIComponent);
            let result, i;
            let pre_parts = [];

            if (self.url_root)
                pre_parts = self.url_root.split('/').map(decodeURIComponent);

            if (input && input[0] !== "/") {
                result = [].concat(self.path);
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
                path = decode_path(path);

            let href = "/" + path.map(encodeURIComponent).join("/");
            if (with_root && self.url_root && href.indexOf("/" + self.url_root + "/") !== 0)
                href = "/" + self.url_root + href;

            /* Undo unnecessary encoding of these */
            href = href.replaceAll("%40", "@");
            href = href.replaceAll("%3D", "=");
            href = href.replaceAll("%2B", "+");
            href = href.replaceAll("%23", "#");

            let opt;
            const query = [];
            function push_option(v) {
                query.push(encodeURIComponent(opt) + "=" + encodeURIComponent(v));
            }

            if (options) {
                for (opt in options) {
                    let value = options[opt];
                    if (!Array.isArray(value))
                        value = [value];
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

            const pos = href.indexOf('?');
            const first = (pos === -1) ? href : href.substr(0, pos);
            const path = decode_path(first);
            if (pos !== -1 && options) {
                href.substring(pos + 1).split("&")
                .forEach(function(opt) {
                    const parts = opt.split('=');
                    const name = decodeURIComponent(parts[0]);
                    const value = decodeURIComponent(parts[1]);
                    if (options[name]) {
                        let last = options[name];
                        if (!Array.isArray(value))
                            last = options[name] = [last];
                        last.push(value);
                    } else {
                        options[name] = value;
                    }
                });
            }

            return path;
        }

        function href_for_go_or_replace(/* ... */) {
            let href;
            if (arguments.length == 1 && arguments[0] instanceof Location) {
                href = String(arguments[0]);
            } else if (typeof arguments[0] == "string") {
                const options = arguments[1] || { };
                href = encode(decode(arguments[0], options), options);
            } else {
                href = encode.apply(self, arguments);
            }
            return href;
        }

        function replace(/* ... */) {
            if (self !== last_loc)
                return;
            const href = href_for_go_or_replace.apply(self, arguments);
            window.location.replace(window.location.pathname + '#' + href);
        }

        function go(/* ... */) {
            if (self !== last_loc)
                return;
            const href = href_for_go_or_replace.apply(self, arguments);
            window.location.hash = '#' + href;
        }

        Object.defineProperties(self, {
            path: {
                enumerable: true,
                writable: false,
                value: self.path
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
            toString: { value: function() { return href } }
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
        let hash = window.location.hash;
        if (hash.indexOf("#") === 0)
            hash = hash.substring(1);
        cockpit.hint("location", { hash });
        cockpit.dispatchEvent("locationchanged");
    });

    /* ------------------------------------------------------------------------
     * Cockpit jump
     */

    cockpit.jump = function jump(path, host) {
        if (Array.isArray(path))
            path = "/" + path.map(encodeURIComponent).join("/")
.replaceAll("%40", "@")
.replaceAll("%3D", "=")
.replaceAll("%2B", "+");
        else
            path = "" + path;

        /* When host is not given (undefined), use current transport's host. If
         * it is null, use localhost.
         */
        if (host === undefined)
            host = cockpit.transport.host;

        const options = { command: "jump", location: path, host };
        cockpit.transport.inject("\n" + JSON.stringify(options));
    };

    /* ---------------------------------------------------------------------
     * Cockpit Page Visibility
     */

    (function() {
        let hiddenHint = false;

        function visibility_change() {
            let value = document.hidden;
            if (value === false)
                value = hiddenHint;
            if (cockpit.hidden !== value) {
                cockpit.hidden = value;
                cockpit.dispatchEvent("visibilitychange");
            }
        }

        document.addEventListener("visibilitychange", visibility_change);

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
        if (window.debugging == "all" || window.debugging?.includes("spawn"))
            console.debug.apply(console, arguments);
    }

    /* public */
    cockpit.spawn = function(command, options) {
        const dfd = cockpit.defer();

        const args = { payload: "stream", spawn: [] };
        if (command instanceof Array) {
            for (let i = 0; i < command.length; i++)
                args.spawn.push(String(command[i]));
        } else {
            args.spawn.push(String(command));
        }
        if (options !== undefined)
            Object.assign(args, options);

        spawn_debug("process spawn:", JSON.stringify(args.spawn));

        const name = args.spawn[0] || "process";
        const channel = cockpit.channel(args);

        /* Callback that wants a stream response, see below */
        const buffer = channel.buffer(null);

        channel.addEventListener("close", function(event, options) {
            const data = buffer.squash();
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

        const ret = dfd.promise;
        ret.stream = function(callback) {
            buffer.callback = callback.bind(ret);
            return this;
        };

        ret.input = function(message, stream) {
            if (message !== null && message !== undefined) {
                spawn_debug("process input:", message);
                iterate_data(message, function(data) {
                    channel.send(data);
                });
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
        const command = ["/bin/sh", "-c", script, "--"];
        command.push.apply(command, args);
        return cockpit.spawn(command, options);
    };

    function dbus_debug() {
        if (window.debugging == "all" || window.debugging?.includes("dbus"))
            console.debug.apply(console, arguments);
    }

    function DBusError(arg, arg1) {
        if (typeof (arg) == "string") {
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
        const self = this;

        let callbacks = [];
        self.data = { };
        self.meta = { };

        self.connect = function connect(path, iface, callback, first) {
            const cb = [path, iface, callback];
            if (first)
                callbacks.unshift(cb);
            else
                callbacks.push(cb);
            return {
                remove: function remove() {
                    const length = callbacks.length;
                    for (let i = 0; i < length; i++) {
                        const cb = callbacks[i];
                        if (cb[0] === path && cb[1] === iface && cb[2] === callback) {
                            delete cb[i];
                            break;
                        }
                    }
                }
            };
        };

        function emit(path, iface, props) {
            const copy = callbacks.slice();
            const length = copy.length;
            for (let i = 0; i < length; i++) {
                const cb = copy[i];
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
                props = Object.assign(self.data[path][iface], props);
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
            for (const path in self.data) {
                for (const ifa in self.data[path]) {
                    if (ifa == iface)
                        callback(self.data[path][iface], path);
                }
            }
        };

        self.close = function close() {
            self.data = { };
            const copy = callbacks;
            callbacks = [];
            const length = copy.length;
            for (let i = 0; i < length; i++)
                copy[i].callback();
        };
    }

    function DBusProxy(client, cache, iface, path, options) {
        const self = this;
        event_mixin(self, { });

        let valid = false;
        let defined = false;
        const waits = cockpit.defer();

        /* No enumeration on these properties */
        Object.defineProperties(self, {
            client: { value: client, enumerable: false, writable: false },
            path: { value: path, enumerable: false, writable: false },
            iface: { value: iface, enumerable: false, writable: false },
            valid: { get: function() { return valid }, enumerable: false },
            wait: {
                enumerable: false,
                writable: false,
                value: function(func) {
                    if (func)
                        waits.promise.always(func);
                    return waits.promise;
                }
            },
            call: {
                value: function(name, args, options) { return client.call(path, iface, name, args, options) },
                enumerable: false,
                writable: false
            },
            data: { value: { }, enumerable: false }
        });

        if (!options)
            options = { };

        function define() {
            if (!cache.meta[iface])
                return;

            const meta = cache.meta[iface];
            defined = true;

            Object.keys(meta.methods || { }).forEach(function(name) {
                if (name[0].toLowerCase() == name[0])
                    return; /* Only map upper case */

                /* Again, make sure these don't show up in enumerations */
                Object.defineProperty(self, name, {
                    enumerable: false,
                    value: function() {
                        const dfd = cockpit.defer();
                        client.call(path, iface, name, Array.prototype.slice.call(arguments))
                            .done(function(reply) { dfd.resolve.apply(dfd, reply) })
                            .fail(function(ex) { dfd.reject(ex) });
                        return dfd.promise;
                    }
                });
            });

            Object.keys(meta.properties || { }).forEach(function(name) {
                if (name[0].toLowerCase() == name[0])
                    return; /* Only map upper case */

                const config = {
                    enumerable: true,
                    get: function() { return self.data[name] },
                    set: function(v) { throw Error(name + "is not writable") }
                };

                const prop = meta.properties[name];
                if (prop.flags && prop.flags.indexOf('w') !== -1) {
                    config.set = function(v) {
                        client.call(path, "org.freedesktop.DBus.Properties", "Set",
                                [iface, name, cockpit.variant(prop.type, v)])
                            .fail(function(ex) {
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
                Object.assign(self.data, props);
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

        client.subscribe({ path, interface: iface }, signal, options.subscribe !== false);

        function waited(ex) {
            if (valid)
                waits.resolve();
            else
                waits.reject(ex);
        }

        /* If watching then do a proper watch, otherwise object is done */
        if (options.watch !== false)
            client.watch({ path, interface: iface }).always(waited);
        else
            waited();
    }

    function DBusProxies(client, cache, iface, path_namespace, options) {
        const self = this;
        event_mixin(self, { });

        let waits;

        Object.defineProperties(self, {
            client: { value: client, enumerable: false, writable: false },
            iface: { value: iface, enumerable: false, writable: false },
            path_namespace: { value: path_namespace, enumerable: false, writable: false },
            wait: {
                enumerable: false,
                writable: false,
                value: function(func) {
                    if (func)
                        waits.always(func);
                    return waits;
                }
            }
        });

        /* Subscribe to signals once for all proxies */
        const match = { interface: iface, path_namespace };

        /* Callbacks added by proxies */
        client.subscribe(match);

        /* Watch for property changes */
        if (options.watch !== false) {
            waits = client.watch(match);
        } else {
            waits = cockpit.defer().resolve().promise;
        }

        /* Already added watch/subscribe, tell proxies not to */
        options = { watch: false, subscribe: false, ...options };

        function update(props, path) {
            let proxy = self[path];
            if (path) {
                if (!props && proxy) {
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
        }

        cache.connect(null, iface, update, false);
        cache.each(iface, update);
    }

    function DBusClient(name, options) {
        const self = this;
        event_mixin(self, { });

        const args = { };
        let track = false;
        let owner = null;

        if (options) {
            if (options.track)
                track = true;

            delete options.track;
            Object.assign(args, options);
        }
        args.payload = "dbus-json3";
        if (name)
            args.name = name;
        self.options = options;
        self.unique_name = null;

        dbus_debug("dbus open: ", args);

        let channel = cockpit.channel(args);
        const subscribers = { };
        let calls = { };
        let cache;

        /* The problem we closed with */
        let closed;

        self.constructors = { "*": DBusProxy };

        /* Allows waiting on the channel if necessary */
        self.wait = channel.wait;

        function ensure_cache() {
            if (!cache)
                cache = new DBusCache();
        }

        function send(payload) {
            if (channel?.valid) {
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
            if (match.interface && signal[1] !== match.interface)
                return false;
            if (match.member && signal[2] !== match.member)
                return false;
            if (match.arg0 && (!signal[3] || signal[3][0] !== match.arg0))
                return false;
            return true;
        }

        function on_message(event, payload) {
            dbus_debug("dbus:", payload);
            let msg;
            try {
                msg = JSON.parse(payload);
            } catch (ex) {
                console.warn("received invalid dbus json message:", ex);
            }
            if (msg === undefined) {
                channel.close({ problem: "protocol-error" });
                return;
            }
            const dfd = (msg.id !== undefined) ? calls[msg.id] : undefined;
            if (msg.reply) {
                if (dfd) {
                    const options = { };
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
                if (msg.signal) {
                    for (const id in subscribers) {
                        const subscription = subscribers[id];
                        if (subscription.callback) {
                            if (matches(msg.signal, subscription.match))
                                subscription.callback.apply(self, msg.signal);
                        }
                    }
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
            Object.assign(cache.meta, data);
            self.dispatchEvent("meta", data);
        }

        function notify(data) {
            ensure_cache();
            for (const path in data) {
                for (const iface in data[path]) {
                    const props = data[path][iface];
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
            const outstanding = calls;
            calls = { };
            for (const id in outstanding) {
                outstanding[id].reject(new DBusError(closed, options.message));
            }
            self.dispatchEvent("close", options);
        }

        this.close = function close(options) {
            if (typeof options == "string")
                options = { problem: options };
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

        channel.addEventListener("ready", on_ready);
        channel.addEventListener("message", on_message);
        channel.addEventListener("close", on_close);

        let last_cookie = 1;

        this.call = function call(path, iface, method, args, options) {
            const dfd = cockpit.defer();
            const id = String(last_cookie);
            last_cookie++;
            const method_call = {
                ...options,
                call: [path, iface, method, args || []],
                id
            };

            const msg = JSON.stringify(method_call);
            if (send(msg))
                calls[id] = dfd;
            else
                dfd.reject(new DBusError(closed));

            return dfd.promise;
        };

        self.signal = function signal(path, iface, member, args, options) {
            if (!channel || !channel.valid)
                return;

            const message = { ...options, signal: [path, iface, member, args || []] };

            send(JSON.stringify(message));
        };

        this.subscribe = function subscribe(match, callback, rule) {
            const subscription = {
                match: { ...match },
                callback
            };

            if (rule !== false)
                send(JSON.stringify({ "add-match": subscription.match }));

            let id;
            if (callback) {
                id = String(last_cookie);
                last_cookie++;
                subscribers[id] = subscription;
            }

            return {
                remove: function() {
                    let prev;
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
            const match = is_plain_object(path) ? { ...path } : { path: String(path) };

            const id = String(last_cookie);
            last_cookie++;
            const dfd = cockpit.defer();

            const msg = JSON.stringify({ watch: match, id });
            if (send(msg))
                calls[id] = dfd;
            else
                dfd.reject(new DBusError(closed));

            const ret = dfd.promise;
            ret.remove = function remove() {
                if (id in calls) {
                    dfd.reject(new DBusError("cancelled"));
                    delete calls[id];
                }
                send(JSON.stringify({ unwatch: match }));
            };
            return ret;
        };

        self.proxy = function proxy(iface, path, options) {
            if (!iface)
                iface = name;
            iface = String(iface);
            if (!path)
                path = "/" + iface.replaceAll(".", "/");
            let Constructor = self.constructors[iface];
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

    /* Well known buses */
    const shared_dbus = {
        internal: null,
        session: null,
        system: null,
    };

    /* public */
    cockpit.dbus = function dbus(name, options) {
        if (!options)
            options = { bus: "system" };

        /*
         * Figure out if this we should use a shared bus.
         *
         * This is only the case if a null name *and* the
         * options are just a simple { "bus": "xxxx" }
         */
        const keys = Object.keys(options);
        const bus = options.bus;
        const shared = !name && keys.length == 1 && bus in shared_dbus;

        if (shared && shared_dbus[bus])
            return shared_dbus[bus];

        const client = new DBusClient(name, options);

        /*
         * Store the shared bus for next time. Override the
         * close function to only work when a problem is
         * indicated.
         */
        if (shared) {
            const old_close = client.close;
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
        return { v: value, t: type };
    };

    cockpit.byte_array = function byte_array(string) {
        return window.btoa(string);
    };

    /* File access
     */

    cockpit.file = function file(path, options) {
        options = options || { };
        const binary = options.binary;

        const self = {
            path,
            read,
            replace,
            modify,

            watch,

            close
        };

        const base_channel_options = { ...options };
        delete base_channel_options.syntax;

        function parse(str) {
            if (options.syntax?.parse)
                return options.syntax.parse(str);
            else
                return str;
        }

        function stringify(obj) {
            if (options.syntax?.stringify)
                return options.syntax.stringify(obj);
            else
                return obj;
        }

        let read_promise = null;
        let read_channel;

        function read() {
            if (read_promise)
                return read_promise;

            const dfd = cockpit.defer();
            const opts = {
                ...base_channel_options,
                payload: "fsread1",
                path
            };

            function try_read() {
                read_channel = cockpit.channel(opts);
                const content_parts = [];
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
                        const error = new BasicError(message.problem, message.message);
                        fire_watch_callbacks(null, null, error);
                        dfd.reject(error);
                        return;
                    }

                    let content;
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

        let replace_channel = null;

        function replace(new_content, expected_tag) {
            const dfd = cockpit.defer();

            let file_content;
            try {
                file_content = (new_content === null) ? null : stringify(new_content);
            } catch (e) {
                dfd.reject(e);
                return dfd.promise;
            }

            if (replace_channel)
                replace_channel.close("abort");

            const opts = {
                ...base_channel_options,
                payload: "fsreplace1",
                path,
                tag: expected_tag
            };
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

            iterate_data(file_content, function(data) {
                replace_channel.send(data);
            });

            replace_channel.control({ command: "done" });
            return dfd.promise;
        }

        function modify(callback, initial_content, initial_tag) {
            const dfd = cockpit.defer();

            function update(content, tag) {
                let new_content = callback(content);
                if (new_content === undefined)
                    new_content = content;
                replace(new_content, tag)
                    .done(function (new_tag) {
                        dfd.resolve(new_content, new_tag);
                    })
                    .fail(function (error) {
                        if (error.problem == "change-conflict")
                            read_then_update();
                        else
                            dfd.reject(error);
                    });
            }

            function read_then_update() {
                read()
                    .done(update)
                    .fail(function (error) {
                        dfd.reject(error);
                    });
            }

            if (initial_content === undefined)
                read_then_update();
            else
                update(initial_content, initial_tag);

            return dfd.promise;
        }

        const watch_callbacks = [];
        let n_watch_callbacks = 0;

        let watch_channel = null;
        let watch_tag;

        function ensure_watch_channel(options) {
            if (n_watch_callbacks > 0) {
                if (watch_channel)
                    return;

                const opts = {
                    payload: "fswatch1",
                    path,
                    superuser: base_channel_options.superuser,
                };
                watch_channel = cockpit.channel(opts);
                watch_channel.addEventListener("message", function (event, message_string) {
                    let message;
                    try {
                        message = JSON.parse(message_string);
                    } catch (e) {
                        message = null;
                    }
                    if (message && message.path == path && message.tag && message.tag != watch_tag) {
                        if (options && options.read !== undefined && !options.read)
                            fire_watch_callbacks(null, message.tag);
                        else
                            read();
                    }
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

        function watch(callback, options) {
            if (callback)
                watch_callbacks.push(callback);
            n_watch_callbacks += 1;
            ensure_watch_channel(options);

            watch_tag = null;
            read();

            return {
                remove: function () {
                    if (callback) {
                        const index = watch_callbacks.indexOf(callback);
                        if (index > -1)
                            watch_callbacks[index] = null;
                    }
                    n_watch_callbacks -= 1;
                    ensure_watch_channel(options);
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

    let po_data = { };
    let po_plural;

    cockpit.language = "en";
    cockpit.language_direction = "ltr";
    const test_l10n = window.localStorage.test_l10n;

    cockpit.locale = function locale(po) {
        let lang = cockpit.language;
        let lang_dir = cockpit.language_direction;
        let header;

        if (po) {
            Object.assign(po_data, po);
            header = po[""];
        } else if (po === null) {
            po_data = { };
        }

        if (header) {
            if (header["plural-forms"])
                po_plural = header["plural-forms"];
            if (header.language)
                lang = header.language;
            if (header["language-direction"])
                lang_dir = header["language-direction"];
        }

        cockpit.language = lang;
        cockpit.language_direction = lang_dir;
    };

    cockpit.translate = function translate(/* ... */) {
        let what;

        /* Called without arguments, entire document */
        if (arguments.length === 0)
            what = [document];

        /* Called with a single array like argument */
        else if (arguments.length === 1 && arguments[0].length)
            what = arguments[0];

        /* Called with 1 or more element arguments */
        else
            what = arguments;

        /* Translate all the things */
        const wlen = what.length;
        for (let w = 0; w < wlen; w++) {
            /* The list of things to translate */
            let list = null;
            if (what[w].querySelectorAll)
                list = what[w].querySelectorAll("[translatable], [translate]");
            if (!list)
                continue;

            /* Each element */
            for (let i = 0; i < list.length; i++) {
                const el = list[i];

                let val = el.getAttribute("translate") || el.getAttribute("translatable") || "yes";
                if (val == "no")
                    continue;

                /* Each thing to translate */
                const tasks = val.split(" ");
                val = el.getAttribute("translate-context") || el.getAttribute("context");
                for (let t = 0; t < tasks.length; t++) {
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

        const key = context ? context + '\u0004' + string : string;
        if (po_data) {
            const translated = po_data[key];
            if (translated?.[1])
                string = translated[1];
        }

        if (test_l10n === 'true')
            return "»" + string + "«";

        return string;
    };

    function imply(val) {
        return (val === true ? 1 : val || 0);
    }

    cockpit.ngettext = function ngettext(context, string1, stringN, num) {
        /* Missing first parameter */
        if (arguments.length == 3) {
            num = stringN;
            stringN = string1;
            string1 = context;
            context = undefined;
        }

        const key = context ? context + '\u0004' + string1 : string1;
        if (po_data && po_plural) {
            const translated = po_data[key];
            if (translated) {
                const i = imply(po_plural(num)) + 1;
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
    const _ = cockpit.gettext;

    cockpit.message = function message(arg) {
        if (arg.message)
            return arg.message;

        let problem = null;
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
        else if (problem == "unknown-host")
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
        else if (problem == "too-large")
            return _("Too much data");
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
        if (window.debugging == "all" || window.debugging?.includes("http"))
            console.debug.apply(console, arguments);
    }

    function find_header(headers, name) {
        if (!headers)
            return undefined;
        name = name.toLowerCase();
        for (const head in headers) {
            if (head.toLowerCase() == name)
                return headers[head];
        }
        return undefined;
    }

    function HttpClient(endpoint, options) {
        const self = this;

        self.options = options;
        options.payload = "http-stream2";

        const active_requests = [];

        if (endpoint !== undefined) {
            if (endpoint.indexOf && endpoint.indexOf("/") === 0) {
                options.unix = endpoint;
            } else {
                const port = parseInt(endpoint, 10);
                if (!isNaN(port))
                    options.port = port;
                else
                    throw Error("The endpoint must be either a unix path or port number");
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
            })
.join('&')
.split('%20')
.join('+'); /* split/join because phantomjs */
        }

        self.request = function request(req) {
            const dfd = cockpit.defer();
            const ret = dfd.promise;

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

            const input = req.body;
            delete req.body;

            const headers = req.headers;
            delete req.headers;

            Object.assign(req, options);

            /* Combine the headers */
            if (options.headers && headers)
                req.headers = { ...options.headers, ...headers };
            else if (options.headers)
                req.headers = options.headers;
            else
                req.headers = headers;

            http_debug("http request:", JSON.stringify(req));

            /* We need a channel for the request */
            const channel = cockpit.channel(req);

            if (input !== undefined) {
                if (input !== "") {
                    http_debug("http input:", input);
                    iterate_data(input, function(data) {
                        channel.send(data);
                    });
                }
                http_debug("http done");
                channel.control({ command: "done" });
            }

            /* Callbacks that want to stream or get headers */
            let streamer = null;
            let responsers = null;

            let resp = null;

            const buffer = channel.buffer(function(data) {
                /* Fire any streamers */
                if (resp && resp.status >= 200 && resp.status <= 299 && streamer)
                    return streamer.call(ret, data);
                return 0;
            });

            function on_control(event, options) {
                /* Anyone looking for response details? */
                if (options.command == "response") {
                    resp = options;
                    if (responsers) {
                        resp.headers = resp.headers || { };
                        invoke_functions(responsers, ret, [resp.status, resp.headers]);
                    }
                }
            }

            function on_close(event, options) {
                const pos = active_requests.indexOf(ret);
                if (pos >= 0)
                    active_requests.splice(pos, 1);

                if (options.problem) {
                    http_debug("http problem: ", options.problem);
                    dfd.reject(new BasicError(options.problem));
                } else {
                    const body = buffer.squash();

                    /* An error, fail here */
                    if (resp && (resp.status < 200 || resp.status > 299)) {
                        let message;
                        const type = find_header(resp.headers, "Content-Type");
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

                channel.removeEventListener("control", on_control);
                channel.removeEventListener("close", on_close);
            }

            channel.addEventListener("control", on_control);
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
                    iterate_data(message, function(data) {
                        channel.send(data);
                    });
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
                method: "GET",
                params,
                path,
                body: "",
                headers
            });
        };

        self.post = function post(path, body, headers) {
            headers = headers || { };

            if (is_plain_object(body) || Array.isArray(body)) {
                body = JSON.stringify(body);
                if (find_header(headers, "Content-Type") === undefined)
                    headers["Content-Type"] = "application/json";
            } else if (body === undefined || body === null) {
                body = "";
            } else if (typeof body !== "string") {
                body = String(body);
            }

            return self.request({
                method: "POST",
                path,
                body,
                headers
            });
        };

        self.close = function close(problem) {
            const reqs = active_requests.slice();
            for (let i = 0; i < reqs.length; i++)
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

    function check_superuser() {
        return new Promise((resolve, reject) => {
            const ch = cockpit.channel({ payload: "null", superuser: "require" });
            ch.wait()
                .then(() => resolve(true))
                .catch(() => resolve(false))
                .always(() => ch.close());
        });
    }

    function Permission(options) {
        const self = this;
        event_mixin(self, { });

        const api = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser", "/superuser");
        api.addEventListener("changed", maybe_reload);

        function maybe_reload() {
            if (api.valid && self.allowed !== null) {
                if (self.allowed != (api.Current != "none"))
                    window.location.reload(true);
            }
        }

        self.allowed = null;
        self.user = options ? options.user : null; // pre-fill for unit tests
        self.is_superuser = options ? options._is_superuser : null; // pre-fill for unit tests

        let group = null;
        let admin = false;

        if (options)
            group = options.group;

        if (options?.admin)
            admin = true;

        function decide(user) {
            if (user.id === 0)
                return true;

            if (group)
                return !!(user.groups || []).includes(group);

            if (admin)
                return self.is_superuser;

            if (user.id === undefined)
                return null;

            return false;
        }

        if (self.user && self.is_superuser !== null) {
            self.allowed = decide(self.user);
        } else {
            Promise.all([cockpit.user(), check_superuser()])
                .then(([user, is_superuser]) => {
                    self.user = user;
                    self.is_superuser = is_superuser;
                    const allowed = decide(user);
                    if (self.allowed !== allowed) {
                        self.allowed = allowed;
                        maybe_reload();
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

    function MetricsChannel(interval, options_list, cache) {
        const self = this;
        event_mixin(self, { });

        if (options_list.length === undefined)
            options_list = [options_list];

        const channels = [];
        let following = false;

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

            const options = {
                payload: "metrics1",
                interval,
                source: "internal",
                ...options_list[0]
            };

            delete options.archive_source;

            const channel = cockpit.channel(options);
            channels.push(channel);

            let meta = null;
            let last = null;
            let beg;

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
                const message = JSON.parse(payload);

                /* A meta message? */
                const message_len = message.length;
                if (message_len === undefined) {
                    meta = message;
                    let timestamp = 0;
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
                    for (let i = 0; i < message_len; i++) {
                        const data = message[i];
                        if (last) {
                            for (let j = 0; j < last.length; j++) {
                                const dataj = data[j];
                                if (dataj === null || dataj === undefined) {
                                    data[j] = last[j];
                                } else {
                                    const dataj_len = dataj.length;
                                    if (dataj_len !== undefined) {
                                        const lastj = last[j];
                                        const lastj_len = last[j].length;
                                        let k;
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
            /* Generate a mapping object if necessary */
            let mapping = meta.mapping;
            if (!mapping) {
                mapping = { };
                meta.metrics.forEach(function(metric, i) {
                    const map = { "": i };
                    const name = options.metrics_path_names?.[i] ?? metric.name;
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
            const timestamp = beg * interval - Date.now();
            const limit = end - beg;

            const archive_options_list = [];
            for (let i = 0; i < options_list.length; i++) {
                if (options_list[i].archive_source) {
                    archive_options_list.push({
                                                   ...options_list[i],
                                                   source: options_list[i].archive_source,
                                                   timestamp,
                                                   limit
                                              });
                }
            }

            transfer(archive_options_list, drain, true);
        };

        self.follow = function follow() {
            transfer(options_list, drain);
        };

        self.close = function close(options) {
            const len = channels.length;
            if (self.series)
                self.series.close();

            for (let i = 0; i < len; i++)
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

    const old_onerror = window.onerror;
    window.onerror = function(msg, url, line) {
        // Errors with url == "" are not logged apparently, so let's
        // not show the "Oops" for them either.
        if (url != "")
            cockpit.oops();
        if (old_onerror)
            return old_onerror(msg, url, line);
        return false;
    };

    cockpit.assert = (predicate, message) => {
        if (!predicate) {
            throw new Error(`Assertion failed: ${message}`);
        }
    };

    return cockpit;
}

// Register cockpit object as global, so that it can be used without ES6 modules
// we need to do that here instead of in pkg/base1/cockpit.js, so that po.js can access cockpit already
window.cockpit = factory();

export default window.cockpit;
