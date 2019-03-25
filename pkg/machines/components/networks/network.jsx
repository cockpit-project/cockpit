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
import { Button } from 'patternfly-react';

import { ListingRow } from 'cockpit-components-listing.jsx';
import {
    rephraseUI,
    networkId
} from '../../helpers.js';
import { NetworkOverviewTab } from './networkOverviewTab.jsx';
import {
    networkActivate,
    networkDeactivate
} from '../../libvirt-dbus.js';

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export class Network extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            actionError: undefined,
            actionErrorDetail: undefined
        };
        this.actionErrorSet = this.actionErrorSet.bind(this);
    }

    actionErrorSet(error, detail) {
        this.setState({ actionError: error, actionErrorDetail: detail });
    }

    render() {
        const { dispatch, network } = this.props;
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
            <React.Fragment>
                { this.state.actionError && <span className='pficon-warning-triangle-o machines-status-alert' /> }
                <span id={`${idPrefix}-state`}>
                    { network.active ? _("active") : _("inactive") }
                </span>
            </React.Fragment>);
        const cols = [
            { name, 'header': true },
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

        let tabRenderers = [
            {
                name: overviewTabName,
                renderer: NetworkOverviewTab,
                data: { network, dispatch, actionError: this.state.actionError,
                        actionErrorDetail: this.state.actionErrorDetail,
                        onActionErrorDismiss: () => { this.setState({ actionError:  undefined }) }
                }
            },
        ];

        return (
            <ListingRow rowId={idPrefix}
                columns={cols}
                tabRenderers={tabRenderers}
                listingActions={<NetworkActions actionErrorSet={this.actionErrorSet} network={network} />} />
        );
    }
}

Network.propTypes = {
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
        networkActivate(this.props.network.connectionName, this.props.network.id)
                .fail(exc => this.props.actionErrorSet(_("Network failed to get activated"), exc.message));
    }

    onDeactivate() {
        networkDeactivate(this.props.network.connectionName, this.props.network.id)
                .fail(exc => this.props.actionErrorSet(_("Network failed to get deactivated"), exc.message));
    }

    render() {
        const network = this.props.network;
        const id = networkId(network.name, network.connectionName);

        return (
            <React.Fragment>
                { network.active &&
                <Button id={`deactivate-${id}`} onClick={this.onDeactivate}>
                    {_("Deactivate")}
                </Button> }
                { !network.active &&
                <Button id={`activate-${id}`} onClick={this.onActivate}>
                    {_("Activate")}
                </Button>
                }
            </React.Fragment>
        );
    }
}
