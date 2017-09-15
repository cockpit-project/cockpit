/*jshint esversion: 6 */
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
import cockpit from 'cockpit';
import { changeNetworkState } from "./actions.es6";
import { rephraseUI, vmId } from "./helpers.es6";
import { Listing, ListingRow } from 'cockpit-components-listing.jsx';

const _ = cockpit.gettext;

class VmNetworkTab extends React.Component {
    render () {
        let { vm, dispatch } = this.props;
        const id = vmId(vm.name);

        if (!vm.interfaces || vm.interfaces.length === 0) {
            return (<div>{_("No network interfaces defined for this VM")}</div>);
        }

        const onChangeState = (network) => {
            return (e) => {
                e.stopPropagation();
                if (network.mac) {
                    dispatch(changeNetworkState(vm, network.mac, network.state === 'up' ? 'down' : 'up'));
                }
            }
        }
        const addressPortSource = (source, networkId) => (<table id={`${id}-network-${networkId}-source`}>
            <tr><td className='machines-network-source-descr'>{_("Address")}</td><td className='machines-network-source-value'>{source.address}</td></tr>
            <tr><td className='machines-network-source-descr'>{_("Port")}</td><td className='machines-network-source-value'>{source.port}</td></tr>
        </table>);

        const getSource = (network) => {
            const mapSource = {
                direct: (source) => source.dev,
                network: (source) => source.network,
                bridge: (source) => source.bridge,
            }
            if (mapSource[network.type] !== undefined) {
                return mapSource[network.type](network.source);
            } else {
                return null;
            }
        }

        // Network data mapping to rows
        const detailMap = [
            { name: _("Type"), value: (network, networkId) => <div id={`${id}-network-${networkId}-type`}>{rephraseUI('networkType', network.type)}</div>, header: true },
            { name: _("Model type"), value: 'model' },
            { name: _("MAC Address"), value: 'mac' },
            { name: _("Target"), value: 'target' },
            { name: _("Source"), value: (network, networkId) => {
                const mapSource = {
                    direct: (source) => source.dev,
                    network: (source) => source.network,
                    bridge: (source) => source.bridge,
                    mcast: addressPortSource,
                    server: addressPortSource,
                    client: addressPortSource,
                    udp: addressPortSource,
                }
                if (mapSource[network.type] !== undefined) {
                    return <div id={`${id}-network-${networkId}-source`}>{mapSource[network.type](network.source, networkId)}</div>
                } else {
                    return null;
                }
            }},
            { name: _("Additional"), value: (network, networkId) => {
                const additionalMap = [
                    { name: _("MTU"), value: 'mtu' },
                    { name: _("Virtualport"), value: 'virtualportType' },
                    { name: _("Managed"), value: rephraseUI('networkManaged', network.managed)  },
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
                return (
                    <div className='machines-network-state' id={`${id}-network-${networkId}-state`}>
                        <span>{rephraseUI('networkState', network.state)}</span>
                        <button className='btn btn-link machines-network-button' onClick={onChangeState(network)} title={`${ isUp ? _("Unplug") : _("Plug")}`}>
                            <i className={`fa fa-power-off ${ isUp ? 'machines-network-down' : 'machines-network-up'}`} />
                        </button>
                    </div>)
            } },
        ];

        let networkId = 1;

        return (
            <div>
                <Listing columnTitles={detailMap.map(target => target.name)} actions={null}>
                    {vm.interfaces.sort().map(target => {
                        const columns = detailMap.map(d => {
                            if (typeof d.value === 'string') {
                                if (target[d.value] !== undefined) {
                                    return { name: (<div id={`${id}-network-${networkId}-${d.value}`}>{target[d.value]}</div>), header: d.header };
                                }
                            }
                            if (typeof d.value === 'function') {
                                return d.value(target, networkId);
                            }
                            return null;
                        })

                        const sourceJump = () => { if (getSource(target) !== null) cockpit.jump(`/network#/${getSource(target)}`) }
                        networkId++;

                        return (<ListingRow columns={columns} navigateToItem={sourceJump} />);
                    })}
                </Listing>
            </div>
        );
    }
}

VmNetworkTab.propTypes = {
    vm: React.PropTypes.object.isRequired,
};

export default VmNetworkTab;
