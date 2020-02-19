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

import * as Select from "cockpit-components-select.jsx";
import cockpit from 'cockpit';

import './nic.css';

const _ = cockpit.gettext;

export const NetworkModelRow = ({ idPrefix, onValueChanged, dialogValues, osTypeArch, osTypeMachine }) => {
    const availableModelTypes = [
        { name: 'virtio', desc: 'Linux, perf' },
        { name: 'e1000e', desc: 'PCI' },
        { name: 'e1000', desc: 'PCI, legacy' },
        { name: 'rtl8139', desc: 'PCI, legacy' }];
    const defaultModelType = dialogValues.networkModel;

    if (osTypeArch == 'ppc64' && osTypeMachine == 'pseries')
        availableModelTypes.push({ name: 'spapr-vlan' });

    return (
        <>
            <label className='control-label' htmlFor={`${idPrefix}-select-model`}>
                {_("Model")}
            </label>
            <Select.Select id={`${idPrefix}-select-model`}
                           onChange={value => onValueChanged('networkModel', value)}
                           initial={defaultModelType}
                           extraClass='form-control'>
                {availableModelTypes
                        .map(networkModel => {
                            return (
                                <Select.SelectEntry data={networkModel.name} key={networkModel.name}>
                                    {networkModel.name} {networkModel.desc && '(' + networkModel.desc + ')'}
                                </Select.SelectEntry>
                            );
                        })}
            </Select.Select>
        </>
    );
};

NetworkModelRow.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    osTypeArch: PropTypes.string.isRequired,
    osTypeMachine: PropTypes.string.isRequired,
    onValueChanged: PropTypes.func.isRequired,
    dialogValues: PropTypes.object.isRequired,
};

export const NetworkTypeAndSourceRow = ({ idPrefix, onValueChanged, dialogValues, connectionName, networkDevices }) => {
    const defaultNetworkType = dialogValues.networkType;
    let availableNetworkTypes = [];
    let defaultNetworkSource = dialogValues.networkSource;
    let networkSourcesContent;
    let networkSourceEnabled = true;

    if (connectionName !== 'session') {
        availableNetworkTypes = [
            { name: 'network', desc: 'Virtual network' },
            { name: 'bridge', desc: 'Bridge to LAN' },
            { name: 'ethernet', desc: 'Generic ethernet connection', disabled: true },
            { name: 'direct', desc: 'Direct attachment' },
        ];
    } else {
        availableNetworkTypes = [
            { name: 'network', desc: 'Virtual network' },
            { name: 'user', desc: 'Userspace SLIRP stack' },
        ];
    }

    // Bring to the first position in dropdown list the initial selection which reflects the current nic type
    availableNetworkTypes.sort(function(x, y) { return x.name == defaultNetworkType ? -1 : y.name == defaultNetworkType ? 1 : 0 });

    if (["network", "direct", "bridge"].includes(dialogValues.networkType)) {
        let sources;
        if (dialogValues.networkType === "network")
            sources = dialogValues.availableSources.network;
        else
            sources = dialogValues.availableSources.device;

        if (sources.length > 0) {
            networkSourcesContent = sources.map(networkSource => {
                return (
                    <Select.SelectEntry data={networkSource} key={networkSource}>
                        {networkSource}
                    </Select.SelectEntry>
                );
            });
        } else {
            if (dialogValues.networkType === "network")
                defaultNetworkSource = _("No Virtual Networks");
            else
                defaultNetworkSource = _("No Network Devices");

            networkSourcesContent = (
                <Select.SelectEntry data='empty-list' key='empty-list'>
                    {defaultNetworkSource}
                </Select.SelectEntry>
            );
            networkSourceEnabled = false;
        }
    }

    return (
        <>
            <label className='control-label' htmlFor={`${idPrefix}-select-type`}>
                {_("Interface Type")}
            </label>
            <Select.Select id={`${idPrefix}-select-type`}
                           onChange={value => onValueChanged('networkType', value)}
                           initial={defaultNetworkType}
                           extraClass='form-control'>
                {availableNetworkTypes
                        .map(networkType => {
                            return (
                                <Select.SelectEntry data={networkType.name} key={networkType.name} disabled={networkType.disabled || false}>
                                    {networkType.desc}
                                </Select.SelectEntry>
                            );
                        })}
            </Select.Select>
            {["network", "direct", "bridge"].includes(dialogValues.networkType) && (
                <div className='ct-form'>
                    <label className='control-label' htmlFor={`${idPrefix}-select-source`}>
                        {_("Source")}
                    </label>
                    <Select.Select id={`${idPrefix}-select-source`}
                                   onChange={value => onValueChanged('networkSource', value)}
                                   enabled={networkSourceEnabled}
                                   initial={defaultNetworkSource}
                                   extraClass='form-control'>
                        {networkSourcesContent}
                    </Select.Select>
                </div>
            )}
        </>
    );
};

NetworkTypeAndSourceRow.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    connectionName: PropTypes.string.isRequired,
    onValueChanged: PropTypes.func.isRequired,
    networkDevices: PropTypes.array.isRequired,
    dialogValues: PropTypes.object.isRequired,
};
