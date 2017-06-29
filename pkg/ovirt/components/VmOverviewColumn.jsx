/*jshint esversion: 6 */
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import cockpit from 'cockpit';
import React from "react";

import { vmId } from '../../machines/helpers.es6';

React;
const _ = cockpit.gettext;

import './VmOverviewColumn.css';

const VmProperty = ({ title, value, id }) => {
    return (
        <tr>
            <td>
                <label className='control-label'>
                    {title}
                </label>
            </td>
            <td id={id}>
                {value}
            </td>
        </tr>
    );
};

const VmIcon = ({ icons, iconId }) => {
    if (!iconId || !icons || !icons[iconId] || !icons[iconId].data) {
        return null;
    }

    const icon = icons[iconId];
    const src = `data:${icon.type};base64,${icon.data}`;

    return (
        <img src={src} className='ovirt-provider-overview-icon' alt={_("VM icon")} />
    );
};

const VmOverviewColumn = ({ vm, providerState }) => { // For reference, extend if needed
    const clusterVm = providerState.vms[vm.id];
    if (!clusterVm) { // not an oVirt-managed VM
        return null;
    }

    const idPrefix =`${vmId(vm.name)}-ovirt`;

    return (
        <td className='ovirt-provider-listing-top-column'>
            <div className='ovirt-provider-columns-container'>
                <div className='ovirt-provider-columns-one'>
                    <table className='form-table-ct'>
                        <VmProperty title={_("Description:")} value={clusterVm.description} id={`${idPrefix}-description`} />
                    </table>
                </div>
                <div className='ovirt-provider-columns-two'>
                    <VmIcon icons={providerState.icons} iconId={clusterVm.icons.largeId} />
                </div>
            </div>
        </td>
    );
};

export default VmOverviewColumn;
