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

import { combineReducers } from 'redux'

import * as actionTypes from './action-types.jsx'

const createReducer = (initialState, actionHandlerMap) => (state = initialState, action) => {
    if (actionHandlerMap[action.type]) {
        return actionHandlerMap[action.type](state, action);
    }
    return state;
};

/**
 * state = [
 *  { ... } : Vm
 * ]
 */
const vmsReducer = createReducer([], {
    [actionTypes.SET_VMS]: (state = [], { payload }) => payload ? payload : []
});

const pvsReducer = createReducer([], {
    [actionTypes.SET_PVS]: (state = [], { payload }) => payload ? payload : []
});

const podsReducer = createReducer([], {
    [actionTypes.SET_PODS]: (state = [], { payload }) => payload ? payload : []
})

/**
 * state = [
 *   {...}
 * ]
 */
const settingsReducer = createReducer([], {
    [actionTypes.SET_SETTINGS]: (state = [], { payload }) => payload ? payload : {}
});

/**
 * state = {
 *  vmUID: {
 *      message,
 *      detail
 *    }
 * }
 */
const vmsMessagesReducer = createReducer({}, {
    [actionTypes.VM_ACTION_FAILED]: (state = {}, { payload: { vm, message, detail } }) => {
      const newState = Object.assign({}, state);
      newState[vm.metadata.uid] = { // So far the last message is kept only
        message, // textual information
        detail, // i.e. exception
      };
      return newState;
    },

    [actionTypes.REMOVE_VM_MESSAGE]: (state = {}, { payload: { vm } }) => {
      if (!state[vm.metadata.uid]) {
        return state;
      }

      const newState = Object.assign({}, state);
      delete newState[vm.metadata.uid];
      return newState;
    },
});

/**
 * state = {
 *  vmUID: {
 *      isExpanded: boolean
 *    }
 * }
 */
const uiReducer = createReducer({}, {
    [actionTypes.VM_EXPANDED]: (state = {}, { payload: { vm, isExpanded }}) => {
        return Object.assign({}, state, { [vm.metadata.uid]: { isExpanded } });
    }
});

const rootReducer = combineReducers({
    vms: vmsReducer, // VirtualMachines from API
    pvs: pvsReducer, // PersistenVolumes from API
    pods: podsReducer, // Pods from API
    settings: settingsReducer, // settings gathered at run-time
    vmsMessages: vmsMessagesReducer, // messages related to a VM
    ui: uiReducer, // various UI-state descriptions (i.e. to restore UI after back-button)
});

export default rootReducer;
