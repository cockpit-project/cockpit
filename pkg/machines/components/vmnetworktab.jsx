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
import React from 'react';
import PropTypes from 'prop-types';
import { OverlayTrigger, Tooltip } from "patternfly-react";

import cockpit from 'cockpit';
import { changeNetworkState } from "../actions/provider-actions.es6";
import VmLastMessage from './vmLastMessage.jsx';
import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import { rephraseUI, vmId } from "../helpers.es6";
import EditNICAction from './nicEdit.jsx';
import './nicEdit.css';

const _ = cockpit.gettext;

const VmNetworkTab = function ({ vm, dispatch, config, hostDevices, networks }) {
    const id = vmId(vm.name);

    const warningInactive = (id) => {
        return (
            <OverlayTrigger overlay={ <Tooltip id="tip-network">{ _("Changes will take effect after shutting down the VM") }</Tooltip> } placement='top'>
                <i id={id} className='pficon pficon-pending' />
            </OverlayTrigger>
        );
    };

    const nicLookupByMAC = (interfacesList, mac) => {
        return interfacesList.filter(iface => iface.mac == mac)[0];
    };

    if (!vm.interfaces || vm.interfaces.length === 0) {
        return (<div>{_("No network interfaces defined for this VM")}</div>);
    }

    const checkDeviceAviability = (network) => {
        for (let i in hostDevices) {
            if (hostDevices[i].valid && hostDevices[i].Interface == network) {
                return true;
            }
        }
        return false;
    };

    const sourceJump = (source) => {
        return () => {
            if (source !== null && checkDeviceAviability(source)) {
                cockpit.jump(`/network#/${source}`, cockpit.transport.host);
            }
        };
    };

    const onChangeState = (network) => {
        return (e) => {
            e.stopPropagation();
            if (network.mac) {
                dispatch(changeNetworkState(vm, network.mac, network.state === 'up' ? 'down' : 'up'));
            }
        };
    };
    const addressPortSource = (source, networkId) => (<table id={`${id}-network-${networkId}-source`}>
        <tbody>
            <tr><td className='machines-network-source-descr'>{_("Address")}</td><td className='machines-network-source-value'>{source.address}</td></tr>
            <tr><td className='machines-network-source-descr'>{_("Port")}</td><td className='machines-network-source-value'>{source.port}</td></tr>
        </tbody>
    </table>);

    // Network data mapping to rows
    const detailMap = [
        { name: _("Type"), value: (network, networkId) => {
            let inactiveNIC = nicLookupByMAC(vm.inactiveXML.interfaces, network.mac);
            return (
                <div id={`${id}-network-${networkId}-type`}>
                    {network.type}
                    {inactiveNIC && inactiveNIC.type !== network.type && warningInactive(`${id}-network-${networkId}-type-tooltip`)}
                </div>
            );
        }},
        { name: _("Model type"), value: (network, networkId) => {
            let inactiveNIC = nicLookupByMAC(vm.inactiveXML.interfaces, network.mac);
            return (
                <div id={`${id}-network-${networkId}-model`}>
                    {network.model}
                    {inactiveNIC && inactiveNIC.model !== network.model && warningInactive(`${id}-network-${networkId}-model-tooltip`)}
                </div>
            );
        }},
        { name: _("MAC Address"), value: 'mac' },
        { name: _("Source"), value: (network, networkId) => {
            const setSourceClass = (source) => checkDeviceAviability(source) ? "machines-network-source-link" : undefined;
            const mapSource = {
                direct: (source) => <span className={setSourceClass(source.dev)} onClick={sourceJump(source.dev)}>{source.dev}</span>,
                network: (source) => <span className={setSourceClass(source.network)} onClick={sourceJump(source.network)}>{source.network}</span>,
                bridge: (source) => <span className={setSourceClass(source.bridge)} onClick={sourceJump(source.bridge)}>{source.bridge}</span>,
                mcast: addressPortSource,
                server: addressPortSource,
                client: addressPortSource,
                udp: addressPortSource,
            };
            if (mapSource[network.type] !== undefined) {
                let inactiveNIC = nicLookupByMAC(vm.inactiveXML.interfaces, network.mac);
                return (
                    <div id={`${id}-network-${networkId}-source`}>
                        {mapSource[network.type](network.source, networkId)}
                        {inactiveNIC && inactiveNIC.source[inactiveNIC.type] !== network.source[network.type] && warningInactive(`${id}-network-${networkId}-source-tooltip`)}

                    </div>
                );
            } else {
                return null;
            }
        }},
        { name: _("State"), value: (network, networkId) => {
            return <span className='machines-network-state' id={`${id}-network-${networkId}-state`}>{rephraseUI('networkState', network.state)}</span>;
        }},
        { name: "", value: (network, networkId) => {
            const isUp = network.state === 'up';
            const editNICAction = (providerName) => {
                if (providerName === "LibvirtDBus")
                    return <EditNICAction dispatch={dispatch} idPrefix={`${id}-network-${networkId}`} vm={vm} network={network} networks={networks} />;
            };

            return (
                <div className='machines-network-actions'>
                    <button className='btn btn-default' onClick={onChangeState(network)} title={`${isUp ? _("Unplug") : _("Plug")}`}>
                        {isUp ? 'Unplug' : 'Plug'}
                    </button>
                    {editNICAction(config.provider.name)}
                </div>
            );
        }},
    ];

    let networkId = 1;
    const currentTab = 'network';
    const message = (<VmLastMessage vm={vm} dispatch={dispatch} tab={currentTab} />);

    return (
        <div className="machines-network-list">
            {message}
            <Listing compact columnTitles={detailMap.map(target => target.name)} actions={null} emptyCaption=''>
                {vm.interfaces.sort().map(target => {
                    const columns = detailMap.map(d => {
                        let column = null;
                        if (typeof d.value === 'string') {
                            if (target[d.value] !== undefined) {
                                column = { name: (<div id={`${id}-network-${networkId}-${d.value}`}>{target[d.value]}</div>), header: d.header };
                            }
                        }
                        if (typeof d.value === 'function') {
                            column = d.value(target, networkId);
                        }
                        return column;
                    });
                    networkId++;

                    return (<ListingRow columns={columns} key={networkId} />);
                })}
            </Listing>
        </div>
    );
};

VmNetworkTab.propTypes = {
    vm: PropTypes.object.isRequired,
};

export default VmNetworkTab;
