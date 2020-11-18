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

import '../lib/patternfly/patternfly-cockpit.scss';
import 'polyfills';
import cockpit from "cockpit";
import moment from "moment";

import React from 'react';
import ReactDOM from 'react-dom';
import {
    Alert, AlertActionCloseButton,
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
import { ShutdownModal } from "./shutdown.jsx";

const _ = cockpit.gettext;

class LoginMessages extends React.Component {
    constructor() {
        super();
        this.state = { messages: {} };

        this.close = this.close.bind(this);

        const bridge = cockpit.dbus(null, { bus: "internal" });
        bridge.call("/LoginMessages", "cockpit.LoginMessages", "Get", [])
                .then(reply => {
                    const obj = JSON.parse(reply[0]);
                    if (obj.version == 1) {
                        if (obj['fail-count'] > 5) {
                            obj.type = "danger";
                        } else if (obj['fail-count'] > 0) {
                            obj.type = "warning";
                        } else {
                            obj.type = "info";
                        }

                        this.setState({ messages: obj });
                    } else {
                        // empty reply is okay -- older bridges just don't send that information
                        if (obj.version !== undefined)
                            console.error("unknown login-messages:", reply[0]);
                    }
                })
                .catch(error => {
                    console.error("failed to fetch login messages:", error);
                });
    }

    close() {
        const bridge = cockpit.dbus(null, { bus: "internal" });
        bridge.call("/LoginMessages", "cockpit.LoginMessages", "Dismiss", [])
                .catch(error => {
                    console.error("failed to dismiss login messages:", error);
                });

        this.setState({ messages: {} });
    }

    render() {
        const messages = this.state.messages;

        // Do the full combinatorial thing to improve translatability
        function generate_line(host, line, datetime) {
            let message = "";
            if (host && line) {
                message = cockpit.format(_("<date> from <host> on <terminal>", "$0 from $1 on $2"), datetime, host, line);
            } else if (host) {
                message = cockpit.format(_("<date> from <host>", "$0 from $1"), datetime, host);
            } else if (line) {
                message = cockpit.format(_("<date> on <terminal>", "$0 on $1"), datetime, line);
            } else {
                message = datetime;
            }
            return message;
        }

        let last_login_message;
        if (messages['last-login-time']) {
            const datetime = moment.unix(messages['last-login-time']).format('ll LTS');
            const host = messages['last-login-host'];
            const line = messages['last-login-line'];
            last_login_message = generate_line(host, line, datetime);
        }

        let last_fail_message;
        if (messages['last-fail-time']) {
            const datetime = moment.unix(messages['last-fail-time']).format('ll LTS');
            const host = messages['last-fail-host'];
            const line = messages['last-fail-line'];
            last_fail_message = generate_line(host, line, datetime);
        }

        let fail_count_message = null;
        if (messages['fail-count']) {
            fail_count_message = cockpit.format(cockpit.ngettext(
                "There was $0 failed login attempt since the last successful login.",
                "There were $0 failed login attempts since the last successful login.",
                messages['fail-count']), messages['fail-count']);
        }

        if (!last_login_message && !fail_count_message && !last_fail_message)
            return (<div id='login-messages' empty='yes' />); // for testing

        const last_log_item = <p id='last-login'><b>{_("Last login:")}</b> {last_login_message}</p>;
        const last_fail_item = <p id='last-failed-login'><b>{_("Last failed login:")}</b> {last_fail_message}</p>;

        return (
            <Alert id='login-messages'
                   variant={this.state.messages.type}
                   isInline={!fail_count_message}
                   className={!fail_count_message ? "no-title" : ""}
                   actionClose={<AlertActionCloseButton onClose={this.close} />}
                   title={fail_count_message || last_log_item}
            >
                {last_login_message && fail_count_message && last_log_item}
                {last_fail_message && last_fail_item}
            </Alert>
        );
    }
}

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
        let str = this.state.hostnameData.HostName;

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
            <DropdownItem key="restart" id="restart" onClick={() => this.setState({ restartModal: true })} component="button">
                {_("Restart")}
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
                                <DropdownToggleAction id='restart-button' variant="secondary"
                                    key='restart-button'
                                    onClick={() => this.setState({ restartModal: true })}>
                                    {_("Restart")}
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
                {this.state.restartModal && <ShutdownModal onClose={() => this.setState({ restartModal: false })} />}
                {this.state.shutdownModal && <ShutdownModal shutdown onClose={() => this.setState({ shutdownModal: false })} />}
                <Page>
                    <SuperuserAlert />
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
                        <LoginMessages />
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
    moment.locale(cockpit.language);
    ReactDOM.render(<OverviewPage />, document.getElementById("overview"));
}

document.addEventListener("DOMContentLoaded", init);
