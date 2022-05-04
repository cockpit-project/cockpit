/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import cockpit from "cockpit";
import React from "react";
import {
    Button, Dropdown, DropdownItem, DropdownPosition, DropdownSeparator, DropdownToggle,
    Masthead, MastheadContent,
    Spinner,
    Toolbar, ToolbarItem, ToolbarContent,
} from '@patternfly/react-core';
import { CogIcon, ExternalLinkAltIcon, HelpIcon } from '@patternfly/react-icons';

import { ActivePagesDialog } from "./active-pages-modal.jsx";
import { CredentialsModal } from './credentials.jsx';
import { AboutCockpitModal, LangModal, OopsModal } from "./shell-modals.jsx";
import { SuperuserIndicator } from "./superuser.jsx";
import { read_os_release } from "os-release.js";
import { DialogsContext } from "dialogs.jsx";

const _ = cockpit.gettext;

export class TopNav extends React.Component {
    static contextType = DialogsContext;

    constructor(props) {
        super(props);

        let hash = props.state.hash;
        let component = props.state.component;

        if (props.machine && props.compiled.compat && props.compiled.compat[component]) { // Old cockpit packages used to be in shell/shell.html
            hash = props.compiled.compat[component];
            component = "shell/shell";
        }
        const frame = component ? props.index.frames.lookup(props.machine, component, hash) : undefined;

        this.state = {
            component: component,
            frame: frame,
            credentialsDialogOpened: false,
            docsOpened: false,
            menuOpened: false,
            showActivePages: false,
            osRelease: {},
        };

        this.superuser_connection = cockpit.dbus(null, { bus: "internal", host: props.machine.connection_string });
        this.superuser = this.superuser_connection.proxy("cockpit.Superuser", "/superuser");

        read_os_release().then(os => this.setState({ osRelease: os || {} }));
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        let hash = nextProps.state.hash;
        let component = nextProps.state.component;

        if (nextProps.machine && nextProps.compiled.compat && nextProps.compiled.compat[component]) { // Old cockpit packages used to be in shell/shell.html
            hash = nextProps.compiled.compat[component];
            component = "shell/shell";
        }

        if (component !== prevState.component) {
            const frame = component ? nextProps.index.frames.lookup(nextProps.machine, component, hash) : undefined;
            return {
                frame: frame,
                component: component,
            };
        }

        return null;
    }

    componentDidUpdate(prevProps) {
        if (prevProps.machine.connection_string !== this.props.machine.connection_string) {
            if (this.superuser_connection)
                this.superuser_connection.close();

            this.superuser_connection = cockpit.dbus(null, { bus: "internal", host: this.props.machine.connection_string });
            this.superuser = this.superuser_connection.proxy("cockpit.Superuser", "/superuser");
        }
    }

    render() {
        const Dialogs = this.context;
        const connected = this.props.machine.state === "connected";

        let docs = [];

        const item = this.props.compiled.items[this.props.state.component];
        if (item && item.docs)
            docs = item.docs;

        // Check for parent as well
        if (docs.length === 0) {
            const comp = cockpit.manifests[this.props.state.component];
            if (comp && comp.parent && comp.parent.docs)
                docs = comp.parent.docs;
        }

        const docItems = [];

        if (this.state.osRelease.DOCUMENTATION_URL)
            docItems.push(<DropdownItem key="os-doc" href={this.state.osRelease.DOCUMENTATION_URL} target="blank" rel="noopener noreferrer" icon={<ExternalLinkAltIcon />}>
                {cockpit.format(_("$0 documentation"), this.state.osRelease.NAME)}
            </DropdownItem>);

        docItems.push(<DropdownItem key="cockpit-doc" href="https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/managing_systems_using_the_rhel_8_web_console/index" target="blank" rel="noopener noreferrer" icon={<ExternalLinkAltIcon />}>
            {_("Web Console")}
        </DropdownItem>);

        if (docs.length > 0)
            docItems.push(<DropdownSeparator key="separator" />);

        docs.forEach(e => {
            docItems.push(<DropdownItem key={e.label} href={e.url} target="blank" rel="noopener noreferrer" icon={<ExternalLinkAltIcon />}>
                {_(e.label)}
            </DropdownItem>);
        });

        docItems.push(<DropdownSeparator key="separator1" />);
        docItems.push(<DropdownItem key="about" component="button"
                                    onClick={() => Dialogs.show(<AboutCockpitModal />)}>
            {_("About Web Console")}
        </DropdownItem>);

        const manifest = cockpit.manifests.shell || { };

        const main_menu = [
            <div id="super-user-indicator-mobile" className="mobile_v" key="superusermobile">
                <SuperuserIndicator proxy={this.superuser} host={this.props.machine.connection_string} />
            </div>,
            <DropdownSeparator key="separator2" className="mobile_v" />,
        ];

        if (manifest.locales)
            main_menu.push(<DropdownItem key="languages" className="display-language-menu" component="button"
                                         onClick={() => Dialogs.show(<LangModal />)}>
                {_("Display language")}
            </DropdownItem>);

        if (this.state.showActivePages)
            main_menu.push(
                <DropdownItem key="frames" id="active-pages" component="button"
                              onClick={() => Dialogs.show(<ActivePagesDialog frames={this.props.index.frames} />)}>
                    {_("Active pages")}
                </DropdownItem>);

        main_menu.push(
            <DropdownItem key="creds" id="sshkeys" component="button"
                          onClick={() => Dialogs.show(<CredentialsModal />)}>
                {_("SSH keys")}
            </DropdownItem>,
            <DropdownSeparator key="separator3" />,
            <DropdownItem key="logout" id="logout" component="button" onClick={cockpit.logout}>
                {_("Log out")}
            </DropdownItem>,
        );

        return (
            <Masthead>
                <MastheadContent>
                    <Toolbar id="toolbar" isFullHeight isStatic>
                        <ToolbarContent className="ct-topnav-content">
                            {(connected && this.state.frame && !this.state.frame.getAttribute("data-ready")) &&
                                <ToolbarItem id="machine-spinner">
                                    <Spinner isSVG size="lg" style={{ "--pf-c-spinner--Color": "#fff", "--pf-c-spinner--diameter": "2rem" }} />
                                </ToolbarItem>
                            }
                            { connected &&
                                <ToolbarItem id="super-user-indicator" className="super-user-indicator desktop_v">
                                    <SuperuserIndicator proxy={this.superuser} host={this.props.machine.connection_string} />
                                </ToolbarItem>
                            }
                            { this.props.index.has_oops &&
                                <ToolbarItem>
                                    <Button id="navbar-oops" variant="link" isLarge isDanger
                                            onClick={() => Dialogs.show(<OopsModal />)}>{_("Ooops!")}</Button>
                                </ToolbarItem>
                            }
                            <ToolbarItem>
                                <Dropdown
                                    onSelect={() => {
                                        this.setState(prevState => { return { docsOpened: !prevState.docsOpened } });
                                        document.getElementById("toggle-docs").focus();
                                    }}
                                    toggle={
                                        <DropdownToggle id="toggle-docs" icon={<HelpIcon size="md" />} onToggle={isOpen => { this.setState({ docsOpened: isOpen }) }}>
                                            {_("Help")}
                                        </DropdownToggle>
                                    }
                                    isOpen={this.state.docsOpened}
                                    dropdownItems={docItems}
                                    position={DropdownPosition.right}
                                    isFullHeight
                                    className="ct-header-item ct-nav-toggle"
                                />
                            </ToolbarItem>
                            <ToolbarItem>
                                <Dropdown
                                    onSelect={() => {
                                        this.setState(prevState => { return { menuOpened: !prevState.menuOpened } });
                                        document.getElementById("toggle-menu").focus();
                                    }}
                                    toggle={
                                        <DropdownToggle id="toggle-menu" icon={<CogIcon size="md" />} onToggle={(isOpen, ev) => { if (ev.target.id !== "toggle-menu") return; this.setState({ menuOpened: isOpen, showActivePages: ev.altKey }) }}>
                                            {_("Session")}
                                        </DropdownToggle>
                                    }
                                    isOpen={this.state.menuOpened}
                                    dropdownItems={main_menu}
                                    position={DropdownPosition.right}
                                    isFullHeight
                                    className="ct-header-item ct-nav-toggle"
                                />
                            </ToolbarItem>
                        </ToolbarContent>
                    </Toolbar>
                </MastheadContent>
            </Masthead>
        );
    }
}
