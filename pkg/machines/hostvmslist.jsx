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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import { Icon } from 'patternfly-react';

import { vmId } from "./helpers.js";

import { Listing, TabView } from "cockpit-components-listing.jsx";
import { Vm, getVmTabRenderers, getVmListingActions } from './components/vm/vm.jsx';
import DummyVm from './components/vm/dummyVm.jsx';

import './hostvmslist.less';

const _ = cockpit.gettext;

/**
 * List of all VMs defined on this host
 */
class HostVmsList extends React.Component {
    constructor(props) {
        super(props);
        this.deviceProxyHandler = this.deviceProxyHandler.bind(this);
        this.client = cockpit.dbus("org.freedesktop.NetworkManager", {});
        this.deviceProxies = this.client.proxies("org.freedesktop.NetworkManager.Device");
        this.deviceProxies.addEventListener('changed', this.deviceProxyHandler);
        this.deviceProxies.addEventListener('removed', this.deviceProxyHandler);
    }

    componentWillUnmount() {
        this.client.close();
    }

    deviceProxyHandler() {
        this.forceUpdate();
    }

    asDummVms(vms, uiVms) {
        const result = Object.assign({}, uiVms);
        vms.forEach(vm => {
            delete result[vm.name];
        });

        return Object.keys(result).map((k) => result[k]);
    }

    render() {
        const { vms, config, ui, storagePools, dispatch, actions, networks, nodeDevices, onAddErrorNotification } = this.props;
        const combinedVms = [...vms, ...this.asDummVms(vms, ui.vms)];
        const hostDevices = this.deviceProxies;

        const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);
        const getVm = vm => {
            const connectionName = vm.connectionName;

            return (
                <Vm vm={vm} config={config}
                    resourceHasError={this.props.resourceHasError}
                    onAddErrorNotification={onAddErrorNotification}
                    hostDevices={hostDevices}
                    storagePools={storagePools.filter(pool => pool && pool.connectionName == connectionName)}
                    dispatch={dispatch}
                    networks={networks.filter(network => network && network.connectionName == connectionName)}
                    nodeDevices={nodeDevices.filter(device => device && device.connectionName == connectionName)}
                    key={`${vmId(vm.name)}`}
                />
            );
        };

        if (cockpit.location.path.length < 2) {
            return (
                <div id='virtual-machines-listing' className='container-fluid'>
                    <Listing title={_("Virtual Machines")}
                        columnTitles={[_("Name"), _("Connection"), _("State")]}
                        actions={actions}
                        emptyCaption={_("No VM is running or defined on this host")}>
                        {combinedVms
                                .sort(sortFunction)
                                .map(vm => {
                                    if (vm.isUi) {
                                        return (
                                            <DummyVm vm={vm} key={`${vmId(vm.name)}`} />
                                        );
                                    }
                                    return getVm(vm);
                                })}
                    </Listing>
                </div>
            );
        } else {
            const vm = vms.find(vm => vm.uuid == cockpit.location.path[1]);
            if (!vm)
                return null;
            const vmTabs = getVmTabRenderers({ vm, config, hostDevices, storagePools, dispatch, networks, nodeDevices, onAddErrorNotification });
            const vmListingActions = getVmListingActions({ vm, config, dispatch });

            return (
                <div id='vm-details'>
                    <div className='content-filter'>
                        <h3>
                            <Icon type='pf' name='virtual-machine' />
                            <span> {vm.name} </span>
                        </h3>
                        <a tabIndex='0' onClick={() => cockpit.location.go(['vms']) }>
                            {_("Show all Virtual Machines")}
                        </a>
                    </div>
                    <div className='listing-ct-inline'>
                        <h3> {_("Details")} </h3>
                        <TabView tabRenderers={vmTabs.tabRenderers}
                                 listingActions={vmListingActions} />
                    </div>
                </div>
            );
        }
    }
}

HostVmsList.propTypes = {
    vms: PropTypes.array.isRequired,
    config: PropTypes.object.isRequired,
    ui: PropTypes.object.isRequired,
    storagePools: PropTypes.array.isRequired,
    dispatch: PropTypes.func.isRequired,
    networks: PropTypes.array.isRequired,
    resourceHasError: PropTypes.object.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default HostVmsList;
