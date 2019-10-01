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
import cockpit from 'cockpit';

import {
    Card,
    CardTitle,
    CardBody,
    AggregateStatusCount,
    AggregateStatusNotifications,
    AggregateStatusNotification,
    Icon,
} from 'patternfly-react';

import './aggregateStatusCards.css';

export class AggregateStatusCards extends React.Component {
    render() {
        return (
            <div className='cards-pf grid-cards-ct cards-ct-hybrid'>
                <Card accented aggregated id='card-pf-storage-pools'>
                    <CardTitle onClick={ () => cockpit.location.go(['storages']) }>
                        <button role="link" className="link-button">
                            <Icon type='pf' name='server' />
                            <AggregateStatusCount>
                                { this.props.storagePools.length }
                            </AggregateStatusCount>
                            <span className="card-pf-title-link">
                                {cockpit.ngettext("Storage Pool", "Storage Pools", this.props.storagePools.length)}
                            </span>
                        </button>
                    </CardTitle>
                    <CardBody>
                        <AggregateStatusNotifications>
                            <AggregateStatusNotification>
                                <Icon type='fa' name='arrow-circle-o-up' />
                                { this.props.storagePools.filter(pool => pool && pool.active).length }
                            </AggregateStatusNotification>
                            <AggregateStatusNotification>
                                <Icon type='fa' name='arrow-circle-o-down' />
                                { this.props.storagePools.filter(pool => pool && !pool.active).length }
                            </AggregateStatusNotification>
                        </AggregateStatusNotifications>
                    </CardBody>
                </Card>
                <Card accented aggregated id='card-pf-networks'>
                    <CardTitle onClick={ () => cockpit.location.go(['networks']) }>
                        <button role="link" className="link-button">
                            <Icon type='pf' name='network' />
                            <AggregateStatusCount>
                                { this.props.networks.length }
                            </AggregateStatusCount>
                            <span className="card-pf-title-link">
                                {cockpit.ngettext("Network", "Networks", this.props.networks.length)}
                            </span>
                        </button>
                    </CardTitle>
                    <CardBody>
                        <AggregateStatusNotifications>
                            <AggregateStatusNotification>
                                <Icon type='fa' name='arrow-circle-o-up' />
                                { this.props.networks.filter(network => network && network.active).length }
                            </AggregateStatusNotification>
                            <AggregateStatusNotification>
                                <Icon type='fa' name='arrow-circle-o-down' />
                                { this.props.networks.filter(network => network && !network.active).length }
                            </AggregateStatusNotification>
                        </AggregateStatusNotifications>
                    </CardBody>
                </Card>
            </div>
        );
    }
}
AggregateStatusCards.propTypes = {
    networks: PropTypes.array.isRequired,
    storagePools: PropTypes.array.isRequired,
};
