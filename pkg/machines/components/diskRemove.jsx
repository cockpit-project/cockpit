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
import cockpit from 'cockpit';
import { Tooltip, OverlayTrigger } from 'patternfly-react';

import { detachDisk, getVm } from '../actions/provider-actions.js';

const _ = cockpit.gettext;

const onDetachDisk = (dispatch, vm, target, onAddErrorNotification) => {
    return () => {
        dispatch(detachDisk({ connectionName:vm.connectionName, id:vm.id, name:vm.name, target, live: vm.state == 'running' }))
                .catch(ex => {
                    onAddErrorNotification({
                        text: cockpit.format(_("Disk $0 fail to get detached from VM $1"), target, vm.name),
                        detail: ex.message, resourceId: vm.id,
                    });
                })
                .then(() => dispatch(getVm({ connectionName: vm.connectionName, id:vm.id })));
    };
};

const RemoveDiskAction = ({ dispatch, vm, target, idPrefixRow, onAddErrorNotification }) => {
    const getRemoveButton = (disabled) => {
        return (
            <button id={`${idPrefixRow}-detach`}
                    disabled={disabled}
                    className="btn btn-default btn-control-ct fa fa-minus"
                    onClick={onDetachDisk(dispatch, vm, target, onAddErrorNotification)} />
        );
    };

    if (vm.state == 'shut off' || vm.state == 'running')
        return getRemoveButton(false);

    return (
        <OverlayTrigger
            overlay={
                <Tooltip id="tip-inforec">
                    {cockpit.format(_("Disks cannot be removed from $0 VMs"), vm.state)}
                </Tooltip>
            }
            placement="top">
            {getRemoveButton(true)}
        </OverlayTrigger>
    );
};

export default RemoveDiskAction;
