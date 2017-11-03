/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

var cockpit = require("cockpit");
var python = require("python.jsx");
var inotify_py = require("raw!inotify.py");
var watch_appstream_py = require("raw!./watch-appstream.py");

var metainfo_db = null;

function get_metainfo_db() {
    if (!metainfo_db) {
        metainfo_db = cockpit.event_target({
            ready: false,
            components: [ ],
            origin_files: [ ]
        });

        var buf = "";
        python.spawn([ inotify_py, watch_appstream_py ], [ ],
                     { environ: [ "LANGUAGE=" + (cockpit.language || "en") ]
                     })
            .stream(function (data) {
                var lines, metadata;

                buf += data;
                lines = buf.split("\n");
                buf = lines[lines.length-1];
                if (lines.length >= 2) {
                    metadata = JSON.parse(lines[lines.length-2]);
                    metainfo_db.components = metadata.components;
                    metainfo_db.origin_files = metadata.origin_files;
                    metainfo_db.ready = true;
                    metainfo_db.dispatchEvent("changed");
                }
            }).
            fail(function (error) {
                if (error != "closed") {
                    console.warn(error);
                }
            });
    }

    return metainfo_db;
}

module.exports = {
    get_metainfo_db: get_metainfo_db
};
