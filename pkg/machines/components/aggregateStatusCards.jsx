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
    Card,
    CardGrid,
    CardTitle,
    CardBody,
    AggregateStatusCount,
    AggregateStatusNotifications,
    AggregateStatusNotification,
    Col,
    Row,
    Icon,
} from 'patternfly-react';

import './aggregateStatusCards.css';

export class AggregateStatusCards extends React.Component {
    render() {
        return (
            <div className='cards-pf grid-cards-ct cards-ct-hybrid'>
                <CardGrid>
                    <Row>
                        <Col sm={6} md={6}>
                            <Card accented aggregated>
                                <CardTitle onClick={ () => this.props.changeActiveList(2) }>
                                    <a href='#'>
                                        <Icon type='pf' name='server' />
                                        <AggregateStatusCount>
                                            { this.props.storagePools.length }
                                        </AggregateStatusCount>
                                        Storage Pools
                                    </a>
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
                        </Col>
                        <Col sm={6} md={6}>
                            <Card accented aggregated>
                                <CardTitle>
                                    <Icon type='pf' name='network' />
                                    <AggregateStatusCount>
                                        { this.props.networks.length }
                                    </AggregateStatusCount>
                                    Networks
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
                        </Col>
                    </Row>
                </CardGrid>
            </div>
        );
    }
}
AggregateStatusCards.propTypes = {
    networks: PropTypes.array.isRequired,
    storagePools: PropTypes.array.isRequired,
    changeActiveList: PropTypes.func.isRequired,
};
