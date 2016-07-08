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

import cockpit from 'cockpit';

/* until we have a good dbus interface to get selinux status updates,
 * we resort to polling
 */

// how often to check the status [milliseconds]
var pollingInterval = 10000;

var statusCommand = "sestatus";

// currentStatus reflects the status of SELinux on the system
var status = {
    enabled: undefined,
    enforcing: false,
    configEnforcing: false, // configured mode at boot time
};

/* initializes the selinux status updating, returns initial status
 * statusChangedCallback parameters (status, errorMessage)
 * status with the following properties:
 *   - enabled:          undefined (couldn't get info), true (enabled) or false (disabled)
 *                      cannot be changed without a reboot
 *   - enforcing:       boolean (current selinux mode of the system, false if permissive or selinux disabled)
 *   - configEnforcing: boolean (mode the system is configured to boot in, may differ from current mode)
 * errorMessage:    optional, if getting the status failed, here will be additional info
 *
 * Since we're screenscraping we need to run this in LC_ALL=C mode
 */
export function init(statusChangedCallback) {
    var refreshInfo = function() {
        cockpit.spawn(statusCommand, { err: 'message', environ: [ "LC_ALL=C" ] }).then(
            function(output) {
                /* parse output that looks like this:
                 *   SELinux status:                 enabled
                 *   SELinuxfs mount:                /sys/fs/selinux
                 *   SELinux root directory:         /etc/selinux
                 *   Loaded policy name:             targeted
                 *   Current mode:                   enforcing
                 *   Mode from config file:          enforcing
                 *   Policy MLS status:              enabled
                 *   Policy deny_unknown status:     allowed
                 *   Max kernel policy version:      30
                 * We want the lines 'SELinux status', 'Current mode' and 'Mode from config file'
                 */

                var lines = output.split("\n");
                lines.map(function(itm) {
                    var items = itm.trim().split(":");
                    if (items.length !== 2)
                        return;
                    var key = items[0].trim();
                    var value = items[1].trim();
                    if (key == "SELinux status") {
                        status.enabled = (value == "enabled");
                    } else if (key == "Current mode") {
                        status.enforcing = (value == "enforcing");
                    } else if (key == "Mode from config file") {
                        if (value == 'error (Permission denied)') {
                            status.configEnforcing = undefined;
                        } else {
                            status.configEnforcing = (value == "enforcing");
                        }
                    }
                });
                if (statusChangedCallback)
                    statusChangedCallback(status, undefined);
            },
            function(error) {
                if (status === undefined)
                    return;
                if (statusChangedCallback) {
                    status.enabled = undefined;
                    statusChangedCallback(status, error.message);
                }
            }
        );
    };

    var polling = null;

    function setupPolling() {
        if (cockpit.hidden) {
            window.clearInterval(polling);
            polling = null;
        } else if (polling === null) {
            polling = window.setInterval(refreshInfo, pollingInterval);
            refreshInfo();
        }
    }

    cockpit.addEventListener("visibilitychange", setupPolling);
    setupPolling();

    /* The first time */
    if (polling === null)
        refreshInfo();

    return status;
}

// returns a promise of the command used to set enforcing mode
export function setEnforcing(enforcingMode) {
    var command = ["setenforce", (enforcingMode?"1":"0")];
    return cockpit.spawn(command, { superuser: true, err: "message" });
}
