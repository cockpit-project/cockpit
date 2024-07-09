import { join_data } from './common';
import { Deferred } from './deferred';
import { event_mixin } from './event-mixin';
import { ensure_transport, transport_globals } from './transport';

/* -------------------------------------------------------------------------
 * Channels
 *
 * Public: https://cockpit-project.org/guide/latest/api-base1.html
 */

export function Channel(options) {
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
            if (transport_globals.default_host)
                command.host = transport_globals.default_host;
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
            waiting = new Deferred();
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
