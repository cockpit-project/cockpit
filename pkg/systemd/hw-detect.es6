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

import * as machine_info from "machine-info.es6";

// map an info.system key to a /sys/class/dmi/id/* attribute name
const InfoDMIKey = {
    version: "product_version",
    name: "product_name",
    type: "chassis_type_str",
    bios_vendor: "bios_vendor",
    bios_version: "bios_version",
    bios_date: "bios_date",
};

function getDMI(info) {
    return new Promise((resolve, reject) => {
        machine_info.dmi_info()
                .done(fields => {
                    Object.keys(InfoDMIKey).forEach(key => {
                        info.system[key] = fields[InfoDMIKey[key]];
                    });
                    resolve();
                })
                .fail(reject);
    });
}

// Add info.pci [{slot, cls, vendor, model}] list
function findPCI(udevdb, info) {
    for (let syspath in udevdb) {
        let props = udevdb[syspath];
        if (props.SUBSYSTEM === "pci")
            info.pci.push({ slot: props.PCI_SLOT_NAME || syspath.split("/").pop(),
                            cls: props.ID_PCI_CLASS_FROM_DATABASE || props.PCI_CLASS.toString(),
                            vendor: props.ID_VENDOR_FROM_DATABASE || "",
                            model: props.ID_MODEL_FROM_DATABASE || props.PCI_ID || "" });
    }
}

export default function detect() {
    let info = { system: {}, pci: [], memory: {} };
    var tasks = [];

    tasks.push(new Promise((resolve, reject) => {
        machine_info.cpu_ram_info()
                .done(result => {
                    info.system.cpu_model = result.cpu_model;
                    info.system.nproc = result.cpus;
                    resolve();
                });
    }));

    tasks.push(new Promise((resolve, reject) => {
        getDMI(info)
                .then(() => resolve())
                .catch(error => {
                // DMI only works on x86 machines; check devicetree (or what lshw does) on other arches
                    console.warn("Failed to get DMI information:", error.toString());
                    resolve();
                });
    }));

    tasks.push(new Promise((resolve, reject) => {
        machine_info.udev_info()
                .done(result => {
                    findPCI(result, info);
                    resolve();
                })
                .catch(error => {
                    console.warn("Failed to get udev information:", error.toString());
                    resolve();
                });
    }));

    tasks.push(new Promise((resolve, reject) => {
        machine_info.memory_info()
                .done(result => {
                    info.memory = result;
                    resolve();
                })
                .catch(error => {
                    console.warn("Failed to get dmidecode information:", error.toString());
                    resolve();
                });
    }));

    // return info after all task promises got done
    return new Promise((resolve, reject) => {
        Promise.all(tasks).then(() => resolve(info));
    });
}
