/* jshint esversion: 6 */
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
    forceVmOff,
    forceRebootVm,
    rebootVm,
    sendNMI,
    startVm,
    installVm,
    usageStartPolling,
    usageStopPolling,
} from "./actions/provider-actions.es6";
import {
    clearNotification,
} from "./actions/store-actions.es6";

import { vmId } from "./helpers.es6";

import { Listing } from "cockpit-components-listing.jsx";
import NotificationArea from './components/notification/notificationArea.jsx';
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
        const { vms, config, ui, storagePools, dispatch, actions } = this.props;
        const combinedVms = [...vms, ...this.asDummVms(vms, ui.vms)];

        const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);

        let allActions = [];
        if (actions) {
            allActions = allActions.concat(actions);
        }

        return (<div className='container-fluid'>
            <NotificationArea id={"notification-area"}
                notifications={ui.notifications}
                onDismiss={(id) => dispatch(clearNotification(id))} />
            <Listing title={_("Virtual Machines")}
                columnTitles={[_("Name"), _("Connection"), _("State")]}
                actions={allActions}
                emptyCaption={_("No VM is running or defined on this host")}>
                {combinedVms
                        .sort(sortFunction)
                        .map(vm => {
                            if (vm.isUi) {
                                return (
                                    <DummyVm vm={vm} key={`${vmId(vm.name)}`} />
                                );
                            }
                            return (
                                <Vm vm={vm} config={config}
                                    hostDevices={this.deviceProxies}
                                    storagePools={storagePools}
                                    onStart={() => dispatch(startVm(vm))}
                                    onInstall={() => dispatch(installVm(vm))}
                                    onReboot={() => dispatch(rebootVm(vm))}
                                    onForceReboot={() => dispatch(forceRebootVm(vm))}
                                    onShutdown={() => dispatch(shutdownVm(vm))}
                                    onForceoff={() => dispatch(forceVmOff(vm))}
                                    onUsageStartPolling={() => dispatch(usageStartPolling(vm))}
                                    onUsageStopPolling={() => dispatch(usageStopPolling(vm))}
                                    onSendNMI={() => dispatch(sendNMI(vm))}
                                    dispatch={dispatch}
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
    storagePools: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
};

export default HostVmsList;
