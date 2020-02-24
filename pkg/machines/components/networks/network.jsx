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
import { Button } from '@patternfly/react-core';

import { ListingRow } from 'cockpit-components-listing.jsx';
import {
    rephraseUI,
    networkId
} from '../../helpers.js';
import { NetworkOverviewTab } from './networkOverviewTab.jsx';
import { DeleteResource } from '../deleteResource.jsx';
import {
    networkActivate,
    networkDeactivate,
    networkUndefine
} from '../../libvirt-dbus.js';

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export class Network extends React.Component {
    render() {
        const { dispatch, network, resourceHasError, onAddErrorNotification } = this.props;
        const idPrefix = `${networkId(network.name, network.connectionName)}`;
        const name = (
            <span id={`${idPrefix}-name`}>
                { network.name }
            </span>);
        const device = (
            <span id={`${idPrefix}-device`}>
                { network.bridge && network.bridge.name }
            </span>);
        const forwarding = (
            <span id={`${idPrefix}-forwarding`}>
                { rephraseUI('networkForward', network.forward ? network.forward.mode : "none") }
            </span>);
        const state = (
            <>
                { resourceHasError[network.id] ? <span className='pficon-warning-triangle-o machines-status-alert' /> : null }
                <span id={`${idPrefix}-state`}>
                    { network.active ? _("active") : _("inactive") }
                </span>
            </>);
        const cols = [
            { name, header: true },
            device,
            rephraseUI('connections', network.connectionName),
            forwarding,
            state,
        ];

        const overviewTabName = (
            <div id={`${idPrefix}-overview`}>
                {_("Overview")}
            </div>
        );

        const tabRenderers = [
            {
                name: overviewTabName,
                renderer: NetworkOverviewTab,
                data: { network, dispatch, }
            },
        ];
        const extraClasses = [];

        if (resourceHasError[network.id])
            extraClasses.push('error');

        return (
            <ListingRow rowId={idPrefix}
                extraClasses={extraClasses}
                columns={cols}
                tabRenderers={tabRenderers}
                listingActions={<NetworkActions onAddErrorNotification={onAddErrorNotification} network={network} />} />
        );
    }
}

Network.propTypes = {
    onAddErrorNotification: PropTypes.func.isRequired,
    resourceHasError: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    network: PropTypes.object.isRequired,
};

class NetworkActions extends React.Component {
    constructor() {
        super();
        this.onActivate = this.onActivate.bind(this);
        this.onDeactivate = this.onDeactivate.bind(this);
    }

    onActivate() {
        const network = this.props.network;

        networkActivate(network.connectionName, network.id)
                .fail(exc => {
                    this.props.onAddErrorNotification({
                        text: cockpit.format(_("Network $0 failed to get activated"), network.name),
                        detail: exc.message, resourceId: network.id,
                    });
                });
    }

    onDeactivate() {
        const network = this.props.network;

        networkDeactivate(this.props.network.connectionName, this.props.network.id)
                .fail(exc => {
                    this.props.onAddErrorNotification({
                        text: cockpit.format(_("Network $0 failed to get deactivated"), network.name),
                        detail: exc.message, resourceId: network.id,
                    });
                });
    }

    render() {
        const network = this.props.network;
        const id = networkId(network.name, network.connectionName);
        const deleteHandler = (network) => {
            if (network.active) {
                return networkDeactivate(network.connectionName, network.id)
                        .then(() => networkUndefine(network.connectionName, network.id));
            } else {
                return networkUndefine(network.connectionName, network.id);
            }
        };

        return (
            <>
                { network.active &&
                <Button id={`deactivate-${id}`} onClick={this.onDeactivate}>
                    {_("Deactivate")}
                </Button> }
                { !network.active &&
                <Button id={`activate-${id}`} onClick={this.onActivate}>
                    {_("Activate")}
                </Button>
                }
                <DeleteResource objectType="Network"
                    objectId={id}
                    objectName={network.name}
                    deleteHandler={() => deleteHandler(network)}
                    overlayText={_("Non-persistent network cannot be deleted. It ceases to exists when it's deactivated.")}
                    disabled={!network.persistent} />
            </>
        );
    }
}
