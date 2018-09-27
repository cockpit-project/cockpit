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
import cockpit from 'cockpit';
import { changeNetworkState } from "./actions/provider-actions.es6";
import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import { rephraseUI, vmId } from "./helpers.es6";

const _ = cockpit.gettext;

const VmNetworkTab = function ({ vm, dispatch, hostDevices }) {
    const id = vmId(vm.name);

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
        <tr><td className='machines-network-source-descr'>{_("Address")}</td><td className='machines-network-source-value'>{source.address}</td></tr>
        <tr><td className='machines-network-source-descr'>{_("Port")}</td><td className='machines-network-source-value'>{source.port}</td></tr>
    </table>);

    // Network data mapping to rows
    let detailMap = [
        { name: _("Type"), value: (network, networkId) => <div id={`${id}-network-${networkId}-type`}>{rephraseUI('networkType', network.type)}</div>, header: true },
        { name: _("Model type"), value: 'model' },
        { name: _("MAC Address"), value: 'mac' },
        { name: _("Host Interface"), value: 'target', hidden: !(vm.state == "running") },
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
                return <div id={`${id}-network-${networkId}-source`}>{mapSource[network.type](network.source, networkId)}</div>;
            } else {
                return null;
            }
        }},
        { name: _("Additional"), value: (network, networkId) => {
            const additionalMap = [
                { name: _("MTU"), value: 'mtu' },
                { name: _("Virtualport"), value: 'virtualportType' },
                { name: _("Managed"), value: rephraseUI('networkManaged', network.managed) },
                { name: _("Portgroup"), value: (network) => {
                    if (network.source.portgroup) {
                        return network.source.portgroup;
                    }
                    return null;
                } },
            ];
            const columns = additionalMap.map(d => {
                let name = d.name;
                let value = null;
                if (typeof d.value === 'string') {
                    value = network[d.value];
                }
                if (typeof d.value === 'function') {
                    value = d.value(network);
                }
                if (value) {
                    return (
                        <div className='col-xs-12 col-md-6 machines-network-additional-column' id={`${id}-network-${networkId}-${name}`}>
                            <div className='machines-network-source-descr col-xs-12 col-sm-6'>{name}</div>
                            <div className='machines-network-source-value col-xs-12 col-sm-6'>{value}</div>
                        </div>);
                }
                return null;
            });
            return (<div>{columns}</div>);
        }},
        { name: _("State"), value: (network, networkId) => {
            const isUp = network.state === 'up';
            return (<div className='machines-network-state' id={`${id}-network-${networkId}-state`}>
                <span className='machines-network-state-text'>{rephraseUI('networkState', network.state)}</span>
                <button className='btn btn-default' onClick={onChangeState(network)} title={`${isUp ? _("Unplug") : _("Plug")}`}>
                    {isUp ? 'Unplug' : 'Plug'}
                </button>
            </div>);
        }
        },
    ];

    let networkId = 1;
    detailMap = detailMap.filter(target => !target.hidden);

    return (
        <div className="machines-network-list">
            <Listing columnTitles={detailMap.map(target => target.name)} actions={null} emptyCaption=''>
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
