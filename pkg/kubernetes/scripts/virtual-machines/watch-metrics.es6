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

import { getNodeName } from './selectors.jsx';
import { fetchStatSummary } from './kube-middleware.jsx';
import { setNodeMetrics } from "./action-creators.jsx";

import CONFIG from './config.es6';
import { combineVms, getValueOrDefault } from './utils.jsx';

let metrics = {
    timeout: null,
    unSubscribe: null,
    watchedNodes: {},
};

function watchMetricsContinuously(fetchNode, timeout) {
    metrics.timeout = window.setTimeout(async () => {
        metrics.timeout = null;
        for (let node of Object.keys(metrics.watchedNodes)) {
            await fetchNode(node);
        }
        watchMetricsContinuously(fetchNode);
    }, timeout == null ? CONFIG.MetricsRefreshInterval : timeout);
}

function collectNode(nodes, vmi) {
    let refresh = false;
    const node = getNodeName(vmi);
    if (node) {
        if (!metrics.watchedNodes[node] && !nodes[node]) {
            refresh = true;
        }
        nodes[node] = node;
    }
    return refresh;
}

export function watchMetrics(store) {
    if (metrics.timeout) {
        cleanupMetricsWatch();
    }

    const fetchNode = async (node) => {
        const result = await fetchStatSummary(node).catch((ex) => console.warn(ex));
        return store.dispatch(setNodeMetrics(result.data));
    };

    metrics.unSubscribe = store.subscribe(function() {
        const state = store.getState();
        const nodes = {};
        let refresh = false;

        // poll visible vmis
        state.vmis.forEach(vmi => {
            if (getValueOrDefault(() => state.vmisUi[vmi.metadata.uid].isVisible) && collectNode(nodes, vmi)) {
                refresh = true;
            }
        });

        // poll visible vms
        combineVms(state.vms, state.vmis).forEach(({vm, vmi}) => {
            if (getValueOrDefault(() => state.vmsUi[vm.metadata.uid].isVisible) && collectNode(nodes, vmi)) {
                refresh = true;
            }
        });

        metrics.watchedNodes = nodes;

        if (refresh && metrics.timeout) {
            window.clearTimeout(metrics.timeout);
            watchMetricsContinuously(fetchNode, 0);
        }
    });

    watchMetricsContinuously(fetchNode, 0);
}

export function cleanupMetricsWatch() {
    if (metrics.unSubscribe) {
        metrics.unSubscribe();
    }

    window.clearTimeout(metrics.timeout);

    metrics.timeout = null;
    metrics.unSubscribe = null;
    metrics.watchedNodes = {};
}
