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
import cockpit from 'cockpit';

import { networkId } from '../../helpers.js';
import { changeNetworkAutostart } from '../../libvirt-dbus.js';
import { ExpandableNotification } from '../notification/inlineNotification.jsx';

import './networkOverviewTab.css';
import 'form-layout.less';

const _ = cockpit.gettext;

const DHCPHost = (host, index, family, idPrefix) => {
    const id = `${idPrefix}-${family}-dhcp-host-${index}`;

    let hostVals = [];
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

        let ip = [];
        // Libvirt allows network to have multiple ipv6 and ipv4 addresses.
        // But we only first one of each
        ip[0] = network.ip.find(ip => ip.family === "ipv4");
        ip[1] = network.ip.find(ip => ip.family === "ipv6");

        const error = (this.props.actionError && <ExpandableNotification
                                                     type='warning'
                                                     text={this.props.actionError}
                                                     textId={`${idPrefix}-error`}
                                                     detail={this.props.actionErrorDetail}
                                                     onDismiss={this.props.onActionErrorDismiss} />
        );

        return (
            <React.Fragment>
                {error}
                <div className="networks-page-grid">
                    <div className='ct-form-layout'>
                        <label className='control-label label-title'> {_("General")} </label>
                        <span />

                        <label className='control-label' htmlFor={`${idPrefix}-persistent`}> {_("Persistent")} </label>
                        <div id={`${idPrefix}-persistent`}> {network.persistent ? _("yes") : _("no")} </div>

                        <label className='control-label' htmlFor={`${idPrefix}-autostart`}> {_("Autostart")} </label>
                        <label className='checkbox-inline'>
                            <input id={`${idPrefix}-autostart-checkbox`}
                                   type="checkbox"
                                   checked={network.autostart}
                                   onChange={this.onAutostartChanged} />
                            {_("Run when host boots")}
                        </label>

                        { network.mtu && <React.Fragment>
                            <label className='control-label' htmlFor={`${idPrefix}-mtu`}> {_("Maximum Transmission Unit")} </label>
                            <div id={`${idPrefix}-mtu`}> {network.mtu} </div>
                        </React.Fragment> }
                    </div>

                    <div className="ct-form-layout">
                        { ip[0] && <React.Fragment>
                            <label className='control-label label-title'> {_("IPv4 Address")} </label>
                            <span />

                            { ip[0].address && <React.Fragment>
                                <label className='control-label' htmlFor={`${idPrefix}-ipv4-address`}> {_("Address")} </label>
                                <div id={`${idPrefix}-ipv4-address`}> {ip[0].address} </div>
                            </React.Fragment> }

                            { ip[0].netmask && <React.Fragment>
                                <label className='control-label' htmlFor={`${idPrefix}-ipv4-netmask`}> {_("Netmask")} </label>
                                <div id={`${idPrefix}-ipv4-netmask`}> {ip[0].netmask} </div>
                            </React.Fragment> }

                            { ip[0].dhcp.range.start && <React.Fragment>
                                <label className='control-label' htmlFor={`${idPrefix}-ipv4-dhcp-range`}> {_("DHCP Range")} </label>
                                <div id={`${idPrefix}-ipv4-dhcp-range`}> {ip[0].dhcp.range.start + " - " + ip[0].dhcp.range.end} </div>
                            </React.Fragment> }

                            { ip[0].dhcp.hosts.map((host, index) => DHCPHost(host, index, ip[0].family, idPrefix))}
                        </React.Fragment> }

                        { ip[1] && <React.Fragment>
                            <hr />
                            <label className='control-label label-title'> {_("IPv6 Address")} </label>
                            <span />

                            { ip[1].address && <React.Fragment>
                                <label className='control-label' htmlFor={`${idPrefix}-ipv6-address`}> {_("Address")} </label>
                                <div id={`${idPrefix}-ipv6-address`}> {ip[1].address} </div>
                            </React.Fragment> }

                            { ip[1].prefix && <React.Fragment>
                                <label className='control-label' htmlFor={`${idPrefix}-ipv6-prefix`}> {_("Prefix")} </label>
                                <div id={`${idPrefix}-ipv6-prefix`}> {ip[1].prefix} </div>
                            </React.Fragment> }

                            { ip[1].dhcp.range.start && <React.Fragment>
                                <label className='control-label' htmlFor={`${idPrefix}-ipv6-dhcp-range`}> {_("DHCP Range")} </label>
                                <div id={`${idPrefix}-ipv6-dhcp-range`}> {ip[1].dhcp.range.start + " - " + ip[1].dhcp.range.end} </div>
                            </React.Fragment> }

                            { ip[1].dhcp.hosts.map((host, index) => DHCPHost(host, index, ip[1].family, idPrefix))}
                        </React.Fragment> }
                    </div>
                </div>
            </React.Fragment>
        );
    }
}

NetworkOverviewTab.propTypes = {
    dispatch: PropTypes.func.isRequired,
    network: PropTypes.object.isRequired,
    actionError: PropTypes.string,
    actionErrorDetail: PropTypes.string,
    onActionErrorDismiss: PropTypes.func,
};
