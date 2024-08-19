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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Dropdown, DropdownGroup, DropdownItem, DropdownList } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider";
import { Masthead, MastheadContent } from "@patternfly/react-core/dist/esm/components/Masthead/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { Toolbar, ToolbarContent, ToolbarItem } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
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
            component,
            frame,
            docsOpened: false,
            menuOpened: false,
            showActivePages: false,
            osRelease: {},
            theme: localStorage.getItem('shell:style') || 'auto',
        };

        this.superuser_connection = null;
        this.superuser = null;

        read_os_release().then(os => this.setState({ osRelease: os || {} }));

        this.handleClickOutside = () => this.setState({ menuOpened: false, docsOpened: false });
    }

    componentDidMount() {
        /* This is a HACK for catching lost clicks on the pages which live in iframes so as to close dropdown menus on the shell.
         * Note: Clicks on an <iframe> element won't trigger document.documentElement listeners, because it's literally different page with different security domain.
         * However, when clicking on an iframe moves focus to its content's window that triggers the main window.blur event.
         */
        window.addEventListener("blur", this.handleClickOutside);
    }

    componentWillUnmount() {
        window.removeEventListener("blur", this.handleClickOutside);
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
                frame,
                component,
            };
        }

        return null;
    }

    handleModeClick = (event, isSelected) => {
        const theme = event.currentTarget.id;
        this.setState({ theme });

        const styleEvent = new CustomEvent("cockpit-style", {
            detail: {
                style: theme,
            }
        });
        window.dispatchEvent(styleEvent);

        localStorage.setItem("shell:style", theme);
    };

    render() {
        const Dialogs = this.context;
        const connected = this.props.machine.state === "connected";

        let docs = [];

        if (!this.superuser_connection || (this.superuser_connection.options.host !=
                                           this.props.machine.connection_string)) {
            if (this.superuser_connection) {
                this.superuser_connection.close();
                this.superuser_connection = null;
            }

            if (connected) {
                this.superuser_connection = cockpit.dbus(null, { bus: "internal", host: this.props.machine.connection_string });
                this.superuser = this.superuser_connection.proxy("cockpit.Superuser", "/superuser");
            }
        }

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
            docItems.push(<DropdownItem key="os-doc" to={this.state.osRelease.DOCUMENTATION_URL} target="blank" rel="noopener noreferrer" icon={<ExternalLinkAltIcon />}>
                {cockpit.format(_("$0 documentation"), this.state.osRelease.NAME)}
            </DropdownItem>);

        // global documentation for cockpit as a whole
        (cockpit.manifests.shell?.docs ?? []).forEach(doc => {
            docItems.push(<DropdownItem key={doc.label} to={doc.url} target="blank" rel="noopener noreferrer" icon={<ExternalLinkAltIcon />}>
                {doc.label}
            </DropdownItem>);
        });

        if (docs.length > 0)
            docItems.push(<Divider key="separator" />);

        docs.forEach(e => {
            docItems.push(<DropdownItem key={e.label} to={e.url} target="blank" rel="noopener noreferrer" icon={<ExternalLinkAltIcon />}>
                {_(e.label)}
            </DropdownItem>);
        });

        docItems.push(<Divider key="separator1" />);
        docItems.push(<DropdownItem key="about" component="button"
                                    onClick={() => Dialogs.run(AboutCockpitModal, {})}>
            {_("About Web Console")}
        </DropdownItem>);

        const manifest = cockpit.manifests.shell || { };

        // HACK: This should be a DropdownItem so the normal onSelect closing behaviour works, but we can't embed a button in a button
        const main_menu = [
            <div // eslint-disable-line jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events
              id="super-user-indicator-mobile"
              className="mobile_v"
              key="superusermobile"
              onClick={() => {
                  this.setState(prevState => { return { menuOpened: !prevState.menuOpened } });
              }}>
                <SuperuserIndicator proxy={this.superuser} host={this.props.machine.connection_string} />
            </div>,
            <Divider key="separator2" className="mobile_v" />,
            <DropdownGroup label={_("Style")} key="dark-switcher">
                <DropdownList>
                    <DropdownItem key="dark-switcher-menu" component="div">
                        <ToggleGroup key="dark-switcher-togglegroup">
                            <ToggleGroupItem key="dark-switcher-auto" buttonId="auto" text={_("Default")}
                                isSelected={this.state.theme === "auto"}
                                onChange={this.handleModeClick} />
                            <ToggleGroupItem key="dark-switcher-light" buttonId="light" text={_("Light")}
                                isSelected={this.state.theme === "light"}
                                onChange={this.handleModeClick} />
                            <ToggleGroupItem key="dark-switcher-dark" buttonId="dark" text={_("Dark")}
                                isSelected={this.state.theme === "dark"}
                                onChange={this.handleModeClick} />
                        </ToggleGroup>
                    </DropdownItem>
                </DropdownList>
            </DropdownGroup>,
            <Divider key="separatorDark" />,
        ];

        if (manifest.locales)
            main_menu.push(<DropdownItem key="languages" className="display-language-menu"
                                         onClick={() => Dialogs.run(LangModal, {})}>
                {_("Display language")}
            </DropdownItem>);

        if (this.state.showActivePages)
            main_menu.push(
                <DropdownItem key="frames" id="active-pages" component="button"
                              onClick={() => Dialogs.run(ActivePagesDialog, { frames: this.props.index.frames })}>
                    {_("Active pages")}
                </DropdownItem>);

        main_menu.push(
            <DropdownItem key="creds" id="sshkeys" component="button"
                          onClick={() => Dialogs.run(CredentialsModal, {})}>
                {_("SSH keys")}
            </DropdownItem>,
            <Divider key="separator3" />,
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
                                    <Spinner size="lg" style={{ "--pf-v5-c-spinner--Color": "#fff", "--pf-v5-c-spinner--diameter": "2rem" }} />
                                </ToolbarItem>
                            }
                            { connected &&
                                <ToolbarItem id="super-user-indicator" className="super-user-indicator desktop_v">
                                    <SuperuserIndicator proxy={this.superuser} host={this.props.machine.connection_string} />
                                </ToolbarItem>
                            }
                            { this.props.index.has_oops &&
                                <ToolbarItem>
                                    <Button id="navbar-oops" variant="link" size="lg" isDanger
                                            onClick={() => Dialogs.run(OopsModal, {})}>{_("Ooops!")}</Button>
                                </ToolbarItem>
                            }
                            <ToolbarItem>
                                <Dropdown
                                    id="toggle-docs-menu"
                                    onSelect={() => {
                                        this.setState(prevState => { return { docsOpened: !prevState.docsOpened } });
                                        document.getElementById("toggle-docs").focus();
                                    }}
                                    toggle={(toggleRef) => (
                                        <MenuToggle
                                          ref={toggleRef}
                                          id="toggle-docs"
                                          className="ct-nav-toggle"
                                          icon={<HelpIcon className="toggle-docs-icon pf-v5-c-icon pf-m-lg" />}
                                          isExpanded={this.state.docsOpened}
                                          isFullHeight
                                          onClick={() => { this.setState(prevState => ({ docsOpened: !prevState.docsOpened, menuOpened: false })) }}>
                                            {_("Help")}
                                        </MenuToggle>
                                    )}
                                    isOpen={this.state.docsOpened}
                                    popperProps={{ position: "right" }}
                                >
                                    <DropdownList>
                                        {docItems}
                                    </DropdownList>
                                </Dropdown>
                            </ToolbarItem>
                            <ToolbarItem>
                                <Dropdown
                                    id="toggle-menu-menu"
                                    onSelect={() => {
                                        this.setState(prevState => { return { menuOpened: !prevState.menuOpened } });
                                        document.getElementById("toggle-menu").focus();
                                    }}
                                    toggle={(toggleRef) => (
                                        <MenuToggle
                                          ref={toggleRef}
                                          id="toggle-menu"
                                          className="ct-nav-toggle"
                                          icon={<CogIcon className="pf-v5-c-icon pf-m-lg" />}
                                          isExpanded={this.state.menuOpened}
                                          isFullHeight
                                          onClick={(event) => {
                                              this.setState(prevState => ({ menuOpened: !prevState.menuOpened, docsOpened: false, showActivePages: event.altKey }));
                                          }}
                                        >
                                            {_("Session")}
                                        </MenuToggle>
                                    )}
                                    isOpen={this.state.menuOpened}
                                    popperProps={{ position: "right" }}
                                >
                                    <DropdownList>
                                        {main_menu}
                                    </DropdownList>
                                </Dropdown>
                            </ToolbarItem>
                        </ToolbarContent>
                    </Toolbar>
                </MastheadContent>
            </Masthead>
        );
    }
}
