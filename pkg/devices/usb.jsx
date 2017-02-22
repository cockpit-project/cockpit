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
import React from 'react';

import { Listing, ListingRow } from "cockpit-components-listing.jsx";

import { selectUsb, setUsbDeviceExpand } from './actions.es6';
import { logDebug } from './helpers.es6';

const _ = cockpit.gettext;

const DEFAULT_MAX_EXPANDED_LEVEL = 2;
const MAX_LEVEL_PADDING = 8;


function childrenCount (device) {
    const childrenNames = Object.getOwnPropertyNames(device);
    let count = childrenNames.length - 1; // -1 for the 'device' attribute
    childrenNames.forEach(child => {
        if (child != 'device') {
            count += childrenCount(device[child]);
        }
    });
    return count;
}

function isExpanded({ visibility, name, level }) {
    return visibility.usbExpandedDevices[name] || (visibility.usbExpandedDevices[name] === undefined && level < DEFAULT_MAX_EXPANDED_LEVEL);
}

function flatDevices ({ usbDevices, visibility, parent = null, level = 0 }) {
    let flat = [];
    Object.getOwnPropertyNames(usbDevices).sort().forEach( name => {
        if (name !== 'device') {
            flat.push({parent, level, device: usbDevices[name]});

            if (isExpanded({ visibility, name, level })) {
                const children = flatDevices({
                    usbDevices: usbDevices[name],
                    visibility,
                    parent: name,
                    level: level + 1
                });
                flat = flat.concat(children);
            }
        }
    });
    return flat;
}

const USBDeviceName = ({ flatDevice, hasChildren }) => {
    const level = flatDevice.level < MAX_LEVEL_PADDING ? flatDevice.level : MAX_LEVEL_PADDING;
    const childrenClass = hasChildren ? 'usb-device-name-with-children' : '';
    return (<div className={`usb-device-name-level-${level} ${childrenClass}`}>
        {flatDevice.device.device.name}
    </div>);
};

const USBDeviceProp = ({ value, valueDetail }) => {
    const detail = valueDetail ? (<span className='device-props-code'>(&nbsp;{valueDetail}&nbsp;)</span>) : '';

    return (<div>
        {value}
        {detail}
    </div>);
};

const USBDevices = ({ usbDevices, deviceActions, visibility }) => {
    const flat = flatDevices({ usbDevices, visibility });

    return (<Listing title={_('USB Devices')} columnTitles={[_('Path'), _('Model (ID)'), _('Vendor (ID)'), _('Serial ID'), _('Connected Devices')]}>
        {flat.map( flatDevice => {
            const detail = flatDevice.device.device;
            const name = detail.name;
            const level = flatDevice.level;
            const childrenTotal = childrenCount(flatDevice.device);
            return (<ListingRow key={name} navigateToItem={() => deviceActions.setUsbDeviceExpand(name, !isExpanded({visibility, name, level}) )}
                                columns={[
                                <USBDeviceName flatDevice={flatDevice} hasChildren={childrenTotal > 0}/>,
                                <USBDeviceProp value={detail['ID_MODEL']} valueDetail={detail['ID_MODEL_ID']}/>,
                                <USBDeviceProp value={detail['ID_VENDOR_FROM_DATABASE']} valueDetail={detail['ID_VENDOR_ID']}/>,
                                <USBDeviceProp value={detail['ID_SERIAL']}/>,
                                `(${childrenTotal})`
                                ]}/>);
        })}
    </Listing>);
};

export function usbActions (dispatch) {
    return {
        onUsbSelected: () => dispatch(selectUsb()),
        setUsbDeviceExpand: (name, expanded) => dispatch(setUsbDeviceExpand({ name, expanded })),
    };
};

export default USBDevices;
