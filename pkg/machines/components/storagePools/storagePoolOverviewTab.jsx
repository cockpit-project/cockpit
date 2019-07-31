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
import cockpit from 'cockpit';

import 'form-layout.less';

const _ = cockpit.gettext;

export const StoragePoolOverviewTab = ({ storagePool }) => {
    const idPrefix = `${storagePoolId(storagePool.name, storagePool.connectionName)}`;

    return (
        <div className='ct-form'>
            { storagePool.source && storagePool.source.host && <React.Fragment>
                <label className='control-label' htmlFor={`${idPrefix}-host`}> {_("Host")} </label>
                <div id={`${idPrefix}-host`}>
                    {storagePool.source.host.name}
                </div>
            </React.Fragment> }

            { storagePool.source && storagePool.source.device && <React.Fragment>
                <label className='control-label' htmlFor={`${idPrefix}-source-path`}> {_("Source Path")} </label>
                <div id={`${idPrefix}-source-path`}> {storagePool.source.device.path} </div>
            </React.Fragment> }

            { storagePool.source && storagePool.source.dir && <React.Fragment>
                <label className='control-label' htmlFor={`${idPrefix}-source-path`}> {_("Source Path")} </label>
                <div id={`${idPrefix}-source-path`}> {storagePool.source.dir.path} </div>
            </React.Fragment> }

            { storagePool.source && storagePool.source.name && <React.Fragment>
                <label className='control-label' htmlFor={`${idPrefix}-source-path`}> {_("Source")} </label>
                <div id={`${idPrefix}-source-path`}> {storagePool.source.name} </div>
            </React.Fragment> }

            { storagePool.source && storagePool.source.format && <React.Fragment>
                <label className='control-label' htmlFor={`${idPrefix}-source-format`}> {_("Source Format")} </label>
                <div id={`${idPrefix}-source-format`}> {storagePool.source.format.type} </div>
            </React.Fragment> }

            { storagePool.target && storagePool.target.path && <React.Fragment>
                <label className='control-label' htmlFor={`${idPrefix}-target-path`}> {_("Target Path")} </label>
                <div id={`${idPrefix}-target-path`}> {storagePool.target.path} </div>
            </React.Fragment> }

            <label className='control-label' htmlFor={`${idPrefix}-persistent`}> {_("Persistent")} </label>
            <div id={`${idPrefix}-persistent`}> {storagePool.persistent ? _("yes") : _("no")} </div>

            <label className='control-label' htmlFor={`${idPrefix}-autostart`}> {_("Autostart")} </label>
            <div id={`${idPrefix}-autostart`}> {storagePool.autostart ? _("yes") : _("no")} </div>

            <label className='control-label' htmlFor={`${idPrefix}-type`}> {_("Type")} </label>
            <div id={`${idPrefix}-type`}> {storagePool.type} </div>
        </div>
    );
};
StoragePoolOverviewTab.propTypes = {
    storagePool: PropTypes.object.isRequired,
};
