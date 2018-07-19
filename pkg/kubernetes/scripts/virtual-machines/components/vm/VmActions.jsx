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

// @flow

import React, { PropTypes } from 'react';
import { gettext as _ } from 'cockpit';
import { connect } from 'react-redux';

import DropdownButtons from '../../../../../machines/components/dropdownButtons.jsx';

import type { Vm, Vmi } from '../../types.es6';
import { kindIdPrefx, prefixedId } from '../../utils.es6';
import { createFailHandler } from '../util/utils.jsx';
import { remove, vmPatch } from '../../kube-middleware.es6';
import { vmActionFailed, vmiActionFailed } from '../../action-creators.es6';

const Stop = ({vm, onVmFailure, idPrefix, disabled}) => {
    const onStop = () => vmPatch({
        vm,
        running: false,
    }).catch(createFailHandler(onVmFailure, _("stop"), _("VM")));

    return {
        title: _("Stop"),
        action: onStop,
        id: prefixedId(idPrefix, 'stop'),
        disabled,
    };
};

const Start = ({vm, onVmFailure, idPrefix, disabled}) => {
    const onStart = () => vmPatch({
        vm,
        running: true,
    }).catch(createFailHandler(onVmFailure, _("start"), _("VM")));

    return {
        title: _("Start"),
        action: onStart,
        id: prefixedId(idPrefix, 'start'),
        disabled,
    };
};

const Delete = ({vm, onVmFailure, onDeleteSuccess, idPrefix, disabled}) => {
    const onDelete = () => remove(vm).then(onDeleteSuccess)
            .catch((createFailHandler(onVmFailure, _("delete"), _("VM"))));

    return {
        title: _("Delete"),
        action: onDelete,
        id: prefixedId(idPrefix, 'delete'),
        disabled,
    };
};

const Restart = ({vmi, onVmFailure, onVmiFailure, idPrefix, disabled}) => {
    const vmRestartFailHandler = createFailHandler(onVmFailure, _("restart"), _("VM"));
    const vmiDeleteFaillHandler = createFailHandler(onVmiFailure, _("delete"), _("VMI"));

    const onRestart = () => remove(vmi).catch((error) => {
        vmRestartFailHandler(error);
        vmiDeleteFaillHandler(error);
    });

    return {
        title: _("Restart"),
        action: onRestart,
        id: prefixedId(idPrefix, 'restart'),
        disabled,
    };
};

const VmActions = ({vm, vmi, onDeleteSuccess, onVmFailure, onVmiFailure}: { vm: Vm, vmi: Vmi, onDeleteSuccess: Function, onVmFailure: Function, onVmiFailure: Function }) => {
    const idPrefix = kindIdPrefx(vm);
    let dropdownButtons = [];
    const isRunning = vm.spec.running === undefined ? vm.spec.Running : vm.spec.running;

    if (isRunning) {
        dropdownButtons.push(Stop({
            vm,
            onVmFailure,
            idPrefix,
        }));

        dropdownButtons.push(Start({
            vm,
            onVmFailure,
            idPrefix,
            disabled: true,
        }));
    } else {
        dropdownButtons.push(Start({
            vm,
            onVmFailure,
            idPrefix,
        }));

        dropdownButtons.push(Stop({
            vm,
            onVmFailure,
            idPrefix,
            disabled: true,
        }));
    }

    dropdownButtons.push(Restart({
        vmi,
        onVmFailure,
        onVmiFailure,
        idPrefix,
        disabled: !vmi || !isRunning,
    }));

    dropdownButtons.push(Delete({
        vm,
        onVmFailure,
        onDeleteSuccess,
        idPrefix
    }));

    return (
        <DropdownButtons buttons={dropdownButtons} />
    );
};

VmActions.propTypes = {
    vm: PropTypes.object.isRequired,
    onDeleteSuccess: PropTypes.func.isRequired,
    onVmFailure: PropTypes.func.isRequired,
    onVmiFailure: PropTypes.func.isRequired,
};

export default connect(
    () => ({}),
    (dispatch, {vm, vmi}) => ({
        onVmFailure: ({message, detail}) => dispatch(vmActionFailed({
            vm,
            message,
            detail
        })),
        onVmiFailure: ({message, detail}) => dispatch(vmiActionFailed({
            vmi,
            message,
            detail
        })),
    }),
)(VmActions);
