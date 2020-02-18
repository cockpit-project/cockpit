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
import moment from "moment";

import React from 'react';
import ReactDOM from 'react-dom';
import {
    Page, PageSection, PageSectionVariants,
    Gallery,
    Dropdown, DropdownItem, DropdownToggle, DropdownToggleAction,
} from '@patternfly/react-core';

import { shutdown, shutdown_modal_setup } from "./shutdown.js";

import { Privileged } from "cockpit-components-privileged.jsx";
import { SystemInfomationCard } from './overview-cards/systemInformationCard.jsx';
import { ConfigurationCard } from './overview-cards/configurationCard.jsx';
import { HealthCard } from './overview-cards/healthCard.jsx';
import { MotdCard } from './overview-cards/motdCard.jsx';
import { UsageCard } from './overview-cards/usageCard.jsx';
import { ServerTime } from './overview-cards/serverTime.js';
import { SuperuserAlert } from './superuser-alert.jsx';
import { SuperuserIndicator } from "../shell/superuser.jsx";

const _ = cockpit.gettext;

class OverviewPage extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            actionIsOpen: false,
            privileged: true,
        };
        this.hostnameMonitor = this.hostnameMonitor.bind(this);
        this.permission = cockpit.permission({ admin: true });
        this.onPermissionChanged = this.onPermissionChanged.bind(this);
    }

    componentDidMount() {
        this.hostnameMonitor();
        shutdown_modal_setup();
        this.permission.addEventListener("changed", this.onPermissionChanged);
        this.onPermissionChanged();
    }

    componentWillUnmount() {
        this.permission.removeEventListener("changed", this.onPermissionChanged);
    }

    onPermissionChanged() {
        // default to allowed while not yet initialized
        this.setState({ privileged: this.permission.allowed !== false });
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
        const { actionIsOpen } = this.state;
        const dropdownItems = [
            <DropdownItem key="restart" id="restart" onClick={() => shutdown('restart', new ServerTime())} component="button">
                {_("Restart")}
            </DropdownItem>,
            <DropdownItem key="shutdown" id="shutdown" onClick={() => shutdown('shutdown', new ServerTime())} component="button">
                {_("Shutdown")}
            </DropdownItem>,
        ];

        const headerActions = (
            <Privileged allowed={ this.state.privileged } placement="bottom"
                        excuse={ cockpit.format(_("The user $0 is not permitted to shutdown or restart this server"),
                                                this.permission.user ? this.permission.user.name : '') }>
                <Dropdown
                    onSelect={() => this.setState({ actionIsOpen: true })}
                    toggle={
                        <DropdownToggle
                            splitButtonItems={[
                                <DropdownToggleAction id='restart-button' variant="secondary"
                                    key='restart-button'
                                    onClick={() => shutdown('restart', new ServerTime())}
                                    data-stable={ (this.permission.allowed !== null) ? "yes" : undefined }
                                    isDisabled={ !this.state.privileged }>
                                    {_("Restart")}
                                </DropdownToggleAction>
                            ]}
                            splitButtonVariant="action"
                            onToggle={isOpen => this.setState({ actionIsOpen: isOpen })}
                            isDisabled={ !this.state.privileged }
                            data-stable={ (this.permission.allowed !== null) ? "yes" : undefined }
                            id="shutdown-group"
                        />
                    }
                    isOpen={actionIsOpen}
                    dropdownItems={dropdownItems}
                />
            </Privileged>);

        const show_superuser = (
            cockpit.transport.host && cockpit.transport.host != "localhost" &&
            !(window.parent.name == "cockpit1" && window.parent.features &&
              window.parent.features.navbar_is_for_current_machine));

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
                        { show_superuser && <SuperuserIndicator /> }
                        { "\n" }
                        { headerActions }
                    </div>
                </PageSection>
                <PageSection variant={PageSectionVariants.default}>
                    <SuperuserAlert />
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
    moment.locale(cockpit.language);
    ReactDOM.render(<OverviewPage />, document.getElementById("overview"));
}

document.addEventListener("DOMContentLoaded", init);
