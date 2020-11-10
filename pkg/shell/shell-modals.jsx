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
import { Button, Modal } from '@patternfly/react-core';

import "form-layout.scss";

const _ = cockpit.gettext;

export function AboutModal(props) {
    return (
        <Modal isOpen position="top" variant="medium"
               onClose={props.onClose}
               id="about-cockpit-modal"
               title={_("About Web Console")}
               footer={<Button variant='secondary' onClick={props.onClose}>{_("Close")}</Button>}
        >
            <div>{_("Cockpit is an interactive Linux server admin interface.")}</div>
            <div><a rel="noopener noreferrer" target="_blank" href="https://cockpit-project.org/">{_("Project website")}</a></div>
            <div>
                <span>{_("Version")} </span>
                <span id="about-version">{cockpit.info.version}</span>.
            </div>
            <div>
                <span>{_("Licensed under:")} </span>
                <a href="https://www.gnu.org/licenses/old-licenses/lgpl-2.1-standalone.html"
              rel="noopener noreferrer" target="_blank">{_("GNU LGPL version 2.1")}</a>
            </div>
        </Modal>);
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
            <Modal isOpen position="top" variant="medium"
                   id="display-language-modal"
                   onClose={this.props.onClose}
                   title={_("Display language")}
                   footer={<>
                       <Button variant='primary' onClick={this.onSelect}>{_("Select")}</Button>
                       <Button variant='link' onClick={this.props.onClose}>{_("Cancel")}</Button>
                   </>}
            >
                <p translate="yes">Choose the language to be used in the application</p>
                <select id="display-language-list" size="5" data-role="none" defaultValue={this.state.selected} onChange={e => this.setState({ selected: e.target.value })}>
                    {Object.keys(manifest.locales || { }).map(key => {
                        return <option key={key} value={key}>{manifest.locales[key]}</option>;
                    })}
                </select>
            </Modal>);
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
        </Modal>);
}
