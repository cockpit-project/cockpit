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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';

/* until we have a good dbus interface to get selinux status updates,
 * we resort to polling
 */

// how often to check the status [milliseconds]
const pollingInterval = 10000;

const statusCommand = "sestatus";

// currentStatus reflects the status of SELinux on the system
const status = {
    enabled: undefined,
    enforcing: false,
    configEnforcing: false, // configured mode at boot time
    shell: "",
    ansible: "",
    modifications: null,
    permitted: true,
    failed: false,
};

/* initializes the selinux status updating, returns initial status
 * statusChangedCallback parameters (status, errorMessage)
 * status with the following properties:
 *   - enabled:          undefined (couldn't get info), true (enabled) or false (disabled)
 *                      cannot be changed without a reboot
 *   - enforcing:       boolean (current selinux mode of the system, false if permissive or selinux disabled)
 *   - configEnforcing: boolean (mode the system is configured to boot in, may differ from current mode)
 *   - shell:           Output of `semanage export`
 *   - ansible:         Ansible script for setting up local modifications
 *   - modifications:   List of all local modifications in selinux policy
 *   - permitted:       Set to false if user is not allowed to see local modifications
 *   - failed:          Reading of modifications failed in unexpected way
 * errorMessage:    optional, if getting the status failed, here will be additional info
 *
 * Since we're screenscraping we need to run this in LC_ALL=C mode
 */
export function init(statusChangedCallback) {
    const refreshInfo = function() {
        cockpit.spawn(statusCommand, { err: 'message', environ: ["LC_ALL=C"], superuser: "try" }).then(
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

                const lines = output.split("\n");
                lines.forEach(function(itm) {
                    const items = itm.trim().split(":");
                    if (items.length !== 2)
                        return;
                    const key = items[0].trim();
                    const value = items[1].trim();
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

    let polling = null;

    function setupPolling() {
        if (cockpit.hidden) {
            window.clearInterval(polling);
            polling = null;
        } else if (polling === null) {
            polling = window.setInterval(refreshInfo, pollingInterval);
            refreshInfo();
            getModifications(statusChangedCallback);
        }
    }

    cockpit.addEventListener("visibilitychange", setupPolling);
    setupPolling();

    /* The first time */
    if (polling === null)
        refreshInfo();

    return status;
}

function parseBoolean(result, item) {
    // Example:
    // authlogin_nsswitch_use_ldap (on , on) Allow authlogin to nsswitch use ldap
    // Split by first ')', as the name cannot contain ')'
    if (item) {
        const match = item.match(/(\S*)\s*\((\S*)\s*,.*\)\s*(.*)/);
        if (match) {
            let description = match[3];
            let enable_val = "--on";
            if (match[2] !== "on") {
                enable_val = "--off";
                description = description.replace("Allow", "Disallow");
            }
            // We want to support Ansible Core, the `seboolean:` module is not a builtin
            const ansible = `
- name: ${description}
  command: semanage boolean -m ${enable_val} ${match[1]}
`;
            result.push({ description, ansible });
        }
    }
    return result;
}

export function getModifications(statusChangedCallback) {
    // List of items we know how to parse
    const manageditems_callbacks = [["boolean", parseBoolean]];
    const manageditems = manageditems_callbacks.map(item => item[0]);

    // Building a query to get information from semanage
    // Use `semanage export` to show shell script (and parse types we yet don't parse explicitly)
    // Use `semanage <type> --list -C` to get better readable and parsable local changes
    // Use `echo '~~~~~'` as separator, so we don't need to execute multiple commands
    let script = "semanage export";
    manageditems.forEach(item => { script += " && echo '~~~~~' && semanage " + item + " --list -C --noheading" });
    cockpit.script(script, [], { err: 'message', environ: ["LC_MESSAGES=C"], superuser: "try" })
            .then(output => {
                output = output.split("~~~~~");
                status.shell = output[0];
                status.modifications = [];
                status.ansible = "";

                for (let i = 1; i < output.length; i++) {
                    const parsed = output[i].trim().split("\n")
                            .reduce(manageditems_callbacks[i - 1][1], []);
                    parsed.forEach(p => {
                        status.modifications.push(p.description);
                        status.ansible += p.ansible;
                    });
                }

                const shell_rules = {};
                // As long as we don't parse all items, we need to get some from general export
                // Once we can parse all types, this can be dropped
                status.modifications.push(...(output[0].split("\n").reduce(function (result, mod) {
                    mod = mod.trim();
                    if (mod === "")
                        return result;

                    const items = mod.split(" ");

                    // Skip enumeration of types, e.g. 'boolean -D'
                    if (items.length === 2 && items[1] == "-D")
                        return result;

                    if (manageditems.indexOf(items[0]) < 0) {
                        if (items[0] in shell_rules)
                            shell_rules[items[0]].push("    semanage " + mod);
                        else
                            shell_rules[items[0]] = ["    semanage " + mod];
                        result.push(mod);
                    }
                    return result;
                }, [])));

                // Create shell rule for every ansible group separately
                Object.keys(shell_rules).forEach(t => {
                    const rules = shell_rules[t].join("\n");
                    status.ansible += `
- name: Set up ${t} customizations
  shell: |
    semanage ${t} -D
${rules}
`;
                });

                statusChangedCallback(status, undefined);
            })
            .catch(e => {
                status.modifications = [];
                if (e.message.indexOf("ValueError:") >= 0) {
                    status.permitted = false;
                    statusChangedCallback(status, undefined);
                } else {
                    status.failed = true;
                    statusChangedCallback(status, e.message);
                }
            });
}

// returns a promise of the command used to set enforcing mode
export function setEnforcing(enforcingMode) {
    const command = ["setenforce", (enforcingMode ? "1" : "0")];
    return cockpit.spawn(command, { superuser: "require", err: "message" });
}
