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

import { vmId } from '../helpers.js';
import VmDisksTab from './vmDisksTab.jsx';
import { DiskSourceCell, DiskExtras } from './vmDiskColumns.jsx';

class VmDisksTabLibvirt extends React.Component {
    constructor(props) {
        super(props);
        props.onUsageStartPolling();
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
            const pool = storagePools.filter(pool => pool.name == disk.source.pool)[0];
            const volumes = pool ? pool.volumes : [];
            const volumeName = disk.source.volume;
            const volume = volumes.filter(vol => vol.name == volumeName)[0];

            if (volume) {
                capacity = volume.capacity;
                used = volume.allocation;
            }
        }

        return {
            used: used,
            capacity: capacity,

            device: disk.device,
            driver: disk.driver,
            target: disk.target,
            bus: disk.bus,
            readonly: disk.readonly,
            shareable: disk.shareable,

            // ugly hack due to complexity, refactor if abstraction is really needed
            diskSourceCell: (<DiskSourceCell diskSource={disk.source} idPrefix={idPrefix} />),
            diskExtras: (
                (disk.driver.cache || disk.driver.io || disk.driver.discard || disk.driver.errorPolicy)
                    ? <DiskExtras idPrefix={idPrefix}
                                  cache={disk.driver.cache}
                                  io={disk.driver.io}
                                  discard={disk.driver.discard}
                                  errorPolicy={disk.driver.errorPolicy} /> : null
            ),
        };
    }

    render() {
        const { vm, dispatch, config, storagePools, vms } = this.props;

        const idPrefix = `${vmId(vm.name)}-disks`;
        const areDiskStatsSupported = this.getDiskStatsSupport(vm);

        const disks = Object.getOwnPropertyNames(vm.disks)
                .sort() // by 'target'
                .map(target => this.prepareDiskData(vm.disks[target],
                                                    vm.disksStats && vm.disksStats[target],
                                                    `${idPrefix}-${target}`,
                                                    storagePools));
        return (
            <VmDisksTab idPrefix={idPrefix}
                vm={vm}
                vms={vms}
                disks={disks}
                renderCapacity={areDiskStatsSupported}
                dispatch={dispatch}
                provider={config.provider}
                storagePools={storagePools}
                onAddErrorNotification={this.props.onAddErrorNotification} />
        );
    }
}

VmDisksTabLibvirt.propTypes = {
    vm: PropTypes.object.isRequired,
    vms: PropTypes.array.isRequired,
    dispatch: PropTypes.func.isRequired,

    onUsageStartPolling: PropTypes.func.isRequired,
    onUsageStopPolling: PropTypes.func.isRequired,
};

export default VmDisksTabLibvirt;
