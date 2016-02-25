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
    "translated!base1/po",
    "base1/mustache",
    "system/journalctl",
    "system/renderer"
], function($, cockpit, po, Mustache, journalctl, journal_renderer) {
    "use strict";

    cockpit.locale(po);
    cockpit.translate();
    var _ = cockpit.gettext;

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

        journal_renderer.journalbox($("#journal-box"), query_start, match, $('#journal-current-day'));
    }

    function update_entry() {
        var cursor = cockpit.location.path[0];
        var out = $('#journal-entry-fields');

        out.empty();

        function show_entry(entry) {
            $('#journal-entry-message').text(journal_renderer.make_printable(entry["MESSAGE"]));

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
                                text(journal_renderer.make_printable(entry[key]))));
                }
            });
        }

        function show_error(error) {
            out.append(
                $('<tr>').append(
                    $('<td>').
                        text(error)));
        }

        journalctl({ cursor: cursor, count: 1, follow: false }).
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

    return update;
});
