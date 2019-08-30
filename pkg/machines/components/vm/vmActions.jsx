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
import React from 'react';
import PropTypes from 'prop-types';

import {
    vmId,
    mouseClick,
} from "../../helpers.js";

import { DeleteDialog } from "../deleteDialog.jsx";
import DropdownButtons from '../dropdownButtons.jsx';

const _ = cockpit.gettext;

const VmActions = ({ vm, config, dispatch, onStart, onInstall, onReboot, onForceReboot, onShutdown, onPause, onResume, onForceoff, onSendNMI }) => {
    const id = vmId(vm.name);
    const state = vm.state;
    const hasInstallPhase = vm.metadata.hasInstallPhase;

    let reset = null;
    if (config.provider.canReset(state)) {
        reset = DropdownButtons({
            buttons: [{
                title: _("Restart"),
                action: onReboot,
                id: `${id}-reboot`,
            }, {
                title: _("Force Restart"),
                action: onForceReboot,
                id: `${id}-forceReboot`,
            }],
        });
    }

    let shutdown = null;
    if (config.provider.canShutdown(state)) {
        const buttons = [{
            title: _("Shut Down"),
            action: onShutdown,
            id: `${id}-off`,
        }, {
            title: _("Force Shut Down"),
            action: onForceoff,
            id: `${id}-forceOff`,
        }];
        if (config.provider.canSendNMI && config.provider.canSendNMI(state)) {
            buttons.push({
                title: _("Send Non-Maskable Interrupt"),
                action: onSendNMI,
                id: `${id}-sendNMI`,
            });
        }
        shutdown = DropdownButtons({ buttons: buttons });
    }

    let pause = null;
    if (config.provider.name === "LibvirtDBus" && config.provider.canPause(state)) {
        pause = (<button key='action-pause' className="btn btn-default" onClick={mouseClick(onPause)} id={`${id}-pause`}>
            {_("Pause")}
        </button>);
    }

    let resume = null;
    if (config.provider.name === "LibvirtDBus" && config.provider.canResume(state)) {
        resume = (<button key='action-resume' className="btn btn-default" onClick={mouseClick(onResume)} id={`${id}-resume`}>
            {_("Resume")}
        </button>);
    }

    let run = null;
    if (config.provider.canRun(state, hasInstallPhase)) {
        run = (<button key='action-run' className="btn btn-default" onClick={mouseClick(onStart)} id={`${id}-run`}>
            {_("Run")}
        </button>);
    }

    let install = null;
    if (config.provider.canInstall(state, hasInstallPhase)) {
        install = (<button key='action-install' className="btn btn-default" onClick={mouseClick(onInstall)} id={`${id}-install`}>
            {_("Install")}
        </button>);
    }

    let providerActions = null;
    if (config.provider.VmActions) {
        const ProviderActions = config.provider.VmActions;
        providerActions = <ProviderActions vm={vm} providerState={config.providerState} dispatch={dispatch} key='provider-actions' />;
    }

    let deleteAction = null;
    if (state !== undefined && config.provider.canDelete && config.provider.canDelete(state, vm.id, config.providerState)) {
        deleteAction = (
            <DeleteDialog key='action-delete' vm={vm} dispatch={dispatch} />
        );
    }

    return [
        reset,
        pause,
        resume,
        shutdown,
        run,
        install,
        providerActions,
        deleteAction,
    ];
};

VmActions.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.string.isRequired,
    dispatch: PropTypes.func.isRequired,
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
