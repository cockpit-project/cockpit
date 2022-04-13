/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
    AboutModal,
    Button,
    Divider,
    Flex,
    Menu, MenuList, MenuItem, MenuContent, MenuInput,
    Modal,
    TextInput,
    TextContent, TextList, TextListItem
} from '@patternfly/react-core';

import "menu-select-widget.scss";

const _ = cockpit.gettext;

export class AboutCockpitModal extends React.Component {
    constructor(props) {
        super();

        this.state = {
            packages: null,
        };
    }

    componentDidMount() {
        const packages = [];
        const cmd = "(set +e; rpm -qa --qf '%{NAME} %{VERSION}\\n'; dpkg-query -f '${Package} ${Version}\n' --show; pacman -Q) 2> /dev/null | grep cockpit | sort";
        cockpit.spawn(["bash", "-c", cmd], [], { err: "message" })
                .then(pkgs =>
                    pkgs.trim().split("\n")
                            .forEach(p => {
                                const parts = p.split(" ");
                                packages.push({ name: parts[0], version: parts[1] });
                            })
                )
                .catch(error => console.error("Could not read packages versions:", error))
                .finally(() => this.setState({ packages: packages }));
    }

    render() {
        return (
            <AboutModal
                isOpen
                onClose={this.props.onClose}
                id="about-cockpit-modal"
                trademark={_("Licensed under GNU LGPL version 2.1")}
                productName={_("Web Console")}
                brandImageSrc="../shell/images/cockpit-icon.svg"
                brandImageAlt={_("Web console logo")}
                backgroundImageSrc="../shell/images/bg-plain.jpg"
            >
                <div>{_("Cockpit is an interactive Linux server admin interface.")}</div>
                <div><a rel="noopener noreferrer" target="_blank" href="https://cockpit-project.org/">{_("Project website")}</a></div>
                <TextContent>
                    <TextList component="dl">
                        {this.state.packages === null && <span>{_("Loading packages...")}</span>}
                        {this.state.packages !== null && this.state.packages.map(p =>
                            <React.Fragment key={p.name}>
                                <TextListItem key={p.name} component="dt">{p.name}</TextListItem>
                                <TextListItem component="dd">{p.version}</TextListItem>
                            </React.Fragment>
                        )}
                    </TextList>
                </TextContent>
            </AboutModal>
        );
    }
}

export class LangModal extends React.Component {
    constructor(props) {
        super();

        let language = document.cookie.replace(/(?:(?:^|.*;\s*)CockpitLang\s*=\s*([^;]*).*$)|^.*$/, "$1");
        if (!language)
            language = "en-us";

        this.state = {
            selected: language,
        };

        this.onSelect = this.onSelect.bind(this);
    }

    onSelect() {
        const lang = this.state.selected;

        if (!lang)
            return;

        const cookie = "CockpitLang=" + encodeURIComponent(lang) + "; path=/; expires=Sun, 16 Jul 3567 06:23:41 GMT";
        document.cookie = cookie;
        window.localStorage.setItem("cockpit.lang", lang);
        window.location.reload(true);
    }

    render() {
        const manifest = cockpit.manifests.shell || { };

        return (
            <Modal isOpen position="top" variant="small"
                   id="display-language-modal"
                   className="display-language-modal"
                   onClose={this.props.onClose}
                   title={_("Display language")}
                   footer={<>
                       <Button variant='primary' onClick={this.onSelect}>{_("Select")}</Button>
                       <Button variant='link' onClick={this.props.onClose}>{_("Cancel")}</Button>
                   </>}
            >
                <Flex direction={{ default: 'column' }}>
                    <p>{_("Choose the language to be used in the application")}</p>
                    <Menu id="display-language-list"
                          className="ct-menu-select-widget"
                          onSelect={(_, selected) => this.setState({ selected })}
                          activeItemId={this.state.selected}
                          selected={this.state.selected}>
                        <MenuInput>
                            <TextInput
                                value={this.state.searchInput}
                                aria-label={_("Filter menu items")}
                                iconVariant="search"
                                type="search"
                                onChange={searchInput => this.setState({ searchInput })}
                            />
                        </MenuInput>
                        <Divider />
                        <MenuContent>
                            <MenuList>
                                {Object.keys(manifest.locales || { })
                                        .filter(key => !this.state.searchInput || manifest.locales[key].toLowerCase().includes(this.state.searchInput.toString().toLowerCase()))
                                        .map(key => {
                                            return <MenuItem itemId={key} key={key} data-value={key}>{manifest.locales[key]}</MenuItem>;
                                        })}
                            </MenuList>
                        </MenuContent>
                    </Menu>
                </Flex>
            </Modal>
        );
    }
}

export function TimeoutModal(props) {
    return (
        <Modal isOpen position="top" variant="medium"
               showClose={false}
               title={_("Session is about to expire")}
               id="session-timeout-modal"
               footer={<Button variant='primary' onClick={props.onClose}>{_("Continue session")}</Button>}
        >
            {props.text}
        </Modal>
    );
}

export function OopsModal(props) {
    return (
        <Modal isOpen position="top" variant="medium"
               onClose={props.onClose}
               title={_("Unexpected error")}
               footer={<Button variant='secondary' onClick={props.onClose}>{_("Close")}</Button>}
        >
            {_("Cockpit had an unexpected internal error.")}
            <br />
            <br />
            <span>{("You can try restarting Cockpit by pressing refresh in your browser. The javascript console contains details about this error") + " ("}
                <b>{_("Ctrl-Shift-J")}</b>
                {" " + _("in most browsers") + ")."}
            </span>
        </Modal>
    );
}
