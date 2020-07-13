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

function prepareObj(dataElem, valueTransformer) {
    const options = valueTransformer(dataElem);

    let startLine = true;
    let result = "";
    Object.keys(options).forEach((optionKey) => {
        const option = options[optionKey];
        if (option) {
            if (typeof option === "boolean")
                result += (startLine) ? `${optionKey}` : `,${optionKey}`;
            else
                result += (startLine) ? `${optionKey}=${option}` : `,${optionKey}=${option}`;
            if (startLine)
                startLine = false;
        }
    });

    return result;
}

function prepareParamsFromObj(dataElem, valueTransformer) {
    return prepareObj(dataElem, valueTransformer);
}

function prepareParamsFromArrOfObjs(arrayData, valueTransformer) {
    return arrayData.map(dataElem => prepareObj(dataElem, valueTransformer)).join("\n");
}

function prepareParamsFromObjOfObjs(objectData, valueTransformer) {
    return Object.keys(objectData).map(key => prepareObj(objectData[key], valueTransformer))
            .join("\n");
}

export function prepareDisplaysParam(displays) {
    return prepareParamsFromObjOfObjs(displays, display => {
        return {
            type: display.type,
            listen: display.address,
            port: display.port,
            tlsport: display.tlsPort,
        };
    });
}

export function prepareNICParam(nics) {
    return prepareParamsFromArrOfObjs(nics, nic => {
        return {
            user: nic.type === "user",
            bridge: nic.source.bridge,
            network: nic.source.network,
            type: (nic.type === "direct" || nic.type === "ethernet") ? nic.type : null,
            source: nic.source.dev,
            mac: nic.mac,
            model: nic.model,
            boot_order: nic.bootOrder,
            link_state: nic.state,
        };
    });
}

export function prepareMemoryParam(currentMemory, memory) {
    return prepareParamsFromObj({ currentMemory, memory }, ({ currentMemory, memory }) => {
        return {
            memory: currentMemory,
            maxmemory: memory,
        };
    });
}

export function prepareVcpuParam(vcpu, cpu) {
    return prepareParamsFromObj({ vcpu, cpu }, ({ vcpu, cpu }) => {
        return {
            vcpus: vcpu.count,
            maxvcpus: vcpu.max,
            sockets: cpu.topology.sockets,
            cores: cpu.topology.cores,
            threads: cpu.topology.threads,
        };
    });
}

export function prepareDisksParam(disks) {
    const isVolume = (disk) => disk.source.volume && disk.source.pool;
    const getVolume = (disk) => isVolume(disk) ? `${disk.source.pool}/${disk.source.volume}` : null;
    const getPath = (disk) => {
        // see: https://libvirt.org/formatdomain.html#elementsDisks -> source
        switch (disk.type) {
        case "file": return disk.source.file;
        case "block": return disk.source.dev;
        case "network": return disk.source.protocol;
        default: return null; // type volume (doesn't have path) and type dir (unsupported)
        }
    };

    return prepareParamsFromObjOfObjs(disks, disk => {
        return {
            path: getPath(disk),
            vol: getVolume(disk),
            device: disk.device,
            boot_order: disk.bootOrder,
            bus: disk.bus,
            removable: disk.removable,
            readonly: disk.readonly ? 'on' : 'off',
            shareable: disk.shareable ? 'on' : 'off',
            cache: disk.driver.cache,
            discard: disk.driver.discard,
            driver_name: disk.driver.name,
            driver_type: disk.driver.type,
            io: disk.driver.io,
            error_policy: disk.driver.errorPolicy,
            startup_policy: disk.source.startupPolicy,
            // format: libvirt's format auto-detection
        };
    });
}
