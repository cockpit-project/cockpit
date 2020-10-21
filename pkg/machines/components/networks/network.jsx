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
import { Button } from '@patternfly/react-core';

import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import {
    rephraseUI,
    networkId
} from '../../helpers.js';
import { NetworkOverviewTab } from './networkOverviewTab.jsx';
import { DeleteResourceModal, DeleteResourceButton } from '../deleteResource.jsx';
import {
    networkActivate,
    networkDeactivate,
    networkUndefine
} from '../../libvirt-dbus.js';

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const getNetworkRow = ({ dispatch, network, resourceHasError, onAddErrorNotification }) => {
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
        { title: name, header: true },
        { title: device },
        { title: rephraseUI('connections', network.connectionName) },
        { title: forwarding },
        { title: state },
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

    const expandedContent = (
        <ListingPanel
            tabRenderers={tabRenderers}
            listingActions={<NetworkActions onAddErrorNotification={onAddErrorNotification} network={network} />} />
    );

    return {
        extraClasses,
        columns: cols,
        rowId: idPrefix,
        props: { key: idPrefix },
        expandedContent: expandedContent,
    };
};

class NetworkActions extends React.Component {
    constructor() {
        super();
        this.state = { deleteDialogProps: undefined, operationInProgress: false };
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
                })
                .always(() => this.setState({ operationInProgress: false }));
    }

    onDeactivate() {
        const network = this.props.network;

        networkDeactivate(this.props.network.connectionName, this.props.network.id)
                .fail(exc => {
                    this.props.onAddErrorNotification({
                        text: cockpit.format(_("Network $0 failed to get deactivated"), network.name),
                        detail: exc.message, resourceId: network.id,
                    });
                })
                .always(() => this.setState({ operationInProgress: false }));
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
        const deleteDialogProps = {
            objectType: "Network",
            objectName: network.name,
            onClose: () => this.setState({ deleteDialogProps: undefined }),
            deleteHandler: () => deleteHandler(network),
        };

        return (
            <>
                { network.active &&
                <Button id={`deactivate-${id}`} isLoading={this.state.operationInProgress} isDisabled={this.state.operationInProgress} onClick={this.onDeactivate}>
                    {_("Deactivate")}
                </Button> }
                { !network.active &&
                <Button id={`activate-${id}`} isLoading={this.state.operationInProgress} isDisabled={this.state.operationInProgress} onClick={this.onActivate}>
                    {_("Activate")}
                </Button>
                }
                {this.state.deleteDialogProps && <DeleteResourceModal {...this.state.deleteDialogProps} />}
                <DeleteResourceButton objectId={id}
                                      showDialog={() => this.setState({ deleteDialogProps })}
                                      overlayText={_("Non-persistent network cannot be deleted. It ceases to exists when it's deactivated.")}
                                      disabled={!network.persistent} />
            </>
        );
    }
}
