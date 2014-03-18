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

/*
 * API: defined in $cockpit namespace
 *
 * $cockpit.rest(endpoint, [machine], [options])
 *   @endpoint: a unix socket that looks like 'unix:///path/to/sock'
 *   @machine: optional, a host name of the machine to connect to
 *   @options: optional, a plain object of additional channel options
 *   Opens a REST JSON client and can be used with the following operations. These
 *   requests travel over the channels provided by channel.js.
 *   Returns: a new Rest() object, see below
 *
 * Rest.get(path, params)
 *   @path: an HTTP path starting with a slash
 *   @params: optional, a plain object of additional query params
 *   Makes a REST JSON GET request to the specified HTTP path.
 *   Returns: a jQuery deferred promise. See below.
 *
 *     $cockpit.rest("unix:///var/run/docker.sock")
 *          .get("/containers/json")
 *              .done(function(resp) {
 *                  console.log(resp);
 *              })
 *              .fail(function(ex) {
 *                  console.warn(ex);
 *              });
 *
 * Rest.getraw(path, params)
 *   Same as Rest.get but doesn't parse the response body as JSON.
 *
 * Rest.del(path, params)
 *   See .get() method above. Behaves identically except for makes a DELETE
 *   HTTP request.
 *
 * Rest.post(path, params)
 *   @path: an HTTP path starting with a slash, optionally with query string
 *   @params: optional, a plain object which will be encoded as JSON
 *   Makes a REST JSON POST request as application/json to the specified
 *   HTTP path.
 *   Returns: a jQuery deferred promise. See below.
 *
 * Deferred promise (return values)
 *   The return values from .get(), .post() and similar methods are jQuery
 *   deferred promises. You can call various functions on these in order
 *   to handle the responses. In addition there is an extra .stream()
 *   method.
 *      .done(function(resp) { }): called when REST operation completes
 *             and @resp will be the parsed JSON returned, or null if
 *             nothing was returned.
 *      .fail(function(ex) { }): called if the operation fails, with
 *             @ex.problem as a standard cockpit error code and @ex.status
 *             as an HTTP code.
 *      .always(function() { }): called when the operation fails or
 *             completes. Use this.state() to see what happened.
 *      .stream(function(resp) { }): if a handler is attached to the
 *             .stream() method then the response switches into streaming
 *             mode and it is expected that the REST endpoint will return
 *             multiple JSON snippets. callback will be called mulitple
 *             times and the .done() callback will get null.
 *
 * RestError
 *   Errors passd to the deferred .fail function will be of this class
 *   and have the following properties:
 *      .status: an HTTP status code, or zero if not an HTTP error
 *      .message: an HTTP message
 *      .problem: a Cockpit style problem code, mapped from the HTTP
 *             status where possible.
 */

var $cockpit = $cockpit || { };

(function($cockpit, $) {
    "use strict";

    /* Translates HTTP error codes to Cockpit codes */
    function RestError(arg0, arg1) {
        var status = parseInt(arg0, 10);
        if (isNaN(status)) {
            this.problem = arg0;
            this.status = 0;
            this.message = arg1 || arg0;
        } else {
            this.status = status;
            this.message = arg1;
            if (status == 400)
                this.problem = "protocol-error";
            else if (status == 401 || status == 403)
                this.problem = "not-authorized";
            else
                this.problem = "internal-error";
        }

        this.valueOf = function() {
            if (this.status === 0)
                return this.problem;
            else
                return this.status;
        };
        this.toString = function() {
            if (this.status === 0)
                return this.problem;
            else
                return this.status + " " + this.message;
        };
    }

    function ChannelPool(options) {
        var max_idle = 3;
        var channels = [ ];
        options["payload"] = "text-stream";
        this.checkout = function() {
            var channel = channels.shift();
            if (!channel || !channel.valid) {
                channel = new Channel(options);
            }
            return channel;
        };

        this.checkin = function(channel) {
            $(channel).off("message").off("close");
            if (channel.valid && channels.length < 3) {
                channel.close();
            } else {
                channels.push(channel);
            }
        };
    }

    function rest_debug() {
        /* console.debug.apply(console, arguments); */
    }

    function build_http_request(args) {
        var path = args["path"] || "/";
        var method = args["method"] || "GET";
        var params = args["params"];
        var body = "";

        var headers = [
            "Connection: keep-alive"
        ];

        if (method === "POST") {
            if (params) {
                body = JSON.stringify(params);
                headers.push("Content-Type: application/json; charset=utf-8");
            }
        } else {
            if (params)
                path += "?" + $.param(params);
        }

        headers.push("Content-Length: " + body.length);

        /* We can't handle HTTP/1.1 responses to chunked encoding */
        headers.unshift(method + " " + path + " HTTP/1.0");
        var request = headers.join("\r\n") + "\r\n\r\n" + body;
        rest_debug("rest request:", request);
        return request;
    }

    function process_json(body) {
        if (body === null || body === "")
            return null; /* no response */
        try {
            return $.parseJSON(body);
        } catch (ex) {
            console.log("Received bad JSON: ", ex);
            throw new RestError("protocol-error");
        }
    }

    function process_raw(body) {
        return body;
    }

    function parse_http_headers(state) {
        var pos = state.buffer.indexOf("\r\n\r\n");
        if (pos == -1)
            return; /* no headers yet */

        state.headers = { };
        var lines = state.buffer.substring(0, pos).split("\r\n");
        state.buffer = state.buffer.substring(pos + 4);
        var num = 0;
        $(lines).each(function(i, line) {
            if (i === 0) {
                var parts = line.split(/\s+/);
                var version = parts.shift();
                var status = parts.shift();
                var message = parts.join(" ");

                /* Check the http status is something sane */
                if (status < 200 || status > 299) {
                     console.warn(status, message);
                     throw new RestError(status, message);
                }

                /* Parse version after status, in case status has more info */
                if (!version.match(/http\/1\.0/i)) {
                     console.warn("Got unsupported HTTP version:", version);
                     throw new RestError("protocol-error");
                }
            } else {
                var lp = line.indexOf(":");
                if (lp == -1) {
                    console.warn("Invalid HTTP header without colon:", line);
                    throw new RestError("protocol-error");
                }
                var name = $.trim(line.substring(0, lp)).toLowerCase();
                state.headers[name] = $.trim(line.substring(lp + 1));
            }
        });
    }

    function parse_http_body(state, force, processor) {
        var body = state.buffer;
        if (state.headers["content-length"] === undefined) {
            if (!force)
                return undefined; /* wait until end of channel */
        } else {
            var length = parseInt(state.headers["content-length"], 10);
            var body_length_in_bytes = unescape(encodeURIComponent(body)).length;
            if (isNaN(length)) {
                console.warn("Invalid HTTP Content-Length received:",
                             state.headers["content-length"]);
                throw new RestError("protocol-error");
            }
            if (length < body_length_in_bytes) {
                console.warn("Too much data in HTTP response: expected",
                             length, "got", body.length);
                throw new RestError("protocol-error");
            }
            if (length > body_length_in_bytes) {
                if (force) {
                    console.warn("Truncated HTTP response received: expected",
                                 length, "got", body.length);
                    throw new RestError("protocol-error");
                }
                return undefined; /* wait for more data */
            }
        }

        state.buffer = "";
        return processor(body);
    }

    function http_perform(pool, processor, args) {
        var dfd = new $.Deferred();
        var request = build_http_request(args);
        var channel = pool.checkout();
        channel.send(request);

        /* Callbacks that want to stream response, see below */
        var streamers = null;

        /* Used during response parsing */
        var state = {
            buffer: "",
            headers: null
        };

        function process(data, problem, eof) {
            state.buffer += data;
            var ret;
            try {
                if (problem)
                    throw new RestError(problem);
                if (state.headers === null)
                    parse_http_headers(state);
                if (state.headers !== null)
                    ret = parse_http_body(state, eof || streamers, processor);
                if (ret === undefined && eof) {
                    console.log("Received incomplete HTTP response");
                    throw new RestError("protocol-error");
                }
            } catch (ex) {
                if (ex instanceof RestError)
                    dfd.reject(ex);
                else
                    throw ex;
            }
            if (ret !== undefined) {
                if (streamers) {
                    if (ret !== null)
                        streamers.fire(ret);
                    ret = undefined;
                }
                if (!streamers || eof) {
                    dfd.resolve(ret);
                }
            }
        }

        $(channel).on("message", function(event, payload) {
            rest_debug("rest message:", payload);
            process(payload);
        });
        $(channel).on("close", function(event, problem) {
            rest_debug("rest closed:", problem);
            process("", problem, true);
        });

        /* This also stops events on the channel */
        dfd.always(function() {
            pool.checkin(channel);
        });

        var promise = dfd.promise();

        /*
         * An additional method on our deferred promise, which enables
         * streaming of the resulting data.
         */
        promise.stream = function(callback) {
            if (streamers === null)
               streamers = $.Callbacks("" /* no flags */);
            streamers.add(callback);
            return this;
        };

        return promise;
    }

    function Rest(endpoint, machine, options) {
        if (endpoint.indexOf("unix://") !== 0)
            console.error("the Rest(uri) must currently start with 'unix://'");
        var args = { "unix": endpoint.substring(7) };
        if (machine !== undefined)
            args["host"] = machine;
        if (options !== undefined)
            $.extend(args, options);
        var pool = new ChannelPool(args);

        /* public */
        this.get = function(path, params) {
            return http_perform(pool, process_json, {
                "method": "GET",
                "params": params,
                "path": path
            });
        };
        this.getraw = function(path, params) {
            return http_perform(pool, process_raw, {
                "method": "GET",
                "params": params,
                "path": path
            });
        };
        this.post = function(path, params) {
            return http_perform(pool, process_json, {
                "method": "POST",
                "params": params,
                "path": path
            });
        };
        this.del = function(path, params) {
            return http_perform(pool, process_json, {
                "method": "DELETE",
                "params": params,
                "path": path
            });
        };
    }

    /* public */
    $cockpit.rest = function(endpoint, machine, options) {
        return new Rest(endpoint, machine, options);
    };

}($cockpit, jQuery));
