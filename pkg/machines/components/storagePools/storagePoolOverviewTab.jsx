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

import { storagePoolId } from '../../helpers.js';

import 'form-layout.less';

export const StoragePoolOverviewTab = ({ storagePool }) => {
    const idPrefix = `${storagePoolId(storagePool.name, storagePool.connectionName)}`;

    return (
        <div className='ct-form-layout'>
            { storagePool.path && <React.Fragment>
                <label className='control-label' htmlFor={`${idPrefix}-path`}> Path: </label>
                <div id={`${idPrefix}-path`}> {storagePool.path} </div>
            </React.Fragment> }

            <label className='control-label' htmlFor={`${idPrefix}-persistent`}> Persistent: </label>
            <div id={`${idPrefix}-persistent`}> {storagePool.persistent ? 'yes' : 'no'} </div>

            <label className='control-label' htmlFor={`${idPrefix}-autostart`}> Autostart: </label>
            <div id={`${idPrefix}-autostart`}> {storagePool.autostart ? 'yes' : 'no'} </div>

            <label className='control-label' htmlFor={`${idPrefix}-type`}> Type: </label>
            <div id={`${idPrefix}-type`}> {storagePool.type} </div>
        </div>
    );
};
StoragePoolOverviewTab.propTypes = {
    storagePool: PropTypes.object.isRequired,
};
