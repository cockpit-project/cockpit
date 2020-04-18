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
import {
    Breadcrumb, BreadcrumbItem,
    Card, CardActions, CardHeader, CardTitle, CardBody,
    Page, PageSection, Text, TextVariants,
} from '@patternfly/react-core';
import { cellWidth } from '@patternfly/react-table';

import cockpit from 'cockpit';
import { ListingTable } from 'cockpit-components-table.jsx';
import { getStoragePoolRow } from './storagePool.jsx';
import { CreateStoragePoolAction } from './createStoragePoolDialog.jsx';

import './storagePoolList.scss';

const _ = cockpit.gettext;

export class StoragePoolList extends React.Component {
    shouldComponentUpdate(nextProps, _) {
        const storagePools = nextProps.storagePools;
        return !storagePools.find(pool => !pool.name);
    }

    render() {
        const { storagePools, dispatch, loggedUser, vms, onAddErrorNotification, libvirtVersion } = this.props;
        const sortFunction = (storagePoolA, storagePoolB) => storagePoolA.name.localeCompare(storagePoolB.name);
        const actions = (<CreateStoragePoolAction dispatch={dispatch} loggedUser={loggedUser} libvirtVersion={libvirtVersion} />);

        return (
            <Page breadcrumb={
                <Breadcrumb className='machines-listing-breadcrumb'>
                    <BreadcrumbItem to='#'>
                        {_("Virtual machines")}
                    </BreadcrumbItem>
                    <BreadcrumbItem isActive>
                        {_("Storage pools")}
                    </BreadcrumbItem>
                </Breadcrumb>}>
                <PageSection id='storage-pools-listing'>
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                <Text component={TextVariants.h2}>{_("Storage pools")}</Text>
                            </CardTitle>
                            <CardActions>
                                {actions}
                            </CardActions>
                        </CardHeader>
                        <CardBody className="contains-list">
                            <ListingTable aria-label={_("Storage pools")}
                                variant='compact'
                                columns={[
                                    { title: _("Name"), header: true, transforms: [cellWidth(20)] },
                                    { title: _("Size"), transforms: [cellWidth(40)] },
                                    { title: _("Connection"), transforms: [cellWidth(20)] },
                                    { title: _("State"), transforms: [cellWidth(20)] },
                                ]}
                                emptyCaption={_("No storage pool is defined on this host")}
                                rows={storagePools
                                        .sort(sortFunction)
                                        .map(storagePool => {
                                            const filterVmsByConnection = vms.filter(vm => vm.connectionName == storagePool.connectionName);

                                            return getStoragePoolRow({ storagePool, vms: filterVmsByConnection, dispatch, onAddErrorNotification });
                                        })
                                }
                            />
                        </CardBody>
                    </Card>
                </PageSection>
            </Page>
        );
    }
}
StoragePoolList.propTypes = {
    storagePools: PropTypes.array.isRequired,
    vms: PropTypes.array.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
    libvirtVersion: PropTypes.number,
};
