/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

/*
 * API:
 *
 * cockpit.channel(options)
 *   @options: a dict of options used to open the channel.
 *     'host': the host to open the channel to
 *     'payload': the type of payload the channel messages will contain.
 *   Open a new channel. The channel is immediately ready to send()
 *   messages.
 *
 * channel.id
 *   The underlying protocol id for the channel.
 *
 * channel.options
 *   The options used to open this channel. See cockpit.channel().
 *
 * channel.valid
 *   Set to 'true' for an open channel. Set to 'false' when the channel
 *   closes.
 *
 * channel.send(message)
 *   @message: string message payload
 *   Sends a message over the channel. The contents of the message depends
 *   on the payload type of the channel.
 *
 * channel.close(options)
 *   @options: optonal, if 'reason' field set indicate the problem that occurred
 *   Closes a channel. Channels can also close if the other end closes
 *   or the underlying WebSocket transport closes.
 *
 * $(channel).on("message", function(message) { })
 *   @message: string message payload
 *   An event triggered when the channel receives a message. The contents
 *   of the message depends on the payload type of the channel.
 *
 * $(channel).on("close", function(options) { })
 *   @options: a short string reason code, or null
 *   An event triggered when the channel closes. This can happen either
 *   because channel.close() was called, or if the other end closed the
 *   channel, or the underlying WebSocket transport closes. @options will
 *   contain various close information, including a 'reason' field which
 *   will indicate a problem closing.
 *
 * cockpit.transport
 *   This object represents the underlying transport. It will be defined
 *   when a channel is created and open. It will automatically be cleared
 *   if the transport closes. Multiple channels share a transport.
 *
 * cockpit.transport.close()
 *   Explicitly close the underlying transport. This will close all open
 *   channels using this transport and cockpit.transport will be cleared.
 *
 * cockpit.transport.logout(disconnect)
 *   Discard login credentials and prevent them from being used to perform
 *   further actions that require credentials. If @disconnect is true, then
 *   also disconnect all user sessions.
 */

var phantom_checkpoint = phantom_checkpoint || function () { };

var cockpit = cockpit || { };

(function(cockpit, $) {

var last_channel = 10;

function Channel(options) {
    /* Choose a new channel id */
    last_channel++;
    var id = last_channel.toString();

    /* Find a valid transport */
    if (cockpit.transport) {
        this._init(id, cockpit.transport, options);
        return;
    }

    /* Private Transport class */
    function Transport() {
        var transport = this;

        function transport_debug() {
            if (cockpit.debugging == "all" || cockpit.debugging == "channel")
                console.debug.apply(console, arguments);
        }

        var ws_loc = cockpit.channel.calculate_url();
        if (!ws_loc)
            return;

        transport_debug("Connecting to " + ws_loc);

        if ("WebSocket" in window) {
            transport._ws = new WebSocket(ws_loc, "cockpit1");
        } else if ("MozWebSocket" in window) { // Firefox 6
            transport._ws = new MozWebSocket(ws_loc);
        } else {
            console.error("WebSocket not supported, application will not work!");
            return;
        }

        transport._queue = [];
        transport._control_cbs = { };
        transport._message_cbs = { };
        transport._got_message = false;

        transport._check_health_timer = window.setInterval(function () {
            if (!transport._got_message) {
                console.log("health check failed");
                transport.close("timeout");
            }
            transport._got_message = false;
        }, 10000);

        transport._ws.onopen = function() {
            while(transport._queue.length > 0 && transport._ws)
                transport._ws.send(transport._queue.shift());
        };

        transport._ws.onclose = function(event) {
            transport_debug("WebSocket onclose");
            transport._ws = null;
            transport.close("disconnected");
        };

        transport._ws.onmessage = function(event) {
            transport._got_message = true;

            /* The first line of a message is the channel */
            var data = event.data;
            var pos = data.indexOf("\n");
            var channel = data.substring(0, pos);
            var payload = data.substring(pos + 1);
            if (!channel) {
                transport_debug("recv control:", payload);
                transport._process_control(JSON.parse(payload));
            } else {
                transport_debug("recv " + channel + ":", payload);
                transport._process_message(channel, payload);
            }
            phantom_checkpoint();
        };

        this.close = function(reason) {
            if (this === cockpit.transport)
                cockpit.transport = null;
            clearInterval(this._check_health_timer);
            var ws = this._ws;
            this._ws = null;
            if (ws)
                ws.close();
            this._process_control({ "command": "close", "reason": reason });
        };

        this.logout = function(disconnect) {
            this._send_control({ "command": "logout", "disconnect": !!disconnect });
        };

        this._process_control = function(data) {
            var channel = data.channel;
            var func;

            /* 'ping' messages are ignored */
            if (data.command == "ping")
                return;

            /* Broadcast to everyone if no channel */
            if (channel === undefined) {
                for (var chan in transport._control_cbs) {
                    func = transport._control_cbs[chan];
                    func.apply(null, [data]);
                }
            } else {
                func = transport._control_cbs[channel];
                if (func)
                    func.apply(null, [data]);
            }
        };

        this._process_message = function(channel, payload) {
            var func = transport._message_cbs[channel];
            if (func)
                func.apply(null, [payload]);
        };

        this._send_message = function(channel, payload) {
            if (!this._ws) {
                console.log("transport closed, dropped message: " + payload);
                return;
            }
            if (channel)
                transport_debug("send " + channel + ":", payload);
            else
                transport_debug("send control:", payload);
            var msg = channel.toString() + "\n" + payload;
            if (this._ws.readyState == 1)
                this._ws.send(msg);
            else
                this._queue.push(msg);
        };

        this._send_control = function(data) {
            if(!this._ws && data.command == "close")
                return; /* don't complain if closed and closing */
            this._send_message("", JSON.stringify(data));
        };

        this._register = function(channel, control_cb, message_cb) {
            this._control_cbs[channel] = control_cb;
            this._message_cbs[channel] = message_cb;
        };

        this._unregister = function(channel) {
            delete this._control_cbs[channel];
            delete this._message_cbs[channel];
        };
    }

    /* Instantiate the transport singleton */
    cockpit.transport = new Transport();
    this._init(id, cockpit.transport, options);
}

Channel.prototype = {
    _init: function(id, transport, options) {
        this.id = id;
        this._transport = transport;
        this.options = options;
        this.valid = true;

        /* Register channel handlers */
        var channel = this;
        function on_message(payload) {
            $(channel).triggerHandler("message", payload);
        }
        function on_control(data) {
            if (data.command == "close") {
                channel.valid = false;
                transport._unregister(channel.id);
                $(channel).triggerHandler("close", data);
            } else {
                console.log("unhandled control message: '" + data.command + "'");
            }
        }
        transport._register(id, on_control, on_message);

        /* Now open the channel */
        var command = {
            "command" : "open",
            "channel": id
        };
        $.extend(command, options);
        transport._send_control(command);
    },

    send: function(message) {
        if (this.valid)
            this._transport._send_message(this.id, message);
        else
            console.log("sending message on closed channel: " + this);
    },

    close: function(options) {
        this.valid = false;
        if (!options)
            options = { };
        else if (!$.isPlainObject(options))
            options = { "reason" : options + "" };
        $.extend(options, {
            "command" : "close",
            "channel": this.id
        });
        this._transport._send_control(options);
        this._transport._unregister(this.id);
        $(this).triggerHandler("close", options);
    },

    toString : function() {
        var host = this.options["host"] || "localhost";
        return "[Channel " + (this.valid ? this.id : "<invalid>") + " -> " + host + "]";
    }
};

cockpit.channel = function channel(options) {
    return new Channel(options);
};

cockpit.channel.calculate_url = function calculate_url() {
    var window_loc = window.location.toString();
    if (window_loc.indexOf('http:') === 0) {
        return "ws://" + window.location.host + "/socket";
    } else if (window_loc.indexOf('https:') === 0) {
        return "wss://" + window.location.host + "/socket";
    } else {
        console.error("Cockpit must be used over http or https");
        return null;
    }
};

})(cockpit, jQuery);
