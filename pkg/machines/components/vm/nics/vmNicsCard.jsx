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
import { Button } from '@patternfly/react-core';

import cockpit from 'cockpit';
import { changeNetworkState, getVm } from "../../../actions/provider-actions.js";
import { rephraseUI, vmId } from "../../../helpers.js";
import AddNIC from './nicAdd.jsx';
import { EditNICModal } from './nicEdit.jsx';
import WarningInactive from '../../common/warningInactive.jsx';
import './nic.css';
import { detachIface, vmInterfaceAddresses } from '../../../libvirt-dbus.js';
import { ListingTable } from "cockpit-components-table.jsx";
import { DeleteResourceButton, DeleteResourceModal } from '../../common/deleteResource.jsx';

const _ = cockpit.gettext;

const getNetworkDevices = (updateState) => {
    cockpit.spawn(["find", "/sys/class/net", "-type", "l", "-printf", '%f\n'], { err: "message" })
            .then(output => {
                const devs = output.trim().split('\n');
                updateState(devs);
            })
            .catch(e => console.warn("could not read /sys/class/net:", e.toString()));
};

export class VmNetworkActions extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            showAddNICModal: false,
            networkDevices: undefined,
        };

        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
    }

    close() {
        this.setState({ showAddNICModal: false });
    }

    open() {
        this.setState({ showAddNICModal: true });
    }

    componentDidMount() {
        // only consider symlinks -- there might be other stuff like "bonding_masters" which we don't want
        getNetworkDevices(devs => this.setState({ networkDevices: devs }));
    }

    render() {
        const { vm, dispatch, networks } = this.props;
        const id = vmId(vm.name);
        const availableSources = {
            network: networks.map(network => network.name),
            device: this.state.networkDevices,
        };
        return (<>
            {this.state.showAddNICModal && this.state.networkDevices !== undefined &&
                <AddNIC dispatch={dispatch}
                    idPrefix={`${id}-add-iface`}
                    vm={vm}
                    availableSources={availableSources}
                    close={this.close} />}
            <Button id={`${id}-add-iface-button`} variant="secondary" onClick={this.open}>
                {_("Add network interface")}
            </Button>
        </>);
    }
}

VmNetworkActions.propTypes = {
    vm: PropTypes.object.isRequired,
    networks: PropTypes.array.isRequired,
    dispatch: PropTypes.func.isRequired,
};

export class VmNetworkTab extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            interfaceAddress: [],
            networkDevices: undefined,
        };

        this.deviceProxyHandler = this.deviceProxyHandler.bind(this);
        this.client = cockpit.dbus("org.freedesktop.NetworkManager", {});
        this.hostDevices = this.client.proxies("org.freedesktop.NetworkManager.Device");
        this.hostDevices.addEventListener('changed', this.deviceProxyHandler);
        this.hostDevices.addEventListener('removed', this.deviceProxyHandler);
    }

    deviceProxyHandler() {
        this.forceUpdate();
    }

    componentDidMount() {
        // only consider symlinks -- there might be other stuff like "bonding_masters" which we don't want
        getNetworkDevices(devs => this.setState({ networkDevices: devs }));

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

    componentWillUnmount() {
        this.client.close();
    }

    render() {
        const { vm, dispatch, networks, onAddErrorNotification } = this.props;
        const id = vmId(vm.name);
        const availableSources = {
            network: networks.map(network => network.name),
            device: this.state.networkDevices,
        };

        const nicLookupByMAC = (interfacesList, mac) => {
            return interfacesList.filter(iface => iface.mac == mac)[0];
        };

        const checkDeviceAviability = (network) => {
            for (const i in this.hostDevices) {
                if (this.hostDevices[i].valid && this.hostDevices[i].Interface == network) {
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
            { name: _("MAC address"), value: 'mac' },
            {
                name: _("IP address"), value: (network) => {
                    const iface = this.state.interfaceAddress.find(iface => iface[1] == network.mac);
                    const ips = (iface && iface[2]) ? iface[2] : undefined;

                    if (!ips) {
                    // There is not IP address associated with this NIC
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
                    const sourceElem = source => checkDeviceAviability(source) ? <button role="link" className='machines-network-source-link link-button' onClick={sourceJump(source)}>{source}</button> : source;
                    const mapSource = {
                        direct: (source) => sourceElem(source.dev),
                        network: (source) => sourceElem(source.network),
                        bridge: (source) => sourceElem(source.bridge),
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
                    const editNICAction = () => {
                        const editNICDialogProps = {
                            dispatch,
                            idPrefix: `${id}-network-${networkId}`,
                            vm,
                            network,
                            availableSources,
                            onClose: () => this.setState({ editNICDialogProps: undefined }),
                        };
                        if (vm.persistent && this.state.networkDevices !== undefined) {
                            return (
                                <Button id={`${editNICDialogProps.idPrefix}-edit-dialog`} variant='secondary'
                                        onClick={() => this.setState({ editNICDialogProps })}>
                                    {_("Edit")}
                                </Button>
                            );
                        }
                    };

                    const deleteDialogProps = {
                        objectType: "Network Interface",
                        objectName: network.mac,
                        onClose: () => this.setState({ deleteDialogProps: undefined }),
                        deleteHandler: () => detachIface(network.mac, vm.connectionName, vm.id, vm.state === 'running', vm.persistent, dispatch),
                    };
                    const deleteNICAction = (
                        <DeleteResourceButton objectId={`${id}-iface-${networkId}`}
                                              disabled={vm.state != 'shut off' && vm.state != 'running'}
                                              showDialog={() => this.setState({ deleteDialogProps })}
                                              overlayText={_("The VM needs to be running or shut off to detach this device")} />
                    );

                    return (
                        <div className='machines-listing-actions'>
                            {deleteNICAction}
                            <button className='pf-c-button pf-m-secondary' onClick={onChangeState(network)} title={`${isUp ? _("Unplug") : _("Plug")}`}>
                                {isUp ? 'Unplug' : 'Plug'}
                            </button>
                            {editNICAction()}
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
            return { columns, props: { key: cockpit.format("$0-$1-$2", target.mac, target.address.bus || networkId, target.address.slot || '') } };
        });

        return (
            <>
                {this.state.deleteDialogProps && <DeleteResourceModal {...this.state.deleteDialogProps} />}
                {this.state.editNICDialogProps && <EditNICModal {...this.state.editNICDialogProps } />}
                <ListingTable aria-label={`VM ${vm.name} Network Interface Cards`}
                    gridBreakPoint='grid-xl'
                    variant='compact'
                    emptyCaption={_("No network interfaces defined for this VM")}
                    columns={columnTitles}
                    rows={rows} />
            </>
        );
    }
}

VmNetworkTab.propTypes = {
    vm: PropTypes.object.isRequired,
    networks: PropTypes.array.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
};
