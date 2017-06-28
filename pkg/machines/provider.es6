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

import cockpit from 'cockpit';
import $ from 'jquery';
import React from 'react';

import { logDebug } from './helpers.es6';
import Libvirt from './libvirt.es6';
import { setProvider, delayPolling, getAllVms, deleteUnlistedVMs, updateOrAddVm } from './actions.es6';

import Store from './store.es6';
import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import { StateIcon, DropdownButtons } from './hostvmslist.jsx';

/**
 * External provider can be optionally installed on: .../cockpit/machines/provider/index.js
 * The default is Libvirt.
 *
 * The external provider needs to meet API stated in libvirt.es6 or the README.md.
 *
 * @param useProvider - function taking 'provider' as 1st argument and performs provider's registration and init
 * @param defaultProvider - used by default if no external provider is installed
 */
function loadExternalProvider({ useProvider, defaultProvider }) {
    const scriptElement = $('<script/>').prop({src: 'provider/index.js', async: true});
    scriptElement.on('load', () => {
        logDebug(`External provider loaded: ${JSON.stringify(window.EXTERNAL_PROVIDER.name)}`);
        useProvider(window.EXTERNAL_PROVIDER);
    });
    scriptElement.on('error', (err) => {
        logDebug(`No external provider found, using ${defaultProvider.name}.`);
        useProvider(defaultProvider);
    });
    document.head.appendChild(scriptElement[0]);
}

function getVirtProvider (store) {
    const state = store.getState();
    if (state.config.provider) {
        return cockpit.resolve(state.config.provider);
    } else {
        const deferred = cockpit.defer();
        logDebug('Discovering provider');

        const useProvider = provider => {
            if (!provider) { //  no provider available
                deferred.reject();
            } else {
                if (!provider.init) {
                    // Skip the initialization if provider does not define the `init` hook.
                    logDebug('No init() method in the provider');
                    store.dispatch(setProvider(provider));
                    deferred.resolve(provider);
                } else {
                    // The external provider plugin lives in the same context as the parent code, so it should be shared.
                    // The provider is meant to support lazy initialization, especially of the React which is
                    // provided by the parent application.
                    const initResult = provider.init( getProviderContext() );

                    if (initResult && initResult.then) { // if Promise or $.jqXHR, the then() is defined
                        initResult
                            .done(() => { // Success, the external provider is in charge
                                logDebug(`Provider's Init() is returning resolved Promise`);
                                store.dispatch(setProvider(provider));
                                deferred.resolve(provider);
                                })
                            .fail(() => { // Use Libvirt as fallback
                                logDebug(`Provider's Init() is returning rejected Promise`);
                                useProvider(Libvirt);
                                } );
                    } else { // Promise is not returned, so at least 'true' is expected
                        if (initResult) {
                            logDebug(`No Promise returned, but successful init: ${JSON.stringify(initResult)}`);
                            store.dispatch(setProvider(provider));
                            deferred.resolve(provider);
                        } else {
                            useProvider(Libvirt);
                        }
                    }
                }
            }
        };

        loadExternalProvider({ useProvider, defaultProvider: Libvirt });

        return deferred.promise;
    }
}

/**
 * Helper for dispatching virt provider methods.
 *
 * Lazily initializes the virt provider and dispatches given method on it.
 */
export function virt(method, action) {
    return (dispatch, getState) => getVirtProvider({dispatch, getState}).fail(err => {
        console.error('could not detect any virt provider');
    }).then(provider => {
        if (method in provider) {
            logDebug(`Calling ${provider.name}.${method}`, action);
            return dispatch(provider[method](action));
        } else {
            var msg = `method: '${method}' is not supported by provider: '${provider.name}'`;
            console.warn(msg);
            return cockpit.reject(msg);
        }
    });
}

/**
 * Returns cockpit:machines provider's context, so
 * - potential provider's React components can share same React context with parent application
 * - a provider can "subscribe" as a listener to _single_ redux store events
 * - share common components to keep same look & feel
 */
function getProviderContext() {
    return {
        defaultProvider: Libvirt,
        React: React,
        reduxStore: Store,
        exportedActionCreators: exportedActionCreators(),
        exportedReactComponents: exportedReactComponents(),
    };
}

/**
 * Selected action creators to be exported to the provider to share the code.
 */
function exportedActionCreators () {
    return {
        virtMiddleware: virt,
        delayRefresh: () => delayPolling(getAllVms()),
        deleteUnlistedVMs: deleteUnlistedVMs,
        updateOrAddVm: updateOrAddVm,
    };
}

/**
 * Selected React components to be exported to the provider to share common look&feel.
 */
function exportedReactComponents () {
    return {
        Listing, // by Cockpit
        ListingRow,

        StateIcon, // by cockpit:machines
        DropdownButtons,
    };
}
