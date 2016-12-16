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

(function() {
    "use strict";

    var cockpit = require("cockpit");
    var Mustache = require("mustache");
    var day_header_template = require('raw!journal_day_header.mustache');
    var line_template = require('raw!journal_line.mustache');
    var reboot_template = require('raw!journal_reboot.mustache');

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    var journal = { };

    /**
     * journalctl([match, ...], [options])
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

    journal.journalctl = function journalctl(/* ... */) {
        var matches = [];
        var i, arg, options = { follow: true };
        for (i = 0; i < arguments.length; i++) {
            arg = arguments[i];
            if (typeof arg == "string") {
                matches.push(arg);
            } else if (typeof arg == "object") {
                if (arg instanceof Array) {
                    matches.push.apply(matches, arg);
                } else {
                    cockpit.extend(options, arg);
                    break;
                }
            } else {
                console.warn("journal.journalctl called with invalid argument:", arg);
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

        var dfd = new cockpit.defer();
        var promise;
        var buffer = "";
        var entries = [];
        var streamers = [];
        var interval = null;

        function fire_streamers() {
            var ents, i;
            if (streamers.length && entries.length > 0) {
                ents = entries;
                entries = [];
                for (i = 0; i < streamers.length; i++)
                    streamers[i].apply(promise, [ents]);
            } else {
                window.clearInterval(interval);
                interval = null;
            }
        }

        var proc = cockpit.spawn(cmd, { host: options.host, batch: 8192, latency: 300, superuser: "try" }).
            stream(function(data) {

                if (buffer)
                    data = buffer + data;
                buffer = "";

                var lines = data.split("\n");
                var last = lines.length - 1;
                lines.forEach(function(line, i) {
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

                if (streamers.length && interval === null)
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

        promise = dfd.promise();
        promise.stream = function stream(callback) {
            streamers.push(callback);
            return this;
        };
        promise.stop = function stop() {
            proc.close("cancelled");
        };
        return promise;
    };

    journal.printable = function printable(value) {
        if (value === undefined)
            return _("[no data]");
        else if (typeof(value) == "string")
            return value;
        else if (value.length !== undefined)
            return cockpit.format(_("[$0 bytes of binary data]"), value.length);
        else
            return _("[binary data]");
    };

    function output_funcs_for_box(box) {
        /* Dereference any jQuery object here */
        if (box.jquery)
            box = box[0];

        Mustache.parse(day_header_template);
        Mustache.parse(line_template);
        Mustache.parse(reboot_template);

        function render_line(ident, prio, message, count, time, entry) {
            var parts = {
                    'cursor': entry["__CURSOR"],
                    'time': time,
                    'message': message,
                    'service': ident
                };
            if (count > 1)
                parts['count'] = count;
            if (prio < 4)
                parts['warning'] = true;
            return Mustache.render(line_template, parts);
        }

        var reboot = _("Reboot");
        var reboot_line = Mustache.render(reboot_template, {'message': reboot} );

        function render_reboot_separator() {
            return reboot_line;
        }

        function render_day_header(day) {
            return Mustache.render(day_header_template, {'day': day} );
        }

        function parse_html(string) {
            var div = document.createElement("div");
            div.innerHTML = string.trim();
            return div.children[0];
        }

        return {
            render_line: render_line,
            render_day_header: render_day_header,
            render_reboot_separator: render_reboot_separator,

            append: function(elt) {
                if (typeof (elt) == "string")
                    elt = parse_html(elt);
                box.appendChild(elt);
            },
            prepend: function(elt) {
                if (typeof (elt) == "string")
                    elt = parse_html(elt);
                if (box.firstChild)
                    box.insertBefore(elt, box.firstChild);
                else
                    box.appendChild(elt);
            },
            remove_last: function() {
                if (box.lastChild)
                    box.removeChild(box.lastChild);
            },
            remove_first: function() {
                if (box.firstChild)
                    box.removeChild(box.firstChild);
            },
        };
    }

    var month_names = [
        C_("month-name", 'January'),
        C_("month-name", 'February'),
        C_("month-name", 'March'),
        C_("month-name", 'April'),
        C_("month-name", 'May'),
        C_("month-name", 'June'),
        C_("month-name", 'July'),
        C_("month-name", 'August'),
        C_("month-name", 'September'),
        C_("month-name", 'October'),
        C_("month-name", 'November'),
        C_("month-name", 'December')
    ];

    /* Render the journal entries by passing suitable HTML strings back to
       the caller via the 'output_funcs'.

       Rendering is context aware.  It will insert 'reboot' markers, for
       example, and collapse repeated lines.  You can extend the output at
       the bottom and also at the top.

       A new renderer is created by calling 'journal.renderer' like
       so:

          var renderer = journal.renderer(funcs);

       You can feed new entries into the renderer by calling various
       methods on the returned object:

          - renderer.append(journal_entry)
          - renderer.append_flush()
          - renderer.prepend(journal_entry)
          - renderer.prepend_flush()

       A 'journal_entry' is one element of the result array returned by a
       call to 'Query' with the 'cockpit.journal_fields' as the fields to
       return.

       Calling 'append' will append the given entry to the end of the
       output, naturally, and 'prepend' will prepend it to the start.

       The output might lag behind what has been input via 'append' and
       'prepend', and you need to call 'append_flush' and 'prepend_flush'
       respectively to ensure that the output is up-to-date.  Flushing a
       renderer does not introduce discontinuities into the output.  You
       can continue to feed entries into the renderer after flushing and
       repeated lines will be correctly collapsed across the flush, for
       example.

       The renderer will call methods of the 'output_funcs' object to
       produce the desired output:

          - output_funcs.append(rendered)
          - output_funcs.remove_last()
          - output_funcs.prepend(rendered)
          - output_funcs.remove_first()

       The 'rendered' argument is the return value of one of the rendering
       functions described below.  The 'append' and 'prepend' methods
       should add this element to the output, naturally, and 'remove_last'
       and 'remove_first' should remove the indicated element.

       If you never call 'prepend' on the renderer, 'output_func.prepend'
       isn't called either.  If you never call 'renderer.prepend' after
       'renderer.prepend_flush', then 'output_func.remove_first' will
       never be called.  The same guarantees exist for the 'append' family
       of functions.

       The actual rendering is also done by calling methods on
       'output_funcs':

          - output_funcs.render_line(ident, prio, message, count, time, cursor)
          - output_funcs.render_day_header(day)
          - output_funcs.render_reboot_separator()

    */

    journal.renderer = function renderer(funcs_or_box) {
        var output_funcs;
        if (funcs_or_box.render_line)
            output_funcs = funcs_or_box;
        else
            output_funcs = output_funcs_for_box(funcs_or_box);

        function copy_object(o) {
            var c = { }; for(var p in o) c[p] = o[p]; return c;
        }

        // A 'entry' object describes a journal entry in formatted form.
        // It has fields 'bootid', 'ident', 'prio', 'message', 'time',
        // 'day', all of which are strings.

        function format_entry(journal_entry) {
            function pad(n) {
                var str = n.toFixed();
                if(str.length == 1)
                    str = '0' + str;
                return str;
            }

            var d = new Date(journal_entry["__REALTIME_TIMESTAMP"] / 1000);
            return {
                cursor: journal_entry["__CURSOR"],
                full: journal_entry,
                day: month_names[d.getMonth()] + ' ' + d.getDate().toFixed() + ', ' + d.getFullYear().toFixed(),
                time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
                bootid: journal_entry["_BOOT_ID"],
                ident: journal_entry["SYSLOG_IDENTIFIER"] || journal_entry["_COMM"],
                prio: journal_entry["PRIORITY"],
                message: journal.printable(journal_entry["MESSAGE"])
            };
        }

        function entry_is_equal(a, b) {
            return (a && b &&
                    a.day == b.day &&
                    a.bootid == b.bootid &&
                    a.ident == b.ident &&
                    a.prio == b.prio &&
                    a.message == b.message);
        }

        // A state object describes a line that should be eventually
        // output.  It has an 'entry' field as per description above, and
        // also 'count', 'last_time', and 'first_time', which record
        // repeated entries.  Additionally:
        //
        // line_present: When true, the line has been output already with
        //     some preliminary data.  It needs to be removed before
        //     outputting more recent data.
        //
        // header_present: The day header has been output preliminarily
        //     before the actual log lines.  It needs to be removed before
        //     prepending more lines.  If both line_present and
        //     header_present are true, then the header comes first in the
        //     output, followed by the line.

        function render_state_line(state) {
            return output_funcs.render_line(state.entry.ident,
                                            state.entry.prio,
                                            state.entry.message,
                                            state.count,
                                            state.last_time,
                                            state.entry.full);
        }

        // We keep the state of the first and last journal lines,
        // respectively, in order to collapse repeated lines, and to
        // insert reboot markers and day headers.
        //
        // Normally, there are two state objects, but if only a single
        // line has been output so far, top_state and bottom_state point
        // to the same object.

        var top_state, bottom_state;

        top_state = bottom_state = { };

        function start_new_line() {
            // If we now have two lines, split the state
            if (top_state === bottom_state && top_state.entry) {
                top_state = copy_object(bottom_state);
            }
        }

        function top_output() {
            if (top_state.header_present) {
                output_funcs.remove_first();
                top_state.header_present = false;
            }
            if (top_state.line_present) {
                output_funcs.remove_first();
                top_state.line_present = false;
            }
            if (top_state.entry) {
                output_funcs.prepend(render_state_line(top_state));
                top_state.line_present = true;
            }
        }

        function prepend(journal_entry) {
            var entry = format_entry(journal_entry);

            if (entry_is_equal(top_state.entry, entry)) {
                top_state.count += 1;
                top_state.first_time = entry.time;
            } else {
                top_output();

                if (top_state.entry) {
                    if (entry.bootid != top_state.entry.bootid)
                        output_funcs.prepend(output_funcs.render_reboot_separator());
                    if (entry.day != top_state.entry.day)
                        output_funcs.prepend(output_funcs.render_day_header(top_state.entry.day));
                }

                start_new_line();
                top_state.entry = entry;
                top_state.count = 1;
                top_state.first_time = top_state.last_time = entry.time;
                top_state.line_present = false;
            }
        }

        function prepend_flush() {
            top_output();
            if (top_state.entry) {
                output_funcs.prepend(output_funcs.render_day_header(top_state.entry.day));
                top_state.header_present = true;
            }
        }

        function bottom_output() {
            if (bottom_state.line_present) {
                output_funcs.remove_last();
                bottom_state.line_present = false;
            }
            if (bottom_state.entry) {
                output_funcs.append(render_state_line(bottom_state));
                bottom_state.line_present = true;
            }
        }

        function append(journal_entry) {
            var entry = format_entry(journal_entry);

            if (entry_is_equal(bottom_state.entry, entry)) {
                bottom_state.count += 1;
                bottom_state.last_time = entry.time;
            } else {
                bottom_output();

                if (!bottom_state.entry || entry.day != bottom_state.entry.day) {
                    output_funcs.append(output_funcs.render_day_header(entry.day));
                    bottom_state.header_present = true;
                }
                if (bottom_state.entry && entry.bootid != bottom_state.entry.bootid)
                    output_funcs.append(output_funcs.render_reboot_separator());

                start_new_line();
                bottom_state.entry = entry;
                bottom_state.count = 1;
                bottom_state.first_time = bottom_state.last_time = entry.time;
                bottom_state.line_present = false;
            }
        }

        function append_flush() {
            bottom_output();
        }

        return { prepend: prepend,
                 prepend_flush: prepend_flush,
                 append: append,
                 append_flush: append_flush
               };
    };

    journal.logbox = function logbox(match, max_entries) {
        var entries = [ ];
        var box = document.createElement("div");

        function render() {
            var renderer = journal.renderer(box);
            while(box.firstChild)
                box.removeChild(box.firstChild);
            for (var i = 0; i < entries.length; i++) {
                renderer.prepend(entries[i]);
            }
            renderer.prepend_flush();
            if (entries.length > 0)
                box.removeAttribute("hidden");
            else
                box.setAttribute("hidden", "hidden");
        }

        render();

        var promise = journal.journalctl(match, { count: max_entries }).
            stream(function(tail) {
                entries = entries.concat(tail);
                if (entries.length > max_entries)
                    entries = entries.slice(-max_entries);
                render();
            }).
            fail(function(error) {
                box.appendChild(document.createTextNode(error.message));
                box.removeAttribute("hidden");
            });

        /* Both a DOM element and a promise */
        return promise.promise(box);
    };

    module.exports = journal;
}());
