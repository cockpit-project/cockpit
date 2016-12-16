/*jshint esversion: 6 */
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
import React from 'react';
import store from './store.es6';
import App from './app.jsx';
import { getAllVms } from './actions.es6';
import { logDebug } from './helpers.es6';

function render() {
    React.render(
        React.createElement(App, {store: store}),
        document.getElementById('app')
    );
}

/**
 * Start the application.
 */
export function appMain() {
    logDebug('index.es6: initial state: ' + JSON.stringify(store.getState()));

    // re-render app every time the state changes
    store.subscribe(render);

    // do initial render
    render();

    // initiate data retrieval
    store.dispatch(getAllVms());
}
