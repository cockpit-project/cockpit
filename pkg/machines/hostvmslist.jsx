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
    Toolbar, ToolbarContent, ToolbarItem,
    TextInput,
    Select, SelectOption, SelectVariant,
    Page, PageSection, PageSectionVariants,
} from '@patternfly/react-core';

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
import VmActions from './components/vm/vmActions.jsx';

import { vmId, rephraseUI, dummyVmsFilter } from "./helpers.js";

import { ListingTable } from "cockpit-components-table.jsx";
import { VmExpandedContent } from './components/vm/vmExpandedContent.jsx';
import StateIcon from './components/vm/stateIcon.jsx';
import { AggregateStatusCards } from "./components/aggregateStatusCards.jsx";

import "./hostvmslist.scss";

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
        this.state = { currentTextFilter: "", statusSelected: { value: _("All"), toString: function() { return this.value } } };

        this.deviceProxyHandler = this.deviceProxyHandler.bind(this);
        this.client = cockpit.dbus("org.freedesktop.NetworkManager", {});
        this.deviceProxies = this.client.proxies("org.freedesktop.NetworkManager.Device");
        this.deviceProxies.addEventListener('changed', this.deviceProxyHandler);
        this.deviceProxies.addEventListener('removed', this.deviceProxyHandler);
        this.onSearchInputChange = (currentTextFilter) => { this.setState({ currentTextFilter }) };
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
        const combinedVmsFiltered = combinedVms
                .filter(vm => vm.name.indexOf(this.state.currentTextFilter) != -1 && (!this.state.statusSelected.apiState || this.state.statusSelected.apiState == vm.state));

        const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);
        const toolBar = <Toolbar>
            <ToolbarContent>
                <ToolbarItem>
                    <TextInput name="text-search" id="text-search" type="search"
                        value={this.state.currentTextFilter}
                        onChange={this.onSearchInputChange}
                        placeholder={_("Filter by name")} />
                </ToolbarItem>
                <ToolbarItem variant="label" id="vm-state-select">
                    {_("State")}
                </ToolbarItem>
                <ToolbarItem>
                    <Select variant={SelectVariant.single}
                            toggleId="vm-state-select-toggle"
                            onToggle={statusIsExpanded => this.setState({ statusIsExpanded })}
                            onSelect={(event, selection) => this.setState({ statusIsExpanded: false, statusSelected: selection })}
                            selections={this.state.statusSelected}
                            isOpen={this.state.statusIsExpanded}
                            aria-labelledby="vm-state-select">
                        {[
                            { value: _("All"), },
                            { value: _("Running"), apiState: "running" },
                            { value: _("Shut off"), apiState: "shut off" }
                        ].map((option, index) => (
                            <SelectOption key={index} value={{ ...option, toString: function() { return this.value } }} />
                        ))}
                    </Select>
                </ToolbarItem>
                <ToolbarItem variant="separator" />
                <ToolbarItem>{actions}</ToolbarItem>
            </ToolbarContent>
        </Toolbar>;

        return (<Page>
            <PageSection id="virtual-machines-page-main-nav" type='nav'>
                <AggregateStatusCards networks={networks} storagePools={storagePools} />
            </PageSection>
            <PageSection variant={PageSectionVariants.light} id='virtual-machines-listing'>
                <ListingTable caption={_("Virtual Machines")}
                    variant='compact'
                    emptyCaption={_("No VM is running or defined on this host")}
                    actions={toolBar}
                    columns={[
                        { title: _("Name"), header: true },
                        { title: _("Connection") },
                        { title: _("State") },
                        { title: "" },
                    ]}
                    rows={ combinedVmsFiltered
                            .sort(sortFunction)
                            .map(vm => {
                                const connectionName = vm.connectionName;
                                const vmActions = <VmActions
                                    vm={vm}
                                    config={config}
                                    dispatch={dispatch}
                                    storagePools={storagePools}
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
                                />;
                                const expandedContent = vm.isUi ? undefined : (
                                    <VmExpandedContent vm={vm} vms={vms} config={config}
                                        libvirtVersion={this.props.libvirtVersion}
                                        resourceHasError={this.props.resourceHasError}
                                        onAddErrorNotification={this.props.onAddErrorNotification}
                                        hostDevices={this.deviceProxies}
                                        storagePools={storagePools.filter(pool => pool && pool.connectionName == connectionName)}
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
                                        { title: !vm.isUi ? vmActions : null },
                                    ],
                                    rowId: cockpit.format("$0-$1", vmId(vm.name), vm.connectionName),
                                    props: { key: cockpit.format("$0-$1-row", vmId(vm.name), vm.connectionName) },
                                    initiallyExpanded: vm.ui ? vm.ui.initiallyExpanded : false,
                                    expandedContent: expandedContent,
                                };
                            }) }
                />
            </PageSection>
        </Page>);
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
