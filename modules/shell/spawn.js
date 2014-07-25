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
 * API: defined in cockpit namespace
 *
 * cockpit.spawn(args, [machine], [options])
 *   @args: an array of args including process path, or just process path as string
 *   @machine: optional, a host name of the machine to connect to
 *   @options: optional, a plain object of additional channel options
 *   Opens a process channel that can be used to communicate on standard in
 *   and standard out with the process. standard error is logged on the machine
 *   but not returned.
 *   Returns: a jQuery deferred promise with additional methods. See below.
 *
 * Deferred promise (return values)
 *   The return values from spawn() are jQuery deferred promises. You can call
 *   various functions on these in order to handle the responses. In addition there
 *   is are extra non-standard methods.
 *   method.
 *      .done(function(resp) { }): called when process exits and @resp will
 *             be the standard output returned.
 *      .fail(function(ex) { }): called if the operation fails, with
 *             @ex.problem as a standard cockpit error code and @ex.exit_status
 *             and @ex.exit_signal as the exit status and terminating signal
 *             respectively (or -1 if not relevant).
 *      .always(function() { }): called when the operation fails or
 *             completes. Use this.state() to see what happened.
 *   non-standard:
 *      .stream(function(resp) { }): if a handler is attached to the
 *             .stream() method then the response switches into streaming
 *             mode and each block of output received from the process is
 *             immediately passed to the callback. The .done() callbacks
 *             will get null.
 *      .write(): send standard input to the process.
 *      .close(): close standard input of the process.
 *
 * ProcessError
 *   Errors passd to the deferred .fail function will be of this class
 *   and have the following properties:
 *      .exit_status: process exit status or NaN
 *      .exit_signal: process terminating signal or NaN
 *      .message: a somewhat descriptive message
 *      .problem: a Cockpit style problem code, mapped from the process
 *             status where possible.
 */

var cockpit = cockpit || { };

(function(cockpit, $) {
    "use strict";

    /* Translates HTTP error codes to Cockpit codes */
    function ProcessError(arg0, signal) {
        var status = parseInt(arg0, 10);
        if (arg0 !== undefined && isNaN(status)) {
            this.problem = arg0;
            this.exit_status = NaN;
            this.exit_signal = null;
            this.message = arg0;
        } else {
            this.exit_status = status;
            this.exit_signal = signal;
            this.problem = "internal-error";
            if (this.exit_signal)
                this.message = "Process killed with signal " + this.exit_signal;
            else
                this.message = "Process exited with code " + this.exit_status;
        }
        this.toString = function() {
            return this.message;
        };
    }

    function spawn_debug() {
        if (cockpit.debugging == "all" || cockpit.debugging == "spawn")
            console.debug.apply(console, arguments);
    }

    /* public */
    cockpit.spawn = function(command, machine, options) {
        var dfd = new $.Deferred();

        var args = { "payload": "text-stream", "spawn": [] };
        if (command instanceof Array) {
            for (var i = 0; i < command.length; i++)
                args["spawn"].push(String(command[i]));
        } else {
            args["spawn"].push(String(command));
        }
        if (machine !== undefined)
            args["host"] = machine;
        if (options !== undefined)
            $.extend(args, options);

        var channel = cockpit.channel(args);

        /* Callbacks that want to stream response, see below */
        var streamers = null;

        var buffer = "";
        $(channel).
            on("message", function(event, payload) {
                spawn_debug("process output:", payload);
                buffer += payload;
                if (streamers && buffer) {
                    streamers.fire(buffer);
                    buffer = "";
                }
            }).
            on("close", function(event, options) {
                spawn_debug("process closed:", JSON.stringify(options));
                if (options.reason)
                    dfd.reject(new ProcessError(options.reason));
                else if (options["exit-status"] || options["exit-signal"])
                    dfd.reject(new ProcessError(options["exit-status"], options["exit-signal"]));
                else
                    dfd.resolve(buffer);
            });

        var promise = dfd.promise();
        promise.stream = function(callback) {
            if (streamers === null)
               streamers = $.Callbacks("" /* no flags */);
            streamers.add(callback);
            return this;
        };

        promise.write = function(message) {
            spawn_debug("process input:", message);
            channel.send(message);
            return this;
        };

        promise.close = function(reason) {
            spawn_debug("process closing:", reason);
            if (channel.valid)
                channel.close(reason);
            return this;
        };

        return promise;
    };

}(cockpit, jQuery));
