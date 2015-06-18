/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

/* global jQuery   */

define([
    "jquery",
    "base1/cockpit",
], function($, cockpit) {
    "use strict";

    var _ = cockpit.gettext;

    /**
     * journal([match, ...], [options])
     * @match: any number of journal match strings
     * @options: an object containing further options
     *
     * Load and (by default) stream journal entries as
     * json objects. This function returns a jQuery deferred
     * object which delivers the various journal entries.
     *
     * The various @match strings are journalctl matches.
     * Zero, one or more can be specified. They must be in
     * string format, or arrays of strings.
     *
     * The optional @options object can contain the following:
     *  * "host": the host to load journal from
     *  * "count": number of entries to load and/or pre-stream.
     *    Default is 10
     *  * "follow": if set to false just load entries and don't
     *    stream further journal data. Default is true.
     *  * "directory": optional directory to load journal files
     *  * "boot": when set only list entries from this specific
     *    boot id, or if null then the current boot.
     *  * "since": if specified list entries since the date/time
     *  * "until": if specified list entries until the date/time
     *  * "cursor": a cursor to start listing entries from
     *  * "after": a cursor to start listing entries after
     *
     * Returns a jQuery deferred promise. You can call these
     * functions on the deferred to handle the responses. Note that
     * there are additional non-jQuery methods.
     *
     *  .done(function(entries) { }): Called when done, @entries is
     *         an array of all journal entries loaded. If .stream()
     *         has been invoked then @entries will be empty.
     *  .fail(funciton(ex) { }): called if the operation fails
     *  .stream(function(entries) { }): called when we receive entries
     *         entries. Called once per batch of journal @entries,
     *         whether following or not.
     *  .stop(): stop following or retrieving entries.
     */

    return function journal(/* ... */) {
        var matches = [];
        var options = { follow: true };
        for (var i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            if (typeof arg == "string") {
                matches.push(arg);
            } else if (typeof arg == "object") {
                if (arg instanceof Array)
                    matches.push.apply(matches, arg);
                else
                    $.extend(options, arg);
            } else {
                console.warn("server.journal called with invalid argument:", arg);
            }
        }

        if (options.count === undefined) {
            if (options.follow)
                options.count = 10;
            else
                options.count = null;
        }

        var cmd = [ "journalctl", "-q", "--output=json" ];
        if (!options.count)
            cmd.push("--no-tail");
        else
            cmd.push("--lines=" + options.count);
        if (options.directory)
            cmd.push("--directory=" + options.directory);
        if (options.boot)
            cmd.push("--boot=" + options.boot);
        else if (options.boot !== undefined)
            cmd.push("--boot");
        if (options.since)
            cmd.push("--since=" + options.since);
        if (options.until)
            cmd.push("--until=" + options.until);
        if (options.cursor)
            cmd.push("--cursor=" + options.cursor);
        if (options.after)
            cmd.push("--after=" + options.after);

        /* journalctl doesn't allow reverse and follow together */
        if (options.reverse)
            cmd.push("--reverse");
        else if (options.follow)
            cmd.push("--follow");

        cmd.push("--");
        cmd.push.apply(cmd, matches);

        var dfd = new $.Deferred();
        var promise;
        var buffer = "";
        var entries = [];
        var streamers = null;
        var interval = null;
        var entry;

        function fire_streamers() {
            if (streamers && entries.length > 0) {
                var ents = entries;
                entries = [];
                streamers.fireWith(promise, [ents]);
            } else {
                window.clearInterval(interval);
                interval = null;
            }
        }

        var proc = cockpit.spawn(cmd, { host: options.host, batch: 8192, latency: 300, superuser: "try" }).
            stream(function(data) {
                var pos = 0;
                var next;

                if (buffer)
                    data = buffer + data;
                buffer = "";

                var lines = data.split("\n");
                var last = lines.length - 1;
                $.each(lines, function(i, line) {
                    if (i == last) {
                        buffer = line;
                    } else if (line && line.indexOf("-- ") !== 0) {
                        try {
                            entries.push(JSON.parse(line));
                        } catch (e) {
                            console.warn(e, line);
                        }
                    }
                });

                if (streamers && interval === null)
                    interval = window.setInterval(fire_streamers, 300);
            }).
            done(function() {
                fire_streamers();
                dfd.resolve(entries);
            }).
            fail(function(ex) {
                /* The journalctl command fails when no entries are matched
                 * so we just ignore this status code */
                if (ex.problem == "cancelled" ||
                    ex.exit_status === 1) {
                    fire_streamers();
                    dfd.resolve(entries);
                } else {
                    dfd.reject(ex);
                }
            }).
            always(function() {
                window.clearInterval(interval);
            });

        var jpromise = dfd.promise;
        dfd.promise = function() {
            return $.extend(jpromise.apply(this, arguments), {
                stream: function stream(callback) {
                    if (streamers === null)
                        streamers = $.Callbacks("" /* no flags */);
                    streamers.add(callback);
                    return this;
                },
                stop: function stop() {
                    proc.close("cancelled");
                },
                promise: this.promise
            });
        };

        /* Used above so save a ref */
        promise = dfd.promise();
        return promise;
    };
});
