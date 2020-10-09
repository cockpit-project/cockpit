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
import PropTypes from 'prop-types';
import {
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
    Flex, FlexItem,
    Text, TextVariants,
} from '@patternfly/react-core';
import cockpit from 'cockpit';

import { networkId } from '../../helpers.js';
import { changeNetworkAutostart } from '../../libvirt-dbus.js';

import '../overviewTab.css';

const _ = cockpit.gettext;

const DHCPHost = (host, index, family, idPrefix) => {
    const id = `${idPrefix}-${family}-dhcp-host-${index}`;

    const hostVals = [];
    if (host.name)
        hostVals.push(_("Name: ") + host.name);
    if (host.mac) // MAC for ipv4, ID for ipv6
        hostVals.push("MAC: " + host.mac);
    else if (host.id)
        hostVals.push("ID: " + host.id);
    if (host.ip)
        hostVals.push("IP: " + host.ip);

    const hostInfo = hostVals.join(", ");

    return (<React.Fragment key={index}>
        <label className='control-label' htmlFor={id}> {`DHCP Host ${index + 1}`} </label>
        <div id={id}> {hostInfo} </div>
    </React.Fragment>);
};

export class NetworkOverviewTab extends React.Component {
    constructor(props) {
        super(props);

        this.onAutostartChanged = this.onAutostartChanged.bind(this);
    }

    onAutostartChanged() {
        const { dispatch, network } = this.props;
        const autostart = !network.autostart;

        changeNetworkAutostart(network, autostart, dispatch);
    }

    render() {
        const network = this.props.network;
        const idPrefix = `${networkId(network.name, network.connectionName)}`;

        const ip = [];
        // Libvirt allows network to have multiple ipv6 and ipv4 addresses.
        // But we only first one of each
        ip[0] = network.ip.find(ip => ip.family === "ipv4");
        ip[1] = network.ip.find(ip => ip.family === "ipv6");

        return (
            <Flex className="overview-tab">
                <FlexItem>
                    <DescriptionList>
                        <Text component={TextVariants.h4}>
                            {_("General")}
                        </Text>

                        <DescriptionListGroup>
                            <DescriptionListTerm> {_("Persistent")} </DescriptionListTerm>
                            <DescriptionListDescription id={`${idPrefix}-persistent`}> {network.persistent ? _("yes") : _("no")} </DescriptionListDescription>
                        </DescriptionListGroup>

                        {network.persistent && <DescriptionListGroup>
                            <DescriptionListTerm> {_("Autostart")} </DescriptionListTerm>
                            <DescriptionListDescription>
                                <div className='checkbox-inline'>
                                    <input id={`${idPrefix}-autostart-checkbox`}
                                           type="checkbox"
                                           checked={network.autostart}
                                           onChange={this.onAutostartChanged} />
                                    {_("Run when host boots")}
                                </div>
                            </DescriptionListDescription>
                        </DescriptionListGroup>}

                        { network.mtu && <DescriptionListGroup>
                            <DescriptionListTerm> {_("Maximum transmission unit")} </DescriptionListTerm>
                            <DescriptionListDescription id={`${idPrefix}-mtu`}> {network.mtu} </DescriptionListDescription>
                        </DescriptionListGroup> }
                    </DescriptionList>
                </FlexItem>

                { ip[0] && <FlexItem>
                    <DescriptionList>
                        <Text component={TextVariants.h4}>
                            {_("IPv4 address")}
                        </Text>

                        { ip[0].address && <DescriptionListGroup>
                            <DescriptionListTerm> {_("Address")} </DescriptionListTerm>
                            <DescriptionListDescription id={`${idPrefix}-ipv4-address`}> {ip[0].address} </DescriptionListDescription>
                        </DescriptionListGroup> }

                        { ip[0].netmask && <DescriptionListGroup>
                            <DescriptionListTerm> {_("Netmask")} </DescriptionListTerm>
                            <DescriptionListDescription id={`${idPrefix}-ipv4-netmask`}> {ip[0].netmask} </DescriptionListDescription>
                        </DescriptionListGroup> }

                        { ip[0].dhcp.range.start && <DescriptionListGroup>
                            <DescriptionListTerm> {_("DHCP range")} </DescriptionListTerm>
                            <DescriptionListDescription id={`${idPrefix}-ipv4-dhcp-range`}> {ip[0].dhcp.range.start + " - " + ip[0].dhcp.range.end} </DescriptionListDescription>
                        </DescriptionListGroup> }

                        { ip[0].dhcp.hosts.map((host, index) => DHCPHost(host, index, ip[0].family, idPrefix))}
                    </DescriptionList>
                </FlexItem>}

                { ip[1] && <FlexItem>
                    <DescriptionList>
                        <Text component={TextVariants.h4}>
                            {_("IPv6 address")}
                        </Text>

                        { ip[1].address && <DescriptionListGroup>
                            <DescriptionListTerm> {_("Address")} </DescriptionListTerm>
                            <DescriptionListDescription id={`${idPrefix}-ipv6-address`}> {ip[1].address} </DescriptionListDescription>
                        </DescriptionListGroup> }

                        { ip[1].prefix && <DescriptionListGroup>
                            <DescriptionListTerm> {_("Prefix")} </DescriptionListTerm>
                            <DescriptionListDescription id={`${idPrefix}-ipv6-prefix`}> {ip[1].prefix} </DescriptionListDescription>
                        </DescriptionListGroup> }

                        { ip[1].dhcp.range.start && <DescriptionListGroup>
                            <DescriptionListTerm> {_("DHCP range")} </DescriptionListTerm>
                            <DescriptionListDescription id={`${idPrefix}-ipv6-dhcp-range`}> {ip[1].dhcp.range.start + " - " + ip[1].dhcp.range.end} </DescriptionListDescription>
                        </DescriptionListGroup> }

                        { ip[1].dhcp.hosts.map((host, index) => DHCPHost(host, index, ip[1].family, idPrefix))}
                    </DescriptionList>
                </FlexItem>}
            </Flex>
        );
    }
}

NetworkOverviewTab.propTypes = {
    dispatch: PropTypes.func.isRequired,
    network: PropTypes.object.isRequired,
};
