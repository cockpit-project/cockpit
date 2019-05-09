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

import React from 'react';
import PropTypes from 'prop-types';

import { ExpandableNotification } from 'cockpit-components-inline-notification.jsx';
import { StorageVolumeDelete } from './storageVolumeDelete.jsx';
import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import { storagePoolId, convertToUnit, units } from '../../helpers.js';
import { getVmDisksMap } from '../../libvirt-dbus.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export class StoragePoolVolumesTab extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            selected: [],
            volumeUsed: {},
        };
        this.deleteErrorHandler = this.deleteErrorHandler.bind(this);
        this.resetSelection = this.resetSelection.bind(this);
    }

    deleteErrorHandler(deleteError, deleteErrorDetail) {
        this.setState({ deleteError, deleteErrorDetail });
    }

    selectedChanged(volumeName, isSelected) {
        let selected = [...this.state.selected];
        if (!isSelected) {
            let index = selected.indexOf(volumeName);
            if (index !== -1)
                selected.splice(index, 1);
        } else
            selected.push(volumeName);
        this.setState({ selected });
    }

    resetSelection() {
        this.setState({ selected: [] });
    }

    render() {
        const { storagePool, vms } = this.props;
        const storagePoolIdPrefix = storagePoolId(storagePool.name, storagePool.connectionName);
        const columnTitles = [_("Name"), _("Used by"), _("Size")];
        const volumes = storagePool.volumes || [];

        if (volumes.length === 0) {
            return (<div id={`${storagePoolIdPrefix}-storage-volumes-list`}>{_("No Storage Volumes defined for this Storage Pool")}</div>);
        }

        // Get a dictionary of vmName -> disks for a specific connection
        const vmDisksMap = getVmDisksMap(vms, storagePool.connectionName);

        // And make it a dictionary of volumeName -> array of Domains using volume
        let isVolumeUsed = {};
        for (let i in volumes) {
            let volumeName = volumes[i].name;
            const targetPath = storagePool.target ? storagePool.target.path : '';
            const volumePath = [targetPath, volumeName].join('/');
            isVolumeUsed[volumeName] = [];

            for (let vmName in vmDisksMap) {
                const disks = vmDisksMap[vmName];

                for (let i in disks) {
                    let disk = disks[i];
                    if (disk.type == 'volume' && disk.volume == volumeName && disk.pool == storagePool.name)
                        isVolumeUsed[volumeName].push(vmName);

                    if (disk.type == 'file' && disk.source == volumePath)
                        isVolumeUsed[volumeName].push(vmName);
                }
            }
        }

        /* Storage Volumes Deletion */
        const actions = [
            <StorageVolumeDelete key='volume-delete-action'
                                 storagePool={storagePool}
                                 isVolumeUsed={isVolumeUsed}
                                 volumes={this.state.selected}
                                 resetSelection={this.resetSelection}
                                 deleteErrorHandler={this.deleteErrorHandler} />
        ];

        return (
            <div id='storage-volumes-list'>
                { this.state.deleteError &&
                <ExpandableNotification type='error' text={this.state.deleteError}
                    detail={this.state.deleteErrorDetail}
                    onDismiss={() => this.setState({ deleteError: undefined }) } /> }
                <Listing compact hasCheckbox columnTitles={columnTitles} actions={actions} emptyCaption=''>
                    { volumes.map(volume => {
                        const allocation = parseFloat(convertToUnit(volume.allocation, units.B, units.GiB).toFixed(2));
                        const capacity = parseFloat(convertToUnit(volume.capacity, units.B, units.GiB).toFixed(2));
                        const columns = [
                            {
                                name: (<div id={`${storagePoolIdPrefix}-volume-${volume.name}-name`}>{volume.name}</div>),
                                header: true,
                            }
                        ];
                        columns.push(
                            { name: (<div id={`${storagePoolIdPrefix}-volume-${volume.name}-usedby`}>{(isVolumeUsed[volume.name] || []).join(', ')}</div>), }
                        );
                        columns.push(
                            { name: (<div id={`${storagePoolIdPrefix}-volume-${volume.name}-size`}>{`${allocation} / ${capacity} GB`}</div>), }
                        );
                        let selectCallback = this.selectedChanged.bind(this, volume.name);

                        return (
                            <ListingRow addCheckbox
                                selectChanged={selectCallback}
                                selected={false}
                                columns={columns}
                                rowId={`${storagePoolIdPrefix}-volume-${volume.name}`}
                                key={`${storagePoolIdPrefix}-volume-${volume.name}`} />
                        );
                    })}
                </Listing>
            </div>
        );
    }
}
StoragePoolVolumesTab.propTypes = {
    storagePool: PropTypes.object.isRequired,
    vms: PropTypes.array.isRequired,
};
