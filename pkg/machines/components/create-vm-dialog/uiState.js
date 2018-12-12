/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import {
    addUiVm,
    updateUiVm,
    deleteUiVm,
} from '../../actions/store-actions.js';

import VMS_CONFIG from "../../config.js";

const INSTALL_TIMEOUT = 'INSTALL_TIMEOUT';
const CREATE_TIMEOUT = 'CREATE_TIMEOUT';

const timeouts = {};

export function setVmCreateInProgress(dispatch, name, settings) {
    const vm = Object.assign({}, {
        name,
        isUi: true,
        expanded: true,
        openConsoleTab: true,
        createInProgress: true,
    }, settings);

    dispatch(addUiVm(vm));
    setupCleanupTimeout(dispatch, name, CREATE_TIMEOUT);
}

export function setVmInstallInProgress(dispatch, name, settings) {
    const vm = Object.assign({}, {
        name,
        isUi: true,
        expanded: true,
        openConsoleTab: true,
        installInProgress: true,
    }, settings);

    dispatch(addUiVm(vm));
    setupCleanupTimeout(dispatch, name, INSTALL_TIMEOUT);
}

export function finishVmCreateInProgress(dispatch, name, settings) {
    const vm = Object.assign({}, {
        name,
        createInProgress: false,
    }, settings);
    dispatch(updateUiVm(vm));
}

export function finishVmInstallInProgress(dispatch, name, settings) {
    const vm = Object.assign({}, {
        name,
        installInProgress: false,
    }, settings);
    dispatch(updateUiVm(vm));
}

export function removeVmCreateInProgress(dispatch, name, settings) {
    if (clearTimeout(name, CREATE_TIMEOUT)) {
        finishVmCreateInProgress(dispatch, name, settings);
    }
}

export function clearVmUiState(dispatch, name) {
    // clear timeouts
    clearTimeout(name, CREATE_TIMEOUT);
    clearTimeout(name, INSTALL_TIMEOUT);
    clearSettings(name);

    // clear store state
    dispatch(deleteUiVm({
        name,
    }));
}

function setupCleanupTimeout(dispatch, name, TIMEOUT_ID) {
    const vmTimeouts = getSettings(name);

    vmTimeouts[TIMEOUT_ID] = window.setTimeout(() => {
        clearVmUiState(dispatch, name);
    }, VMS_CONFIG.DummyVmsWaitInterval);// 10 * 1000
}

function clearTimeout(name, TIMEOUT_ID) {
    const vm = timeouts[name];
    let timeout = null;
    if (vm) {
        timeout = vm[TIMEOUT_ID];
        if (timeout) {
            window.clearTimeout(timeout);
            delete vm[TIMEOUT_ID];
        }
    }
    return timeout;
}

function getSettings(name) {
    if (!timeouts[name]) {
        timeouts[name] = {};
    }
    return timeouts[name];
}

function clearSettings(name) {
    delete timeouts[name];
}
