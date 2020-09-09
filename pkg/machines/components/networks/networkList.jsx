/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import { Breadcrumb, BreadcrumbItem, Page, PageSection, PageSectionVariants } from '@patternfly/react-core';

import cockpit from 'cockpit';
import { ListingTable } from 'cockpit-components-table.jsx';
import { getNetworkRow } from './network.jsx';
import { getNetworkDevices } from '../../helpers.js';
import { CreateNetworkAction } from './createNetworkDialog.jsx';

const _ = cockpit.gettext;

export class NetworkList extends React.Component {
    shouldComponentUpdate(nextProps, _) {
        const networks = nextProps.networks;
        return !networks.find(network => !network.name);
    }

    render() {
        const { dispatch, networks, resourceHasError, onAddErrorNotification, vms, nodeDevices, interfaces } = this.props;
        const sortFunction = (networkA, networkB) => networkA.name.localeCompare(networkB.name);
        const devices = getNetworkDevices(vms, nodeDevices, interfaces);
        const actions = (<CreateNetworkAction devices={devices} dispatch={dispatch} />);

        return (
            <Page breadcrumb={
                <Breadcrumb variant={PageSectionVariants.light} className='machines-listing-breadcrumb'>
                    <BreadcrumbItem to='#'>
                        {_("Virtual machines")}
                    </BreadcrumbItem>
                    <BreadcrumbItem isActive>
                        {_("Networks")}
                    </BreadcrumbItem>
                </Breadcrumb>}>
                <PageSection variant={PageSectionVariants.light} id='networks-listing'>
                    <ListingTable title={_("Networks")}
                        variant='compact'
                        columns={[{ title: _("Name"), header: true }, _("Device"), _("Connection"), _("Forwarding mode"), _("State")]}
                        emptyCaption={_("No network is defined on this host")}
                        actions={actions}
                        rows={networks
                                .sort(sortFunction)
                                .map(network => getNetworkRow({ dispatch, network, resourceHasError, onAddErrorNotification }))
                        } />
                </PageSection>
            </Page>
        );
    }
}
NetworkList.propTypes = {
    dispatch: PropTypes.func.isRequired,
    networks: PropTypes.array.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
    resourceHasError: PropTypes.object.isRequired,
    vms: PropTypes.array.isRequired,
    nodeDevices: PropTypes.array.isRequired,
    interfaces: PropTypes.array.isRequired,
};
