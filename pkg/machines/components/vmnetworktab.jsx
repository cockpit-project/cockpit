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
import { changeNetworkState, getVm } from "../actions/provider-actions.js";
import { rephraseUI, vmId } from "../helpers.js";
import AddNICAction from './nicAdd.jsx';
import EditNICAction from './nicEdit.jsx';
import WarningInactive from './warningInactive.jsx';
import './nic.css';
import { detachIface, vmInterfaceAddresses } from '../libvirt-dbus.js';
import { ListingTable } from "cockpit-components-table.jsx";
import { DeleteResource } from './deleteResource.jsx';

const _ = cockpit.gettext;

class VmNetworkTab extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            interfaceAddress: [],
        };
    }

    componentDidMount() {
        if (this.props.config.provider.name != 'LibvirtDBus')
            return;

        if (this.props.vm.state != 'running' && this.props.vm.state != 'paused')
            return;

        // Load the interface addresses list when the tab mounts
        vmInterfaceAddresses(this.props.vm.connectionName, this.props.vm.id)
                .then(ifaces => {
                    this.setState({ interfaceAddress: ifaces[0] });
                }, ex => {
                    this.props.onAddErrorNotification({
                        text: cockpit.format(_("Failed to fetch the IP addresses of the interfaces present in $0"), this.props.vm.name),
                        detail: ex.message, resourceId: this.props.vm.id,
                    });
                });
    }

    render() {
        const { vm, dispatch, config, hostDevices, networks, nodeDevices, interfaces, onAddErrorNotification } = this.props;
        const id = vmId(vm.name);

        const nicLookupByMAC = (interfacesList, mac) => {
            return interfacesList.filter(iface => iface.mac == mac)[0];
        };

        const checkDeviceAviability = (network) => {
            for (const i in hostDevices) {
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
                    dispatch(changeNetworkState(vm, network.mac, network.state === 'up' ? 'down' : 'up'))
                            .catch(ex => {
                                onAddErrorNotification({
                                    text: cockpit.format(_("NIC $0 of VM $1 failed to change state"), network.mac, vm.name),
                                    detail: ex.message, resourceId: vm.id,
                                });
                            })
                            .then(() => dispatch(getVm({ connectionName: vm.connectionName, id:vm.id, name: vm.name })));
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
        let detailMap = [
            {
                name: _("Type"), value: (network, networkId) => {
                    const inactiveNIC = nicLookupByMAC(vm.inactiveXML.interfaces, network.mac);
                    return (
                        <div id={`${id}-network-${networkId}-type`}>
                            {network.type}
                            {inactiveNIC && inactiveNIC.type !== network.type && <WarningInactive iconId={`${id}-network-${networkId}-type-tooltip`} tooltipId="tip-network" />}
                        </div>
                    );
                }
            },
            {
                name: _("Model type"), value: (network, networkId) => {
                    const inactiveNIC = nicLookupByMAC(vm.inactiveXML.interfaces, network.mac);
                    return (
                        <div id={`${id}-network-${networkId}-model`}>
                            {network.model}
                            {inactiveNIC && inactiveNIC.model !== network.model && <WarningInactive iconId={`${id}-network-${networkId}-model-tooltip`} tooltipId="tip-network" />}
                        </div>
                    );
                }
            },
            { name: _("MAC Address"), value: 'mac' },
            {
                name: _("IP Address"), hidden: config.provider.name != 'LibvirtDBus', value: (network) => {
                    const iface = this.state.interfaceAddress.find(iface => iface[1] == network.mac);
                    const ips = (iface && iface[2]) ? iface[2] : undefined;

                    if (!ips) {
                    // There is not IP address assosiated with this NIC
                        return _("Unknown");
                    } else {
                        return (
                            <div id={`${id}-network-${networkId}-ipaddress`}>
                                { ips.map(ip => cockpit.format("$0/$1", ip[1], ip[2])).join(',') }
                            </div>
                        );
                    }
                }
            },
            {
                name: _("Source"), value: (network, networkId) => {
                    const setSourceClass = (source) => checkDeviceAviability(source) ? "machines-network-source-link link-button" : undefined;
                    const mapSource = {
                        direct: (source) => <button role="link" className={setSourceClass(source.dev)} onClick={sourceJump(source.dev)}>{source.dev}</button>,
                        network: (source) => <button role="link" className={setSourceClass(source.network)} onClick={sourceJump(source.network)}>{source.network}</button>,
                        bridge: (source) => <button role="link" className={setSourceClass(source.bridge)} onClick={sourceJump(source.bridge)}>{source.bridge}</button>,
                        mcast: addressPortSource,
                        server: addressPortSource,
                        client: addressPortSource,
                        udp: addressPortSource,
                    };
                    if (mapSource[network.type] !== undefined) {
                        const inactiveNIC = nicLookupByMAC(vm.inactiveXML.interfaces, network.mac);
                        return (
                            <div id={`${id}-network-${networkId}-source`}>
                                {mapSource[network.type](network.source, networkId)}
                                {inactiveNIC && inactiveNIC.source[inactiveNIC.type] !== network.source[network.type] && <WarningInactive iconId={`${id}-network-${networkId}-source-tooltip`} tooltipId="tip-network" />}

                            </div>
                        );
                    } else {
                        return null;
                    }
                }
            },
            {
                name: _("State"), value: (network, networkId) => {
                    return <span className='machines-network-state' id={`${id}-network-${networkId}-state`}>{rephraseUI('networkState', network.state)}</span>;
                }
            },
            {
                name: "", value: (network, networkId) => {
                    const isUp = network.state === 'up';
                    const editNICAction = (providerName) => {
                        if (providerName === "LibvirtDBus")
                            return <EditNICAction dispatch={dispatch}
                                   idPrefix={`${id}-network-${networkId}`}
                                   vm={vm}
                                   network={network}
                                   networks={networks}
                                   nodeDevices={nodeDevices}
                                   interfaces={interfaces} />;
                    };

                    const deleteNICAction = (providerName) => {
                        if (providerName === "LibvirtDBus")
                            return <DeleteResource objectType="Network Interface"
                                       objectName={network.mac}
                                       objectId={`${id}-iface-${networkId}`}
                                       disabled={vm.state != 'shut off'}
                                       overlayText={_("The VM needs to be running or shut off to detach this device")}
                                       deleteHandler={() => detachIface(network.mac, vm.connectionName, vm.id, vm.state === "running", dispatch)} />;
                    };

                    return (
                        <div className='machines-listing-actions'>
                            <button className='btn btn-default' onClick={onChangeState(network)} title={`${isUp ? _("Unplug") : _("Plug")}`}>
                                {isUp ? 'Unplug' : 'Plug'}
                            </button>
                            {editNICAction(config.provider.name)}
                            {deleteNICAction(config.provider.name)}
                        </div>
                    );
                }
            },
        ];

        let networkId = 1;
        detailMap = detailMap.filter(d => !d.hidden);

        const columnTitles = detailMap.map(target => target.name);
        const rows = vm.interfaces.sort().map(target => {
            const columns = detailMap.map(d => {
                let column = null;
                if (typeof d.value === 'string') {
                    if (target[d.value] !== undefined) {
                        column = { title: <div id={`${id}-network-${networkId}-${d.value}`}>{target[d.value]}</div> };
                    }
                }
                if (typeof d.value === 'function') {
                    column = { title: d.value(target, networkId, vm.connectionName) };
                }
                return column;
            });
            networkId++;
            return { columns };
        });

        return (
            <div className="machines-network-list">
                {(config.provider.name === "LibvirtDBus") &&
                <AddNICAction dispatch={dispatch}
                    idPrefix={`${id}-add-iface`}
                    vm={vm}
                    networks={networks}
                    provider={config.provider}
                    nodeDevices={nodeDevices}
                    interfaces={interfaces} />}
                <ListingTable aria-label={`VM ${vm.name} Network Interface Cards`}
                    variant='compact'
                    emptyCaption={_("No network interfaces defined for this VM")}
                    columns={columnTitles}
                    rows={rows} />
            </div>
        );
    }
}

VmNetworkTab.propTypes = {
    vm: PropTypes.object.isRequired,
    networks: PropTypes.array.isRequired,
    interfaces: PropTypes.array.isRequired,
    nodeDevices: PropTypes.array.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
};

export default VmNetworkTab;
