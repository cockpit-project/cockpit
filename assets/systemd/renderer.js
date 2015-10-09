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
    "base1/mustache",
    "system/journalctl",
    "data!./journal_day_header.mustache",
    "data!./journal_line.mustache",
    "data!./journal_reboot.mustache"
], function($, cockpit, Mustache, journal, day_header_template, line_template, reboot_template) {
    "use strict";

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    var journal_renderer = {};

    journal_renderer.output_funcs_for_box = function output_funcs_for_box(box) {
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

        return {
            render_line: render_line,
            render_day_header: render_day_header,
            render_reboot_separator: render_reboot_separator,

            append: function(elt) { box.append($(elt)); },
            prepend: function(elt) { box.prepend($(elt)); },
            remove_last: function() { $(box[0].lastChild).remove(); },
            remove_first: function() { $(box[0].firstChild).remove(); }
        };
    };

    /* Not public API */
    journal_renderer.journalbox = function journalbox(outer, start, match, day_box) {
        var box = $('<div class="panel panel-default cockpit-log-panel">');
        var start_box = $('<div class="journal-start">');

        outer.empty().append(box, start_box);

        var query_count = 5000;
        var query_more = 1000;

        var renderer = journal_renderer.journal_renderer(journal_renderer.output_funcs_for_box(box));
        /* cache to store offsets for days */
        var renderitems_day_cache = null;
        var procs = [];

        function query_error(error) {
          /* TODO: blank slate
            if (error.name == "org.freedesktop.DBus.Error.AccessDenied")
                end_box.text(_("You are not authorized."));
            else
                end_box.text(error.message);*/
        }

        function prepend_entries(entries) {
            for (var i = 0; i < entries.length; i++)
                renderer.prepend(entries[i]);
            renderer.prepend_flush();
            /* empty cache for day offsets */
            renderitems_day_cache = null;
        }

        function append_entries(entries) {
            for (var i = 0; i < entries.length; i++)
                renderer.append(entries[i]);
            renderer.append_flush();
            /* empty cache for day offsets */
            renderitems_day_cache = null;
        }

        function didnt_reach_start(first) {
            var button = $('<button id="journal-load-earlier" class="btn btn-default" data-inline="true" data-mini="true">' +
                           _("Load earlier entries") +
                           '</button>');
            start_box.html(button);
            button.click(function() {
                var count = 0;
                var stopped = null;
                start_box.text(_("Loading..."));
                procs.push(journal(match, { follow: false, reverse: true, cursor: first }).
                    fail(query_error).
                    stream(function(entries) {
                        if (entries[0]["__CURSOR"] == first)
                            entries.shift();
                        count += entries.length;
                        append_entries(entries);
                        if (count >= query_more) {
                            stopped = entries[entries.length - 1]["__CURSOR"];
                            didnt_reach_start(stopped);
                            this.stop();
                        }
                    }).
                    done(function() {
                        if (start_box.text() == _("Loading..."))
                            start_box.empty();
                    }));
            });
        }

        function follow(cursor) {
            procs.push(journal(match, { follow: true, count: 0, cursor: cursor }).
                fail(query_error).
                stream(function(entries) {
                    if (entries[0]["__CURSOR"] == cursor)
                        entries.shift();
                    prepend_entries(entries);
                    update_day_box();
                }));
        }

        function update_day_box() {
            /* Build cache if empty
             */
            if (renderitems_day_cache === null) {
                renderitems_day_cache = [];
                for (var d = box[0].firstChild; d; d = d.nextSibling) {
                    if ($(d).hasClass('panel-heading'))
                        renderitems_day_cache.push([$(d).offset().top, $(d).text()]);
                }
            }
            if (renderitems_day_cache.length > 0) {
                /* Find the last day that begins above top
                 */
                var currentIndex = 0;
                var top = window.scrollY;
                while ((currentIndex + 1) < renderitems_day_cache.length &&
                        renderitems_day_cache[currentIndex + 1][0] < top) {
                    currentIndex++;
                }
                day_box.text(renderitems_day_cache[currentIndex][1]);
            } else {
                /* No visible day headers
                 */
                day_box.text(_("Go to"));
            }
        }

        start_box.text(_("Loading..."));

        $(window).on('scroll', update_day_box);

        var options = {
            follow: false,
            reverse: true
        };

        var all = false;
        if (start == 'boot') {
            options["boot"] = null;
        } else if (start == 'last-24h') {
            options["since"] = "-1days";
        } else if (start == 'last-week') {
            options["since"] = "-7days";
        } else {
            all = true;
        }

        var last = null;
        var count = 0;
        var stopped = null;

        procs.push(journal(match, options).
            fail(query_error).
            stream(function(entries) {
                if (!last) {
                    last = entries[0]["__CURSOR"];
                    follow(last);
                    update_day_box();
                }
                count += entries.length;
                append_entries(entries);
                if (count >= query_count) {
                    stopped = entries[entries.length - 1]["__CURSOR"];
                    didnt_reach_start(stopped);
                    this.stop();
                }
            }).
            done(function() {
                if (start_box.text() == _("Loading..."))
                    start_box.empty();
                if (!last) {
                    procs.push(journal(match, { follow: true, count: 0,
                                                       boot: options["boot"],
                                                       since: options["since"]
                                                     }).
                        fail(query_error).
                        stream(function(entries) {
                            prepend_entries(entries);
                            update_day_box();
                        }));
                }
                if (!all || stopped)
                    didnt_reach_start();
            }));

        outer.stop = function stop() {
            $(window).off('scroll', update_day_box);
            $.each(procs, function(i, proc) {
                proc.stop();
            });
        };

        return outer;
    };

    var month_names = [         'January',
                                'February',
                                'March',
                                'April',
                                'May',
                                'June',
                                'July',
                                'August',
                                'September',
                                'October',
                                'November',
                                'December'
                              ];

    /* Render the journal entries by passing suitable HTML strings back to
       the caller via the 'output_funcs'.

       Rendering is context aware.  It will insert 'reboot' markers, for
       example, and collapse repeated lines.  You can extend the output at
       the bottom and also at the top.

       A new renderer is created by calling 'cockpit.journal_renderer' like
       so:

          var renderer = cockpit.journal_renderer(funcs);

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

    journal_renderer.journal_renderer = function journal_renderer(output_funcs) {
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
                day: C_("month-name", month_names[d.getMonth()]) + ' ' + d.getDate().toFixed() + ', ' + d.getFullYear().toFixed(),
                time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
                bootid: journal_entry["_BOOT_ID"],
                ident: journal_entry["SYSLOG_IDENTIFIER"] || journal_entry["_COMM"],
                prio: journal_entry["PRIORITY"],
                message: journal_entry["MESSAGE"]
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

    return journal_renderer;
});
