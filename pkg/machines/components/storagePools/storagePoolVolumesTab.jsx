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

import { ListingTable } from "cockpit-components-table.jsx";
import { InlineNotification } from 'cockpit-components-inline-notification.jsx';
import { StorageVolumeDelete } from './storageVolumeDelete.jsx';
import { StorageVolumeCreate } from './storageVolumeCreate.jsx';
import { storagePoolId, convertToUnit, units, getStorageVolumesUsage } from '../../helpers.js';
import cockpit from 'cockpit';

import './storagePoolVolumesTab.css';

const _ = cockpit.gettext;

export class StoragePoolVolumesTab extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            volumeUsed: {},
            rows: (props.storagePool.volumes || []).map(row => {
                row.selected = false;
                return row;
            }),
        };
        this.deleteErrorHandler = this.deleteErrorHandler.bind(this);
        this.onSelect = this.onSelect.bind(this);
    }

    static getDerivedStateFromProps(props, current_state) {
        if ((props.storagePool.volumes || []).length !== current_state.rows.length) {
            return { rows: props.storagePool.volumes || [] };
        }
        return null;
    }

    deleteErrorHandler(deleteError, deleteErrorDetail) {
        this.setState({ deleteError, deleteErrorDetail });
    }

    onSelect(event, isSelected, rowId) {
        let rows;
        if (rowId === -1) {
            rows = this.state.rows.map(oneRow => {
                oneRow.selected = isSelected;
                return oneRow;
            });
        } else {
            rows = [...this.state.rows];
            rows[rowId].selected = isSelected;
        }
        this.setState({ rows });
    }

    render() {
        const { storagePool, vms } = this.props;
        const storagePoolIdPrefix = storagePoolId(storagePool.name, storagePool.connectionName);
        const volumes = this.state.rows;
        const isVolumeUsed = getStorageVolumesUsage(vms, storagePool);
        const columnTitles = [_("Name"), _("Used by"), _("Size")];
        const actions = (
            <div className='table-actions'>
                <StorageVolumeDelete key='volume-delete-action'
                        storagePool={storagePool}
                        isVolumeUsed={isVolumeUsed}
                        volumes={volumes.filter(row => row.selected)}
                        deleteErrorHandler={this.deleteErrorHandler} />
                <StorageVolumeCreate key='volume-create-action'
                        storagePool={storagePool} />
            </div>
        );

        const sortFunction = (volumeA, volumeB) => volumeA.name.localeCompare(volumeB.name);
        const rows = volumes
                .sort(sortFunction)
                .map(volume => {
                    const allocation = parseFloat(convertToUnit(volume.allocation, units.B, units.GiB).toFixed(2));
                    const capacity = parseFloat(convertToUnit(volume.capacity, units.B, units.GiB).toFixed(2));
                    const columns = [
                        { title: <div id={`${storagePoolIdPrefix}-volume-${volume.name}-name`}>{volume.name}</div> },
                        { title: <div id={`${storagePoolIdPrefix}-volume-${volume.name}-usedby`}>{(isVolumeUsed[volume.name] || []).join(', ')}</div>, },
                        { title: <div id={`${storagePoolIdPrefix}-volume-${volume.name}-size`}>{`${allocation} / ${capacity} GB`}</div> },
                    ];
                    return { columns, selected: volume.selected, props: { key: volume.name } };
                });

        return (
            <>
                { this.state.deleteError &&
                <InlineNotification type='danger' text={this.state.deleteError}
                    detail={this.state.deleteErrorDetail}
                    onDismiss={() => this.setState({ deleteError: undefined }) } /> }
                <ListingTable variant='compact'
                    actions={actions}
                    aria-label={`Storage pool ${storagePool.name} Volumes`}
                    emptyCaption={storagePool.active ? _("No storage volumes defined for this storage pool") : _("Activate the storage pool to administer volumes")}
                    columns={columnTitles}
                    onSelect={this.onSelect}
                    rows={rows} />
            </>
        );
    }
}
StoragePoolVolumesTab.propTypes = {
    storagePool: PropTypes.object.isRequired,
    vms: PropTypes.array.isRequired,
};
