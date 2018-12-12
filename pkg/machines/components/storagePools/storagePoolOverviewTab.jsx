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
import { Col, Row } from 'patternfly-react';

import { storagePoolId } from '../../helpers.js';

export const StoragePoolOverviewTab = ({ storagePool }) => {
    const idPrefix = `${storagePoolId(storagePool.name, storagePool.connectionName)}`;

    return (
        <Col lg={12} md={12} sm={12}>
            { storagePool.path && <Row>
                <Col lg={6} md={6} sm={6} id={`${idPrefix}-path`}>
                    <dl>
                        <dt> Path: </dt>
                        <dd> { storagePool.path } </dd>
                    </dl>
                </Col>
            </Row> }
            <Row>
                <Col lg={6} md={6} sm={6} id={`${idPrefix}-persistent`}>
                    <dl>
                        <dt> Persistent: </dt>
                        <dd> { storagePool.persistent ? 'yes' : 'no' } </dd>
                    </dl>
                </Col>
            </Row>
            <Row>
                <Col lg={6} md={6} sm={6} id={`${idPrefix}-autostart`}>
                    <dl>
                        <dt> Autostart: </dt>
                        <dd> { storagePool.autostart ? 'yes' : 'no' } </dd>
                    </dl>
                </Col>
            </Row>
            <Row>
                <Col lg={6} md={6} sm={6} id={`${idPrefix}-type`}>
                    <dl>
                        <dt> Type: </dt>
                        <dd> { storagePool.type } </dd>
                    </dl>
                </Col>
            </Row>
        </Col>
    );
};
StoragePoolOverviewTab.propTypes = {
    storagePool: PropTypes.object.isRequired,
};
