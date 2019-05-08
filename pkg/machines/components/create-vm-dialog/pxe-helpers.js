/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import * as Select from 'cockpit-components-select.jsx';

const _ = cockpit.gettext;

/*
 * Removes the virbr*-nic libvirt devices from a given Network Node Devices array
 * @param {array} netNodeDevices - An array of object containing NetNodeDevices.
 * @param {array} virtualNetworks - An array of object containing Virtual Networks.
 */
function filterVirtualBridgesFromNetNodeDevices(netNodeDevices, virtualNetworks) {
    /* Do not show to the user the libvirt virbrX-nic devices since these are
     * supposed to be managed through virtual networks
     */
    const libvirtVirBridges = getLibvirtNetworkBridges(virtualNetworks);

    return netNodeDevices.filter(netNodeDevice => {
        if (!netNodeDevice.capability.interface.endsWith('-nic'))
            return true;

        for (let i in libvirtVirBridges) {
            if (netNodeDevice.capability.interface == (libvirtVirBridges[i] + '-nic'))
                return false;
        }
        return true;
    });
}

/**
 * Returns a list of all virbrX Virtual Networks.
 * @param {array} virtualNetworks - An array of object containing Virtual Networks.
 */
function getLibvirtNetworkBridges(virtualNetworks) {
    return virtualNetworks
            .filter(network => network.bridge)
            .map(network => network.bridge.name);
}

/**
 * Filters an array of node devices returning only devices of specific capability.
 * @param {array} nodeDevices - An array of object containing NodeDevices.
 * @param {string} type - The capability type, ex 'net'.
 */
function getNodeDevicesOfType(nodeDevices, type) {
    return nodeDevices.filter(nodeDevice => nodeDevice.capability.type == type);
}

/**
 * Return the Virtual Network matching a name from a Virtual Networks list.
 * @param {string} virtualNetworkName.
 * @param {array} virtualNetworks - An array of object containing Virtual Networks.
 */
export function getVirtualNetworkByName(virtualNetworkName, virtualNetworks) {
    return virtualNetworks.filter(virtualNetwork => virtualNetwork.name == virtualNetworkName)[0];
}

/**
 * Return a short description of the Virtual Network.
 * @param {object} virtualNetwork - A Virtual Network object.
 */
function getVirtualNetworkDescription(virtualNetwork) {
    let mode, dev;
    let forward = virtualNetwork.forward;

    if (forward) {
        mode = forward.mode;
        dev = forward.interface && forward.interface.dev;
    }

    if (mode || dev) {
        if (!mode || mode == 'nat') {
            if (dev)
                return cockpit.format(_("NAT to $0"), dev);
            else
                return 'NAT';
        } else if (mode == 'route') {
            if (dev)
                return cockpit.format(_("Route to $0"), dev);
            else
                return _("Routed Network");
        } else {
            if (dev)
                return cockpit.format('$0 to $1', mode, dev);
            else
                return cockpit.format(_("$0 Network"), mode.toUpperCase());
        }
    } else {
        return _("Isolated Network");
    }
}

/**
 * @param {array} nodeDevices - An array of object containing NodeDevices.
 * @param {object} virtualNetwork - A Virtual Network object.
 */
export function getVirtualNetworkPXESupport(virtualNetwork) {
    if (virtualNetwork.forward && virtualNetwork.forward.mode != 'nat') {
        return true;
    }

    return !!virtualNetwork.ip.find(ip => ip.dhcp.bootp);
}

/**
 * Returns the first available Network Resource to be used for showing to PXE Network Sources list.
 * @param {array} nodeDevices - An array of object containing NodeDevices.
 * @param {array} virtualNetworks - An array of object containing Virtual Networks.
 */
export function getPXEInitialNetworkSource(nodeDevices, virtualNetworks) {
    if (virtualNetworks.length > 0)
        return cockpit.format('network=$0', virtualNetworks[0].name);

    let netNodeDevices = filterVirtualBridgesFromNetNodeDevices(
        getNodeDevicesOfType(nodeDevices, 'net'),
        virtualNetworks
    );

    if (netNodeDevices.length > 0)
        return cockpit.format('type=direct,source=$0', netNodeDevices[0].capability.interface);
}

/**
 * Returns the Select Entries rows for the PXE Network Sources.
 * @param {array} nodeDevices - An array of object containing NodeDevices.
 * @param {array} virtualNetworks - An array of object containing Virtual Networks.
 */
export function getPXENetworkRows(nodeDevices, virtualNetworks) {
    /* Do not show to the user the libvirt virbrX-nic devices since these are
     * supposed to be managed through virtual networks
     */
    let netNodeDevices = filterVirtualBridgesFromNetNodeDevices(
        getNodeDevicesOfType(nodeDevices, 'net'),
        virtualNetworks
    );

    let virtualNetworkRows = virtualNetworks.map(network => {
        const data = cockpit.format('network=$0', network.name);

        return (
            <Select.SelectEntry data={data} key={data}>
                {cockpit.format("$0 $1: $2", _("Virtual Network"), network.name, getVirtualNetworkDescription(network))}
            </Select.SelectEntry>
        );
    });

    let netNodeDevicesRows = netNodeDevices.map(netNodeDevice => {
        const iface = netNodeDevice.capability.interface;
        const data = cockpit.format('type=direct,source=$0', iface);

        return (
            <Select.SelectEntry data={data} key={data}>
                {cockpit.format("$0 $1: macvtap", _("Host Device"), iface)}
            </Select.SelectEntry>
        );
    });

    if (virtualNetworkRows.length == 0 && netNodeDevicesRows.length == 0)
        return ([
            <Select.SelectEntry disabled data='no-resource' key='no-resource'>
                {_("No networks available")}
            </Select.SelectEntry>
        ]);

    return [virtualNetworkRows, netNodeDevicesRows];
}
