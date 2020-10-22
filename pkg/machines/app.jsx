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
import { ToastNotificationList } from 'patternfly-react';
import { Alert } from "@patternfly/react-core";
import { superuser } from "superuser.js";
import cockpit from 'cockpit';

import HostVmsList from "./hostvmslist.jsx";
import { StoragePoolList } from "./components/storagePools/storagePoolList.jsx";
import { NetworkList } from "./components/networks/networkList.jsx";
import { VmExpandedContent } from './components/vm/vmExpandedContent.jsx';
import { CreateVmAction } from "./components/create-vm-dialog/createVmDialog.jsx";
import LibvirtSlate from "./components/libvirtSlate.jsx";
import { isObjectEmpty, dummyVmsFilter, vmId } from "./helpers.js";
import { InlineNotification } from 'cockpit-components-inline-notification.jsx';
import {
    usageStartPolling,
    usageStopPolling,
} from "./actions/provider-actions.js";

superuser.reload_page_on_change();

class App extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            notifications: {},
            /* Dictionary with keys being a resource's UUID and values the number of active error notifications for that resource */
            resourceHasError: {},
            notificationIdCnt: 0,
            path: cockpit.location.path,
        };
        this.onAddErrorNotification = this.onAddErrorNotification.bind(this);
        this.onDismissErrorNotification = this.onDismissErrorNotification.bind(this);
        this.onNavigate = () => this.setState({ path: cockpit.location.path });
        this.onSuperuserChanged = this.onSuperuserChanged.bind(this);
    }

    componentDidMount() {
        cockpit.addEventListener("locationchanged", this.onNavigate);
        superuser.addEventListener("changed", this.onSuperuserChanged);
    }

    componentWillUnmount() {
        cockpit.removeEventListener("locationchanged", this.onNavigate);
        superuser.removeEventListener("changed", this.onSuperuserChanged);
    }

    onSuperuserChanged() {
        this.setState({ allowed: !!superuser.allowed });
    }

    /*
     * Adds a new notification object to the notifications Object. It also updates
     * the error count for a specific resource.
     * @param {object} notification - The notification object to be added to the array.
     */
    onAddErrorNotification(notification) {
        const resourceHasError = Object.assign({}, this.state.resourceHasError);

        if (resourceHasError[notification.resourceId])
            resourceHasError[notification.resourceId]++;
        else
            resourceHasError[notification.resourceId] = 1;

        notification.index = this.state.notificationIdCnt;

        this.setState({
            notifications: {
                ...this.state.notifications,
                [this.state.notificationIdCnt]: notification
            },
            notificationIdCnt: this.state.notificationIdCnt + 1,
            resourceHasError,
        });
    }

    /*
     * Removes the notification with index notificationIndex from the notifications Object.
     * It also updates the error count for a specific resource.
     * @param {int} notificationIndex - Index of the notification to be removed.
     */
    onDismissErrorNotification(notificationIndex) {
        const notifications = Object.assign({}, this.state.notifications);
        const resourceHasError = Object.assign({}, this.state.resourceHasError);

        resourceHasError[notifications[notificationIndex].resourceId]--;
        delete notifications[notificationIndex];

        this.setState({ notifications, resourceHasError });
    }

    render() {
        const { vms, config, storagePools, systemInfo, ui, networks, nodeDevices, interfaces } = this.props.store.getState();
        const path = this.state.path;
        const dispatch = this.props.store.dispatch;
        const combinedVms = [...vms, ...dummyVmsFilter(vms, ui.vms)];
        const properties = {
            dispatch,
            networks, nodeDevices, nodeMaxMemory: config.nodeMaxMemory,
            onAddErrorNotification: this.onAddErrorNotification,
            storagePools, systemInfo, vms: combinedVms,
        };
        const createVmAction = <CreateVmAction {...properties} mode='create' />;
        const importDiskAction = <CreateVmAction {...properties} mode='import' />;
        const vmActions = <> {createVmAction} {importDiskAction} </>;
        const resources = [...storagePools, ...networks, ...nodeDevices, ...interfaces, ...vms];
        const loadingResources = resources.some(resource => isObjectEmpty(resource));

        // Show libvirtSlate component if libvirtd is not running only to users that are allowed to start the service.
        if ((systemInfo.libvirtService.activeState !== 'running' && (this.state.allowed === undefined || this.state.allowed)) ||
            loadingResources) {
            return (<LibvirtSlate libvirtService={systemInfo.libvirtService}
                        loadingResources={loadingResources}
                        dispatch={dispatch} />);
        }

        const pathVms = path.length == 0 || (path.length > 0 && path[0] == 'vms');

        let vmContent;
        if (path.length > 0 && path[0] == 'vm') {
            const vm = vms.find(vm => vm.name == cockpit.location.options.name && vm.connectionName == cockpit.location.options.connection);
            if (!vm)
                return null;

            const connectionName = vm.connectionName;
            // If vm.isUi is set we show a dummy placeholder until libvirt gets a real domain object for newly created V
            const expandedContent = vm.isUi ? undefined : (
                <VmExpandedContent vm={vm} vms={vms} config={config}
                    libvirtVersion={systemInfo.libvirtVersion}
                    notifications={this.state.resourceHasError[vm.id]
                        ? Object.keys(this.state.notifications)
                                .map(notificationId => this.state.notifications[notificationId])
                                .filter(notification => notification.resourceId == vm.id)
                                .map(notification => {
                                    return (
                                        <Alert variant='danger' key={notification.index}
                                               isInline
                                               onDismiss={() => this.onDismissErrorNotification(notification.index)}
                                               title={notification.text}>{notification.detail}</Alert>
                                    );
                                })
                        : undefined}
                    onAddErrorNotification={this.onAddErrorNotification}
                    storagePools={(storagePools || []).filter(pool => pool && pool.connectionName == connectionName)}
                    onUsageStartPolling={() => dispatch(usageStartPolling(vm))}
                    onUsageStopPolling={() => dispatch(usageStopPolling(vm))}
                    dispatch={dispatch}
                    interfaces={interfaces || []}
                    networks={(networks || []).filter(network => network && network.connectionName == connectionName)}
                    nodeDevices={(nodeDevices || []).filter(device => device && device.connectionName == connectionName)}
                    key={vmId(vm.name)}
                />
            );
            return expandedContent;
        }

        return (
            <>
                {Object.keys(this.state.notifications).length > 0 &&
                <section className="toast-notification-wrapper">
                    <ToastNotificationList>
                        {Object.keys(this.state.notifications).map(notificationId => {
                            const notification = this.state.notifications[notificationId];

                            return (
                                <InlineNotification type='danger' key={notification.index}
                                    isInline={false}
                                    onDismiss={() => this.onDismissErrorNotification(notification.index)}
                                    text={notification.text}
                                    detail={notification.detail} />
                            );
                        })}
                    </ToastNotificationList>
                </section>}
                {pathVms && <HostVmsList vms={vms}
                    config={config}
                    ui={ui}
                    libvirtVersion={systemInfo.libvirtVersion}
                    storagePools={storagePools}
                    dispatch={dispatch}
                    interfaces={interfaces}
                    networks={networks}
                    actions={vmActions}
                    resourceHasError={this.state.resourceHasError}
                    onAddErrorNotification={this.onAddErrorNotification}
                    nodeDevices={nodeDevices} />
                }
                {path.length > 0 && path[0] == 'vms' && vmContent}
                {path.length > 0 && path[0] == 'storages' &&
                <StoragePoolList storagePools={storagePools}
                    dispatch={dispatch}
                    vms={vms}
                    loggedUser={systemInfo.loggedUser}
                    libvirtVersion={systemInfo.libvirtVersion}
                    resourceHasError={this.state.resourceHasError}
                    onAddErrorNotification={this.onAddErrorNotification} />
                }
                {path.length > 0 && path[0] == 'networks' &&
                <NetworkList networks={networks}
                    dispatch={dispatch}
                    resourceHasError={this.state.resourceHasError}
                    onAddErrorNotification={this.onAddErrorNotification}
                    vms={vms}
                    nodeDevices={nodeDevices}
                    interfaces={interfaces} />
                }
            </>
        );
    }
}
App.propTypes = {
    store: PropTypes.object.isRequired,
};

export default App;
