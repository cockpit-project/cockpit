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

export const cpu_ram_info = () =>
    cockpit.spawn(["cat", "/proc/meminfo", "/proc/cpuinfo"])
            .then(text => {
                const info = { };
                const memtotal_match = text.match(/MemTotal:[^0-9]*([0-9]+) [kK]B/);
                const total_kb = memtotal_match && parseInt(memtotal_match[1], 10);
                if (total_kb)
                    info.memory = total_kb * 1024;

                const available_match = text.match(/MemAvailable:[^0-9]*([0-9]+) [kK]B/);
                const available_kb = available_match && parseInt(available_match[1], 10);
                if (available_kb)
                    info.available_memory = available_kb * 1024;

                const swap_match = text.match(/SwapTotal:[^0-9]*([0-9]+) [kK]B/);
                const swap_total_kb = swap_match && parseInt(swap_match[1], 10);
                if (swap_total_kb)
                    info.swap = swap_total_kb * 1024;

                let model_match = text.match(/^model name\s*:\s*(.*)$/m);
                if (!model_match)
                    model_match = text.match(/^cpu\s*:\s*(.*)$/m); // PowerPC
                if (!model_match)
                    model_match = text.match(/^vendor_id\s*:\s*(.*)$/m); // s390x
                if (model_match)
                    info.cpu_model = model_match[1];

                info.cpus = 0;
                const re = /^(processor|cpu number)\s*:/gm;
                while (re.test(text))
                    info.cpus += 1;
                return info;
            });

// https://www.dmtf.org/sites/default/files/standards/documents/DSP0134_2.7.1.pdf
const chassis_types = [
    undefined,
    _("Other"),
    _("Unknown"),
    _("Desktop"),
    _("Low profile desktop"),
    _("Pizza box"),
    _("Mini tower"),
    _("Tower"),
    _("Portable"),
    _("Laptop"),
    _("Notebook"),
    _("Handheld"),
    _("Docking station"),
    _("All-in-one"),
    _("Sub-Notebook"),
    _("Space-saving computer"),
    _("Lunch box"), /* 0x10 */
    _("Main server chassis"),
    _("Expansion chassis"),
    _("Sub-Chassis"),
    _("Bus expansion chassis"),
    _("Peripheral chassis"),
    _("RAID chassis"),
    _("Rack mount chassis"),
    _("Sealed-case PC"),
    _("Multi-system chassis"),
    _("Compact PCI"), /* 0x1A */
    _("Advanced TCA"),
    _("Blade"),
    _("Blade enclosure"),
    _("Tablet"),
    _("Convertible"),
    _("Detachable"), /* 0x20 */
    _("IoT gateway"),
    _("Embedded PC"),
    _("Mini PC"),
    _("Stick PC"),
];

function parseDMIFields(text) {
    const info = {};
    text.split("\n").forEach(line => {
        const sep = line.indexOf(':');
        if (sep <= 0)
            return;
        const file = line.slice(0, sep);
        const key = file.slice(file.lastIndexOf('/') + 1);
        let value = line.slice(sep + 1);

        // clean up after lazy OEMs
        if (value.match(/to be filled by o\.?e\.?m\.?/i))
            value = "";

        info[key] = value;

        if (key === "chassis_type")
            info[key + "_str"] = chassis_types[parseInt(value)] || chassis_types[2]; // fall back to "Unknown"
    });
    return info;
}

export function dmi_info() {
    // the grep often/usually exits with 2, that's okay as long as we find *some* information
    return cockpit.script("grep -r . /sys/class/dmi/id || true", null,
                          { err: "message", superuser: "try" })
            .then((output) => parseDMIFields(output));
}

// decode a binary Uint8Array with a trailing null byte
function decode_proc_str(s) {
    return cockpit.utf8_decoder().decode(s.slice(0, -1));
}

export function devicetree_info() {
    let model, serial;

    return Promise.all([
        // these succeed with content === null if files are absent
        cockpit.file("/proc/device-tree/model", { binary: true }).read()
                .then(content => { model = content ? decode_proc_str(content) : null }),
        cockpit.file("/proc/device-tree/serial-number", { binary: true }).read()
                .then(content => { serial = content ? decode_proc_str(content) : null }),
    ])
            .then(() => ({ model, serial }));
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
    const info = {};
    text.split("\n\n").forEach(paragraph => {
        let syspath = null;
        const props = {};

        paragraph = paragraph.trim();
        if (!paragraph)
            return;

        paragraph.split("\n").forEach(line => {
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

export function udev_info() {
    return cockpit.spawn(["udevadm", "info", "--export-db"], { err: "message" })
            .then(output => parseUdevDB(output));
}

const memoryRE = /^([ \w]+): (.*)/;

// Process the dmidecode output and create a mapping of locator to DIMM properties
function parseMemoryInfo(text) {
    const info = {};
    text.split("\n\n").forEach(paragraph => {
        let locator = null;
        let bankLocator = null;
        const props = {};
        paragraph = paragraph.trim();
        if (!paragraph)
            return;

        paragraph.split("\n").forEach(line => {
            line = line.trim();
            const match = line.match(memoryRE);
            if (match)
                props[match[1]] = match[2];
        });

        locator = props.Locator;
        bankLocator = props['Bank Locator'];
        if (locator)
            info[bankLocator + locator] = props;
    });
    return processMemory(info);
}

// Select the useful properties to display
function processMemory(info) {
    const memoryArray = [];

    for (const dimm in info) {
        const memoryProperty = info[dimm];

        let memorySize = memoryProperty.Size || _("Unknown");
        if (memorySize.includes("MB")) {
            const memorySizeValue = parseInt(memorySize, 10);
            memorySize = cockpit.format(_("$0 GiB"), memorySizeValue / 1024);
        }

        let memoryTechnology = memoryProperty["Memory technology"];
        if (!memoryTechnology || memoryTechnology == "<OUT OF SPEC>")
            memoryTechnology = _("Unknown");

        let memoryRank = memoryProperty.Rank || _("Unknown");
        if (memoryRank == 1)
            memoryRank = _("Single rank");
        if (memoryRank == 2)
            memoryRank = _("Dual rank");

        memoryArray.push({
            locator: (memoryProperty['Bank Locator'] + ': ' + memoryProperty.Locator) || _("Unknown"),
            technology: memoryTechnology,
            type: memoryProperty.Type || _("Unknown"),
            size: memorySize,
            state: memoryProperty["Total Width"] == "Unknown" ? _("Absent") : _("Present"),
            rank: memoryRank,
            speed: memoryProperty.Speed || _("Unknown")
        });
    }

    return memoryArray;
}

export function memory_info() {
    return cockpit.spawn(["dmidecode", "-t", "memory"], { environ: ["LC_ALL=C"], err: "message", superuser: "try" })
            .then(output => parseMemoryInfo(output));
}
