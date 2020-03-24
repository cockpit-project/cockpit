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
import cockpit from 'cockpit';
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Tooltip } from 'patternfly-react';
import {
    Button,
    Dropdown, DropdownItem, DropdownSeparator, KebabToggle,
} from '@patternfly/react-core';

import {
    vmId,
} from "../../helpers.js";

import { DeleteDialog } from "../deleteDialog.jsx";
import LibvirtDBus from '../../libvirt-dbus.js';

const _ = cockpit.gettext;

const VmActions = ({ vm, dispatch, storagePools, onStart, onInstall, onReboot, onForceReboot, onShutdown, onPause, onResume, onForceoff, onSendNMI }) => {
    const [isActionOpen, setIsActionOpen] = useState(false);
    const [showDeleteDialog, toggleDeleteModal] = useState(false);

    const id = vmId(vm.name);
    const state = vm.state;
    const hasInstallPhase = vm.metadata.hasInstallPhase;
    const dropdownItems = [];

    let shutdown;

    if (LibvirtDBus.canPause(state)) {
        dropdownItems.push(
            <DropdownItem key={`${id}-pause`}
                          id={`${id}-pause`}
                          onClick={() => onPause()}>
                {_("Pause")}
            </DropdownItem>
        );
        dropdownItems.push(<DropdownSeparator key="separator-pause" />);
    }

    if (LibvirtDBus.canResume(state)) {
        dropdownItems.push(
            <DropdownItem key={`${id}-resume`}
                          id={`${id}-resume`}
                          onClick={() => onResume()}>
                {_("Resume")}
            </DropdownItem>
        );
        dropdownItems.push(<DropdownSeparator key="separator-resume" />);
    }

    if (LibvirtDBus.canShutdown(state)) {
        shutdown = (<Button key='action-shutdown' variant='secondary' onClick={() => onShutdown()} id={`${id}-shutdown-button`}>
            {_("Shut Down")}
        </Button>);
        dropdownItems.push(
            <DropdownItem key={`${id}-off`}
                          id={`${id}-off`}
                          onClick={() => onShutdown()}>
                {_("Shut Down")}
            </DropdownItem>
        );
        dropdownItems.push(
            <DropdownItem key={`${id}-forceOff`}
                          id={`${id}-forceOff`}
                          onClick={() => onForceoff()}>
                {_("Force Shut Down")}
            </DropdownItem>
        );
        dropdownItems.push(<DropdownSeparator key="separator-shutdown" />);
        dropdownItems.push(
            <DropdownItem key={`${id}-sendNMI`}
                          id={`${id}-sendNMI`}
                          onClick={() => onSendNMI()}>
                {_("Send Non-Maskable Interrupt")}
            </DropdownItem>
        );
        dropdownItems.push(<DropdownSeparator key="separator-sendnmi" />);
    }

    if (LibvirtDBus.canReset(state)) {
        dropdownItems.push(
            <DropdownItem key={`${id}-reboot`}
                          id={`${id}-reboot`}
                          onClick={() => onReboot()}>
                {_("Restart")}
            </DropdownItem>
        );
        dropdownItems.push(
            <DropdownItem key={`${id}-forceReboot`}
                          id={`${id}-forceReboot`}
                          onClick={() => onForceReboot()}>
                {_("Force Restart")}
            </DropdownItem>
        );
        dropdownItems.push(<DropdownSeparator key="separator-reset" />);
    }

    let run = null;
    if (LibvirtDBus.canRun(state, hasInstallPhase)) {
        run = (<Button key='action-run' variant="secondary" onClick={() => onStart()} id={`${id}-run`}>
            {_("Run")}
        </Button>);
    }

    let install = null;
    if (LibvirtDBus.canInstall(state, hasInstallPhase)) {
        install = (<Button key='action-install' variant="secondary" onClick={() => onInstall()} id={`${id}-install`}>
            {_("Install")}
        </Button>);
    }

    let deleteAction = null;
    if (state !== undefined && LibvirtDBus.canDelete && LibvirtDBus.canDelete(state, vm.id)) {
        if (!vm.persistent) {
            dropdownItems.push(
                <DropdownItem key={`${id}-delete`}
                              id={`${id}-delete`}
                              className='pf-m-danger'
                              tooltip={<Tooltip id={`${id}-delete-tooltip`}>
                                  {_("This VM is transient. Shut it down if you wish to delete it.")}
                              </Tooltip>}
                              isDisabled>
                    {_("Delete")}
                </DropdownItem>
            );
        } else {
            dropdownItems.push(
                <DropdownItem className='pf-m-danger' key={`${id}-delete`} id={`${id}-delete`} onClick={() => toggleDeleteModal(true)}>
                    {_("Delete")}
                </DropdownItem>
            );
        }
        if (showDeleteDialog) {
            deleteAction = (
                <DeleteDialog key='action-delete' vm={vm} dispatch={dispatch} storagePools={storagePools} toggleModal={() => toggleDeleteModal(!showDeleteDialog)} />
            );
        }
    }

    return (
        <div className='btn-group'>
            {run}
            {shutdown}
            {install}
            {deleteAction}
            <Dropdown onSelect={() => setIsActionOpen(!isActionOpen)}
                      id={`${id}-action-kebab`}
                      toggle={<KebabToggle onToggle={isOpen => setIsActionOpen(isOpen)} />}
                      isPlain
                      isOpen={isActionOpen}
                      position='right'
                      dropdownItems={dropdownItems} />
        </div>
    );
};

VmActions.propTypes = {
    vm: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    storagePools: PropTypes.array.isRequired,
    onStart: PropTypes.func.isRequired,
    onReboot: PropTypes.func.isRequired,
    onForceReboot: PropTypes.func.isRequired,
    onShutdown: PropTypes.func.isRequired,
    onPause: PropTypes.func.isRequired,
    onResume: PropTypes.func.isRequired,
    onForceoff: PropTypes.func.isRequired,
    onSendNMI: PropTypes.func.isRequired,
};

export default VmActions;
