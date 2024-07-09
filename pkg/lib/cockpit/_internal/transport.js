import { EventEmitter } from '../event';

import { calculate_application, calculate_url } from './location';
import { ParentWebSocket } from './parentwebsocket';

export const transport_globals = {
    default_transport: null,
    public_transport: null,
    reload_after_disconnect: false,
    expect_disconnect: false,
    init_callback: null,
    default_host: null,
    process_hints: null,
    incoming_filters: null,
    outgoing_filters: null,
};

window.addEventListener('beforeunload', function() {
    transport_globals.expect_disconnect = true;
}, false);

function transport_debug() {
    if (window.debugging == "all" || window.debugging?.includes("channel"))
        console.debug.apply(console, arguments);
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
/** @extends EventEmitter<{ ready(): void }> */
class Transport extends EventEmitter {
    constructor() {
        super();

        const self = this;
        self.application = calculate_application();

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

            check_health_timer = window.setInterval(function() {
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

        const control_cbs = {};
        const message_cbs = {};
        let waiting_for_init = true;
        self.ready = false;

        /* Called when ready for channels to interact */
        function ready_for_channels() {
            if (!self.ready) {
                self.ready = true;
                self.emit("ready");
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
            if (transport_globals.reload_after_disconnect) {
                transport_globals.expect_disconnect = true;
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

            const length = transport_globals.incoming_filters ? transport_globals.incoming_filters.length : 0;
            for (let i = 0; i < length; i++) {
                if (transport_globals.incoming_filters[i](message, channel, control) === false)
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
            if (transport_globals.expect_disconnect)
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
                transport_globals.default_host = options.host;

            if (transport_globals.public_transport) {
                transport_globals.public_transport.options = options;
                transport_globals.public_transport.csrf_token = options["csrf-token"];
                transport_globals.public_transport.host = transport_globals.default_host;
            }

            if (transport_globals.init_callback)
                transport_globals.init_callback(options);

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
                if (transport_globals.process_hints)
                    transport_globals.process_hints(data);
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

            const length = transport_globals.outgoing_filters ? transport_globals.outgoing_filters.length : 0;
            for (let i = 0; i < length; i++) {
                if (channel === undefined)
                    channel = parse_channel(data);
                if (!channel && control === undefined)
                    control = JSON.parse(data);
                if (transport_globals.outgoing_filters[i](data, channel, control) === false)
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

            if (typeof payload !== 'string') {
                /* A binary message */
                const body = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload;

                // We want to create channel + '\n' + body in binary
                const header = new TextEncoder().encode(`${channel}\n`);
                const output = new Uint8Array(header.length + body.length);
                output.set(header);
                output.set(body, header.length);
                return self.send_data(output.buffer, channel, control);
            } else {
                /* A string message */
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
}

export function ensure_transport(callback) {
    if (!transport_globals.default_transport)
        transport_globals.default_transport = new Transport();
    const transport = transport_globals.default_transport;
    if (transport.ready) {
        callback(transport);
    } else {
        transport.on("ready", () => {
            callback(transport);
        });
    }
}

/* Always close the transport explicitly: allows parent windows to track us */
window.addEventListener("unload", function() {
    if (transport_globals.default_transport)
        transport_globals.default_transport.close();
});
