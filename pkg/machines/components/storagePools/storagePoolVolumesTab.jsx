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

import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import { storagePoolId, convertToUnit, units } from '../../helpers.js';
import { getStorageVolumeUsed } from '../../libvirt-dbus.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const StoragePoolVolumesTab = ({ storagePool, vms }) => {
    const storagePoolIdPrefix = storagePoolId(storagePool.name, storagePool.connectionName);
    const columnTitles = ['Name', 'Used by', 'Size'];
    const volumes = storagePool.volumes || [];
    const usedBy = volumes.reduce((resultDict, volume) => {
        const domainsUsingVolume = getStorageVolumeUsed(storagePool, vms, volume.name);

        resultDict[volume.name] = domainsUsingVolume;
        return resultDict;
    }, {});

    if (!storagePool.volumes || storagePool.volumes.length === 0) {
        return (<div id={`${storagePoolIdPrefix}-storage-volumes-list`}>{_("No Storage Volumes defined for this Storage Pool")}</div>);
    }

    return (
        <div>
            <Listing compact columnTitles={columnTitles} actions={null} emptyCaption=''>
                {storagePool.volumes.map(volume => {
                    const allocation = parseFloat(convertToUnit(volume.allocation, units.B, units.GiB).toFixed(2));
                    const capacity = parseFloat(convertToUnit(volume.capacity, units.B, units.GiB).toFixed(2));
                    const columns = [
                        {
                            name: (<div id={`${storagePoolIdPrefix}-volume-${volume.name}-name`}>{volume.name}</div>),
                            header: true,
                        }
                    ];
                    columns.push(
                        {
                            name: (<div id={`${storagePoolIdPrefix}-volume-${volume.name}-usedby`}>{usedBy[volume.name].join(', ')}</div>),
                        }
                    );
                    columns.push(
                        {
                            name: (<div id={`${storagePoolIdPrefix}-volume-${volume.name}-size`}>{`${allocation} / ${capacity} GB`}</div>),
                        }
                    );

                    return (<ListingRow columns={columns} key={`${storagePoolIdPrefix}-volume-${volume.name}`} />);
                })}
            </Listing>
        </div>
    );
};
StoragePoolVolumesTab.propTypes = {
    storagePool: PropTypes.object.isRequired,
    vms: PropTypes.array.isRequired,
};
