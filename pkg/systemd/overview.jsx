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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import 'polyfills';
import cockpit from "cockpit";

import React from 'react';
import ReactDOM from 'react-dom';
import {
    Page, PageSection, PageSectionVariants,
    Gallery,
    Dropdown, DropdownItem, DropdownToggle, DropdownToggleAction,
} from '@patternfly/react-core';

import { superuser } from "superuser";

import { SystemInfomationCard } from './overview-cards/systemInformationCard.jsx';
import { ConfigurationCard } from './overview-cards/configurationCard.jsx';
import { HealthCard } from './overview-cards/healthCard.jsx';
import { MotdCard } from './overview-cards/motdCard.jsx';
import { UsageCard } from './overview-cards/usageCard.jsx';
import { SuperuserAlert } from './superuser-alert.jsx';
import { SuperuserIndicator } from "../shell/superuser.jsx";
import { ShutdownModal } from 'cockpit-components-shutdown.jsx';

const _ = cockpit.gettext;

class OverviewPage extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            actionIsOpen: false,
            privileged: true,
        };
        this.hostnameMonitor = this.hostnameMonitor.bind(this);
        this.onPermissionChanged = this.onPermissionChanged.bind(this);
    }

    componentDidMount() {
        this.hostnameMonitor();
        superuser.addEventListener("changed", this.onPermissionChanged);
        this.onPermissionChanged();
    }

    componentWillUnmount() {
        superuser.removeEventListener("changed", this.onPermissionChanged);
    }

    onPermissionChanged() {
        this.setState({ privileged: superuser.allowed });
    }

    hostname_text() {
        if (!this.state.hostnameData)
            return undefined;

        const pretty_hostname = this.state.hostnameData.PrettyHostname;
        const static_hostname = this.state.hostnameData.StaticHostname;
        let str = this.state.hostnameData.Hostname;

        if (pretty_hostname && static_hostname && static_hostname != pretty_hostname)
            str = pretty_hostname + " (" + static_hostname + ")";
        else if (static_hostname)
            str = static_hostname;

        return str || '';
    }

    hostnameMonitor() {
        this.client = cockpit.dbus('org.freedesktop.hostname1');
        this.hostname_proxy = this.client.proxy('org.freedesktop.hostname1',
                                                '/org/freedesktop/hostname1');
        this.hostname_proxy.addEventListener("changed", data => {
            this.setState({ hostnameData: data.detail });
        });
    }

    render() {
        const { actionIsOpen } = this.state;
        const dropdownItems = [
            <DropdownItem key="reboot" id="reboot" onClick={() => this.setState({ rebootModal: true })} component="button">
                {_("Reboot")}
            </DropdownItem>,
            <DropdownItem key="shutdown" id="shutdown" onClick={() => this.setState({ shutdownModal: true })} component="button">
                {_("Shutdown")}
            </DropdownItem>,
        ];

        let headerActions = null;
        if (this.state.privileged)
            headerActions = (
                <Dropdown onSelect={() => this.setState({ actionIsOpen: true })}
                          toggle={
                              <DropdownToggle
                            splitButtonItems={[
                                <DropdownToggleAction id='reboot-button' variant="secondary"
                                    key='reboot-button'
                                    onClick={() => this.setState({ rebootModal: true })}>
                                    {_("Reboot")}
                                </DropdownToggleAction>
                            ]}
                            splitButtonVariant="action"
                            onToggle={isOpen => this.setState({ actionIsOpen: isOpen })}
                            id="shutdown-group"
                              />
                          }
                    isOpen={actionIsOpen}
                    dropdownItems={dropdownItems}
                />);

        const show_superuser = (
            cockpit.transport.host && cockpit.transport.host != "localhost" &&
            !(window.parent.name == "cockpit1" && window.parent.features &&
              window.parent.features.navbar_is_for_current_machine));

        return (
            <>
                {this.state.rebootModal && <ShutdownModal onClose={() => this.setState({ rebootModal: false })} />}
                {this.state.shutdownModal && <ShutdownModal shutdown onClose={() => this.setState({ shutdownModal: false })} />}
                <Page>
                    <PageSection variant={PageSectionVariants.light} padding={{ default: 'noPadding' }}>
                        <SuperuserAlert />
                    </PageSection>
                    <PageSection className='ct-overview-header' variant={PageSectionVariants.light}>
                        <div className='ct-overview-header-hostname'>
                            <h1>
                                {this.hostname_text()}
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
                        <Gallery className='ct-system-overview' hasGutter>
                            <MotdCard />
                            <HealthCard />
                            <UsageCard />
                            <SystemInfomationCard />
                            <ConfigurationCard hostname={this.hostname_text()} />
                        </Gallery>
                    </PageSection>
                </Page>
            </>
        );
    }
}

function init() {
    cockpit.translate();
    ReactDOM.render(<OverviewPage />, document.getElementById("overview"));
}

document.addEventListener("DOMContentLoaded", init);
