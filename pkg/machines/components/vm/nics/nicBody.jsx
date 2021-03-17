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
import {
    FormGroup,
    FormSelect, FormSelectOption,
} from '@patternfly/react-core';

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
        <FormGroup fieldId={`${idPrefix}-select-model`} label={_("Model")}>
            <FormSelect id={`${idPrefix}-select-model`}
                        onChange={value => onValueChanged('networkModel', value)}
                        value={defaultModelType}>
                {availableModelTypes
                        .map(networkModel => {
                            return (
                                <FormSelectOption value={networkModel.name} key={networkModel.name}
                                                  label={networkModel.name && '(' + networkModel.desc + ')'} />
                            );
                        })}
            </FormSelect>
        </FormGroup>
    );
};

NetworkModelRow.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    osTypeArch: PropTypes.string.isRequired,
    osTypeMachine: PropTypes.string.isRequired,
    onValueChanged: PropTypes.func.isRequired,
    dialogValues: PropTypes.object.isRequired,
};

export const NetworkTypeAndSourceRow = ({ idPrefix, onValueChanged, dialogValues, connectionName }) => {
    const defaultNetworkType = dialogValues.networkType;
    let availableNetworkTypes = [];
    let defaultNetworkSource = dialogValues.networkSource;
    let networkSourcesContent;
    let networkSourceEnabled = true;

    // { name: 'ethernet', desc: 'Generic ethernet connection' }, Add back to the list when implemented
    if (connectionName !== 'session') {
        availableNetworkTypes = [
            { name: 'network', desc: 'Virtual network' },
            { name: 'bridge', desc: 'Bridge to LAN' },
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
                    <FormSelectOption value={networkSource} key={networkSource}
                                      label={networkSource} />
                );
            });
        } else {
            if (dialogValues.networkType === "network")
                defaultNetworkSource = _("No virtual networks");
            else
                defaultNetworkSource = _("No network devices");

            networkSourcesContent = (
                <FormSelectOption value='empty-list' key='empty-list'
                                  label={defaultNetworkSource} />
            );
            networkSourceEnabled = false;
        }
    }

    return (
        <FormGroup fieldId={`${idPrefix}-select-type`} label={_("Interface type")}>
            <FormSelect id={`${idPrefix}-select-type`}
                        onChange={value => onValueChanged('networkType', value)}
                        value={defaultNetworkType}>
                {availableNetworkTypes
                        .map(networkType => {
                            return (
                                <FormSelectOption value={networkType.name} key={networkType.name}
                                                  isDisabled={networkType.disabled || false}
                                                  label={networkType.desc} />
                            );
                        })}
            </FormSelect>
            {["network", "direct", "bridge"].includes(dialogValues.networkType) && (
                <FormGroup fieldId={`${idPrefix}-select-source`} label={_("Source")}>
                    <FormSelect id={`${idPrefix}-select-source`}
                                onChange={value => onValueChanged('networkSource', value)}
                                isDisabled={!networkSourceEnabled}
                                value={defaultNetworkSource}>
                        {networkSourcesContent}
                    </FormSelect>
                </FormGroup>
            )}
        </FormGroup>
    );
};

NetworkTypeAndSourceRow.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    connectionName: PropTypes.string.isRequired,
    onValueChanged: PropTypes.func.isRequired,
    dialogValues: PropTypes.object.isRequired,
};
