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
define([
    "jquery",
    "base1/cockpit",
    "system/journalctl",
    "system/renderer"
], function($, cockpit, journalctl, journal_renderer) {
    "use strict";

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    var server = { };

    server.journal = journalctl;

    server.logbox = function logbox(match, max_entries) {
        var entries = [ ];
        var box = $("<div>");

        function render() {
            var renderer = journal_renderer.journal_renderer(journal_renderer.output_funcs_for_box(box));
            box.empty();
            for (var i = 0; i < entries.length; i++) {
                renderer.prepend(entries[i]);
            }
            renderer.prepend_flush();
            box.toggle(entries.length > 0);
        }

        render();

        var promise = server.journal(match, { count: max_entries }).
            stream(function(tail) {
                entries = entries.concat(tail);
                if (entries.length > max_entries)
                    entries = entries.slice(-max_entries);
                render();
            }).
            fail(function(error) {
                box.append(document.createTextNode(error.message));
                box.show();
            });

        /* Both a DOM element and a promise */
        return promise.promise(box);
    };

    return server;
});
