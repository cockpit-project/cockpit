/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
var moment = require("moment");

var atomic = {};
cockpit.event_target(atomic);

var bus = cockpit.dbus();
var intervalId;

function sanitizeVulnerableInfo (id, info) {
    return {
        id: id,
        successful: info.Successful === true || info.Successful === "true",
        scanType: info["Scan Type"],
        finishedTime: moment(info.FinishedTime),
        vulnerabilities: info.Vulnerabilities.map(function (v) {
            return {
                title: v.Title,
                description: v.Description,
                severity: v.Severity
            };
        })
    };
}

function updateVulnerableInfo() {
    bus.call("/org/atomic/object", "org.atomic", "VulnerableInfo", [], { name: 'org.atomic' })
        .done(function (reply) {
            var infos = {};

            try {
                infos = JSON.parse(reply[0]);
            } catch (error) {
                /* ignore errors (same as when org.atomic doesn't exist) */
            }

            var promises;

            /* Atomic sometimes returns containers for which it doesn't
             * have scan results. Remove those. */
            var ids = Object.keys(infos).filter(function (id) { return infos[id].json_file; });

            if (ids.length > 0) {
                promises = ids.map(function (id) {
                    return cockpit.file(infos[id].json_file, { syntax: JSON }).read();
                });

                cockpit.all(promises).done(function () {
                    var detailedInfos = {};

                    for (var i = 0; i < arguments.length; i++)
                        detailedInfos[ids[i]] = sanitizeVulnerableInfo(ids[i], arguments[i]);

                    atomic.dispatchEvent("vulnerableInfoChanged", detailedInfos);
                });
            }
        });
}

function visibilityChanged() {
    if (cockpit.hidden) {
        window.clearInterval(intervalId);
        intervalId = undefined;
    } else {
        if (!intervalId) {
            updateVulnerableInfo();
            intervalId = window.setInterval(updateVulnerableInfo, 10000);
        }
    }
}

cockpit.onvisibilitychange = visibilityChanged;
visibilityChanged();

module.exports = atomic;
