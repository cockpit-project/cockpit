/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import cockpit from "cockpit";
const _ = cockpit.gettext;

var cpu_ram_info_promises = { };

export function cpu_ram_info(address) {
    var pr = cpu_ram_info_promises[address];
    var dfd;
    if (!pr) {
        dfd = cockpit.defer();
        cpu_ram_info_promises[address] = pr = dfd.promise();

        cockpit.spawn(["cat", "/proc/meminfo", "/proc/cpuinfo"], { host: address })
                .done(function(text) {
                    var info = { };
                    var match = text.match(/MemTotal:[^0-9]*([0-9]+) [kK]B/);
                    var total_kb = match && parseInt(match[1], 10);
                    if (total_kb)
                        info.memory = total_kb * 1024;
                    var swap_match = text.match(/SwapTotal:[^0-9]*([0-9]+) [kK]B/);
                    var swap_total_kb = swap_match && parseInt(swap_match[1], 10);
                    if (swap_total_kb)
                        info.swap = swap_total_kb * 1024;

                    match = text.match(/^model name\s*:\s*(.*)$/m);
                    if (match)
                        info.cpu_model = match[1];

                    info.cpus = 0;
                    var re = /^processor/gm;
                    while (re.test(text))
                        info.cpus += 1;
                    dfd.resolve(info);
                })
                .fail(function() {
                    dfd.reject();
                });
    }
    return pr;
}

// https://www.dmtf.org/sites/default/files/standards/documents/DSP0134_2.7.1.pdf
const chassis_types = [
    undefined,
    _("Other"),
    _("Unknown"),
    _("Desktop"),
    _("Low Profile Desktop"),
    _("Pizza Box"),
    _("Mini Tower"),
    _("Tower"),
    _("Portable"),
    _("Laptop"),
    _("Notebook"),
    _("Hand Held"),
    _("Docking Station"),
    _("All In One"),
    _("Sub Notebook"),
    _("Space-saving Computer"),
    _("Lunch Box"), /* 0x10 */
    _("Main Server Chassis"),
    _("Expansion Chassis"),
    _("Sub Chassis"),
    _("Bus Expansion Chassis"),
    _("Peripheral Chassis"),
    _("RAID Chassis"),
    _("Rack Mount Chassis"),
    _("Sealed-case PC"),
    _("Multi-system Chassis"),
    _("Compact PCI"), /* 0x1A */
    _("Advanced TCA"),
    _("Blade"),
    _("Blade enclosure"),
    _("Tablet"),
    _("Convertible"),
    _("Detachable"), /* 0x20 */
    _("IoT Gateway"),
    _("Embedded PC"),
    _("Mini PC"),
    _("Stick PC"),
];

function parseDMIFields(text) {
    var info = {};
    text.split("\n").map(line => {
        let sep = line.indexOf(':');
        if (sep <= 0)
            return;
        let key = line.slice(0, sep);
        let value = line.slice(sep + 1);
        info[key] = value;

        if (key === "chassis_type")
            info[key + "_str"] = chassis_types[parseInt(value)] || chassis_types[2]; // fall back to "Unknown"
    });
    return info;
}

var dmi_info_promises = { };

export function dmi_info(address) {
    var pr = dmi_info_promises[address];
    var dfd;
    if (!pr) {
        dfd = cockpit.defer();
        dmi_info_promises[address] = pr = dfd.promise();

        cockpit.spawn(["grep", "-r", "."],
                      { directory: "/sys/class/dmi/id", err: "ignore", superuser: "try" })
                .done(output => dfd.resolve(parseDMIFields(output)))
                .fail((exception, output) => {
                // the grep often/usually exits with 2, that's okay as long as we find *some* information
                    if (!exception.problem && output)
                        dfd.resolve(parseDMIFields(output));
                    else
                        dfd.reject(exception.message);
                });
    }
    return pr;
}

/* we expect udev db paragraphs like this:
 *
   P: /devices/virtual/mem/null
   N: null
   E: DEVMODE=0666
   E: DEVNAME=/dev/null
   E: SUBSYSTEM=mem
*/

const udevPathRE = /^P: (.*)$/;
const udevPropertyRE = /^E: (\w+)=(.*)$/;

function parseUdevDB(text) {
    var info = {};
    text.split("\n\n").map(paragraph => {
        let syspath = null;
        let props = {};

        paragraph = paragraph.trim();
        if (!paragraph)
            return;

        paragraph.split("\n").map(line => {
            let match = line.match(udevPathRE);
            if (match) {
                syspath = match[1];
            } else {
                match = line.match(udevPropertyRE);
                if (match)
                    props[match[1]] = match[2];
            }
        });

        if (syspath)
            info[syspath] = props;
        else
            console.log("udev database paragraph is missing P:", paragraph);
    });
    return info;
}

var udev_info_promises = { };

export function udev_info(address) {
    var pr = udev_info_promises[address];
    var dfd;
    if (!pr) {
        dfd = cockpit.defer();
        udev_info_promises[address] = pr = dfd.promise();

        cockpit.spawn(["udevadm", "info", "--export-db"], { err: "message" })
                .done(output => dfd.resolve(parseUdevDB(output)))
                .fail(exception => dfd.reject(exception.message));
    }
    return pr;
}

const memoryRE = /^([ \w]+): (.*)/;

// Process the dmidecode text output and create a mapping of locator to dimm properties {"A1": {Array Handle: "0x1000"...,},...}
function parseMemoryInfo(text) {
    var info = {};
    text.split("\n\n").map(paragraph => {
        let locator = null;
        let props = {};

        paragraph = paragraph.trim();
        if (!paragraph)
            return;

        paragraph.split("\n").map(line => {
            line = line.trim();
            let match = line.match(memoryRE);
            if (match)
                props[match[1]] = match[2];
        });

        locator = props["Locator"];
        if (locator)
            info[locator] = props;
    });

    return processMemory(info);
}

// Select the useful properties to display
function processMemory(info) {
    var memory_array = [];
    var empty_slots = 0;

    for (let dimm in info) {
        let memory = info[dimm];
        if (memory["Type Detail"] == "None") {
            empty_slots += 1;
        }
        memory_array.push({ locator: memory["Locator"],
                            manufacturer: memory["Manufacturer"],
                            type_detail: memory["Type Detail"],
                            size: memory["Size"],
                            speed: memory["Speed"],
                            part_number: memory["Part Number"],
                            serial: memory["Serial Number"] });
    }
    return {"array": memory_array, "empty_slots": empty_slots};
}

var memory_info_promises = { };

// Calls dmidecode to gather memory information. Returns array of properties mapping and number of empty slots for preprocessing.
// Return {"array": memory, "empty_slots": #}
export function memory_info(address) {
    var pr = memory_info_promises[address];
    var dfd;

    if (!pr) {
        dfd = cockpit.defer();
        memory_info_promises[address] = pr = dfd.promise();
        cockpit.spawn(["/usr/sbin/dmidecode", "-t", "memory"], { environ: ["LC_ALL=C"], err: "message", superuser: "try" })
                .done(output => dfd.resolve(parseMemoryInfo(output)))
                .fail(exception => dfd.reject(exception.message));
    }
    return pr;
}
