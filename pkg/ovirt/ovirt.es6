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

import {
    pollOvirtAction,
    updateHost,
    removeUnlistedHosts,
    updateVm,
    removeUnlistedVms,
    updateTemplate,
    removeUnlistedTemplates,
    updateCluster,
    removeUnlistedClusters,
    downloadIcons,
} from './actions.es6';

import { logDebug, logError } from '../machines/helpers.es6';
import { ovirtApiGet } from './ovirtApiAccess.es6';
import CONFIG from './config.es6';
import { isOvirtApiCheckPassed } from './provider.es6';
import { waitForCurrentCluster } from './selectors.es6';

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
 * Ensure, the function `call()` is not executed more than once per timeperiod.
 */
function callOncePerTimeperiod({ call, delay, lastCall }) {
    const now = Date.now();

    if (lastCall + delay <= now) {
        return call();
    }

    return null;
}
/**
 * TODO: evaluate use of ovirt's AuditLog messages to track changes so deep polling will be not needed.
 */
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
                const promises = [];
                promises.push(doRefreshHosts(dispatch));
                promises.push(doRefreshClusters(dispatch));

                promises.push(doRefreshVms(dispatch, getState));
                promises.push(doRefreshTemplates(dispatch, getState));

                return cockpit.all(promises).then(() => { // update the timestamp
                    logDebug('oVirt polling finished');
                    lastOvirtPoll = Date.now(); // single polling finished, re-enable it
                });
            }
        });
    };
}

/**
 * Shortens the period for next oVirt polling, so it will be executed at next earliest opportunity.
 *
 * Useful to shorten polling delay after user action.
 */
export function forceNextOvirtPoll() {
    lastOvirtPoll = -1;
}

function doRefreshHosts(dispatch) {
    logDebug(`doRefreshHosts() called`);
    return ovirtApiGet('hosts').done(data => {
        const result = JSON.parse(data);
        if (result && result.host && (result.host instanceof Array)) {
            const allHostIds = [];
            result.host.forEach( host => {
                allHostIds.push(host.id);
                dispatch(updateHost({
                    id: host.id,
                    name: host.name,
                    address: host.address,
                    clusterId: host.cluster ? host.cluster.id : undefined,
                    status: host.status,
                    memory: host.memory,
                    cpu: host.cpu ? {
                        name: host.cpu.name,
                        speed: host.cpu.speed,
                        topology: host.cpu.topology ? {
                            sockets: host.cpu.topology.sockets,
                            cores: host.cpu.topology.cores,
                            threads: host.cpu.topology.threads
                        } : undefined
                    } : undefined,
                    // summary
                    // vdsm version
                    // libvirt_version
                }));
            });
            dispatch(removeUnlistedHosts({allHostIds}));
        } else {
            logError(`doRefreshHosts() failed, data: ${data}`);
        }
    });
}

function parseVms(deferred, data, dispatch) {
    const result = JSON.parse(data);

    if (result && result.vm && (result.vm instanceof Array)) {
        const allVmsIds = [];
        const allIconIds = {}; // used as a set
        result.vm.forEach( vm => {
            allVmsIds.push(vm.id);

            let largeIconId, smallIconId;
            if (vm.large_icon) {
                largeIconId = vm.large_icon.id;
                allIconIds[largeIconId] = true;
            }
            if (vm.small_icon) {
                smallIconId = vm.small_icon.id;
                allIconIds[smallIconId] = true;
            }

            dispatch(updateVm({ // TODO: consider batching
                id: vm.id,
                name: vm.name,
                state: mapOvirtStatusToLibvirtState(vm.status),
                description: vm.description,
                highAvailability: vm.high_availability,
                icons: {
                    largeId: largeIconId,
                    smallId: smallIconId,
                },
                memory: vm.memory,
                cpu: {
                    architecture: vm.cpu.architecture,
                    topology: {
                        sockets: vm.cpu.topology.sockets,
                        cores: vm.cpu.topology.cores,
                        threads: vm.cpu.topology.threads
                    }
                },
                origin: vm.origin,
                os: {
                    type: vm.os.type
                },
                type: vm.type, // server, desktop
                stateless: vm.stateless,
                clusterId: vm.cluster.id,
                templateId: vm.template.id,
                hostId: vm.host ? vm.host.id : undefined,
                fqdn: vm.fqdn,
                startTime: vm.start_time, // in milliseconds since 1970/01/01
            }));
        });
        dispatch(removeUnlistedVms({allVmsIds}));
        dispatch(downloadIcons({ iconIds: allIconIds, forceReload: false }));

        deferred.resolve();
    } else {
        logError(`doRefreshVms() failed, result: ${JSON.stringify(result)}`);
        deferred.reject(result);
    }
}

function doRefreshVms(dispatch, getState) { // TODO: consider paging; there might be thousands of vms
    logDebug(`doRefreshVms() called`);

    const deferred = cockpit.defer();

    waitForCurrentCluster(getState).done(currentCluster => {
        logDebug('Reading VMs for currentCluster = ', currentCluster);

        ovirtApiGet(`vms?search=cluster%3D${currentCluster.name}`)
            .done(data => parseVms(deferred, data, dispatch))
            .fail((reason) => deferred.reject(reason));
    }).fail((reason) => deferred.reject(reason));

    return deferred.promise;
}

function mapOvirtStatusToLibvirtState(ovirtStatus) {
    switch (ovirtStatus) {// TODO: finish - add additional states
        case 'up': return 'running';
        case 'down': return 'shut off';
        default:
            return ovirtStatus;
    }
}

function parseTemplates(deferred, data, dispatch, currentClusterId) {
    const result = JSON.parse(data);
    if (result && result.template && (result.template instanceof Array)) {
        const allTemplateIds = [];
        result.template.forEach( template => {
            if (template.cluster && template.cluster.id !== currentClusterId) {
                return ; // accept template if either cluster is not set or conforms the current one, skip otherwise
            }

            allTemplateIds.push(template.id);
            dispatch(updateTemplate({ // TODO: consider batching
                id: template.id,
                name: template.name,
                description: template.description,
                cpu: {
                    architecture: template.cpu.architecture,
                    topology: {
                        sockets: template.cpu.topology.sockets,
                        cores: template.cpu.topology.cores,
                        threads: template.cpu.topology.threads
                    }
                },
                memory: template.memory,
                creationTime: template.creation_time,

                highAvailability: template.high_availability,
                icons: {
                    largeId: template.large_icon ? template.large_icon.id : undefined,
                    smallId: template.small_icon ? template.small_icon.id : undefined,
                },
                os: {
                    type: template.os.type
                },
                stateless: template.stateless,
                type: template.type, // server, desktop
                version: {
                    name: template.version ? template.version.name : undefined,
                    number: template.version ? template.version.number : undefined,
                    baseTemplateId: template.version && template.version.base_template ? template.version.base_template.id : undefined,
                },

                // bios
                // display
                // migration
                // memory_policy
                // os.boot
                // start_paused
                // usb
            }));
        });
        dispatch(removeUnlistedTemplates({allTemplateIds}));

        deferred.resolve();
    } else {
        logError(`doRefreshTemplates() failed, result: ${JSON.stringify(result)}`);
        deferred.reject(result);
    }
}

function doRefreshTemplates(dispatch, getState) { // TODO: consider paging; there might be thousands of templates
    logDebug(`doRefreshTemplates() called`);

    const deferred = cockpit.defer();

    waitForCurrentCluster(getState).done(currentCluster => {
        console.log('Reading Templates for currentCluster = ', currentCluster);

        // due to limitations of oVirt API we have to filter on templates on client side
        ovirtApiGet(`templates`)
            .done(data => parseTemplates(deferred, data, dispatch, currentCluster.id))
            .fail(reason => deferred.reject(reason));
    }).fail((reason) => deferred.reject(reason));

    return deferred.promise;
}

function doRefreshClusters(dispatch) {
    logDebug(`doRefreshClusters() called`);
    return ovirtApiGet('clusters').done(data => {
        const result = JSON.parse(data);
        if (result && result.cluster && (result.cluster instanceof Array)) {
            const allClusterIds  = [];
            result.cluster.forEach( cluster => {
                allClusterIds.push(cluster.id);
                dispatch(updateCluster({
                    id: cluster.id,
                    name: cluster.name,
                    // TODO: add more, if needed
                }));
            });
            dispatch(removeUnlistedClusters({allClusterIds}));
        } else {
            logError(`doRefreshClusters() failed, result: ${JSON.stringify(result)}`);
        }
    });
}

export function oVirtIconToInternal(ovirtIcon) {
    return {
        id: ovirtIcon.id,
        type: ovirtIcon['media_type'],
        data: ovirtIcon.data,
    };
}
