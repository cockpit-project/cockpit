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
import '../lib/patternfly/patternfly-cockpit.scss';
import 'polyfills'; // once per application

import React from 'react';
import ReactDOM from 'react-dom';

import store from './store.js';
import App from './app.jsx';
import { initDataRetrieval } from './actions/provider-actions.js';
import { logDebug } from './helpers.js';

function render() {
    ReactDOM.render(
        <App store={store} />,
        document.getElementById('app')
    );
}

function renderApp() {
    // initiate data retrieval
    store.dispatch(initDataRetrieval());

    // re-render app every time the state changes
    store.subscribe(render);

    // do initial render
    render();
}

/**
 * Start the application.
 */
function appMain() {
    logDebug('index.js: initial state: ' + JSON.stringify(store.getState()));
    renderApp();
}

(function() {
    document.addEventListener("DOMContentLoaded", function() {
        appMain();
    });
}());
