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
    Button,
    Card, CardHeader,
    Divider,
    Flex, FlexItem,
} from '@patternfly/react-core';
import { ServerIcon, NetworkIcon, ArrowCircleUpIcon, ArrowCircleDownIcon } from '@patternfly/react-icons';

import './aggregateStatusCards.css';

export class AggregateStatusCards extends React.Component {
    render() {
        return (
            <div className='grid-cards-ct'>
                <Card id='card-pf-storage-pools'>
                    <CardHeader>
                        <Button onClick={() => cockpit.location.go(['storages'])} variant="link" icon={<ServerIcon />}>
                            <span className="card-pf-title-link">
                                {cockpit.format(cockpit.ngettext("$0 Storage pool", "$0 Storage pools", this.props.storagePools.length), this.props.storagePools.length)}
                            </span>
                        </Button>
                        <Flex>
                            <FlexItem className="active-resources">
                                <ArrowCircleUpIcon />
                                { this.props.storagePools.filter(pool => pool && pool.active).length }
                            </FlexItem>
                            <Divider isVertical />
                            <FlexItem className="active-resources">
                                <ArrowCircleDownIcon />
                                { this.props.storagePools.filter(pool => pool && !pool.active).length }
                            </FlexItem>
                        </Flex>
                    </CardHeader>
                </Card>
                <Card id='card-pf-networks'>
                    <CardHeader>
                        <Button onClick={() => cockpit.location.go(['networks'])} variant="link" icon={<NetworkIcon />}>
                            <span className="card-pf-title-link">
                                {cockpit.format(cockpit.ngettext("$0 Network", "$0 Networks", this.props.networks.length), this.props.networks.length)}
                            </span>
                        </Button>
                        <Flex>
                            <FlexItem className="active-resources">
                                <ArrowCircleUpIcon />
                                { this.props.networks.filter(network => network && network.active).length }
                            </FlexItem>
                            <Divider isVertical />
                            <FlexItem className="active-resources">
                                <ArrowCircleDownIcon />
                                { this.props.networks.filter(network => network && !network.active).length }
                            </FlexItem>
                        </Flex>
                    </CardHeader>
                </Card>
            </div>
        );
    }
}
AggregateStatusCards.propTypes = {
    networks: PropTypes.array.isRequired,
    storagePools: PropTypes.array.isRequired,
};
