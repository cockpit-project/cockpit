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
import { ToastNotificationList, ToastNotification } from 'patternfly-react';
import cockpit from 'cockpit';

import HostVmsList from "./hostvmslist.jsx";
import { StoragePoolList } from "./components/storagePools/storagePoolList.jsx";
import { NetworkList } from "./components/networks/networkList.jsx";
import LibvirtSlate from "./components/libvirtSlate.jsx";
import { CreateVmAction } from "./components/create-vm-dialog/createVmDialog.jsx";
import { AggregateStatusCards } from "./components/aggregateStatusCards.jsx";
import { InlineNotification } from './components/notification/inlineNotification.jsx';

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
    }

    componentDidMount() {
        cockpit.addEventListener("locationchanged", this.onNavigate);
    }

    componentWillUnmount() {
        cockpit.removeEventListener("locationchanged", this.onNavigate);
    }

    /*
     * Adds a new notification object to the notifications Object. It also updates
     * the error count for a specific resource.
     * @param {object} notification - The notification object to be added to the array.
     */
    onAddErrorNotification(notification) {
        let resourceHasError = Object.assign({}, this.state.resourceHasError);

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
        let notifications = Object.assign({}, this.state.notifications);
        let resourceHasError = Object.assign({}, this.state.resourceHasError);

        resourceHasError[notifications[notificationIndex].resourceId]--;
        delete notifications[notificationIndex];

        this.setState({ notifications, resourceHasError });
    }

    render() {
        const { vms, config, storagePools, systemInfo, ui, networks, nodeDevices } = this.props.store.getState();
        const path = this.state.path;
        const dispatch = this.props.store.dispatch;
        const createVmAction = (
            <CreateVmAction dispatch={dispatch}
                providerName={config.provider ? config.provider.name : 'Libvirt'}
                networks={networks}
                nodeDevices={nodeDevices}
                onAddErrorNotification={this.onAddErrorNotification}
                systemInfo={systemInfo} />
        );

        if (systemInfo.libvirtService.activeState !== 'running') {
            return (<LibvirtSlate libvirtService={systemInfo.libvirtService} dispatch={dispatch} />);
        }

        const pathVms = path.length == 0 || (path.length > 0 && path[0] == 'vms');

        return (
            <div>
                { config.provider.name === 'LibvirtDBus' && pathVms &&
                <AggregateStatusCards networks={networks} storagePools={storagePools} />
                }
                {Object.keys(this.state.notifications).length > 0 &&
                <section className="toast-notification-wrapper">
                    <ToastNotificationList>
                        {Object.keys(this.state.notifications).map(notificationId => {
                            const notification = this.state.notifications[notificationId];

                            return (
                                <ToastNotification type='error' key={notification.index}
                                    onDismiss={() => this.onDismissErrorNotification(notification.index)}>
                                    <InlineNotification
                                        text={notification.text}
                                        detail={notification.detail} />
                                </ToastNotification>
                            );
                        })}
                    </ToastNotificationList>
                </section>}
                {pathVms && <HostVmsList vms={vms}
                    config={config}
                    ui={ui}
                    storagePools={storagePools}
                    dispatch={dispatch}
                    networks={networks}
                    actions={createVmAction}
                    resourceHasError={this.state.resourceHasError}
                    onAddErrorNotification={this.onAddErrorNotification}
                    nodeDevices={nodeDevices} />
                }
                {config.provider.name === 'LibvirtDBus' && path.length > 0 && path[0] == 'storages' &&
                <StoragePoolList storagePools={storagePools}
                    dispatch={dispatch}
                    vms={vms}
                    loggedUser={systemInfo.loggedUser}
                    resourceHasError={this.state.resourceHasError}
                    onAddErrorNotification={this.onAddErrorNotification} />
                }
                {config.provider.name === 'LibvirtDBus' && path.length > 0 && path[0] == 'networks' &&
                <NetworkList networks={networks}
                    dispatch={dispatch}
                    resourceHasError={this.state.resourceHasError}
                    onAddErrorNotification={this.onAddErrorNotification} />
                }
            </div>
        );
    }
}
App.propTypes = {
    store: PropTypes.object.isRequired,
};

export default App;
