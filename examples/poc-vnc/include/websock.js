/*
 * Websock: high-performance binary WebSockets
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * Websock is similar to the standard WebSocket object but Websock
 * enables communication with raw TCP sockets (i.e. the binary stream)
 * via websockify. This is accomplished by base64 encoding the data
 * stream between Websock and websockify.
 *
 * Websock has built-in receive queue buffering; the message event
 * does not contain actual data but is simply a notification that
 * there is new data available. Several rQ* methods are available to
 * read binary data off of the receive queue.
 */

/*jslint browser: true, bitwise: true */
/*global Util, Base64 */


// Load Flash WebSocket emulator if needed

// To force WebSocket emulator even when native WebSocket available
//window.WEB_SOCKET_FORCE_FLASH = true;
// To enable WebSocket emulator debug:
//window.WEB_SOCKET_DEBUG=1;

if (window.WebSocket && !window.WEB_SOCKET_FORCE_FLASH) {
    Websock_native = true;
} else if (window.MozWebSocket && !window.WEB_SOCKET_FORCE_FLASH) {
    Websock_native = true;
    window.WebSocket = window.MozWebSocket;
} else {
    /* no builtin WebSocket so load web_socket.js */

    Websock_native = false;
    (function () {
        window.WEB_SOCKET_SWF_LOCATION = Util.get_include_uri() +
                    "web-socket-js/WebSocketMain.swf";
        if (Util.Engine.trident) {
            Util.Debug("Forcing uncached load of WebSocketMain.swf");
            window.WEB_SOCKET_SWF_LOCATION += "?" + Math.random();
        }
        Util.load_scripts(["web-socket-js/swfobject.js",
                           "web-socket-js/web_socket.js"]);
    })();
}


function Websock() {
    "use strict";

    this._websocket = null;  // WebSocket object
    this._rQ = [];           // Receive queue
    this._rQi = 0;           // Receive queue index
    this._rQmax = 10000;     // Max receive queue size before compacting
    this._sQ = [];           // Send queue

    this._mode = 'base64';    // Current WebSocket mode: 'binary', 'base64'
    this.maxBufferedAmount = 200;

    this._eventHandlers = {
        'message': function () {},
        'open': function () {},
        'close': function () {},
        'error': function () {}
    };
}

(function () {
    "use strict";
    Websock.prototype = {
        // Getters and Setters
        get_sQ: function () {
            return this._sQ;
        },

        get_rQ: function () {
            return this._rQ;
        },

        get_rQi: function () {
            return this._rQi;
        },

        set_rQi: function (val) {
            this._rQi = val;
        },

        // Receive Queue
        rQlen: function () {
            return this._rQ.length - this._rQi;
        },

        rQpeek8: function () {
            return this._rQ[this._rQi];
        },

        rQshift8: function () {
            return this._rQ[this._rQi++];
        },

        rQskip8: function () {
            this._rQi++;
        },

        rQskipBytes: function (num) {
            this._rQi += num;
        },

        rQunshift8: function (num) {
            if (this._rQi === 0) {
                this._rQ.unshift(num);
            } else {
                this._rQi--;
                this._rQ[this._rQi] = num;
            }
        },

        rQshift16: function () {
            return (this._rQ[this._rQi++] << 8) +
                   this._rQ[this._rQi++];
        },

        rQshift32: function () {
            return (this._rQ[this._rQi++] << 24) +
                   (this._rQ[this._rQi++] << 16) +
                   (this._rQ[this._rQi++] << 8) +
                   this._rQ[this._rQi++];
        },

        rQshiftStr: function (len) {
            if (typeof(len) === 'undefined') { len = this.rQlen(); }
            var arr = this._rQ.slice(this._rQi, this._rQi + len);
            this._rQi += len;
            return String.fromCharCode.apply(null, arr);
        },

        rQshiftBytes: function (len) {
            if (typeof(len) === 'undefined') { len = this.rQlen(); }
            this._rQi += len;
            return this._rQ.slice(this._rQi - len, this._rQi);
        },

        rQslice: function (start, end) {
            if (end) {
                return this._rQ.slice(this._rQi + start, this._rQi + end);
            } else {
                return this._rQ.slice(this._rQi + start);
            }
        },

        // Check to see if we must wait for 'num' bytes (default to FBU.bytes)
        // to be available in the receive queue. Return true if we need to
        // wait (and possibly print a debug message), otherwise false.
        rQwait: function (msg, num, goback) {
            var rQlen = this._rQ.length - this._rQi; // Skip rQlen() function call
            if (rQlen < num) {
                if (goback) {
                    if (this._rQi < goback) {
                        throw new Error("rQwait cannot backup " + goback + " bytes");
                    }
                    this._rQi -= goback;
                }
                return true; // true means need more data
            }
            return false;
        },

        // Send Queue

        flush: function () {
            if (this._websocket.bufferedAmount !== 0) {
                Util.Debug("bufferedAmount: " + this._websocket.bufferedAmount);
            }

            if (this._websocket.bufferedAmount < this.maxBufferedAmount) {
                if (this._sQ.length > 0) {
                    this._websocket.send(this._encode_message());
                    this._sQ = [];
                }

                return true;
            } else {
                Util.Info("Delaying send, bufferedAmount: " +
                        this._websocket.bufferedAmount);
                return false;
            }
        },

        send: function (arr) {
           this._sQ = this._sQ.concat(arr);
           return this.flush();
        },

        send_string: function (str) {
            this.send(str.split('').map(function (chr) {
                return chr.charCodeAt(0);
            }));
        },

        // Event Handlers
        on: function (evt, handler) {
            this._eventHandlers[evt] = handler;
        },

        init: function (protocols, ws_schema) {
            this._rQ = [];
            this._rQi = 0;
            this._sQ = [];
            this._websocket = null;

            // Check for full typed array support
            var bt = false;
            if (('Uint8Array' in window) &&
                    ('set' in Uint8Array.prototype)) {
                bt = true;
            }

            // Check for full binary type support in WebSockets
            // Inspired by:
            // https://github.com/Modernizr/Modernizr/issues/370
            // https://github.com/Modernizr/Modernizr/blob/master/feature-detects/websockets/binary.js
            var wsbt = false;
            try {
                if (bt && ('binaryType' in WebSocket.prototype ||
                           !!(new WebSocket(ws_schema + '://.').binaryType))) {
                    Util.Info("Detected binaryType support in WebSockets");
                    wsbt = true;
                }
            } catch (exc) {
                // Just ignore failed test localhost connection
            }

            // Default protocols if not specified
            if (typeof(protocols) === "undefined") {
                if (wsbt) {
                    protocols = ['binary', 'base64'];
                } else {
                    protocols = 'base64';
                }
            }

            if (!wsbt) {
                if (protocols === 'binary') {
                    throw new Error('WebSocket binary sub-protocol requested but not supported');
                }

                if (typeof(protocols) === 'object') {
                    var new_protocols = [];

                    for (var i = 0; i < protocols.length; i++) {
                        if (protocols[i] === 'binary') {
                            Util.Error('Skipping unsupported WebSocket binary sub-protocol');
                        } else {
                            new_protocols.push(protocols[i]);
                        }
                    }

                    if (new_protocols.length > 0) {
                        protocols = new_protocols;
                    } else {
                        throw new Error("Only WebSocket binary sub-protocol was requested and is not supported.");
                    }
                }
            }

            return protocols;
        },

        open: function (uri, protocols) {
            var ws_schema = uri.match(/^([a-z]+):\/\//)[1];
            protocols = this.init(protocols, ws_schema);

            this._websocket = new WebSocket(uri, protocols);

            if (protocols.indexOf('binary') >= 0) {
                this._websocket.binaryType = 'arraybuffer';
            }

            this._websocket.onmessage = this._recv_message.bind(this);
            this._websocket.onopen = (function () {
                Util.Debug('>> WebSock.onopen');
                if (this._websocket.protocol) {
                    this._mode = this._websocket.protocol;
                    Util.Info("Server choose sub-protocol: " + this._websocket.protocol);
                } else {
                    this._mode = 'base64';
                    Util.Error('Server select no sub-protocol!: ' + this._websocket.protocol);
                }
                this._eventHandlers.open();
                Util.Debug("<< WebSock.onopen");
            }).bind(this);
            this._websocket.onclose = (function (e) {
                Util.Debug(">> WebSock.onclose");
                this._eventHandlers.close(e);
                Util.Debug("<< WebSock.onclose");
            }).bind(this);
            this._websocket.onerror = (function (e) {
                Util.Debug(">> WebSock.onerror: " + e);
                this._eventHandlers.error(e);
                Util.Debug("<< WebSock.onerror: " + e);
            }).bind(this);
        },

        close: function () {
            if (this._websocket) {
                if ((this._websocket.readyState === WebSocket.OPEN) ||
                        (this._websocket.readyState === WebSocket.CONNECTING)) {
                    Util.Info("Closing WebSocket connection");
                    this._websocket.close();
                }

                this._websocket.onmessage = function (e) { return; };
            }
        },

        // private methods
        _encode_message: function () {
            if (this._mode === 'binary') {
                // Put in a binary arraybuffer
                return (new Uint8Array(this._sQ)).buffer;
            } else {
                // base64 encode
                return Base64.encode(this._sQ);
            }
        },

        _decode_message: function (data) {
            if (this._mode === 'binary') {
                // push arraybuffer values onto the end
                var u8 = new Uint8Array(data);
                for (var i = 0; i < u8.length; i++) {
                    this._rQ.push(u8[i]);
                }
            } else {
                // base64 decode and concat to end
                this._rQ = this._rQ.concat(Base64.decode(data, 0));
            }
        },

        _recv_message: function (e) {
            try {
                this._decode_message(e.data);
                if (this.rQlen() > 0) {
                    this._eventHandlers.message();
                    // Compact the receive queue
                    if (this._rQ.length > this._rQmax) {
                        this._rQ = this._rQ.slice(this._rQi);
                        this._rQi = 0;
                    }
                } else {
                    Util.Debug("Ignoring empty message");
                }
            } catch (exc) {
                var exception_str = "";
                if (exc.name) {
                    exception_str += "\n    name: " + exc.name + "\n";
                    exception_str += "    message: " + exc.message + "\n";
                }

                if (typeof exc.description !== 'undefined') {
                    exception_str += "    description: " + exc.description + "\n";
                }

                if (typeof exc.stack !== 'undefined') {
                    exception_str += exc.stack;
                }

                if (exception_str.length > 0) {
                    Util.Error("recv_message, caught exception: " + exception_str);
                } else {
                    Util.Error("recv_message, caught exception: " + exc);
                }

                if (typeof exc.name !== 'undefined') {
                    this._eventHandlers.error(exc.name + ": " + exc.message);
                } else {
                    this._eventHandlers.error(exc);
                }
            }
        }
    };
})();
