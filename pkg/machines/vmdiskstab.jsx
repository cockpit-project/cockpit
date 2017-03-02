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
import cockpit from 'cockpit';
import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import { toGigaBytes } from './helpers.es6';

const _ = cockpit.gettext;

const DiskTotal = ({ disks, vmId }) => {
    return (
        <span className='machines-disks-total'>
            {_("Count:")}&nbsp;
            <span id={`${vmId}-disks-total-value`} className='machines-disks-total-value'>
                {Object.getOwnPropertyNames(disks).length}
            </span>
        </span>
    );
};

const DiskSource = ({ disk, vmId }) => {
    const src = disk.source;
    const addOptional = (chunks, value, descr) => {
        if (value) {
            chunks.push(
                <tr>
                    <td className='machines-disks-source-descr'>{descr}: </td>
                    <td className='machines-disks-source-value'>{value}</td>
                </tr>);
        }
    };

    const chunks = [];
    addOptional(chunks, src.file, _("File"));
    addOptional(chunks, src.dev, _("Device"));
    addOptional(chunks, src.protocol, _("Protocol"));
    addOptional(chunks, src.pool, _("Pool"));
    addOptional(chunks, src.volume, _("Volume"));
    addOptional(chunks, src.host.name, _("Host"));
    addOptional(chunks, src.host.port, _("Port"));

    return (
        <table className='machines-disks-source' id={`${vmId}-disks-${disk.target}-source`}>
            {chunks}
        </table>
    );
};

const StorageUnit = ({ value, id }) => {
    if (!value) {
        return null;
    }
      return (
          <div id={id}>
              {toGigaBytes(value, 'B')}&nbsp;{_("GB")}
          </div>
      );
};

const DiskTarget = ({ disk, vmId }) => {
    return (
        <div id={`${vmId}-disks-${disk.target}-target`}>
            {disk.target}
        </div>
    );
};

const DiskDevice = ({ disk, vmId }) => {
    return (
        <div id={`${vmId}-disks-${disk.target}-device`}>
            {disk.device}
        </div>
    );
};

const DiskBus = ({ disk, vmId }) => {
    return (
        <div id={`${vmId}-disks-${disk.target}-bus`}>
            {disk.bus}
        </div>
    );
};

const VmDisksTab = ({ vm, provider }) => {
    if (!vm.disks || Object.getOwnPropertyNames(vm.disks).length === 0) {
        return (<div>_("No disks defined for this VM")</div>);
    }

    const columnTitles = [_("Device"), _("Target"), _("Used"), _("Capacity"), _("Bus"), _("Readonly"), _("Source")];
    if (provider.vmDisksColumns) { // External Provider might extend the list of columns
        // expected: an array of [{title, index, valueProvider: ({ vm, diskTarget }) => {return "String or React Component";}}, ...]
        provider.vmDisksColumns.forEach(column => {
            columnTitles.splice(column.index, 0, column.title);
        });
    }

    const actions = (provider.vmDisksActionsFactory instanceof Function) ?
        provider.vmDisksActionsFactory({vm}) : undefined; // listing-wide actions

    const vmId=`vm-${vm.name}`;

    return (
        <div>
            <DiskTotal disks={vm.disks} vmId={vmId} />
            <Listing columnTitles={columnTitles} actions={actions}>
                {Object.getOwnPropertyNames(vm.disks).sort().map(target => {
                    const disk = vm.disks[target];
                    const disksStats = vm.disksStats ? vm.disksStats[target] : undefined;
                    const used = disksStats ? disksStats.allocation : undefined;
                    const capacity = disksStats ? disksStats.capacity : undefined;

                    const columns = [
                        {name: <DiskDevice disk={disk} vmId={vmId}/>, 'header': true},
                        <DiskTarget disk={disk} vmId={vmId}/>,
                        <StorageUnit value={used} id={`${vmId}-disks-${disk.target}-used`}/>,
                        <StorageUnit value={capacity} id={`${vmId}-disks-${disk.target}-capacity`}/>,
                        <DiskBus disk={disk} vmId={vmId} />,
                        disk.readonly ? _("yes") : _("no"),
                        <DiskSource disk={disk} vmId={vmId} />,
                    ];

                    if (provider.vmDisksColumns) {
                        provider.vmDisksColumns.forEach(column => {
                            columns.splice(column.index, 0, column.valueProvider({ vm, diskTarget: target}));
                        });
                    }

                    return (<ListingRow columns={columns}/>);
                })}
            </Listing>
        </div>
    );
};
VmDisksTab.propTypes = {
    vm: React.PropTypes.object.isRequired,
};

export default VmDisksTab;
