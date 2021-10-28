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

import * as machine_info from "machine-info.js";

// map an info.system key to a /sys/class/dmi/id/* attribute name
const InfoDMIKey = {
    version: "product_version",
    name: "product_name",
    alt_version: "board_vendor",
    alt_name: "board_name",
    type: "chassis_type_str",
    bios_vendor: "bios_vendor",
    bios_version: "bios_version",
    bios_date: "bios_date",
};

const getDMI = info => machine_info.dmi_info()
        .then(fields => {
            Object.keys(InfoDMIKey).forEach(key => {
                info.system[key] = fields[InfoDMIKey[key]];
            });
            return true;
        });

const getDeviceTree = info => machine_info.devicetree_info()
        .then(fields => {
            // if getDMI sets a field first, let that win
            if (fields.model && !info.system.name)
                info.system.name = fields.model;
            return true;
        });

// Add info.pci [{slot, cls, vendor, model}] list
function findPCI(udevdb, info) {
    for (const syspath in udevdb) {
        const props = udevdb[syspath];
        if (props.SUBSYSTEM === "pci")
            info.pci.push({
                slot: props.PCI_SLOT_NAME || syspath.split("/").pop() || "",
                cls: props.ID_PCI_CLASS_FROM_DATABASE || props.PCI_CLASS.toString() || "",
                vendor: props.ID_VENDOR_FROM_DATABASE || "",
                model: props.ID_MODEL_FROM_DATABASE || props.PCI_ID || ""
            });
    }
}

export default function detect() {
    const info = { system: {}, pci: [], memory: [] };
    const tasks = [];

    tasks.push(machine_info.cpu_ram_info()
            .then(result => {
                info.system.cpu_model = result.cpu_model;
                info.system.nproc = result.cpus;
                return true;
            }));

    tasks.push(getDMI(info)
            .catch(error => {
                console.warn("Failed to get DMI information:", error.toString());
                return true;
            }));

    tasks.push(getDeviceTree(info)
            .catch(error => {
                console.debug("Failed to get DeviceTree information:", error.toString());
                return true;
            }));

    tasks.push(machine_info.udev_info()
            .then(result => {
                findPCI(result, info);
                return true;
            })
            .catch(error => {
                console.warn("Failed to get udev information:", error.toString());
                return true;
            }));

    tasks.push(machine_info.memory_info()
            .then(result => {
                info.memory = result;
                return true;
            })
            .catch(error => {
                console.warn("Failed to get dmidecode information: ", error.toString());
                return true;
            }));

    // return info after all task promises got done
    return Promise.all(tasks).then(() => info);
}
