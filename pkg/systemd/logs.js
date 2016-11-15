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

var $ = require("jquery");
$(function() {
    "use strict";

    var cockpit = require("cockpit");

    var journal = require("journal");

    cockpit.translate();
    var _ = cockpit.gettext;

    /* Not public API */
    function journalbox(outer, start, match, day_box) {
        var box = $('<div class="panel panel-default cockpit-log-panel">');
        var start_box = $('<div class="journal-start">');

        outer.empty().append(box, start_box);

        var query_count = 5000;
        var query_more = 1000;

        var renderer = journal.renderer(box);
        /* cache to store offsets for days */
        var renderitems_day_cache = null;
        var procs = [];

        function query_error(error) {
            /* TODO: blank slate */
            console.warn(cockpit.message(error));
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
                procs.push(journal.journalctl(match, { follow: false, reverse: true, cursor: first }).
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
            procs.push(journal.journalctl(match, { follow: true, count: 0, cursor: cursor }).
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

        procs.push(journal.journalctl(match, options).
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
                    procs.push(journal.journalctl(match, { follow: true, count: 0,
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
    }

    var filler;

    function stop_query() {
        if (filler)
            filler.stop();
    }

    function update_query() {
        stop_query();

        var match = [ ];

        var query_prio = cockpit.location.options['prio'] || "3";
        var prio_level = parseInt(query_prio, 10);
        $("#journal-prio button").each(function() {
            var num = parseInt($(this).attr("data-prio"), 10);
            $(this).toggleClass('active', isNaN(prio_level) || num <= prio_level);
        });

        if (prio_level) {
            for (var i = 0; i <= prio_level; i++)
                match.push('PRIORITY=' + i.toString());
        }

        var options = cockpit.location.options;
        if (options['service'])
            match.push('_SYSTEMD_UNIT=' + options['service']);
        else if (options['tag'])
            match.push('SYSLOG_IDENTIFIER=' + options['tag']);

        var query_start = cockpit.location.options['start'] || "recent";
        if (query_start == 'recent')
            $(window).scrollTop($(document).height());

        journalbox($("#journal-box"), query_start, match, $('#journal-current-day'));
    }

    function update_entry() {
        var cursor = cockpit.location.path[0];
        var out = $('#journal-entry-fields');

        out.empty();

        function show_entry(entry) {
            $('#journal-entry-message').text(journal.printable(entry["MESSAGE"]));

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
                            $('<td>').css("text-align", "right").text(key),
                            $('<td>').css("text-align", "left").
                                text(journal.printable(entry[key]))));
                }
            });
        }

        function show_error(error) {
            out.append(
                $('<tr>').append(
                    $('<td>').
                        text(error)));
        }

        journal.journalctl({ cursor: cursor, count: 1, follow: false }).
            done(function (entries) {
                if (entries.length >= 1 && entries[0]["__CURSOR"] == cursor)
                    show_entry(entries[0]);
                else
                    show_error(_("Journal entry not found"));
            }).
            fail(function (error) {
                show_error(error);
            });
    }

    function update() {
        var path = cockpit.location.path;
        if (path.length === 0) {
            $("#journal-entry").hide();
            update_query();
            $("#journal").show();
        } else if (path.length == 1) {
            stop_query();
            $("#journal").hide();
            update_entry();
            $("#journal-entry").show();
        } else { /* redirect */
            console.warn("not a journal location: " + path);
            cockpit.location = '';
        }
        $("body").show();
    }

    $(cockpit).on("locationchanged", update);

    $('#journal-current-day-menu a').on('click', function() {
        cockpit.location.go([], $.extend(cockpit.location.options, { start: $(this).attr("data-op") }));
    });

    $('#journal-box').on('click', '.cockpit-logline', function() {
         var cursor = $(this).attr('data-cursor');
         if (cursor)
            cockpit.location.go([ cursor ]);
    });

    $('#journal-prio button').on("click", function() {
        var options = cockpit.location.options;
        var prio = $(this).attr('data-prio');
        if (prio)
            options.prio = prio;
        else
            delete options.prio;
        cockpit.location.go([], options);
    });

    $('#journal-navigate-home').on("click", function() {
        cockpit.location.go('/');
    });

    update();
});
