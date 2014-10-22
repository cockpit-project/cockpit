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

(function(cockpit, $) {
"use strict";

/**
 * cockpit.journal([match, ...], [options])
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

cockpit.journal = function journal(/* ... */) {
    var matches = [];
    var options = { follow: true };
    for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        if (typeof (arg) == "string") {
            matches.push(arg);
        } else if (typeof (arg) == "object") {
            if (arg instanceof Array)
                matches.push.apply(matches, arg);
            else
                jQuery.extend(options, arg);
        } else {
            console.warn("cockpit.journal called with invalid argument:", arg);
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

    var dfd = new jQuery.Deferred();
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
            clearInterval(interval);
            interval = null;
        }
    }

    var proc = cockpit.spawn(cmd, { host: options.host }).
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
                } else if (line && !line.startsWith("-- ")) {
                    try {
                        entries.push(JSON.parse(line));
                    } catch (e) {
                        console.warn(e, line);
                    }
                }
            });

            if (streamers && interval === null)
                interval = setInterval(fire_streamers, 300);
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
            clearInterval(interval);
        });

    promise = dfd.promise();
    promise.stream = function stream(callback) {
        if (streamers === null)
            streamers = $.Callbacks("" /* no flags */);
        streamers.add(callback);
        return this;
    };

    promise.stop = function stop() {
        proc.close("cancelled");
    };

    return promise;
};

function output_funcs_for_box(box)
{
    function render_line(ident, prio, message, count, time, entry)
    {
        var html = ('<span class="cockpit-logident">' +
                    cockpit.esc(ident) + ': ' +
                    '</span>' +
                    '<span class="cockpit-logmsg">' +
                    '<span class="cockpit-logprio-' + prio + '">' + cockpit.esc(message) + '</span>' +
                    '<span class="cockpit-logtime">' +
                    ((count > 1)?
                     '<span class="badge">' + count + '</span>' :
                     '') +
                    cockpit.esc(time) +
                    '</span>' +
                    '</span>');
        var elt = $('<div class="cockpit-logline">' + html + '</div>');
        elt.data('cockpit-journal-cursor', entry["__CURSOR"]);
        return elt;
    }

    function render_reboot_separator ()
    {
        return ('<div class="cockpit-logline"><span class="cockpit-logdiv">' +
                _('<span class="cockpit-logmsg-reboot">Reboot</span>') +
                '</span></div>');
    }

    function render_day_header (day)
    {
        return '<div class="cockpit-loghead">' + day + '</div>';
    }

    return {
        render_line: render_line,
        render_day_header: render_day_header,
        render_reboot_separator: render_reboot_separator,

        append: function (elt) { box.append(elt); },
        prepend: function (elt) { box.prepend(elt); },
        remove_last: function (elt) { $(box[0].lastChild).remove(); },
        remove_first: function (elt) { $(box[0].firstChild).remove(); }
    };
}

cockpit.simple_logbox = function simple_logbox(machine, box, match, max_entries)
{
    var entries = [ ];

    function render() {
        var renderer = cockpit.journal_renderer(output_funcs_for_box (box));
        box.empty();
        for (var i = 0; i < entries.length; i++) {
            renderer.prepend (entries[i]);
        }
        renderer.prepend_flush ();
        box.toggle(entries.length > 0);
    }

    render();

    return cockpit.journal(match, { count: max_entries, host: machine }).
        stream(function(tail) {
            entries = entries.concat(tail);
            if (entries.length > max_entries)
                entries = entries.slice(-max_entries);
            render();
        }).
        fail(function(error) {
            box.append(cockpit.esc(error.message));
            box.show();
        });
};

function journal_filler(machine, box, start, match, header, day_box, start_box, end_box)
{
    var query_count = 5000;
    var query_more = 1000;

    var renderer = cockpit.journal_renderer(output_funcs_for_box (box));
    /* cache to store offsets for days */
    var renderitems_day_cache = null;
    var procs = [];

    function query_error(error) {
        if (error.name == "org.freedesktop.DBus.Error.AccessDenied")
            end_box.text(_("You are not authorized."));
        else
            end_box.text(error.message);
        start_box.text("");
    }

    /* Going forwards.
     */

    function prepend_entries (entries)
    {
        for (var i = 0; i < entries.length; i++)
            renderer.prepend (entries[i]);
        renderer.prepend_flush ();
        /* empty cache for day offsets */
        renderitems_day_cache = null;
    }

    function reached_end (seek, skip) {
        end_box.text(_("-- End of Journal, waiting for more --"));
    }

    function append_entries(entries) {
        for (var i = 0; i < entries.length; i++)
            renderer.append(entries[i]);
        renderer.append_flush();
        /* empty cache for day offsets */
        renderitems_day_cache = null;
    }

    function reached_start () {
        start_box.text(_("-- Start of Journal --"));
    }

    function didnt_reach_start (first) {
        var button = $('<button id="journal-load-earlier" class="btn btn-default" data-inline="true" data-mini="true">' +
                       _("Load earlier entries") +
                       '</button>');
        start_box.html(button);
        button.click(function () {
            var count = 0;
            var stopped = null;
            start_box.text(_("Loading..."));
            procs.push(cockpit.journal(match, { follow: false, reverse: true, cursor: first, host: machine }).
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
                    if (!stopped)
                        reached_start();
                }));
        });
    }

    function follow(cursor) {
        procs.push(cockpit.journal(match, { follow: true, count: 0, cursor: cursor, host: machine }).
            fail(query_error).
            stream(function(entries) {
                if (entries[0]["__CURSOR"] == cursor)
                    entries.shift();
                prepend_entries(entries);
                update_day_box();
            }));
    }

    function update_day_box () {
        /* We work with document coordinates here and from that
         * viewpoint, the header slides down the document during
         * scrolling.
         */
        var border = $(header).offset().top + $(header).outerHeight();
        /* Build cache if empty
         */
        if (renderitems_day_cache === null) {
            renderitems_day_cache = [];
            for (var d = box[0].firstChild; d; d = d.nextSibling) {
                /* if not a day header, ignore
                */
                if (!$(d).hasClass('cockpit-loghead')) {
                    continue;
                }

                renderitems_day_cache.push([$(d).offset().top, $(d).text()]);
            }
        }
        if (renderitems_day_cache.length > 0) {
            /* Find the last day that begins above border
             */
            var currentIndex = 0;
            while ( (currentIndex+1) < renderitems_day_cache.length &&
                    renderitems_day_cache[currentIndex+1][0] < border) {
                currentIndex++;
            }
            $(day_box).text(renderitems_day_cache[currentIndex][1]);
        }
        else {
            /* No visible day headers
             */
            $(day_box).text(_("Go to"));
        }
    }

    box.empty();
    start_box.text(_("Loading..."));
    end_box.text(_("Loading..."));

    if (day_box) {
        $(window).on('scroll', update_day_box);
    }

    var options = {
        follow: false,
        reverse: true,
        host: machine
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

    procs.push(cockpit.journal(match, options).
        fail(query_error).
        stream(function(entries) {
            if (!last) {
                reached_end();
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
            if (!last) {
                reached_end();
                procs.push(cockpit.journal(match, { follow: true, count: 0, host: machine }).
                    fail(query_error).
                    stream(function(entries) {
                        prepend_entries(entries);
                        update_day_box();
                    }));
            }
            if (all && !stopped)
                reached_start();
            else
                didnt_reach_start();
        }));

    return {
        stop: function stop() {
            $.each(procs, function(i, proc) {
                proc.stop();
            });
        }
    };
}

PageJournal.prototype = {
    _init: function() {
        this.id = "journal";
    },

    getTitle: function() {
        return C_("page-title", "Journal");
    },

    show: function() {
    },

    setup: function() {
        var self = this;

        $('#journal-box').on('click', '.cockpit-logline', function (event) {
            self.details($(this).data('cockpit-journal-cursor'));
        });
    },

    enter: function() {
        var me = this;

        $('#content-header-extra').
            append('<div class="btn-group" id="journal-current-day-menu"> \
                      <button class="btn btn-default dropdown-toggle" data-toggle="dropdown" style="padding-left:10px"><span id="journal-current-day"></span> <span class="caret"></span></button> \
                      <ul class="dropdown-menu" role="menu"> \
                        <li><a data-op="recent">Recent</a></li> \
                        <li><a data-op="boot">Current boot</a></li> \
                        <li><a data-op="last-24h">Last 24 hours</a></li> \
                        <li><a data-op="last-week">Last 7 days</a></li> \
                      </ul> \
                    </div>');

        $('#journal-current-day-menu a').on('click', function () {
            me.query_start = $(this).attr("data-op");
            me.reset_query ();
        });

        var priority_labels = [ _("Errors"), _("Warnings"), _("Notices"), _("All") ];
        var priority_buttons = priority_labels.map(function (l, i) {
            function click() {
                if (i != me.query_prio) {
                    me.query_prio = i;
                    update_priority_buttons(i);
                    me.reset_query();
                }
            }
            return $('<button>', { 'class': 'btn btn-default',
                                   'on': { 'click': click }
                                 }).text(l);
        });

        function update_priority_buttons(v) {
            priority_buttons.forEach(function (b, i) {
                b.toggleClass('active', i <= v);
            });
        }

        $('#content-header-extra').append($('<div>', { 'class': 'btn-group' }).append(priority_buttons));

        this.query_prio = parseInt(cockpit.get_page_param('prio') || "0", 10);
        this.query_service = cockpit.get_page_param('service') || "";
        this.query_tag = cockpit.get_page_param('tag') || "";
        this.query_start = cockpit.get_page_param('start') || "recent";

        update_priority_buttons (this.query_prio);

        this.address = cockpit.get_page_machine();

        this.reset_query ();
    },

    leave: function() {
        if (this.filler)
            this.filler.stop();
    },

    reset_query: function () {
        if (this.filler)
            this.filler.stop();

        var prio_param = this.query_prio;
        var service_param = this.query_service;
        var start_param = this.query_start;
        var tag_param = this.query_tag;

        cockpit.set_page_param('prio', prio_param.toString());
        cockpit.set_page_param('service', service_param);
        cockpit.set_page_param('tag', tag_param);
        cockpit.set_page_param('start', start_param);

        var match = [ ];

        var prio_level = { "0": 3,
                           "1": 4,
                           "2": 5,
                           "3": null
                         }[prio_param];

        if (prio_level) {
            for (var i = 0; i <= prio_level; i++)
                match.push('PRIORITY=' + i.toString());
        }

        if (service_param)
            match.push('_SYSTEMD_UNIT=' + service_param);
        else if (tag_param)
            match.push('SYSLOG_IDENTIFIER=' + tag_param);

        if (start_param == 'recent')
            $(window).scrollTop($(document).height());

        this.filler = journal_filler(this.address,
                                     $('#journal-box'), start_param, match,
                                     '#content nav', '#journal-current-day',
                                     $('#journal-start'), $('#journal-end'));
    },

    details: function(cursor) {
        if (cursor)
            cockpit.go_rel({ page: 'journal-entry',
                             c: cursor });
    }
};

function PageJournal() {
    this._init();
}

cockpit.pages.push(new PageJournal());


PageJournalEntry.prototype = {
    _init: function() {
        this.id = "journal-entry";
        this.section_id = "journal";
    },

    getTitle: function() {
        return C_("page-title", "Journal");
    },

    show: function() {
    },

    enter: function() {
        var cursor = cockpit.get_page_param('c');
        var out = $('#journal-entry-fields');

        out.empty();

        function show_entry(entry) {
            $('#journal-entry-message').text(entry["MESSAGE"]);

            var d = new Date(entry["__REALTIME_TIMESTAMP"] / 1000);
            $('#journal-entry-date').text(d.toString());

            var id;
            if (entry["SYSLOG_IDENTIFIER"])
                id = entry["SYSLOG_IDENTIFIER"];
            else if (entry["_SYSTEMD_UNIT"])
                id = entry["_SYSTEMD_UNIT"];
            else
                id = _("Journal entry");
            $('#journal-entry-id').text(id);

            var keys = Object.keys(entry).sort();
            $.each(keys, function(i, key) {
                if (key != "MESSAGE") {
                    out.append(
                        $('<tr>').append(
                            $('<td style="text-align:right">').
                                text(key),
                            $('<td style="text-align:left">').
                                text(entry[key])));
                }
            });
        }

        function show_error(error) {
            out.append(
                $('<tr>').append(
                    $('<td>').
                        text(error)));
        }

        cockpit.journal({ cursor: cursor, count: 1, follow: false }).
            done(function (entries) {
                if (entries.length >= 1 && entries[0]["__CURSOR"] == cursor)
                    show_entry(entries[0]);
                else
                    show_error(_("Journal entry not found"));
            }).
            fail(function (error) {
                show_error(error);
            });
    },

    leave: function() {
    }
};

function PageJournalEntry() {
    this._init();
}

cockpit.pages.push(new PageJournalEntry());

})(cockpit, jQuery);
