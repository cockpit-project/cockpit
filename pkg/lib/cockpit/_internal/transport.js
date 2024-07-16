import { EventEmitter } from '../event';

import { calculate_application, calculate_url } from './location';
import { ParentWebSocket } from './parentwebsocket';

class TransportGlobals {
    default_transport = null;
    reload_after_disconnect = false;
    expect_disconnect = false;
    init_callback = null;
    default_host = null;
    process_hints = null;
    incoming_filters = [];
}

export const transport_globals = new TransportGlobals();

window.addEventListener('beforeunload', () => {
    transport_globals.expect_disconnect = true;
}, false);

function transport_debug(...args) {
    if (window.debugging == "all" || window.debugging?.includes("channel"))
        console.debug(...args);
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
        if (typeof options.host === 'string')
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
        } else if (typeof channel === 'string') {
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

    /** @param arg{MessageEvent<string | ArrayBuffer>} */
    dispatch_data(arg) {
        this.#got_message = true;

        const message = arg.data;
        let channel;
        let control = null;
        let payload = null;

        if (message instanceof ArrayBuffer) {
            /* Binary message */
            const frame = new window.Uint8Array(message);
            const nl = frame.indexOf(10);

            channel = new TextDecoder().decode(frame.subarray(0, nl));
            if (!channel) {
                console.warn('Received invalid binary message without a channel');
                return false;
            }

            payload = frame.subarray(nl + 1);
            transport_debug("recv binary message:", control, payload);
        } else {
            const nl = message.indexOf('\n');
            channel = message.substring(0, nl);
            if (nl == 0) {
                control = JSON.parse(message);
                transport_debug("recv control:", control);
            } else {
                payload = message.substring(nl + 1);
                transport_debug("recv text message:", control, payload);
            }
        }

        for (const filter of transport_globals.incoming_filters)
            if (filter(message, channel, control) === false)
                return false;

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

    send_data(data) {
        if (!this.#ws) {
            return false;
        }
        this.#ws.send(data);
        return true;
    }

    send_message(payload, channel) {
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
            return this.send_data(output.buffer);
        } else {
            /* A string message */
            return this.send_data(channel.toString() + "\n" + payload);
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
        return this.send_message(JSON.stringify(data), "");
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
