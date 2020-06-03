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
import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core';

import cockpit from 'cockpit';
import { Listing } from 'cockpit-components-listing.jsx';
import { StoragePool } from './storagePool.jsx';
import { storagePoolId } from '../../helpers.js';
import { CreateStoragePoolAction } from './createStoragePoolDialog.jsx';

const _ = cockpit.gettext;

export class StoragePoolList extends React.Component {
    shouldComponentUpdate(nextProps, _) {
        const storagePools = nextProps.storagePools;
        return !storagePools.find(pool => !pool.name);
    }

    render() {
        const { storagePools, dispatch, loggedUser, vms, resourceHasError, onAddErrorNotification, libvirtVersion } = this.props;
        const sortFunction = (storagePoolA, storagePoolB) => storagePoolA.name.localeCompare(storagePoolB.name);
        const actions = (<CreateStoragePoolAction dispatch={dispatch} loggedUser={loggedUser} libvirtVersion={libvirtVersion} />);

        return (
            <>
                <Breadcrumb className='machines-listing-breadcrumb'>
                    <BreadcrumbItem to='#'>
                        {_("Virtual Machines")}
                    </BreadcrumbItem>
                    <BreadcrumbItem isActive>
                        {_("Storage Pools")}
                    </BreadcrumbItem>
                </Breadcrumb>
                <div id='storage-pools-listing' className='container-fluid'>
                    <Listing title={_("Storage Pools")}
                        columnTitles={[_("Name"), _("Size"), _("Connection"), _("State")]}
                        emptyCaption={_("No storage pool is defined on this host")}
                        actions={actions}>
                        {storagePools
                                .sort(sortFunction)
                                .map(storagePool => {
                                    const filterVmsByConnection = vms.filter(vm => vm.connectionName == storagePool.connectionName);

                                    return (
                                        <StoragePool key={`${storagePoolId(storagePool.id, storagePool.connectionName)}`}
                                            storagePool={storagePool}
                                            vms={filterVmsByConnection}
                                            resourceHasError={resourceHasError}
                                            onAddErrorNotification={onAddErrorNotification} />
                                    );
                                })
                        }
                    </Listing>
                </div>
            </>
        );
    }
}
StoragePoolList.propTypes = {
    storagePools: PropTypes.array.isRequired,
    vms: PropTypes.array.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
    resourceHasError: PropTypes.object.isRequired,
    libvirtVersion: PropTypes.number,
};
