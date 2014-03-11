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
 *   Returns: a jQuery deferred object with the following promise:
 *      .done(function(resp) { }): called when REST operation completes
 *             and @resp will be the parsed JSON returned.
 *      .fail(function(reason) { }): called if the operation fails, with
 *             @reason as a standard cockpit error code.
 *
 * Example:
 *     $cockpit.rest("unix:///var/run/docker.sock")
 *          .get("/containers/json")
 *              .done(function(resp) {
 *                  console.log(resp);
 *              })
 *              .fail(function(reason) {
 *                  console.warn(reason);
 *              });
 */

var $cockpit = $cockpit || { };

(function($cockpit, $) {
    "use strict";

    /* Translates HTTP error codes to Cockpit codes */
    function HttpError(status, reason) {
        if (status == 400)
            this.code = "protocol-error";
        else if (status == 401 || status == 403)
            this.code = "not-authorized";
        else if (status == 404)
            this.code = "not-found";
        else
            this.code = "internal-error";
        this.toString = function() { return this.code; };
    }

    function CockpitError(reason) {
        this.code = reason;
        this.toString = function() { return this.code; };
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

        /* TODO: Handle other than GET here */
        if (method === "GET") {
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

    function process_json(headers, body) {
        if (body === null || body === "")
            return null; /* not found */
        try {
            return $.parseJSON(body);
        } catch (ex) {
            console.log("Received bad JSON: ", ex);
            throw new CockpitError("protocol-error");
        }
    }

    function parse_http_response(response, eof, processor) {
        var pos = response.indexOf("\r\n\r\n");
        if (pos == -1)
            return undefined; /* no headers yet */

        var headers = { };
        var lines = response.substring(0, pos).split("\r\n");
        var body = response.substring(pos + 4);
        var num = 0;
        $(lines).each(function(i, line) {
            if (i === 0) {
                var parts = line.split(/\s+/);
                var version = parts.shift();
                var status = parts.shift();
                var reason = parts.join(" ");

                /* Check the http status is something sane */
                if (status == 404) {
                     body = null;
                } else if (status != 200) {
                     console.warn(status, reason);
                     throw new HttpError(status, reason);
                }

                /* Parse version after status, in case status has more info */
                if (!version.match(/http\/1\.0/i)) {
                     console.warn("Got unsupported HTTP version:", version);
                     throw new CockpitError("protocol-error");
                }
            } else {
                var lp = line.indexOf(":");
                if (lp == -1) {
                    console.warn("Invalid HTTP header without colon:", line);
                    throw new CockpitError("protocol-error");
                }
                var name = $.trim(line.substring(0, lp)).toLowerCase();
                headers[name] = $.trim(line.substring(lp + 1));
            }
        });

        if (headers["content-length"] === undefined) {
            if (!eof)
                return undefined; /* wait until end of channel */
        } else {
            var length = parseInt(headers["content-length"], 10);
            if (isNaN(length)) {
                console.warn("Invalid HTTP Content-Length received:",
                             headers["content-length"]);
                throw new CockpitError("protocol-error");
            }
            if (length < body.length) {
                console.warn("Too much data in HTTP response: expected",
                             length, "got", body.length);
                throw new CockpitError("protocol-error");
            }
            if (length > body.length) {
                if (eof) {
                    console.warn("Truncated HTTP response received: expected",
                                 length, "got", body.length);
                    throw new CockpitError("protocol-error");
                }
                return undefined; /* wait for more data */
            }
        }

        return processor(headers, body);
    }

    function http_perform(pool, processor, args) {
        var dfd = new $.Deferred();
        var request = build_http_request(args);
        var channel = pool.checkout();
        channel.send(request);

        var response = "";
        $(channel).on("message", function(event, payload) {
            rest_debug("rest message:", payload);
            response += payload;
            var ret;
            try {
                ret = parse_http_response(response, false, processor);
            } catch (ex) {
                if (ex.code)
                    dfd.reject(ex);
                else
                    throw ex;
            }
            if (ret !== undefined)
                dfd.resolve(ret);
        });

        $(channel).on("close", function(event, reason) {
            rest_debug("rest closed:", reason);
            var ret;
            try {
                if (reason)
                    throw new CockpitError(reason);
                ret = parse_http_response(response, true, processor);
                if (ret === undefined) {
                    console.log("Received incomplete HTTP response");
                    throw new CockpitError("protocol-error");
                }
            } catch (ex) {
                if (ex.code)
                    dfd.reject(ex);
                else
                    throw ex;
            }
            if (dfd.state() == "pending")
                dfd.resolve(ret);
        });

        dfd.always(function() {
            pool.checkin(channel);
        });

        return dfd.promise();
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
    }

    /* public */
    $cockpit.rest = function(endpoint, machine, options) {
        return new Rest(endpoint, machine, options);
    };

}($cockpit, jQuery));
