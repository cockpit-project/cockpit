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
        return actionHandlerMap[action.type](state, action)
    }
    return state
}

const vmsReducer = createReducer([], {
    [actionTypes.SET_VMS]: (state = [], { payload }) => payload ? payload : []
})

const settingsReducer = createReducer([], {
    [actionTypes.SET_SETTINGS]: (state = [], { payload }) => payload ? payload : {}
})

const rootReducer = combineReducers({
    vms: vmsReducer,
    settings: settingsReducer
})

export default rootReducer
