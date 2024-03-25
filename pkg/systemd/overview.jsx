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

import '../lib/patternfly/patternfly-5-cockpit.scss';
import 'polyfills';
import 'cockpit-dark-theme'; // once per page
import cockpit from "cockpit";

import React from 'react';
import { createRoot } from "react-dom/client";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Dropdown, DropdownItem, DropdownList } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { MenuToggle, MenuToggleAction } from "@patternfly/react-core/dist/esm/components/MenuToggle";

import { superuser } from "superuser";

import { SystemInformationCard } from './overview-cards/systemInformationCard.jsx';
import { ConfigurationCard } from './overview-cards/configurationCard.jsx';
import { HealthCard } from './overview-cards/healthCard.jsx';
import { MotdCard } from './overview-cards/motdCard.jsx';
import { UsageCard } from './overview-cards/usageCard.jsx';
import { SuperuserAlert } from './superuser-alert.jsx';
import { SuperuserIndicator } from "../shell/superuser.jsx";
import { ShutdownModal } from 'cockpit-components-shutdown.jsx';
import { WithDialogs, DialogsContext } from "dialogs.jsx";

import "./overview.scss";

const _ = cockpit.gettext;

class OverviewPage extends React.Component {
    static contextType = DialogsContext;

    constructor(props) {
        super(props);

        this.state = {
            actionIsOpen: false,
            privileged: true,
        };
        this.hostnameMonitor = this.hostnameMonitor.bind(this);
        this.onPermissionChanged = this.onPermissionChanged.bind(this);

        this.superuser = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser", "/superuser");
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
        const Dialogs = this.context;
        const { actionIsOpen } = this.state;
        const dropdownItems = [
            <DropdownItem key="reboot" id="reboot"
                          onClick={() => Dialogs.show(<ShutdownModal />)}
                          component="button">
                {_("Reboot")}
            </DropdownItem>,
            <DropdownItem key="shutdown" id="shutdown"
                          onClick={() => Dialogs.show(<ShutdownModal shutdown />)}
                          component="button">
                {_("Shutdown")}
            </DropdownItem>,
        ];

        let headerActions = null;
        if (this.state.privileged)
            headerActions = (
                <Dropdown onSelect={() => this.setState({ actionIsOpen: true })}
                    toggle={(toggleRef) => (
                        <MenuToggle
                            ref={toggleRef}
                            variant="secondary"
                            splitButtonOptions={{
                                variant: "action",
                                items: [
                                    <MenuToggleAction
                                        id='reboot-button'
                                        key='reboot-button'
                                        onClick={() => Dialogs.show(<ShutdownModal />)}
                                    >
                                        {_("Reboot")}
                                    </MenuToggleAction>
                                ],
                            }}
                            onClick={() => this.setState({ actionIsOpen: !actionIsOpen })}
                            id="shutdown-group"
                        />
                    )}
                    isOpen={actionIsOpen}
                    popperProps={{ position: "right" }}
                >
                    <DropdownList>
                        {dropdownItems}
                    </DropdownList>
                </Dropdown>
            );

        const show_superuser = (
            cockpit.transport.host && cockpit.transport.host != "localhost" &&
            !(window.parent.name == "cockpit1" && window.parent.features &&
              window.parent.features.navbar_is_for_current_machine));

        return (
            <Page>
                <PageSection variant={PageSectionVariants.light} padding={{ default: 'noPadding' }}>
                    <SuperuserAlert />
                </PageSection>
                <PageSection variant={PageSectionVariants.light} className='ct-overview-header' padding={{ default: 'padding' }}>
                    <div className='ct-overview-header-hostname'>
                        <h1>
                            {this.hostname_text()}
                        </h1>
                        {this.state.hostnameData &&
                         this.state.hostnameData.OperatingSystemPrettyName &&
                         <div className="ct-overview-header-subheading" id="system_information_os_text">{cockpit.format(_("running $0"), this.state.hostnameData.OperatingSystemPrettyName)}</div>}
                    </div>
                    <div className='ct-overview-header-actions'>
                        { show_superuser && <SuperuserIndicator proxy={this.superuser} /> }
                        { "\n" }
                        { headerActions }
                    </div>
                </PageSection>
                <PageSection variant={PageSectionVariants.default}>
                    <Gallery className='ct-system-overview' hasGutter>
                        <MotdCard />
                        <HealthCard />
                        <UsageCard />
                        <SystemInformationCard />
                        <ConfigurationCard hostname={this.hostname_text()} />
                    </Gallery>
                </PageSection>
            </Page>
        );
    }
}

function init() {
    cockpit.translate();
    const root = createRoot(document.getElementById("overview"));
    root.render(<WithDialogs><OverviewPage /></WithDialogs>);
}

document.addEventListener("DOMContentLoaded", init);
