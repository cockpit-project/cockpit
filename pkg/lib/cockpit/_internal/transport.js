import { EventEmitter } from '../event';

import { calculate_application, calculate_url } from './location';
import { ParentWebSocket } from './parentwebsocket';

export const transport_globals = {
    default_transport: null,
    reload_after_disconnect: false,
    expect_disconnect: false,
    init_callback: null,
    default_host: null,
    process_hints: null,
    incoming_filters: null,
    outgoing_filters: null,
};

window.addEventListener('beforeunload', () => {
    transport_globals.expect_disconnect = true;
}, false);

function transport_debug(...args) {
    if (window.debugging == "all" || window.debugging?.includes("channel"))
        console.debug(...args);
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
    #last_channel = 0;
    #channel_seed = "";
    #ws;
    #ignore_health_check = false;
    #got_message = false;
    #check_health_timer;
    #control_cbs = {};
    #message_cbs = {};
    #waiting_for_init = true;

    constructor() {
        super();

        this.application = calculate_application();

        if (window.mock)
            window.mock.last_transport = this;

        /* See if we should communicate via parent */
        if (window.parent !== window && window.name.indexOf("cockpit1:") === 0) {
            this.#ws = new ParentWebSocket(window.parent);
        } else {
            const ws_loc = calculate_url();
            transport_debug("connecting to " + ws_loc);
            this.#ws = new WebSocket(ws_loc, "cockpit1");

            this.#check_health_timer = window.setInterval(() => {
                if (this.ready)
                    this.#ws.send("\n{ \"command\": \"ping\" }");
                if (!this.#got_message) {
                    if (this.#ignore_health_check) {
                        console.log("health check failure ignored");
                    } else {
                        console.log("health check failed");
                        this.close({ problem: "timeout" });
                    }
                }
                this.#got_message = false;
            }, 30000);
        }

        this.ready = false;

        this.#ws.onopen = () => {
            if (this.#ws) {
                if (typeof this.#ws.binaryType !== "undefined")
                    this.#ws.binaryType = "arraybuffer";
                this.#ws.send("\n{ \"command\": \"init\", \"version\": 1 }");
            }
        };

        this.#ws.onclose = () => {
            transport_debug("WebSocket onclose");
            this.#ws = null;
            if (transport_globals.reload_after_disconnect) {
                transport_globals.expect_disconnect = true;
                window.location.reload(true);
            }
            this.close();
        };

        this.#ws.onmessage = event => this.dispatch_data(event);
    }

    /* Called when ready for channels to interact */
    #ready_for_channels() {
        if (!this.ready) {
            this.ready = true;
            this.emit("ready");
        }
    }

    #process_init(options) {
        if (options.problem) {
            this.close({ problem: options.problem });
            return;
        }

        if (options.version !== 1) {
            console.error("received unsupported version in init message: " + options.version);
            this.close({ problem: "not-supported" });
            return;
        }

        if (options["channel-seed"])
            this.#channel_seed = String(options["channel-seed"]);
        if (options.host)
            transport_globals.default_host = options.host;

        if (transport_globals.init_callback)
            transport_globals.init_callback(options);

        if (this.#waiting_for_init) {
            this.#waiting_for_init = false;
            this.#ready_for_channels();
        }
    }

    #process_control(data) {
        const channel = data.channel;

        /* Init message received */
        if (data.command == "init") {
            this.#process_init(data);
        } else if (this.#waiting_for_init) {
            this.#waiting_for_init = false;
            if (data.command != "close" || channel) {
                console.error("received message before init: ", data.command);
                data = { problem: "protocol-error" };
            }
            this.close(data);

            /* Any pings get sent back as pongs */
        } else if (data.command == "ping") {
            data.command = "pong";
            this.send_control(data);
        } else if (data.command == "pong") {
            /* Any pong commands are ignored */
        } else if (data.command == "hint") {
            if (transport_globals.process_hints)
                transport_globals.process_hints(data);
        } else if (channel !== undefined) {
            const func = this.#control_cbs[channel];
            if (func)
                func(data);
        }
    }

    #process_message(channel, payload) {
        const func = this.#message_cbs[channel];
        if (func)
            func(payload);
    }

    dispatch_data(arg) {
        this.#got_message = true;

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
            this.#process_control(control);

        else
            this.#process_message(channel, payload);

        return true;
    }

    close(options) {
        if (!options)
            options = { problem: "disconnected" };
        options.command = "close";
        window.clearInterval(this.#check_health_timer);
        const ows = this.#ws;
        this.#ws = null;
        if (ows)
            ows.close();
        if (transport_globals.expect_disconnect)
            return;
        this.#ready_for_channels(); /* ready to fail */

        /* Broadcast to everyone */
        for (const chan in this.#control_cbs)
            this.#control_cbs[chan].apply(null, [options]);
    }

    next_channel() {
        this.#last_channel++;
        return this.#channel_seed + String(this.#last_channel);
    }

    /* The channel/control arguments is used by filters, and auto-populated if necessary */
    send_data(data, channel, control) {
        if (!this.#ws) {
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

        this.#ws.send(data);
        return true;
    }

    /* The control arguments is used by filters, and auto populated if necessary */
    send_message(payload, channel, control) {
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
            return this.send_data(output.buffer, channel, control);
        } else {
            /* A string message */
            return this.send_data(channel.toString() + "\n" + payload, channel, control);
        }
    }

    send_control(data) {
        if (!this.#ws && (data.command == "close" || data.command == "kill"))
            return; /* don't complain if closed and closing */
        if (this.#check_health_timer &&
            data.command == "hint" && data.hint == "ignore_transport_health_check") {
            /* This is for us, process it directly. */
            this.#ignore_health_check = data.data;
            return;
        }
        return this.send_message(JSON.stringify(data), "", data);
    }

    register(channel, control_cb, message_cb) {
        this.#control_cbs[channel] = control_cb;
        this.#message_cbs[channel] = message_cb;
    }

    unregister(channel) {
        delete this.#control_cbs[channel];
        delete this.#message_cbs[channel];
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
window.addEventListener("unload", () => {
    if (transport_globals.default_transport)
        transport_globals.default_transport.close();
});
