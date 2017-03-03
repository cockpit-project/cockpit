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

const DiskTotal = ({ disks }) => {
    return (
        <div className='machines-disks-total'>
            {_("Count:")}&nbsp;<strong>{Object.getOwnPropertyNames(disks).length}</strong>
        </div>
    );
};

const DiskSource = ({ disk }) => {
    return (
        <div className='machines-disks-source'>
            {disk.sourceFile}
        </div>
    );
};

const StorageUnit = ({ value }) => {
    if (!value) {
        return null;
    }
      return (
          <div>
              {toGigaBytes(value, 'B')}&nbsp;{_("GB")}
          </div>
      );
};

const VmDisksTab = ({ vm, provider }) => {
    if (!vm.disks || Object.getOwnPropertyNames(vm.disks).length === 0) {
        return (<div>_("No disks defined for this VM")</div>);
    }

    // TODO: listing-wide actions

    const columnTitles = [_("Device"), _("Target"), _("Used"), _("Capacity"), _("Bus"), _("Readonly"), _("Type"), _("Source")];
    if (provider.vmDisksColumns) { // External Provider might extend the list of columns
        // expected: an array of [{title, index, valueProvider: ({ vm, diskTarget }) => {return "String or React Component";}}, ...]
        provider.vmDisksColumns.forEach(column => {
            columnTitles.splice(column.index, 0, column.title);
        });
    }

    const actions = (provider.vmDisksActionsFactory instanceof Function) ?
        provider.vmDisksActionsFactory({vm}) : undefined; // listing-wide actions

    return (
        <div>
            <DiskTotal disks={vm.disks} />
            <Listing columnTitles={columnTitles} actions={actions}>
                {Object.getOwnPropertyNames(vm.disks).sort().map(target => {
                    const disk = vm.disks[target];
                    const disksStats = vm.disksStats ? vm.disksStats[target] : undefined;
                    const used = disksStats ? disksStats.allocation : undefined;
                    const capacity = disksStats ? disksStats.capacity : undefined;

                    const columns = [
                        {name: disk.device, 'header': true},
                        disk.target,
                        <StorageUnit value={used} />,
                        <StorageUnit value={capacity} />,
                        disk.bus,
                        disk.readonly ? _("yes") : _("no"),
                        disk.type,
                        <DiskSource disk={disk} />,
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
