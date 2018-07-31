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

import { createStore } from 'redux';
import reducers from './reducers.jsx';
import { logDebug } from './utils.jsx';

let reduxStore;

export function initStore () {
    if (reduxStore) {
        logDebug('initStore(): store already initialized, skipping.', reduxStore);
        return reduxStore;
    }
    logDebug('initStore(): initializing empty store');
    const initialState = {
        vms: []
    };

    const storeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION__ && window.__REDUX_DEVTOOLS_EXTENSION__();
    reduxStore = createStore(reducers, initialState, storeEnhancers);

    return reduxStore;
}

export function getStore () {
    if (!reduxStore) {
        logDebug('getStore(): store is not initialized yet.');
    }
    return reduxStore;
}
