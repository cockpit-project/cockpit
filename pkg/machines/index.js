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
import App from './app.jsx';
import { initDataRetrieval } from './actions/provider-actions.js';
import { logDebug } from './helpers.js';

import cockpit from 'cockpit';
import LibvirtDbus from './libvirt-dbus.js';
import Libvirt from './libvirt-virsh.js';
import { setVirtProvider } from './provider.js';

/**
 * Returns promise that will have as return value the Provider that should be set.
 * @return {Promise}
 */

function detectLibvirtProvider() {
    let client = cockpit.dbus("org.freedesktop.DBus");

    return client.call("/org/freedesktop/DBus", "org.freedesktop.DBus",
                       "ListActivatableNames")
            .then(services => {
                let libvirtDBusavailable = services[0].includes("org.libvirt");

                client.close();
                return libvirtDBusavailable ? LibvirtDbus : Libvirt;
            })
            .catch(exception => {
                console.warn("Could not get a list of services from DBus.", exception);
                client.close();
                return Libvirt;
            });
}

function render() {
    ReactDOM.render(
        <App store={store} />,
        document.getElementById('app')
    );
}

function renderApp() {
    // re-render app every time the state changes
    store.subscribe(render);

    // do initial render
    render();

    // initiate data retrieval
    store.dispatch(initDataRetrieval());
}

/**
 * Start the application.
 */
function appMain() {
    logDebug('index.js: initial state: ' + JSON.stringify(store.getState()));

    detectLibvirtProvider().then((providerVal) => {
        console.info(`index.js: Setting ${providerVal.name} as virt provider.`);
        setVirtProvider(providerVal);
        renderApp();
    });
}

(function() {
    document.addEventListener("DOMContentLoaded", function() {
        appMain();
    });
}());
