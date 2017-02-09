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

/*
 * Provider for Libvirt
 */
import cockpit from 'cockpit';
import $ from 'jquery';
import {updateOrAddVm, getVm, getAllVms, delayPolling, deleteUnlistedVMs} from './actions.es6';
import { spawnScript, spawnProcess } from './services.es6';
import { toKiloBytes, isEmpty, logDebug, isRunning } from './helpers.es6';
import VMS_CONFIG from './config.es6';

// --- compatibility hack
if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (searchString, position) {
        position = position || 0;
        return this.substr(position, searchString.length) === searchString;
    };
}

/**
 * Parse non-XML stdout of virsh.
 *
 * @param virshStdout
 * @returns {*}
 */
function parseLines(virshStdout) {
    return virshStdout.match(/[^\r\n]+/g);
}

/**
 * Parse format of:
 * Pattern: value
 * @param parsedLines
 * @param pattern
 */
function getValueFromLine(parsedLines, pattern) {
    const selectedLine = parsedLines.filter(line => {
        return line.trim().startsWith(pattern);
    });
    return isEmpty(selectedLine) ? undefined : selectedLine.toString().trim().substring(pattern.length).trim();
}

export default {
    name: 'Libvirt',

    /**
     * read VM properties (virsh)
     *
     * @param VM name
     * @returns {Function}
     */
    GET_VM ({ lookupId: name }) {
        logDebug(`${this.name}.GET_VM()`);

        return dispatch => {
            if (!isEmpty(name)) {
                return spawnVirshReadOnly('dumpxml', name).then(domXml => {
                    parseDumpxml(dispatch, domXml);
                    return spawnVirshReadOnly('dominfo', name);
                }).then(domInfo => {
                    if (isRunning(parseDominfo(dispatch, name, domInfo))) {
                        return spawnVirshReadOnly('dommemstat', name);
                    }
                }).then(dommemstat => {
                    if (dommemstat) { // is undefined if vm is not running
                        parseDommemstat(dispatch, name, dommemstat);
                        return spawnVirshReadOnly('domstats', name);
                    }
                }).then(domstats => {
                    if (domstats) {
                        parseDomstats(dispatch, name, domstats);
                    }
                }); // end of GET_VM return
            }
        };
    },

    /**
     * Initiate read of all VMs
     *
     * @returns {Function}
     */
    GET_ALL_VMS () {
        logDebug(`${this.name}.GET_ALL_VMS():`);
        return dispatch => {
            spawnScript({
                script: `virsh ${VMS_CONFIG.Virsh.ConnectionParams.join(' ')} -r list --all | awk '$1 == "-" || $1+0 > 0 { print $2 }'`
            }).then(output => {
                const vmNames = output.trim().split(/\r?\n/);
                vmNames.forEach((vmName, index) => {
                    vmNames[index] = vmName.trim();
                });
                logDebug(`GET_ALL_VMS: vmNames: ${JSON.stringify(vmNames)}`);

                // remove undefined domains
                dispatch(deleteUnlistedVMs(vmNames));

                // read VM details
                return cockpit.all(vmNames.map((name) => dispatch(getVm(name))));
            }).then(() => {
                // keep polling AFTER all VM details have been read (avoid overlap)
                dispatch(delayPolling(getAllVms()));
            });
        };
    },

    SHUTDOWN_VM ({ name }) {
        logDebug(`${this.name}.SHUTDOWN_VM(${name}):`);
        return spawnVirsh('SHUTDOWN_VM', 'shutdown', name);
    },

    FORCEOFF_VM ({ name }) {
        logDebug(`${this.name}.FORCEOFF_VM(${name}):`);
        return spawnVirsh('FORCEOFF_VM', 'destroy', name);
    },

    REBOOT_VM ({ name }) {
        logDebug(`${this.name}.REBOOT_VM(${name}):`);
        return spawnVirsh('REBOOT_VM', 'reboot', name);
    },

    FORCEREBOOT_VM ({ name }) {
        logDebug(`${this.name}.FORCEREBOOT_VM(${name}):`);
        return spawnVirsh('FORCEREBOOT_VM', 'reset', name);
    },

    START_VM ({ name }) {
        logDebug(`${this.name}.START_VM(${name}):`);
        return spawnVirsh('START_VM', 'start', name);
    }
};

// TODO: add configurable custom virsh attribs - i.e. libvirt user/pwd
function spawnVirsh(method, ...args) {
    args = VMS_CONFIG.Virsh.ConnectionParams.concat(args);

    return spawnProcess({
        cmd: 'virsh',
        args
    }).catch((ex, data, output) => {
        console.error(`${method}() exception: '${ex}', data: '${data}', output: '${output}'`);
    });
}

function spawnVirshReadOnly(method, name) {
    return spawnProcess({
        cmd: 'virsh',
        args: VMS_CONFIG.Virsh.ConnectionParams.concat(['-r', method, name])
    });
}

function parseDumpxml(dispatch, domXml) {
    const xmlDoc = $.parseXML(domXml);

    const domainElem = xmlDoc.getElementsByTagName("domain")[0];
    const osElem = domainElem.getElementsByTagName("os")[0];
    const currentMemoryElem = domainElem.getElementsByTagName("currentMemory")[0];
    const vcpuElem = domainElem.getElementsByTagName("vcpu")[0];

    const name = domainElem.getElementsByTagName("name")[0].childNodes[0].nodeValue;
    const id = domainElem.getElementsByTagName("uuid")[0].childNodes[0].nodeValue;
    const osType = osElem.getElementsByTagName("type")[0].childNodes[0].nodeValue;

    const currentMemoryUnit = currentMemoryElem.getAttribute("unit");
    const currentMemory = toKiloBytes(currentMemoryElem.childNodes[0].nodeValue, currentMemoryUnit);

    const vcpus = vcpuElem.childNodes[0].nodeValue;

    dispatch(updateOrAddVm({name, id, osType, currentMemory, vcpus}));
}

function parseDominfo(dispatch, name, domInfo) {
    const lines = parseLines(domInfo);
    const state = getValueFromLine(lines, 'State:');
    const autostart = getValueFromLine(lines, 'Autostart:');

    if (!isRunning(state)) { // clean usage data
        dispatch(updateOrAddVm({name, state, autostart, actualTimeInMs: -1}));
    } else {
        dispatch(updateOrAddVm({name, state, autostart}));
    }

    return state;
}

function parseDommemstat(dispatch, name, dommemstat) {
    const lines = parseLines(dommemstat);

    let rssMemory = getValueFromLine(lines, 'rss'); // in KiB

    if (rssMemory) {
        dispatch(updateOrAddVm({name, rssMemory}));
    }
}

function parseDomstats(dispatch, name, domstats) {
    const actualTimeInMs = Date.now();

    const lines = parseLines(domstats);

    let cpuTime = getValueFromLine(lines, 'cpu\.time=');
    // TODO: Add disk, network usage statistics

    if (cpuTime) {
        dispatch(updateOrAddVm({name, actualTimeInMs, cpuTime}));
    }
}
