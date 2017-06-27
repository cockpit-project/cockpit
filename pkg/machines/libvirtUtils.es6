/*jshint esversion: 6 */

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

function prepareParams(objectData, valueTransformer) {
    let result = '';
    let startLine = true;
    Object.keys(objectData).forEach((key) => {
        const options = valueTransformer(objectData[key]);

        Object.keys(options).forEach((optionKey) => {
            const option = options[optionKey];
            if (option) {
                result += (startLine) ? `${optionKey}=${option}` : `,${optionKey}=${option}`;
                if (startLine) {
                    startLine = false;
                }
            }
        });
        result += '\n';
        startLine = true;
    });

    return result;
}

export function prepareDisplaysParam(displays) {
    return prepareParams(displays, display => {
        return {
            type: display.type,
            listen: display.address,
            port: display.port,
            tlsport: display.tlsPort,
        };
    });
}

export function prepareDisksParam(disks) {
    const isVolume = (disk) => disk.source.volume && disk.source.pool;
    const getVolume = (disk) => isVolume(disk) ? `${disk.source.pool}/${disk.source.volume}` : null;
    const getPath = (disk) => isVolume(disk) ? null : disk.source.file;

    return prepareParams(disks, disk => {
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
