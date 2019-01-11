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

import {
    pollOvirtAction,
    updateHost,
    removeHost,
    updateVm,
    removeVm,
    updateTemplate,
    removeTemplate,
    updateCluster,
    removeCluster,
    downloadIcons,
} from './actions.js';

import {
    clusterConverter,
    vmConverter,
    templateConverter,
    hostConverter,
} from './ovirtConverters.js';

import { logDebug, logError } from '../machines/helpers.js';
import { ovirtApiGet } from './ovirtApiAccess.js';
import CONFIG from './config.js';
import { isOvirtApiCheckPassed } from './provider.js';
import { waitForCurrentCluster } from './selectors.js';

let lastOvirtPoll = -1; // timestamp
/**
 * Initiate polling of oVirt data.
 *
 * @param dispatch
 */
export function startOvirtPolling({ dispatch }) {
    if (!isOvirtApiCheckPassed()) {
        logDebug(`Skipping oVirt poling due to failed/unfinished oVirt API check`);
        return;
    }

    window.setInterval(() => dispatch(pollOvirtAction()), 1000); // see pollOvirt(), polling will be effectively started less often
}

/**
 * Shortens the period for next oVirt event polling, so it will be executed at next earliest opportunity.
 *
 * Useful to shorten reaction after user action.
 */
export function forceNextOvirtPoll() {
    lastOvirtPoll = -1;
}

/**
 * Ensure, the function `call()` is not executed more than once per timeperiod.
 */
function callOncePerTimeperiod({ call, delay, lastCall }) {
    const now = Date.now();

    if (lastCall + delay <= now) {
        return call();
    }

    return null;
}

export function pollOvirt() {
    return function (dispatch, getState) {
        callOncePerTimeperiod({
            lastCall: lastOvirtPoll,
            delay: CONFIG.ovirt_polling_interval, // do not poll more than once per this period
            call: () => {
                if (cockpit.hidden) { // plugin is not visible in Cockpit
                    logDebug('oVirt polling skipped since the plugin is not visible');
                    return;
                }

                logDebug('Executing oVirt polling');
                lastOvirtPoll = Infinity; // avoid parallel execution
                return doRefreshEvents(dispatch, getState)
                        .always(() => { // update the timestamp
                            logDebug('oVirt polling finished');
                            lastOvirtPoll = Date.now(); // single polling finished, re-enable it
                        });
            }
        });
    };
}

let lastEventIndexReceived = -1; // oVirt strictly increases event indexes to allow incremental polling
function doRefreshEvents(dispatch, getState) {
    logDebug(`doRefreshEvents() called`);

    let fullReload = false;
    let params = `?from=${lastEventIndexReceived}`;
    if (lastEventIndexReceived < 0) { // first run, take last event index and do full reload
        params = '?max=1&search=sortby%20time%20desc'; // just the last one
        fullReload = true;
    }

    const deferred = cockpit.defer();

    ovirtApiGet(`events${params}`)
            .done(data => {
                const result = JSON.parse(data);
                if (result && result.event && (result.event instanceof Array)) {
                    const vmsToRefresh = {};
                    const templatesToRefresh = {};
                    const hostsToRefresh = {};
                    const clustersToRefresh = {};

                    result.event.forEach(event => parseEvent(event, {
                        vmsToRefresh,
                        templatesToRefresh,
                        hostsToRefresh,
                        clustersToRefresh,
                    }));

                    const promises = [];

                    if (fullReload) { // first run
                        promises.push(doRefreshClusters(dispatch));
                        promises.push(doRefreshHosts(dispatch));

                        promises.push(doRefreshVms(dispatch, getState));
                        promises.push(doRefreshTemplates(dispatch, getState));
                    } else { // partial reload based on events only
                        Object.getOwnPropertyNames(clustersToRefresh)
                                .forEach(id => promises.push(doRefreshClusters(dispatch, id)));

                        Object.getOwnPropertyNames(hostsToRefresh)
                                .forEach(id => promises.push(doRefreshHosts(dispatch, id)));

                        Object.getOwnPropertyNames(vmsToRefresh)
                                .forEach(id => promises.push(doRefreshVms(dispatch, getState, id)));

                        Object.getOwnPropertyNames(templatesToRefresh)
                                .forEach(id => promises.push(doRefreshTemplates(dispatch, getState, id)));
                    }

                    // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
                    // https://github.com/cockpit-project/cockpit/issues/10956
                    // eslint-disable-next-line cockpit/no-cockpit-all
                    cockpit.all(promises)
                            .then(() => deferred.resolve())
                            .catch((r) => deferred.reject(r));
                } else {
                    if (result && Object.getOwnPropertyNames(result).length === 0) { // no new events
                        logDebug('No new oVirt events received');
                        deferred.resolve();
                    } else {
                        logError('doRefreshEvents() failed, data: ', data, ', result: ', result);
                        deferred.reject('Array of events expected');
                    }
                }
            })
            .fail(() => {
                logError('Failed to retrieve oVirt events');
                deferred.reject('Failed to retrieve oVirt events');
            });

    return deferred.promise;
}

function parseEvent(event, { vmsToRefresh, templatesToRefresh, hostsToRefresh, clustersToRefresh }) {
    logDebug('parseEvent: ', event);
    const eventIndex = parseInt(event.index);
    lastEventIndexReceived = (lastEventIndexReceived < eventIndex) ? eventIndex : lastEventIndexReceived;

    // TODO: improve refresh decision based on event type and not just on presence of related resource
    if (event.host && event.host.id) {
        hostsToRefresh[event.host.id] = true;
    }

    if (event.vm && event.vm.id) {
        vmsToRefresh[event.vm.id] = true;
    }

    if (event.template && event.template.id) {
        templatesToRefresh[event.template.id] = true;
    }

    if (event.cluster && event.cluster.id) {
        clustersToRefresh[event.cluster.id] = true;
    }
}

function doRefreshHosts(dispatch, hostId) {
    return doRefreshResource(dispatch, 'hosts', hostId, parseHosts, removeHost);
}

function doRefreshClusters(dispatch, clusterId) {
    return doRefreshResource(dispatch, 'clusters', clusterId, parseClusters, removeCluster);
}

function doRefreshVms(dispatch, getState, vmId) {
    return doRefreshResourceWithCurrentCluster(dispatch, getState, 'vms', vmId, parseVms, removeVm, true);
}

function doRefreshTemplates(dispatch, getState, templateId) {
    return doRefreshResourceWithCurrentCluster(dispatch, getState, 'templates', templateId, parseTemplates, removeTemplate, false);
}

function parseVms(deferred, data, dispatch, currentCluster) {
    const filterPredicate = vm => vm.cluster && vm.cluster.id === currentCluster.id;

    const allIconIds = {}; // used as a set
    const collectIconIds = vm => {
        if (vm.large_icon) {
            allIconIds[vm.large_icon.id] = true;
        }
        if (vm.small_icon) {
            allIconIds[vm.small_icon.id] = true;
        }
    };

    parseResourceGeneric(data, dispatch, 'vm', vmConverter, updateVm, filterPredicate, deferred, collectIconIds);
    dispatch(downloadIcons({ iconIds: allIconIds, forceReload: false }));
}

function parseTemplates(deferred, data, dispatch, currentCluster) {
    const filterPredicate = (template) => !template.cluster || template.cluster.id === currentCluster.id;
    parseResourceGeneric(data, dispatch, 'template', templateConverter, updateTemplate, filterPredicate, deferred);
}

function parseHosts(data, dispatch) {
    parseResourceGeneric(data, dispatch, 'host', hostConverter, updateHost);
}

function parseClusters(data, dispatch) {
    parseResourceGeneric(data, dispatch, 'cluster', clusterConverter, updateCluster);
}

/**
 * Generic function to parse received oVirt JSON resource string and update redux store.
 */
function parseResourceGeneric(data, dispatch, name, converterFunction, updateAction, filterPredicate, deferred, resourceCallback) {
    const alwaysTrue = () => true;
    filterPredicate = filterPredicate || alwaysTrue;

    const result = JSON.parse(data);
    if (result && result[name] && (result[name] instanceof Array)) {
        result[name]
                .filter(filterPredicate)
                .forEach(resource => {
                    if (resourceCallback) {
                        resourceCallback(resource);
                    }
                    dispatch(updateAction(converterFunction(resource)));
                });

        if (deferred) {
            deferred.resolve();
        }
    } else if (result && result.id) { // single entry
        if (resourceCallback) {
            resourceCallback(result);
        }
        dispatch(updateAction(converterFunction(result)));
        if (deferred) {
            deferred.resolve();
        }
    } else {
        if (result && Object.getOwnPropertyNames(result).length === 0) { // no resource received
            logDebug(`No oVirt '${name}' received`);
        } else {
            logError('parseResourceGeneric() failed, name: ', name, ', data:\n', data, '\n, result:\n', result);
        }

        if (deferred) {
            deferred.reject(result);
        }
    }
}

/**
 * Generic function to refresh oVirt API resource
 */
function doRefreshResource(dispatch, name, resourceId, parserFunction, removeAction) {
    const url = `${name}${resourceId ? `/${resourceId}` : ''}`;
    logDebug(`doRefreshResource() called for ${url}`);

    return ovirtApiGet(url)
            .done(data => parserFunction(data, dispatch))
            .fail(data => {
                console.info(`Failed to get ${url}, `, data);
                if (resourceId) {
                    console.info(`The ${name} ${resourceId} is about to be removed from the list.`);
                    dispatch(removeAction(resourceId));
                }
            });
}

/**
 * Like doRefreshResource() but waits for 'cluster' to be loaded
 */
function doRefreshResourceWithCurrentCluster(dispatch, getState, name, resourceId, parserFunction, removeAction, isApiSearchOnCluster) {
    logDebug(`doRefreshResourceWithCurrentCluster() called, name=${name}, resourceId=${resourceId} `);

    const deferred = cockpit.defer();

    waitForCurrentCluster(getState)
            .done(currentCluster => {
                logDebug(`Reading ${name} for currentCluster: `, currentCluster);

                let url = isApiSearchOnCluster ? `${name}?search=cluster%3D${currentCluster.name}` : `${name}`; // special case for templates - no way to get cluster templates + Blank from API
                if (resourceId) {
                    url = `${name}/${resourceId}`; // currently no way to filter on cluster for single resource
                }

                logDebug('doRefreshResourceWithCurrentCluster(), url: ', url);
                ovirtApiGet(url) // TODO: consider paging; there might be thousands of resources within initial load
                        .done(data => parserFunction(deferred, data, dispatch, currentCluster))
                        .fail(data => {
                            console.info(`Failed to get ${url}, `, data);
                            if (resourceId) {
                                console.info(`The ${name} ${resourceId} is about to be removed from the list.`);
                                dispatch(removeAction(resourceId));
                            }
                            deferred.reject(data);
                        });
            })
            .fail((reason) => deferred.reject(reason));

    return deferred.promise;
}
