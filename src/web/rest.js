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

    function rest_debug() {
        console.debug.apply(console, arguments);
    }

    var last_cookie = 3;

    function rest_perform(channel, req) {
        var dfd = new $.Deferred();

        /* Unique cookie for this request */
        var cookie = last_cookie;
        last_cookie++;

        if (!req.path)
            req.path = "/";
        if (!req.method)
            req.method = "GET";
        req.cookie = cookie;
        if (req.params) {
            if (req.path.indexOf("?") == -1)
                req.path += "?" + $.param(req.params);
            else
                req.path += "&" + $.param(req.params);
        }
        delete req.params;
        if (req.body === undefined)
            delete req.body;

        rest_debug("rest request:", req);
        channel.send(JSON.stringify(req));

        /* Callbacks that want to stream response, see below */
        var streamers = null;

        function on_result(event, result) {
            if (result.cookie !== cookie)
                return;

            /* An error, fail here */
            if (result.status < 200 || result.status > 299) {
                var httpex = new RestError(result.status, result.message);
                httpex.body = result.body;
                dfd.reject(httpex);

            /* A normal result */
            } else {
                if (streamers && result.body !== undefined) {
                    streamers.fire(result.body);
                    result.body = undefined;
                }

                if (result.body !== undefined || result.complete)
                    dfd.resolve(result.body);
            }
        }

        function on_close(event, problem) {
            rest_debug("rest close:", problem);
            if (!problem)
                problem = "disconnected";
            dfd.reject(new RestError(problem));
        }

        /* result event is triggered below */
        $(channel).on("result", on_result);
        $(channel).on("close", on_close);

        /* disconnect handlers when done */
        dfd.always(function() {
            $(channel).off("result", on_result);
            $(channel).off("close", on_close);
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
        var args = { "unix": endpoint.substring(7), "payload": "rest-json1" };
        if (machine !== undefined)
            args["host"] = machine;
        if (options !== undefined)
            $.extend(args, options);

        var channel = null;
        function get_channel() {
            if (channel === null || channel.valid !== true) {
                channel = new Channel(args);

                /* Individual requests wait for 'result' event */
                $(channel).on("message", function(event, payload) {
                    var result = undefined;
                    try {
                        result = JSON.parse(payload);
                        rest_debug("rest result:", result);
                    } catch(ex) {
                        rest_debug("rest result:", payload);
                        console.warn("received invalid rest-json1:", ex);
                    }
                    if (result === undefined)
                        channel.close("protocol-error");
                    else
                        $(channel).trigger("result", [result]);
                });
            }

            return channel;
        }

        /* public */
        this.get = function(path, params) {
            return rest_perform(get_channel(), {
                "method": "GET",
                "params": params,
                "path": path
            });
        };
        this.post = function(path, params, body) {
            return rest_perform(get_channel(), {
                "method": "POST",
                "params": params,
                "path": path,
                "body": body
            });
        };
        this.del = function(path, params) {
            return rest_perform(get_channel(), {
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
