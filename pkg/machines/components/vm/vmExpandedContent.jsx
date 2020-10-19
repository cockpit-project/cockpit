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
import PropTypes from 'prop-types';
import React, { useEffect } from 'react';
import cockpit from 'cockpit';

import {
    Breadcrumb, BreadcrumbItem,
    Gallery, Button,
    Card, CardTitle, CardActions, CardHeader, CardBody, CardFooter,
    Page, PageSection, PageSectionVariants,
} from '@patternfly/react-core';
import { ExpandIcon } from '@patternfly/react-icons';

import { vmId } from "../../helpers.js";

import { VmDisksTabLibvirt, VmDisksActions } from '../vmDisksTab.jsx';
import { VmNetworkTab, VmNetworkActions } from '../vmnetworktab.jsx';
import Consoles from '../consoles.jsx';
import VmOverviewTab from '../vmOverviewTabLibvirt.jsx';
import VmUsageTab from './vmUsageTab.jsx';
import { VmSnapshotsTab, VmSnapshotsActions } from '../vmSnapshotsTab.jsx';
import VmActions from './vmActions.jsx';

import './vmExpandedContent.scss';

const _ = cockpit.gettext;

export const VmExpandedContent = ({
    vm, vms, config, libvirtVersion, hostDevices, storagePools,
    onUsageStartPolling, onUsageStopPolling, dispatch, networks,
    interfaces, nodeDevices, notifications, onAddErrorNotification
}) => {
    useEffect(() => {
        // Anything in here is fired on component mount.
        onUsageStartPolling();
        return () => {
            // Anything in here is fired on component unmount.
            onUsageStopPolling();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (cockpit.location.path[1] == "console") {
        return (<Page breadcrumb={
            <Breadcrumb className='machines-listing-breadcrumb'>
                <BreadcrumbItem to='#'>
                    {_("Virtual machines")}
                </BreadcrumbItem>
                <BreadcrumbItem onClick={() => cockpit.location.go(["vm"], Object.assign(cockpit.location.options, { name: vm.name, connection: vm.connectionName }))}>
                    <a className="pf-c-breadcrumb__link">{vm.name}</a>
                </BreadcrumbItem>
                <BreadcrumbItem isActive>
                    {_("Console")}
                </BreadcrumbItem>
            </Breadcrumb>}>
            <PageSection variant={PageSectionVariants.light}>
                <Consoles vm={vm} config={config} dispatch={dispatch}
                          onAddErrorNotification={onAddErrorNotification} />
            </PageSection>
        </Page>);
    }

    const cardContents = [
        {
            id: `${vmId(vm.name)}-overview`,
            title: _("Overview"),
            body: <VmOverviewTab vm={vm} config={config} dispatch={dispatch}
                                 nodeDevices={nodeDevices} libvirtVersion={libvirtVersion} />,
        },
        {
            id: `${vmId(vm.name)}-usage`,
            className: 'usage-card',
            title: _("Usage"),
            body: <VmUsageTab vm={vm} />,
        },
        {
            id: `${vmId(vm.name)}-consoles`,
            className: "consoles-card",
            title: _("Console"),
            actions: <Button variant="link"
                           isDisabled={vm.state == "shut off"}
                           onClick={() => {
                               const urlOptions = { name: vm.name, connection: vm.connectionName };
                               return cockpit.location.go(["vm", "console"], { ...cockpit.location.options, ...urlOptions });
                           }}
                           icon={<ExpandIcon />}
                           iconPosition="right">{_("Expand")}</Button>,
            body: <Consoles vm={vm} config={config} dispatch={dispatch}
                            onAddErrorNotification={onAddErrorNotification} />,
        },
        {
            id: `${vmId(vm.name)}-disks`,
            className: "disks-card",
            title: _("Disks"),
            actions: <VmDisksActions vm={vm} vms={vms} storagePools={storagePools}
                                     dispatch={dispatch} />,
            body: <VmDisksTabLibvirt vm={vm} config={config} storagePools={storagePools}
                                     dispatch={dispatch} onAddErrorNotification={onAddErrorNotification} />,
        },
        {
            id: `${vmId(vm.name)}-networks`,
            className: "networks-card",
            title: _("Networks"),
            actions: <VmNetworkActions vm={vm} dispatch={dispatch}
                                       interfaces={interfaces} networks={networks}
                                       nodeDevices={nodeDevices} />,
            body: <VmNetworkTab vm={vm} dispatch={dispatch} config={config}
                                interfaces={interfaces} networks={networks}
                                nodeDevices={nodeDevices} onAddErrorNotification={onAddErrorNotification} />,
        },
    ];
    if (vm.snapshots !== -1 && vm.snapshots !== undefined) {
        cardContents.push({
            id: cockpit.format("$0-snapshots", vmId(vm.name)),
            className: "snapshots-card",
            title: _("Snapshots"),
            actions: <VmSnapshotsActions vm={vm} dispatch={dispatch} />,
            body: <VmSnapshotsTab vm={vm} dispatch={dispatch} config={config}
                                  onAddErrorNotification={onAddErrorNotification} />
        });
    }

    const cards = cardContents.map(card => {
        return (
            <Card key={card.id}
                  className={card.className}
                  id={card.id}>
                <CardHeader>
                    <CardTitle><h2>{card.title}</h2></CardTitle>
                    {card.actions && <CardActions>{card.actions}</CardActions>}
                </CardHeader>
                <CardBody className={["disks-card", "networks-card", "snapshots-card"].includes(card.className) ? "contains-list" : ""}>
                    {card.body}
                </CardBody>
                <CardFooter />
            </Card>
        );
    });

    return (
        <Page breadcrumb={
            <Breadcrumb className='machines-listing-breadcrumb'>
                <BreadcrumbItem to='#'>
                    {_("Virtual machines")}
                </BreadcrumbItem>
                <BreadcrumbItem isActive>
                    {vm.name}
                </BreadcrumbItem>
            </Breadcrumb>}>
            <PageSection variant={PageSectionVariants.light}>
                <div className="vm-top-panel">
                    <h2 className="vm-name">{vm.name}</h2>
                    <VmActions vm={vm}
                               config={config}
                               dispatch={dispatch}
                               storagePools={storagePools}
                               onAddErrorNotification={onAddErrorNotification}
                               isDetailsPage />
                </div>
                {notifications && <div className="vm-notifications">{notifications}</div>}
            </PageSection>
            <PageSection>
                <Gallery className='ct-vm-overview' hasGutter>
                    {cards}
                </Gallery>
            </PageSection>
        </Page>
    );
};

VmExpandedContent.propTypes = {
    vm: PropTypes.object.isRequired,
    vms: PropTypes.array.isRequired,
    config: PropTypes.object.isRequired,
    libvirtVersion: PropTypes.number.isRequired,
    storagePools: PropTypes.array.isRequired,
    dispatch: PropTypes.func.isRequired,
    networks: PropTypes.array.isRequired,
    interfaces: PropTypes.array.isRequired,
    notifications: PropTypes.array,
    onAddErrorNotification: PropTypes.func.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};
