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

/* [module]
 * import Util from "./util";
 * import Base64 from "./base64";
 */

/*jslint browser: true, bitwise: true */
/*global Util*/

/* [module] export default */ function Websock() {
    "use strict";

    this._websocket = null;  // WebSocket object

    this._rQi = 0;           // Receive queue index
    this._rQlen = 0;         // Next write position in the receive queue
    this._rQbufferSize = 1024 * 1024 * 4; // Receive queue buffer size (4 MiB)
    this._rQmax = this._rQbufferSize / 8;
    // called in init: this._rQ = new Uint8Array(this._rQbufferSize);
    this._rQ = null; // Receive queue

    this._sQbufferSize = 1024 * 10;  // 10 KiB
    // called in init: this._sQ = new Uint8Array(this._sQbufferSize);
    this._sQlen = 0;
    this._sQ = null;  // Send queue

    this._mode = 'binary';    // Current WebSocket mode: 'binary', 'base64'
    this.maxBufferedAmount = 200;

    this._eventHandlers = {
        'message': function () {},
        'open': function () {},
        'close': function () {},
        'error': function () {}
    };
};

(function () {
    "use strict";
    // this has performance issues in some versions Chromium, and
    // doesn't gain a tremendous amount of performance increase in Firefox
    // at the moment.  It may be valuable to turn it on in the future.
    var ENABLE_COPYWITHIN = false;

    var MAX_RQ_GROW_SIZE = 40 * 1024 * 1024;  // 40 MiB

    var typedArrayToString = (function () {
        // This is only for PhantomJS, which doesn't like apply-ing
        // with Typed Arrays
        try {
            var arr = new Uint8Array([1, 2, 3]);
            String.fromCharCode.apply(null, arr);
            return function (a) { return String.fromCharCode.apply(null, a); };
        } catch (ex) {
            return function (a) {
                return String.fromCharCode.apply(
                    null, Array.prototype.slice.call(a));
            };
        }
    })();

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
            return this._rQlen - this._rQi;
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

        // TODO(directxman12): test performance with these vs a DataView
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
            var arr = new Uint8Array(this._rQ.buffer, this._rQi, len);
            this._rQi += len;
            return typedArrayToString(arr);
        },

        rQshiftBytes: function (len) {
            if (typeof(len) === 'undefined') { len = this.rQlen(); }
            this._rQi += len;
            return new Uint8Array(this._rQ.buffer, this._rQi - len, len);
        },

        rQshiftTo: function (target, len) {
            if (len === undefined) { len = this.rQlen(); }
            // TODO: make this just use set with views when using a ArrayBuffer to store the rQ
            target.set(new Uint8Array(this._rQ.buffer, this._rQi, len));
            this._rQi += len;
        },

        rQwhole: function () {
            return new Uint8Array(this._rQ.buffer, 0, this._rQlen);
        },

        rQslice: function (start, end) {
            if (end) {
                return new Uint8Array(this._rQ.buffer, this._rQi + start, end - start);
            } else {
                return new Uint8Array(this._rQ.buffer, this._rQi + start, this._rQlen - this._rQi - start);
            }
        },

        // Check to see if we must wait for 'num' bytes (default to FBU.bytes)
        // to be available in the receive queue. Return true if we need to
        // wait (and possibly print a debug message), otherwise false.
        rQwait: function (msg, num, goback) {
            var rQlen = this._rQlen - this._rQi; // Skip rQlen() function call
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
                if (this._sQlen > 0 && this._websocket.readyState === WebSocket.OPEN) {
                    this._websocket.send(this._encode_message());
                    this._sQlen = 0;
                }

                return true;
            } else {
                Util.Info("Delaying send, bufferedAmount: " +
                        this._websocket.bufferedAmount);
                return false;
            }
        },

        send: function (arr) {
            this._sQ.set(arr, this._sQlen);
            this._sQlen += arr.length;
            return this.flush();
        },

        send_string: function (str) {
            this.send(str.split('').map(function (chr) {
                return chr.charCodeAt(0);
            }));
        },

        // Event Handlers
        off: function (evt) {
            this._eventHandlers[evt] = function () {};
        },

        on: function (evt, handler) {
            this._eventHandlers[evt] = handler;
        },

        _allocate_buffers: function () {
            this._rQ = new Uint8Array(this._rQbufferSize);
            this._sQ = new Uint8Array(this._sQbufferSize);
        },

        init: function (protocols, ws_schema) {
            this._allocate_buffers();
            this._rQi = 0;
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
                protocols = 'binary';
            }

            if (Array.isArray(protocols) && protocols.indexOf('binary') > -1) {
                protocols = 'binary';
            }

            if (!wsbt) {
                throw new Error("noVNC no longer supports base64 WebSockets.  " +
                                "Please use a browser which supports binary WebSockets.");
            }

            if (protocols != 'binary') {
                throw new Error("noVNC no longer supports base64 WebSockets.  Please " +
                                "use the binary subprotocol instead.");
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
                    this._mode = 'binary';
                    Util.Error('Server select no sub-protocol!: ' + this._websocket.protocol);
                }

                if (this._mode != 'binary') {
                    throw new Error("noVNC no longer supports base64 WebSockets.  Please " +
                                    "use the binary subprotocol instead.");

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
            // Put in a binary arraybuffer
            // according to the spec, you can send ArrayBufferViews with the send method
            return new Uint8Array(this._sQ.buffer, 0, this._sQlen);
        },

        _expand_compact_rQ: function (min_fit) {
            var resizeNeeded = min_fit || this._rQlen - this._rQi > this._rQbufferSize / 2;
            if (resizeNeeded) {
                if (!min_fit) {
                    // just double the size if we need to do compaction
                    this._rQbufferSize *= 2;
                } else {
                    // otherwise, make sure we satisy rQlen - rQi + min_fit < rQbufferSize / 8
                    this._rQbufferSize = (this._rQlen - this._rQi + min_fit) * 8;
                }
            }

            // we don't want to grow unboundedly
            if (this._rQbufferSize > MAX_RQ_GROW_SIZE) {
                this._rQbufferSize = MAX_RQ_GROW_SIZE;
                if (this._rQbufferSize - this._rQlen - this._rQi < min_fit) {
                    throw new Exception("Receive Queue buffer exceeded " + MAX_RQ_GROW_SIZE + " bytes, and the new message could not fit");
                }
            }

            if (resizeNeeded) {
                var old_rQbuffer = this._rQ.buffer;
                this._rQmax = this._rQbufferSize / 8;
                this._rQ = new Uint8Array(this._rQbufferSize);
                this._rQ.set(new Uint8Array(old_rQbuffer, this._rQi));
            } else {
                if (ENABLE_COPYWITHIN) {
                    this._rQ.copyWithin(0, this._rQi);
                } else {
                    this._rQ.set(new Uint8Array(this._rQ.buffer, this._rQi));
                }
            }

            this._rQlen = this._rQlen - this._rQi;
            this._rQi = 0;
        },

        _decode_message: function (data) {
            // push arraybuffer values onto the end
            var u8 = new Uint8Array(data);
            if (u8.length > this._rQbufferSize - this._rQlen) {
                this._expand_compact_rQ(u8.length);
            }
            this._rQ.set(u8, this._rQlen);
            this._rQlen += u8.length;
        },

        _recv_message: function (e) {
            try {
                this._decode_message(e.data);
                if (this.rQlen() > 0) {
                    this._eventHandlers.message();
                    // Compact the receive queue
                    if (this._rQlen == this._rQi) {
                        this._rQlen = 0;
                        this._rQi = 0;
                    } else if (this._rQlen > this._rQmax) {
                        this._expand_compact_rQ();
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
