/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import { Button, Progress, Tooltip } from '@patternfly/react-core';

import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import {
    convertToUnit,
    rephraseUI,
    storagePoolId,
    units
} from '../../helpers.js';
import { StoragePoolOverviewTab } from './storagePoolOverviewTab.jsx';
import { StoragePoolVolumesTab } from './storagePoolVolumesTab.jsx';
import { StoragePoolDelete } from './storagePoolDelete.jsx';
import { storagePoolActivate, storagePoolDeactivate } from '../../libvirt-dbus.js';

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const getStoragePoolRow = ({ storagePool, vms, resourceHasError, onAddErrorNotification }) => {
    const idPrefix = `${storagePoolId(storagePool.name, storagePool.connectionName)}`;
    const name = (
        <span id={`${idPrefix}-name`}>
            { storagePool.name }
        </span>);
    const allocation = parseFloat(convertToUnit(storagePool.allocation, units.B, units.GiB).toFixed(2));
    const capacity = parseFloat(convertToUnit(storagePool.capacity, units.B, units.GiB).toFixed(2));
    const sizeLabel = String(cockpit.format("$0 / $1 GiB", allocation, capacity));
    const size = (
        <Progress value={Number(storagePool.allocation)}
                  min={0}
                  max={Number(storagePool.capacity)}
                  label={sizeLabel}
                  valueText={sizeLabel} />
    );
    const state = (
        <>
            { resourceHasError[storagePool.id] ? <span className='pficon-warning-triangle-o machines-status-alert' /> : null }
            <span id={`${idPrefix}-state`}>
                { storagePool.active ? _("active") : _("inactive") }
            </span>
        </>);

    const overviewTabName = (
        <div id={`${idPrefix}-overview`}>
            {_("Overview")}
        </div>
    );
    const storageVolsTabName = (
        <div id={`${idPrefix}-storage-volumes`}>
            {_("Storage Volumes")}
        </div>
    );
    const tabRenderers = [
        {
            name: overviewTabName,
            renderer: StoragePoolOverviewTab,
            data: { storagePool }
        },
        {
            name: storageVolsTabName,
            renderer: StoragePoolVolumesTab,
            data: { storagePool, vms }
        },
    ];
    const extraClasses = [];

    if (resourceHasError[storagePool.id])
        extraClasses.push('error');

    const expandedContent = (
        <ListingPanel
            tabRenderers={tabRenderers}
            listingActions={<StoragePoolActions onAddErrorNotification={onAddErrorNotification} storagePool={storagePool} vms={vms} />} />
    );

    return {
        extraClasses: resourceHasError[storagePool.id] ? ['error'] : [],
        columns: [
            { title: name, header: true },
            { title: size },
            { title: rephraseUI('connections', storagePool.connectionName) },
            { title: state },
        ],
        rowId: idPrefix,
        props: { key: idPrefix },
        expandedContent: expandedContent,
    };
};

class StoragePoolActions extends React.Component {
    constructor() {
        super();
        this.state = { operationInProgress: false };
        this.onActivate = this.onActivate.bind(this);
        this.onDeactivate = this.onDeactivate.bind(this);
    }

    onActivate() {
        const storagePool = this.props.storagePool;

        this.setState({ operationInProgress: true });
        storagePoolActivate(storagePool.connectionName, storagePool.id)
                .fail(exc => {
                    this.props.onAddErrorNotification({
                        text: cockpit.format(_("Storage Pool $0 failed to get activated"), storagePool.name),
                        detail: exc.message, resourceId: storagePool.id,
                    });
                })
                .always(() => this.setState({ operationInProgress: false }));
    }

    onDeactivate() {
        const storagePool = this.props.storagePool;

        this.setState({ operationInProgress: true });
        storagePoolDeactivate(storagePool.connectionName, storagePool.id)
                .fail(exc => {
                    this.props.onAddErrorNotification({
                        text: cockpit.format(_("Storage Pool $0 failed to get deactivated"), storagePool.name),
                        detail: exc.message, resourceId: storagePool.id,
                    });
                })
                .always(() => this.setState({ operationInProgress: false }));
    }

    render() {
        const { storagePool, vms } = this.props;
        const id = storagePoolId(storagePool.name, storagePool.connectionName);
        let deactivateButton = (
            <Button id={`deactivate-${id}`}
                variant='secondary'
                isDisabled={this.state.operationInProgress}
                onClick={this.onDeactivate}>
                {_("Deactivate")}
            </Button>
        );
        let activateButton = (
            <Button id={`activate-${id}`}
                variant='secondary'
                isDisabled={this.state.operationInProgress}
                onClick={this.onActivate}>
                {_("Activate")}
            </Button>
        );
        if (this.state.operationInProgress) {
            deactivateButton = (
                <Tooltip id="tip-in-progress" content={_("Operation is in progress")}>
                    <span>
                        {deactivateButton}
                    </span>
                </Tooltip>
            );
            activateButton = (
                <Tooltip id="tip-in-progress" content={_("Operation is in progress")}>
                    <span>
                        {activateButton}
                    </span>
                </Tooltip>
            );
        }

        return (
            <>
                { storagePool.active && deactivateButton }
                { !storagePool.active && activateButton }
                <StoragePoolDelete storagePool={storagePool} vms={vms} />
            </>
        );
    }
}
