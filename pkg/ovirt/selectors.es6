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

import { getHostAddress } from './helpers.es6';
import { logDebug, logError } from '../machines/helpers.es6';

export function getAllIcons (state) {
    return state.config && state.config.providerState ? state.config.providerState.icons : {};
}

export function getHost(hosts, ovirtConfig) {
    if (!hosts) {
        return null;
    }

    // match by browser URL first
    const hostAddress = getHostAddress();
    let hostId = Object.getOwnPropertyNames(hosts).find(hostId => hosts[hostId].address === hostAddress);

    // match by system's hostname as fallback
    if (!hostId && ovirtConfig && ovirtConfig.hostname) {
        hostId = Object.getOwnPropertyNames(hosts).find(hostId => hosts[hostId].address === ovirtConfig.hostname);
    }

    return hostId && hosts[hostId];
}

export function getCurrentClusterFromState(state) {
    return getCurrentCluster(state.config.providerState.hosts, state.config.providerState.clusters, state.config.providerState.ovirtConfig);
}

export function getCurrentCluster (hosts, clusters, ovirtConfig) {
    const currentHost = getHost(hosts, ovirtConfig);
    if (!currentHost || !clusters || !currentHost.clusterId) {
        return null;
    }

    return clusters[currentHost.clusterId];
}

export function isVmManagedByOvirt (providerState, vmId) {
    return vmId && providerState && !!providerState.vms[vmId];
}

function _waitForCurrentCluster(deferred, getState, counter) {
    if (counter <= 0) {
        logError('waitForCurrentCluster(): timeout reached, list of hosts and/or clusters has not yet finished');
        deferred.reject();
    }

    logDebug('Sleeping in _waitForCurrentCluster(), ', counter);
    window.setTimeout(() => {
        const currentCluster = getCurrentClusterFromState(getState());
        if (currentCluster) {
            deferred.resolve(currentCluster);
        } else {
            _waitForCurrentCluster(deferred, getState, counter - 1);
        }
    }, 250);
}

export function waitForCurrentCluster(getState) {
    let currentCluster = getCurrentClusterFromState(getState());
    if (currentCluster) {
        return cockpit.resolve(currentCluster);
    }

    const deferred = cockpit.defer();
    logDebug('Waiting for list of clusters and hosts to be loaded');

    _waitForCurrentCluster(deferred, getState, 20);

    return deferred.promise;
}
