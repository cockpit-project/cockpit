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
import React, { PropTypes } from 'react';
import cockpit from 'cockpit';
import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import { toGigaBytes } from '../helpers.es6';
import InfoRecord from './infoRecord.jsx';
import { Info } from './inlineNotification.jsx';

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
            chunks.push(<InfoRecord descrClass='machines-disks-source-descr' descr={descr} valueClass='machines-disks-source-value' value={value} />);
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
    if (isNaN(value)) {
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

class VmDisksTab extends React.Component {
    componentWillMount () {
        this.props.onUsageStartPolling();
    }

    componentWillUnmount () {
        this.props.onUsageStopPolling();
    }

    /**
     * Returns true, if disk statistics are retrieved.
     */
    getDiskStatsSupport (vm) {
        /* Possible states for disk stats:
            available ~ already read
            supported, but not available yet ~ will be read soon
            unsupported ~ failed attempt to read (old libvirt)
         */
        let areDiskStatsSupported = false;
        if (vm.disksStats) {
            // stats are read/supported if there is a non-NaN stat value
            areDiskStatsSupported = !!Object.getOwnPropertyNames(vm.disksStats).some(target => {
                if (!vm.disksStats[target]) {
                    return false; // not yet retrieved, can't decide about disk stats support
                }
                return !isNaN(vm.disksStats[target].capacity) || !isNaN(vm.disksStats[target].allocation);
            });
        }

        return areDiskStatsSupported;
    }

    render () {
        const { vm, provider } = this.props;
        const vmId = `vm-${vm.name}`;

        if (!vm.disks || Object.getOwnPropertyNames(vm.disks).length === 0) {
            return (<div>{_("No disks defined for this VM")}</div>);
        }

        const areDiskStatsSupported = this.getDiskStatsSupport(vm);

        const columnTitles = [_("Device"), _("Target")];
        if (areDiskStatsSupported) {
            columnTitles.push(_("Used"));
            columnTitles.push(_("Capacity"));
        }
        columnTitles.push(_("Bus"));
        columnTitles.push(_("Readonly"));
        columnTitles.push(_("Source"));

        if (provider.vmDisksColumns) { // External Provider might extend the list of columns
            // expected: an array of [{title, index, valueProvider: ({ vm, diskTarget }) => {return "String or React Component";}}, ...]
            provider.vmDisksColumns.forEach(column => {
                columnTitles.splice(column.index, 0, column.title);
            });
        }

        const actions = (provider.vmDisksActionsFactory instanceof Function) ?
            provider.vmDisksActionsFactory({vm}) : undefined; // listing-wide actions

        let notification = null;
        if (!areDiskStatsSupported) {
            if (vm.status === 'running') {
                notification = (<Info text={_("Upgrade to a more recent version of libvirt to view disk statistics")}
                               textId={`${vmId}-disksstats-unsupported`} />);
            } else {
                notification = (<Info text={_("Start the VM to see disk statistics.")}
                               textId={`${vmId}-disksstats-unavailable`} />);
            }
        }

        return (
            <div>
                {notification}
                <DiskTotal disks={vm.disks} vmId={vmId}/>
                <Listing columnTitles={columnTitles} actions={actions}>
                    {Object.getOwnPropertyNames(vm.disks).sort().map(target => {
                        const disk = vm.disks[target];
                        const disksStats = vm.disksStats ? vm.disksStats[target] : undefined;
                        const used = disksStats ? disksStats.allocation : undefined;
                        const capacity = disksStats ? disksStats.capacity : undefined;

                        const columns = [
                            {name: <DiskDevice disk={disk} vmId={vmId}/>, 'header': true},
                            <DiskTarget disk={disk} vmId={vmId}/>
                        ];
                        if (areDiskStatsSupported) {
                            columns.push(<StorageUnit value={used} id={`${vmId}-disks-${disk.target}-used`}/>);
                            columns.push(<StorageUnit value={capacity} id={`${vmId}-disks-${disk.target}-capacity`}/>);
                        }
                        columns.push(<DiskBus disk={disk} vmId={vmId}/>);
                        columns.push(disk.readonly ? _("yes") : _("no"));
                        columns.push(<DiskSource disk={disk} vmId={vmId}/>);

                        if (provider.vmDisksColumns) { // optional External Provider extension
                            provider.vmDisksColumns.forEach(column => {
                                columns.splice(column.index, 0, column.valueProvider({vm, diskTarget: target}));
                            });
                        }

                        return (<ListingRow columns={columns}/>);
                    })}
                </Listing>
            </div>
        );
    }
}
VmDisksTab.propTypes = {
    vm: PropTypes.object.isRequired,
    provider: PropTypes.object.isRequired,
    onUsageStartPolling: PropTypes.func.isRequired,
    onUsageStopPolling: PropTypes.func.isRequired,
};

export default VmDisksTab;
