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

import {
    shutdownVm,
    pauseVm,
    resumeVm,
    forceVmOff,
    forceRebootVm,
    rebootVm,
    sendNMI,
    startVm,
    installVm,
    usageStartPolling,
    usageStopPolling,
} from "./actions/provider-actions.js";

import { vmId } from "./helpers.js";

import { Listing } from "cockpit-components-listing.jsx";
import Vm from './components/vm/vm.jsx';
import DummyVm from './components/vm/dummyVm.jsx';

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
        const { vms, config, ui, storagePools, dispatch, actions, networks, nodeDevices } = this.props;
        const combinedVms = [...vms, ...this.asDummVms(vms, ui.vms)];

        const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);

        return (<div id='virtual-machines-listing' className='container-fluid'>
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
                            const connectionName = vm.connectionName;

                            return (
                                <Vm vm={vm} config={config}
                                    resourceHasError={this.props.resourceHasError}
                                    onAddErrorNotification={this.props.onAddErrorNotification}
                                    hostDevices={this.deviceProxies}
                                    storagePools={storagePools.filter(pool => pool && pool.connectionName == connectionName)}
                                    onStart={() => dispatch(startVm(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to start"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onInstall={() => dispatch(installVm(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to get installed"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onReboot={() => dispatch(rebootVm(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to Reboot"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onForceReboot={() => dispatch(forceRebootVm(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to force Reboot"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onShutdown={() => dispatch(shutdownVm(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to shutdown"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onPause={() => dispatch(pauseVm(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to pause"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onResume={() => dispatch(resumeVm(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to resume"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onForceoff={() => dispatch(forceVmOff(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to force shutdown"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onSendNMI={() => dispatch(sendNMI(vm)).catch(ex => {
                                        this.props.onAddErrorNotification({
                                            text: cockpit.format(_("VM $0 failed to send NMI"), vm.name),
                                            detail: ex.message, resourceId: vm.id,
                                        });
                                    })}
                                    onUsageStartPolling={() => dispatch(usageStartPolling(vm))}
                                    onUsageStopPolling={() => dispatch(usageStopPolling(vm))}
                                    dispatch={dispatch}
                                    networks={networks.filter(network => network && network.connectionName == connectionName)}
                                    nodeDevices={nodeDevices.filter(device => device && device.connectionName == connectionName)}
                                    key={`${vmId(vm.name)}`}
                                />);
                        })}
            </Listing>
        </div>);
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
