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
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import { vmId } from '../helpers.js';
import { AddDiskAction } from './diskAdd.jsx';
import VmDisksTab from './vmDisksTab.jsx';
import DiskSourceCell from './vmDiskSourceCell.jsx';

const _ = cockpit.gettext;

class VmDisksTabLibvirt extends React.Component {
    componentWillMount() {
        this.props.onUsageStartPolling();
    }

    componentWillUnmount() {
        this.props.onUsageStopPolling();
    }

    /**
     * Returns true, if disk statistics are retrieved.
     */
    getDiskStatsSupport(vm) {
        /* Possible states for disk stats:
            available ~ already read
            supported, but not available yet ~ will be read soon
            unsupported ~ failed attempt to read (old libvirt)
         */
        let areDiskStatsSupported = false;
        if (vm.disksStats) {
            // stats are read/supported if there is a non-NaN stat value
            areDiskStatsSupported = !!Object.getOwnPropertyNames(vm.disksStats)
                    .some(target => {
                        if (!vm.disks[target] || (vm.disks[target].type !== 'volume' && !vm.disksStats[target])) {
                            return false; // not yet retrieved, can't decide about disk stats support
                        }
                        return vm.disks[target].type == 'volume' || !isNaN(vm.disksStats[target].capacity) || !isNaN(vm.disksStats[target].allocation);
                    });
        }

        return areDiskStatsSupported;
    }

    getNotification(vm, areDiskStatsSupported) {
        if (areDiskStatsSupported) {
            return null;
        }

        if (vm.state === 'running') {
            return _("Upgrade to a more recent version of libvirt to view disk statistics");
        }

        return _("Start the VM to see disk statistics.");
    }

    prepareDiskData(disk, diskStats, idPrefix, storagePools) {
        diskStats = diskStats || {};

        let used = diskStats.allocation;
        let capacity = diskStats.capacity;

        /*
         * For disks of type `volume` allocation and capacity stats are not
         * fetched with the virConnectGetAllDomainStats API so we need to get
         * them from the volume.
         *
         * Both pool and volume of the disk might have been undefined so make
         * required checks before reading them.
         */
        if (disk.type == 'volume') {
            let pool = storagePools.filter(pool => pool.name == disk.source.pool)[0];
            let volumes = pool ? pool.volumes : [];
            let volumeName = disk.source.volume;
            let volume = volumes.filter(vol => vol.name == volumeName)[0];

            if (volume) {
                capacity = volume.capacity;
                used = volume.allocation;
            }
        }

        return {
            used: used,
            capacity: capacity,

            device: disk.device,
            target: disk.target,
            bus: disk.bus,
            readonly: disk.readonly,

            // ugly hack due to complexity, refactor if abstraction is really needed
            diskSourceCell: (<DiskSourceCell diskSource={disk.source} idPrefix={idPrefix} />),
        };
    }

    render() {
        const { vm, dispatch, config, storagePools } = this.props;

        const idPrefix = `${vmId(vm.name)}-disks`;
        const areDiskStatsSupported = this.getDiskStatsSupport(vm);

        const filteredStoragePools = storagePools.filter(pool => pool.connectionName == vm.connectionName);
        const disks = Object.getOwnPropertyNames(vm.disks)
                .sort() // by 'target'
                .map(target => this.prepareDiskData(vm.disks[target],
                                                    vm.disksStats && vm.disksStats[target],
                                                    `${idPrefix}-${target}`,
                                                    filteredStoragePools));
        let actions = [];

        if (config.provider.name != 'oVirt')
            actions = [<AddDiskAction dispatch={dispatch} provider={config.provider} idPrefix={idPrefix} key='add-disk' vm={vm} storagePools={storagePools} />];

        return (
            <VmDisksTab idPrefix={idPrefix}
                actions={actions}
                vm={vm}
                disks={disks}
                renderCapacity={areDiskStatsSupported}
                notificationText={this.getNotification(vm, areDiskStatsSupported)}
                dispatch={dispatch}
                provider={config.provider.name} />
        );
    }
}

VmDisksTabLibvirt.propTypes = {
    vm: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,

    onUsageStartPolling: PropTypes.func.isRequired,
    onUsageStopPolling: PropTypes.func.isRequired,
};

export default VmDisksTabLibvirt;
