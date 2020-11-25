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
import "form-layout.scss";
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import { Button } from '@patternfly/react-core';

import { convertToUnit, diskPropertyChanged, toReadableNumber, units, vmId } from "../../../helpers.js";
import { AddDiskModalBody } from './diskAdd.jsx';
import { getVm, detachDisk } from '../../../actions/provider-actions.js';
import { EditDiskAction } from './diskEdit.jsx';
import WarningInactive from '../../common/warningInactive.jsx';
import { ListingTable } from "cockpit-components-table.jsx";
import { DeleteResourceButton, DeleteResourceModal } from '../../common/deleteResource.jsx';
import { DiskSourceCell, DiskExtras } from './vmDiskColumns.jsx';

const _ = cockpit.gettext;

const StorageUnit = ({ value, id }) => {
    if (!value) {
        return null;
    }

    if (isNaN(value)) {
        return (
            <div id={id}>
                {value}
            </div>
        );
    }

    return (
        <div id={id}>
            {toReadableNumber(convertToUnit(value, units.B, units.GiB))}&nbsp;{_("GiB")}
        </div>
    );
};

const VmDiskCell = ({ value, id }) => {
    return (
        <div id={id}>
            {value}
        </div>
    );
};

export class VmDisksActions extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            showAddDiskModal: false,
        };
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
    }

    close() {
        this.setState({ showAddDiskModal: false });
    }

    open() {
        this.setState({ showAddDiskModal: true });
    }

    render() {
        const { dispatch, vm, vms, storagePools } = this.props;
        const idPrefix = `${vmId(vm.name)}-disks`;

        return (
            <>
                <Button id={`${idPrefix}-adddisk`} variant='secondary' onClick={this.open}>
                    {_("Add disk")}
                </Button>
                {this.state.showAddDiskModal && <AddDiskModalBody close={this.close} dispatch={dispatch} idPrefix={idPrefix} vm={vm} vms={vms} storagePools={storagePools.filter(pool => pool && pool.active)} />}
            </>
        );
    }
}

export class VmDisksCardLibvirt extends React.Component {
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
            let volume;
            if (volumes)
                volume = volumes.filter(vol => vol.name == volumeName)[0];

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
        const { vm, dispatch, storagePools } = this.props;

        const idPrefix = `${vmId(vm.name)}-disks`;
        const areDiskStatsSupported = this.getDiskStatsSupport(vm);

        const disks = Object.getOwnPropertyNames(vm.disks)
                .sort() // by 'target'
                .map(target => this.prepareDiskData(vm.disks[target],
                                                    vm.disksStats && vm.disksStats[target],
                                                    `${idPrefix}-${target}`,
                                                    storagePools));
        return (
            <VmDisksCard
                vm={vm}
                disks={disks}
                renderCapacity={areDiskStatsSupported}
                dispatch={dispatch}
                onAddErrorNotification={this.props.onAddErrorNotification} />
        );
    }
}

VmDisksCardLibvirt.propTypes = {
    vm: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
};

export class VmDisksCard extends React.Component {
    constructor(props) {
        super(props);
        this.state = {};
    }

    render() {
        const { vm, disks, renderCapacity, dispatch, onAddErrorNotification } = this.props;
        let renderCapacityUsed, renderAccess, renderAdditional;
        const columnTitles = [];
        const idPrefix = `${vmId(vm.name)}-disks`;

        if (disks && disks.length > 0) {
            columnTitles.push(_("Device"));
            renderCapacityUsed = !!disks.find(disk => (!!disk.used));
            renderAccess = !!disks.find(disk => (typeof disk.readonly !== "undefined") || (typeof disk.shareable !== "undefined"));
            renderAdditional = !!disks.find(disk => (!!disk.diskExtras));

            if (renderCapacity) {
                if (renderCapacityUsed) {
                    columnTitles.push(_("Used"));
                }
                columnTitles.push(_("Capacity"));
            }
            columnTitles.push(_("Bus"));
            if (renderAccess) {
                columnTitles.push(_("Access"));
            }
            columnTitles.push(_("Source"));
            if (renderAdditional)
                columnTitles.push(_("Additional"));

            columnTitles.push('');
        }

        const rows = disks.map(disk => {
            const idPrefixRow = `${idPrefix}-${disk.target || disk.device}`;
            const columns = [
                { title: <VmDiskCell value={disk.device} id={`${idPrefixRow}-device`} key={`${idPrefixRow}-device`} /> },

            ];

            if (renderCapacity) {
                if (renderCapacityUsed) {
                    columns.push({ title: <StorageUnit value={disk.used} id={`${idPrefixRow}-used`} key={`${idPrefixRow}-used`} /> });
                }
                columns.push({ title: <StorageUnit value={disk.capacity} id={`${idPrefixRow}-capacity`} key={`${idPrefixRow}-capacity`} /> });
            }

            columns.push({ title: <VmDiskCell value={disk.bus} id={`${idPrefixRow}-bus`} key={`${idPrefixRow}-bus`} /> });

            if (renderAccess) {
                const access = (
                    <span id={`${idPrefixRow}-access`}>
                        { disk.readonly ? _("Read-only") : disk.shareable ? _("Writeable and shared") : _("Writeable") }
                        { vm.state === "running" &&
                        (diskPropertyChanged(vm, disk.target, "readonly") || diskPropertyChanged(vm, disk.target, "shareable")) &&
                            <WarningInactive iconId={`${idPrefixRow}-access-tooltip`} tooltipId={`tip-${idPrefixRow}-access`} /> }
                    </span>
                );
                columns.push({ title: access });
            }

            columns.push({ title: disk.diskSourceCell });
            if (renderAdditional)
                columns.push({ title: disk.diskExtras || '' });

            const onRemoveDisk = () => {
                return dispatch(detachDisk({ connectionName:vm.connectionName, id:vm.id, name:vm.name, target: disk.target, live: vm.state == 'running', persistent: vm.persistent }))
                        .catch(ex => {
                            onAddErrorNotification({
                                text: cockpit.format(_("Disk $0 fail to get detached from VM $1"), disk.target, vm.name),
                                detail: ex.message, resourceId: vm.id,
                            });
                        })
                        .then(() => {
                            dispatch(getVm({ connectionName: vm.connectionName, id:vm.id }));
                        });
            };
            const deleteDialogProps = {
                objectType: "Disk",
                objectName: disk.target,
                actionName: _("Remove"),
                onClose: () => this.setState({ deleteDialogProps: undefined }),
                deleteHandler: () => onRemoveDisk(),
            };
            const diskActions = (
                <div className='machines-listing-actions'>
                    <DeleteResourceButton objectId={vm.name + "-disk-" + disk.target}
                       disabled={vm.state != 'shut off' && vm.state != 'running'}
                       showDialog={() => this.setState({ deleteDialogProps })}
                       overlayText={_("The VM needs to be running or shut off to detach this device")}
                       actionName={_("Remove")} />
                    { vm.persistent && vm.inactiveXML.disks[disk.target] && // supported only  for persistent disks
                    <EditDiskAction disk={disk}
                        vm={vm}
                        idPrefix={idPrefixRow}
                        onAddErrorNotification={onAddErrorNotification} /> }
                </div>
            );
            columns.push({ title: diskActions });
            return { columns, props: { key: disk.target } };
        });

        return (
            <>
                {this.state.deleteDialogProps && <DeleteResourceModal {...this.state.deleteDialogProps} />}
                <ListingTable variant='compact'
                    gridBreakPoint='grid-xl'
                    emptyCaption={_("No disks defined for this VM")}
                    aria-label={`VM ${vm.name} Disks`}
                    columns={columnTitles}
                    rows={rows} />
            </>
        );
    }
}
VmDisksCard.propTypes = {
    disks: PropTypes.array.isRequired,
    renderCapacity: PropTypes.bool,
    onAddErrorNotification: PropTypes.func.isRequired,
};
