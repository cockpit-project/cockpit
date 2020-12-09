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
import React from "react";
import cockpit from 'cockpit';
import { vmId } from '../../../helpers.js';

import { Button } from '@patternfly/react-core';

import './consoles.css';

const _ = cockpit.gettext;

function fmt_to_fragments(fmt) {
    const args = Array.prototype.slice.call(arguments, 1);

    function replace(part) {
        if (part[0] == "$") {
            return args[parseInt(part.slice(1))];
        } else
            return part;
    }

    return React.createElement.apply(null, [React.Fragment, { }].concat(fmt.split(/(\$[0-9]+)/g).map(replace)));
}

const MoreInformationInstallVariant = ({ os, command, innerHtml }) => {
    return (
        <li className='machines-desktop-install-instructs-item'>
            <div className='machines-desktop-install-instructs-row'>
                <b>{os}:</b>&nbsp;
                {innerHtml && <div>{innerHtml}</div>}
                {!innerHtml && <div className='machines-desktop-shell-command'>{command}</div>}
            </div>
        </li>

    );
};

const MoreInformationContent = () => {
    const msg1 = fmt_to_fragments(_("Clicking \"Launch Remote Viewer\" will download a .vv file and launch $0."), <i>Remote Viewer</i>);

    const msg2 = fmt_to_fragments(_("$0 is available for most operating systems. To install it, search for it in GNOME Software or run the following:"), <i>Remote Viewer</i>);

    const downloadMsg = fmt_to_fragments(_("Download the MSI from $0"), <a href="https://virt-manager.org/download/" rel="noopener noreferrer" target="_blank">virt-manager.org</a>);

    return (
        <div>
            <p className='machines-desktop-more-info-text'>{msg1}</p>
            <p className='machines-desktop-more-info-text'>{msg2}</p>

            <ul className='machines-desktop-install-instructs'>
                <MoreInformationInstallVariant os='RHEL, CentOS' command='sudo yum install virt-viewer' />
                <MoreInformationInstallVariant os='Fedora' command='sudo dnf install virt-viewer' />
                <MoreInformationInstallVariant os='Ubuntu, Debian' command='sudo apt-get install virt-viewer' />
                <MoreInformationInstallVariant os='Windows' innerHtml={downloadMsg} />
            </ul>
        </div>
    );
};

class MoreInformation extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            expanded: false,
        };

        this.onClick = this.onClick.bind(this);
        this.getContent = this.getContent.bind(this);
    }

    onClick() {
        this.setState({
            expanded: !this.state.expanded,
        });
    }

    getContent() {
        return <MoreInformationContent />;
    }

    render() {
        if (!this.state.expanded) {
            return (
                <button className="link-button" onClick={this.onClick}>
                    <span className='fa fa-angle-right' />&nbsp;
                    {_("More information")}
                </button>);
        }

        return (
            <div className='machines-desktop-more-info-container'>
                <button className="link-button" onClick={this.onClick}>
                    <span className='fa fa-angle-down' />&nbsp;
                    {_("More information")}
                </button>
                {this.getContent()}
            </div>);
    }
}

const ConnectWithRemoteViewer = ({ vm, config, onDesktopConsole }) => {
    let display = vm.displays.spice;
    if (!display) {
        display = vm.displays.vnc;
    }
    const onLaunch = () => onDesktopConsole(display);

    return (
        <div className='machines-desktop-main-col'>
            <Button variant="secondary" onClick={onLaunch} id={`${vmId(vm.name)}-consoles-launch`}>
                {_("Launch Remote Viewer")}
            </Button>
            <div className='machines-desktop-viewer-block'>
                <MoreInformation vm={vm} config={config} />
            </div>
        </div>
    );
};

const ManualConnectionDetails = ({ displays, idPrefix }) => {
    const spiceAddress = displays.spice && displays.spice.address;
    const spicePort = displays.spice && displays.spice.port;
    const spiceTlsPort = displays.spice && displays.spice.tlsPort;
    const vncPort = displays.vnc && displays.vnc.port;
    const vncTlsPort = displays.vnc && displays.vnc.tlsPort;
    const vncAddress = displays.vnc && displays.vnc.address;

    // deduplicate the address if possible
    const singleAddress = vncAddress && spiceAddress
        ? (vncAddress === spiceAddress && vncAddress)
        : (spiceAddress || vncAddress);

    return (
        <dl className='machines-desktop-manual-con-details'>
            {singleAddress && (<dt>{_("Address:")}</dt>)}
            {singleAddress && (<dd id={`${idPrefix}-address`}>{singleAddress}</dd>)}

            {(!singleAddress && spiceAddress) && (<dt>{_("SPICE address:")}</dt>)}
            {(!singleAddress && spiceAddress) && (<dd id={`${idPrefix}-address-spice`}>{spiceAddress}</dd>)}

            {(!singleAddress && vncAddress) && (<dt>{_("VNC address:")}</dt>)}
            {(!singleAddress && vncAddress) && (<dd id={`${idPrefix}-address-vnc`}>{vncAddress}</dd>)}

            {spicePort && (<dt>{_("SPICE port:")}</dt>)}
            {spicePort && (<dd id={`${idPrefix}-port-spice`}>{spicePort}</dd>)}

            {spiceTlsPort && (<dt>{_("SPICE TLS port:")}</dt>)}
            {spiceTlsPort && (<dd id={`${idPrefix}-port-spice-tls`}>{spiceTlsPort}</dd>)}

            {vncPort && (<dt>{_("VNC port:")}</dt>)}
            {vncPort && (<dd id={`${idPrefix}-port-vnc`}>{vncPort}</dd>)}

            {vncTlsPort && (<dt>{_("VNC TLS port:")}</dt>)}
            {vncTlsPort && (<dd id={`${idPrefix}-port-vnc-tls`}>{vncTlsPort}</dd>)}
        </dl>
    );
};

const ManualConnection = ({ displays, idPrefix }) => {
    const isVNC = !!displays.vnc;
    const isSPICE = !!displays.spice;

    if (!isVNC && !isSPICE) {
        return null;
    }

    let msg = _("Connect with any SPICE or VNC viewer application.");
    if (!isVNC || !isSPICE) {
        const protocol = isVNC ? _("VNC") : _("SPICE");
        msg = cockpit.format(_("Connect with any $0 viewer application."), protocol);
    }

    return (
        <div className='machines-desktop-main-col'>
            <h2>{_("Manual connection")}</h2>
            <div className='machines-desktop-manual-block'>{msg}</div>
            <div className='machines-desktop-manual-block'>
                <ManualConnectionDetails displays={displays} idPrefix={idPrefix} />
            </div>
        </div>
    );
};

const DesktopConsoleDownload = ({ vm, onDesktopConsole, config }) => {
    return (
        <div className="manual-connection">
            <div className='machines-desktop-main'>
                <ConnectWithRemoteViewer config={config} vm={vm} onDesktopConsole={onDesktopConsole} />
                <ManualConnection displays={vm.displays} idPrefix={`${vmId(vm.name)}-consoles-manual`} />
            </div>
        </div>
    );
};

export default DesktopConsoleDownload;
