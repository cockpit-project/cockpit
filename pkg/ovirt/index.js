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
import '../lib/polyfills.js'; // once per application

import React from 'react';
import ReactDOM from 'react-dom';

import store from './store.js';
import { initDataRetrieval } from '../machines/actions/provider-actions.js';
import { logDebug } from '../machines/helpers.js';

import Provider from './provider.js';
import App from './components/App.jsx';
import { setVirtProvider } from '../machines/provider.js';

(function() {
    function render() {
        ReactDOM.render(
            React.createElement(App, { store: store }),
            document.getElementById('app')
        );
    }

    document.addEventListener("DOMContentLoaded", function() {
        console.log("loading ovirt package");
        logDebug('index.js: initial state: ' + JSON.stringify(store.getState()));

        setVirtProvider(Provider);

        // re-render app every time the state changes
        store.subscribe(render);

        // do initial render
        render();

        // initiate data retrieval
        store.dispatch(initDataRetrieval());
    });
}());
