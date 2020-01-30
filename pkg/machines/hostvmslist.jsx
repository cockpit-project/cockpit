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

import { vmId, rephraseUI, dummyVmsFilter } from "./helpers.js";

import { ListingTable } from "cockpit-components-table.jsx";
import { VmExpandedContent } from './components/vm/vmExpandedContent.jsx';
import StateIcon from './components/vm/stateIcon.jsx';

const VmState = ({ vm, resourceHasError }) => {
    let state = null;

    if (vm.installInProgress) {
        state = _("creating VM installation");
    } else if (vm.createInProgress) {
        state = _("creating VM");
    } else {
        state = vm.state;
    }

    const stateAlert = resourceHasError[vm.id] ? <span className='pficon-warning-triangle-o machines-status-alert' /> : null;

    return <StateIcon state={state} valueId={`${vmId(vm.name)}-state`} extra={stateAlert} />;
};

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

    render() {
        const { vms, config, ui, storagePools, dispatch, actions, networks, nodeDevices, interfaces } = this.props;
        const combinedVms = [...vms, ...dummyVmsFilter(vms, ui.vms)];

        const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);

        return (<div id='virtual-machines-listing' className='container-fluid'>
            <ListingTable caption={_("Virtual Machines")}
                variant='compact'
                emptyCaption={_("No VM is running or defined on this host")}
                actions={actions}
                columns={[
                    { title: _("Name") },
                    { title: _("Connection") },
                    { title: _("State") }
                ]}
                rows={ combinedVms
                        .sort(sortFunction)
                        .map(vm => {
                            const connectionName = vm.connectionName;
                            const expandedContent = vm.isUi ? undefined : (
                                <VmExpandedContent vm={vm} vms={vms} config={config}
                                    libvirtVersion={this.props.libvirtVersion}
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
                                    interfaces={interfaces}
                                    networks={networks.filter(network => network && network.connectionName == connectionName)}
                                    nodeDevices={nodeDevices.filter(device => device && device.connectionName == connectionName)}
                                    key={`${vmId(vm.name)}`}
                                />
                            );

                            return {
                                extraClasses: this.props.resourceHasError[vm.id] ? ['error'] : [],
                                columns: [
                                    { title: <span id={`${vmId(vm.name)}-${vm.connectionName}-name`}>{vm.name}</span> },
                                    { title: rephraseUI('connections', vm.connectionName) },
                                    { title: <VmState vm={vm} resourceHasError={this.props.resourceHasError} /> },
                                ],
                                rowId: cockpit.format("$0-$1", vmId(vm.name), vm.connectionName),
                                props: { key: cockpit.format("$0-$1-row", vmId(vm.name), vm.connectionName) },
                                initiallyExpanded: vm.ui ? vm.ui.initiallyExpanded : false,
                                expandedContent: expandedContent,
                            };
                        }) }
            />
        </div>);
    }
}

HostVmsList.propTypes = {
    vms: PropTypes.array.isRequired,
    config: PropTypes.object.isRequired,
    ui: PropTypes.object.isRequired,
    libvirtVersion: PropTypes.number.isRequired,
    storagePools: PropTypes.array.isRequired,
    dispatch: PropTypes.func.isRequired,
    networks: PropTypes.array.isRequired,
    interfaces: PropTypes.array.isRequired,
    resourceHasError: PropTypes.object.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default HostVmsList;
