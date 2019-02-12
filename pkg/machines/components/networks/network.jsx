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

import { ListingRow } from 'cockpit-components-listing.jsx';
import {
    rephraseUI,
    networkId
} from '../../helpers.js';
import { NetworkOverviewTab } from './networkOverviewTab.jsx';

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export class Network extends React.Component {
    render() {
        const { network } = this.props;
        const idPrefix = `${networkId(network.name, network.connectionName)}`;
        const name = (
            <span id={`${idPrefix}-name`}>
                { network.name }
            </span>);
        const device = (
            <span id={`${idPrefix}-device`}>
                { network.device }
            </span>);
        const forwarding = (
            <span id={`${idPrefix}-forwarding`}>
                { rephraseUI('networkForward', network.mode) }
            </span>);
        const state = (
            <React.Fragment>
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
                data: { network }
            },
        ];

        return (
            <ListingRow rowId={idPrefix}
                columns={cols}
                tabRenderers={tabRenderers} />
        );
    }
}

Network.propTypes = {
    network: PropTypes.object.isRequired,
};
