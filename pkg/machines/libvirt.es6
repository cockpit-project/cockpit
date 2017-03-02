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
import {updateOrAddVm, getVm, getAllVms, delayPolling, deleteUnlistedVMs, vmActionFailed} from './actions.es6';
import { spawnScript, spawnProcess } from './services.es6';
import { toKiloBytes, isEmpty, logDebug } from './helpers.es6';
import VMS_CONFIG from './config.es6';

const _ = cockpit.gettext;

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

/**
 * Returns a function handling VM action failures.
 */
function buildFailHandler({ dispatch, name, connectionName, message }) {
    return ({ exception, data }) =>
        dispatch(vmActionFailed({name, connectionName, message, detail: {exception, data}}));
}

let LIBVIRT_PROVIDER = {};
LIBVIRT_PROVIDER = {
    name: 'Libvirt',

    /**
     * Initialize the provider.
     * Arguments are used for reference only, they are actually not needed for this Libvirt provider.
     *
     * @param actionCreators - Map of action creators (functions)
     * @param nextProvider - Next provider in chain, recently Libvirt. Used for chaining commands or fallbacks.
     * @returns {boolean} - true, if initialization succeeded
     */
    init(actionCreators, nextProvider) {
        // This is default provider - the Libvirt.
        // We do not need to use actionCreators or nextProvider
        return true;
    },

    canReset(vmState) {
        return vmState == 'running' || vmState == 'idle' || vmState == 'paused';
    },
    canShutdown(vmState) {
        return LIBVIRT_PROVIDER.canReset(vmState);
    },
    isRunning(vmState) {
        return LIBVIRT_PROVIDER.canReset(vmState);
    },
    canRun(vmState) {
        return vmState == 'shut off';
    },

    /**
     * Read VM properties of a single VM (virsh)
     *
     * @param VM name
     * @returns {Function}
     */
    GET_VM ({ lookupId: name, connectionName }) {
        logDebug(`${this.name}.GET_VM()`);

        const canFailHandler = ({exception, data}) => {
            console.info(`The 'virsh' command failed, as expected: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
        };

        return dispatch => {
            if (!isEmpty(name)) {
                return spawnVirshReadOnly({connectionName, method: 'dumpxml', name}).then(domXml => {
                    parseDumpxml(dispatch, connectionName, domXml);
                    return spawnVirshReadOnly({connectionName, method: 'dominfo', name});
                }).then(domInfo => {
                    if (LIBVIRT_PROVIDER.isRunning(parseDominfo(dispatch, connectionName, name, domInfo))) {
                        return spawnVirshReadOnly({connectionName, method: 'dommemstat', name, failHandler: canFailHandler});
                    }
                }).then(dommemstat => {
                    if (dommemstat) { // is undefined if vm is not running
                        parseDommemstat(dispatch, connectionName, name, dommemstat);
                        return spawnVirshReadOnly({connectionName, method: 'domstats', name, failHandler: canFailHandler});
                    }
                }).then(domstats => {
                    if (domstats) {
                        parseDomstats(dispatch, connectionName, name, domstats);
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
    GET_ALL_VMS ({ connectionName }) {
        logDebug(`${this.name}.GET_ALL_VMS(connectionName='${connectionName}'):`);
        if (connectionName) {
            return dispatch => doGetAllVms(dispatch, connectionName);
        }

        return dispatch => { // for all connections
            return cockpit.user().done( loggedUser => {
                const promises = Object.getOwnPropertyNames(VMS_CONFIG.Virsh.connections)
                    .filter(
                        // The 'root' user does not have its own qemu:///session just qemu:///system
                        // https://bugzilla.redhat.com/show_bug.cgi?id=1045069
                        connectionName => canLoggedUserConnectSession(connectionName, loggedUser))
                    .map(connectionName => dispatch(getAllVms(connectionName)));

                return cockpit.all(promises)
                    .then(() => { // keep polling AFTER all VM details have been read (avoid overlap)
                        dispatch(delayPolling(getAllVms()));
                    });
            });
        };
    },

    SHUTDOWN_VM ({ name, connectionName }) {
        logDebug(`${this.name}.SHUTDOWN_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'SHUTDOWN_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM SHUT DOWN action failed")}),
            args: ['shutdown', name]
        });
    },

    FORCEOFF_VM ({ name, connectionName }) {
        logDebug(`${this.name}.FORCEOFF_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'FORCEOFF_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM FORCE OFF action failed")}),
            args: ['destroy', name]
        });
    },

    REBOOT_VM ({ name, connectionName }) {
        logDebug(`${this.name}.REBOOT_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'REBOOT_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM REBOOT action failed")}),
            args: ['reboot', name]
        });
    },

    FORCEREBOOT_VM ({ name, connectionName }) {
        logDebug(`${this.name}.FORCEREBOOT_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'FORCEREBOOT_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM FORCE REBOOT action failed")}),
            args: ['reset', name]
        });
    },

    START_VM ({ name, connectionName }) {
        logDebug(`${this.name}.START_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'START_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM START action failed")}),
            args: ['start', name]
        });
    }
};

function canLoggedUserConnectSession (connectionName, loggedUser) {
    return connectionName !== 'session' || loggedUser.name !== 'root';
}

function doGetAllVms (dispatch, connectionName) {
    const connection = VMS_CONFIG.Virsh.connections[connectionName];

    return spawnScript({
        script: `virsh ${connection.params.join(' ')} -r list --all | awk '$1 == "-" || $1+0 > 0 { print $2 }'`
    }).then(output => {
        const vmNames = output.trim().split(/\r?\n/);
        vmNames.forEach((vmName, index) => {
            vmNames[index] = vmName.trim();
        });
        logDebug(`GET_ALL_VMS: vmNames: ${JSON.stringify(vmNames)}`);

        // remove undefined domains
        dispatch(deleteUnlistedVMs(connectionName, vmNames));

        // read VM details
        return cockpit.all(vmNames.map((name) => dispatch(getVm(connectionName, name))));
    });
}

// TODO: add configurable custom virsh attribs - i.e. libvirt user/pwd
function spawnVirsh({connectionName, method, failHandler, args}) {
    return spawnProcess({
        cmd: 'virsh',
        args: VMS_CONFIG.Virsh.connections[connectionName].params.concat(args),
        failHandler,
    }).catch((ex, data, output) => {
        const msg = `${method}() exception: '${ex}', data: '${data}', output: '${output}'`;
        if (failHandler) {
            logDebug(msg);
            return ;
        }
        console.error(msg);
    });
}

function spawnVirshReadOnly({connectionName, method, name, failHandler}) {
    return spawnVirsh({connectionName, method, args: ['-r', method, name], failHandler});
}

function parseDumpxml(dispatch, connectionName, domXml) {
    const xmlDoc = $.parseXML(domXml);

    if (!xmlDoc) {
        console.error(`Can't parse dumpxml, input: "${domXml}"`);
        return ;
    }

    const domainElem = xmlDoc.getElementsByTagName("domain")[0];
    const osElem = domainElem.getElementsByTagName("os")[0];
    const currentMemoryElem = domainElem.getElementsByTagName("currentMemory")[0];
    const vcpuElem = domainElem.getElementsByTagName("vcpu")[0];
    const vcpuCurrentAttr = vcpuElem.attributes.getNamedItem('current');

    const name = domainElem.getElementsByTagName("name")[0].childNodes[0].nodeValue;
    const id = domainElem.getElementsByTagName("uuid")[0].childNodes[0].nodeValue;
    const osType = osElem.getElementsByTagName("type")[0].childNodes[0].nodeValue;

    const currentMemoryUnit = currentMemoryElem.getAttribute("unit");
    const currentMemory = toKiloBytes(currentMemoryElem.childNodes[0].nodeValue, currentMemoryUnit);

    const vcpus = (vcpuCurrentAttr && vcpuCurrentAttr.value) ? vcpuCurrentAttr.value : vcpuElem.childNodes[0].nodeValue;

    dispatch(updateOrAddVm({connectionName, name, id, osType, currentMemory, vcpus}));
}

function parseDominfo(dispatch, connectionName, name, domInfo) {
    const lines = parseLines(domInfo);
    const state = getValueFromLine(lines, 'State:');
    const autostart = getValueFromLine(lines, 'Autostart:');

    if (!LIBVIRT_PROVIDER.isRunning(state)) { // clean usage data
        dispatch(updateOrAddVm({connectionName, name, state, autostart, actualTimeInMs: -1}));
    } else {
        dispatch(updateOrAddVm({connectionName, name, state, autostart}));
    }

    return state;
}

function parseDommemstat(dispatch, connectionName, name, dommemstat) {
    const lines = parseLines(dommemstat);

    let rssMemory = getValueFromLine(lines, 'rss'); // in KiB

    if (rssMemory) {
        dispatch(updateOrAddVm({connectionName, name, rssMemory}));
    }
}

function parseDomstats(dispatch, connectionName, name, domstats) {
    const actualTimeInMs = Date.now();

    const lines = parseLines(domstats);

    let cpuTime = getValueFromLine(lines, 'cpu\.time=');
    // TODO: Add disk, network usage statistics

    if (cpuTime) {
        dispatch(updateOrAddVm({connectionName, name, actualTimeInMs, cpuTime}));
    }
}

export default LIBVIRT_PROVIDER;
