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

import 'polyfills.js';
import cockpit from "cockpit";
import $ from "jquery";

import React from 'react';
import ReactDOM from 'react-dom';
import {
    Page, PageSection, PageSectionVariants,
    Gallery, Button,
    Dropdown, DropdownItem, KebabToggle,
} from '@patternfly/react-core';

import { shutdown, shutdown_modal_setup } from "./shutdown.js";

import { SystemInfomationCard } from './overview-cards/systemInformationCard.jsx';
import { ConfigurationCard } from './overview-cards/configurationCard.jsx';
import { HealthCard } from './overview-cards/healthCard.jsx';
import { MotdCard } from './overview-cards/motdCard.jsx';
import { UsageCard } from './overview-cards/usageCard.jsx';
import { ServerTime } from './overview-cards/serverTime.js';

const _ = cockpit.gettext;
var permission = cockpit.permission({ admin: true });
permission.addEventListener("changed", update_shutdown_privileged);

function update_shutdown_privileged() {
    $(".shutdown-privileged").update_privileged(
        permission, cockpit.format(
            _("The user <b>$0</b> is not permitted to shutdown or restart this server"),
            permission.user ? permission.user.name : ''),
        'bottom'
    );
}

class OverviewPage extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            actionKebabIsOpen: false
        };
        this.onKebabToggle = actionKebabIsOpen => this.setState({ actionKebabIsOpen });
        this.onKebabSelect = event => this.setState({ actionKebabIsOpen: !this.state.actionKebabIsOpen });
        this.hostnameMonitor = this.hostnameMonitor.bind(this);
    }

    componentDidMount() {
        this.hostnameMonitor();
        shutdown_modal_setup();
    }

    hostname_text() {
        if (!this.state.hostnameData)
            return undefined;

        const pretty_hostname = this.state.hostnameData.PrettyHostname;
        const static_hostname = this.state.hostnameData.StaticHostname;
        let str = this.state.hostnameData.HostName;

        if (pretty_hostname && static_hostname && static_hostname != pretty_hostname)
            str = pretty_hostname + " (" + static_hostname + ")";
        else if (static_hostname)
            str = static_hostname;

        return str || '';
    }

    hostnameMonitor() {
        this.client = cockpit.dbus('org.freedesktop.hostname1',
                                   { superuser : "try" });
        this.hostname_proxy = this.client.proxy('org.freedesktop.hostname1',
                                                '/org/freedesktop/hostname1');
        this.hostname_proxy.addEventListener("changed", data => {
            this.setState({ hostnameData: data.detail });
        });
    }

    render() {
        const { actionKebabIsOpen } = this.state;
        const dropdownItems = [
            <DropdownItem key="shutdown" onClick={() => shutdown('shutdown', new ServerTime())} component="button">
                {_("Shutdown")}
            </DropdownItem>,
        ];
        return (
            <Page>
                <PageSection className='ct-overview-header' variant={PageSectionVariants.light}>
                    <div className='ct-overview-header-hostname'>
                        <h1>
                            {this.hostname_text() || ""}
                        </h1>
                        {this.state.hostnameData &&
                         this.state.hostnameData.OperatingSystemPrettyName &&
                         <div className="ct-overview-header-subheading" id="system_information_os_text">{cockpit.format(_("running $0"), this.state.hostnameData.OperatingSystemPrettyName)}</div>}
                    </div>
                    <div className='ct-overview-header-actions'>
                        <Button className="shutdown-privileged" id='restart-button' variant="secondary" onClick={() => shutdown('restart', new ServerTime())}>
                            {_("Restart")}
                        </Button>
                        <Dropdown
                            id="shutdown-group"
                            className="shutdown-privileged"
                            position="right"
                            onSelect={this.onKebabSelect}
                            toggle={<KebabToggle onToggle={this.onKebabToggle} />}
                            isOpen={actionKebabIsOpen}
                            isPlain
                            dropdownItems={dropdownItems}
                        />
                    </div>
                </PageSection>
                <PageSection variant={PageSectionVariants.default}>
                    <Gallery className='ct-system-overview' gutter="lg">
                        <MotdCard />
                        <HealthCard />
                        <UsageCard />
                        <SystemInfomationCard />
                        <ConfigurationCard hostname={this.hostname_text()} />
                    </Gallery>
                </PageSection>
            </Page>
        );
    }
}

function init() {
    cockpit.translate();
    ReactDOM.render(<OverviewPage />, document.getElementById("overview"));
}

document.addEventListener("DOMContentLoaded", init);
