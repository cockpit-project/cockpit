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
import React from 'react';
import {
    Card, CardBody, Button, CardTitle, Modal, Alert,
    Form, FormGroup, TextInput
} from '@patternfly/react-core';

import host_keys_script from "raw-loader!./ssh-list-host-keys.sh";
import cockpit from "cockpit";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { Privileged } from "cockpit-components-privileged.jsx";
import { ServerTimeConfig } from 'serverTime.js';
import * as realmd from "./realmd-operation.js";
import { superuser } from "superuser";

/* These add themselves to jQuery so just including is enough */
import "patterns";
import "bootstrap-datepicker/dist/js/bootstrap-datepicker";

import "./configurationCard.scss";

const _ = cockpit.gettext;

export class ConfigurationCard extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            serverTime: '',
            hostEditModal: false,
            showKeysModal: false,
        };

        this.realmd = realmd.setup();
    }

    componentDidMount() {
        this.realmd.addEventListener("changed", () => this.setState({}));
    }

    render() {
        let hostname_button = null;
        if (superuser.allowed && !this.realmd.hostname_button_disabled)
            hostname_button = (
                <Button id="system_information_hostname_button" variant="link"
                        onClick={ () => this.setState({ hostEditModal: true }) }
                        isInline aria-label="edit hostname">
                    {this.props.hostname !== "" ? _("edit") : _("Set hostname")}
                </Button>);

        const domain_tooltip = superuser.allowed && this.realmd.button_tooltip;
        const domain_disabled = !superuser.allowed || this.realmd.button_disabled;

        const domain_button = (
            <Privileged allowed={ !domain_tooltip }
                        tooltipId="system_information_domain_tooltip"
                        excuse={ domain_tooltip }>
                <Button id="system_information_domain_button" variant="link"
                        onClick={ () => this.realmd.clicked() }
                        isInline isDisabled={ domain_disabled } aria-label="join domain">
                    { superuser.allowed ? this.realmd.button_text : _("Not joined") }
                </Button>
            </Privileged>);

        return (
            <>
                {this.state.hostEditModal && <PageSystemInformationChangeHostname onClose={() => this.setState({ hostEditModal: false })} />}
                {this.state.showKeysModal && <SystemInformationSshKeys onClose={() => this.setState({ showKeysModal: false })} />}
                <Card className="system-configuration">
                    <CardTitle>{_("Configuration")}</CardTitle>
                    <CardBody>
                        <table className="pf-c-table pf-m-grid-md pf-m-compact">
                            <tbody>
                                <tr>
                                    <th scope="row">{_("Hostname")}</th>
                                    <td>
                                        {this.props.hostname && <span id="system_information_hostname_text">{this.props.hostname}</span>}
                                        <span>{hostname_button}</span>
                                    </td>
                                </tr>

                                <tr>
                                    <th scope="row">{_("System time")}</th>
                                    <td><ServerTimeConfig /></td>
                                </tr>

                                <tr>
                                    <th scope="row">{_("Domain")}</th>
                                    <td>{domain_button}</td>
                                </tr>

                                <tr>
                                    <th scope="row">{_("Performance profile")}</th>
                                    <td><span id="system-info-performance" /></td>
                                </tr>

                                <tr>
                                    <th scope="row">{_("Secure shell keys")}</th>
                                    <td>
                                        <Button variant="link" isInline id="system-ssh-keys-link"
                                                onClick={() => this.setState({ showKeysModal: true })}>
                                            {_("Show fingerprints")}
                                        </Button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </CardBody>
                </Card>
            </>
        );
    }
}

class SystemInformationSshKeys extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            keys: [],
            error: "",
            loading: true,
        };
        this.interval = null;

        this.keysUpdate = this.keysUpdate.bind(this);
    }

    componentDidMount() {
        /*
         * Yes, we do refresh the keys while the dialog is open.
         * It may occur that sshd is not running at the point when
         * we try, or in rare cases the keys may change.
         */
        this.interval = window.setInterval(this.keysUpdate, 10 * 1000);
        this.keysUpdate();
    }

    componentWillUnmount() {
        window.clearInterval(this.interval);
        this.interval = null;
    }

    keysUpdate() {
        cockpit.script(host_keys_script, [], { superuser: "try", err: "message" })
                .then(data => {
                    const seen = {};
                    const keys = {};

                    data.trim().split("\n")
                            .forEach(line => {
                                if (!line)
                                    return;

                                const parts = line.trim().split(" ");
                                const fp = parts[1];
                                if (!seen[fp]) {
                                    seen[fp] = fp;
                                    let title = parts[parts.length - 1];
                                    if (title) {
                                        const m = title.match(/^\((.*)\)$/);
                                        if (m && m[1])
                                            title = m[1];
                                    }
                                    if (!keys[title])
                                        keys[title] = [];
                                    keys[title].push(fp);
                                }
                            });

                    let arr = Object.keys(keys);
                    arr.sort();
                    arr = arr.map(function(k) {
                        return { title: k, fps: keys[k] };
                    });

                    this.setState({
                        keys: arr,
                        loading: false,
                        error: "",
                    });
                })
                .catch(function(ex) {
                    this.setState({
                        loading: false,
                        error: cockpit.format(_("failed to list ssh host keys: $0"), ex.message),
                    });
                });
    }

    render() {
        let body = null;
        if (this.state.error)
            body = <Alert variant='danger' isInline title={_("Loading of SSH keys failed")}>
                <p>{_("Error message")}: {this.state.error}</p>
            </Alert>;
        else if (this.state.loading)
            body = <EmptyStatePanel loading title={ _("Loading keys...") } />;
        else if (!this.state.keys.length)
            body = <EmptyStatePanel title={ _("No host keys found.") } />;
        else
            body = <div className="list-group dialog-list-ct">
                {this.state.keys.map(key =>
                    <div className="list-group-item" key={key.title}>
                        <h4>{key.title}</h4>
                        {key.fps.map((fp, i) => <div key={i}><small>{fp}</small></div>)}
                    </div>
                )}
            </div>;

        return (
            <Modal isOpen position="top" variant="medium"
                   onClose={this.props.onClose}
                   id="system_information_ssh_keys"
                   title={_("Machine SSH key fingerprints")}
                   footer={<>
                       <Button variant='secondary' onClick={this.props.onClose}>{_("Close")}</Button>
                   </>}
            >
                {body}
            </Modal>);
    }
}

class PageSystemInformationChangeHostname extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            update_from_pretty: true,
            init_hostname: "",
            hostname: "",
            proxy: null,
            pretty: "",
            init_pretty: "",
            error: [],

        };
        this.onSubmit = this.onSubmit.bind(this);
        this.onPrettyChanged = this.onPrettyChanged.bind(this);
        this.onHostnameChanged = this.onHostnameChanged.bind(this);
    }

    componentDidMount() {
        const client = cockpit.dbus('org.freedesktop.hostname1', { superuser : "try" });
        const hostname_proxy = client.proxy();

        hostname_proxy.wait()
                .then(() => {
                    const initial_hostname = hostname_proxy.StaticHostname || "";
                    const initial_pretty_hostname = hostname_proxy.PrettyHostname || "";
                    this.setState({
                        proxy: hostname_proxy,
                        hostname: initial_hostname,
                        init_hostname: initial_hostname,
                        pretty: initial_pretty_hostname,
                        init_pretty: initial_pretty_hostname,
                    });
                });
    }

    onPrettyChanged(value) {
        // Whenever the pretty host name has changed (e.g. the user has edited it), we compute a new
        // simple host name (e.g. 7bit ASCII, no special chars/spaces, lower case) from it

        const new_state = { pretty: value };

        if (this.state.update_from_pretty) {
            const old_hostname = this.state.hostname;
            const first_dot = old_hostname.indexOf(".");
            let new_hostname = value
                    .toLowerCase()
                    .replace(/['".]+/g, "")
                    .replace(/[^a-zA-Z0-9]+/g, "-");
            new_hostname = new_hostname.substr(0, 64);
            if (first_dot >= 0)
                new_hostname = new_hostname + old_hostname.substr(first_dot);
            new_state.hostname = new_hostname;
        }
        this.setState(new_state);
    }

    onHostnameChanged(value) {
        const error = [];
        if (value.length > 64)
            error.push(_("Real host name must be 64 characters or less"));
        if (value.match(/[.a-z0-9-]*/)[0] !== value || value.indexOf("..") !== -1)
            error.push(_("Real host name can only contain lower-case characters, digits, dashes, and periods (with populated subdomains)"));

        this.setState({
            hostname: value,
            update_from_pretty: false,
            error: error,
        });
    }

    onSubmit(event) {
        const one = this.state.proxy.call("SetStaticHostname", [this.state.hostname, true]);
        const two = this.state.proxy.call("SetPrettyHostname", [this.state.pretty, true]);

        Promise.all([one, two]).then(this.props.onClose);

        if (event)
            event.preventDefault();
        return false;
    }

    render() {
        const disabled = this.state.error.length || (this.state.init_hostname == this.state.hostname && this.state.init_pretty == this.state.pretty);
        return (
            <Modal isOpen position="top" variant="medium"
                   onClose={this.props.onClose}
                   id="system_information_change_hostname"
                   title={_("Change host name")}
                   footer={<>
                       <Button variant='primary' isDisabled={disabled} onClick={this.onSubmit}>{_("Change")}</Button>
                       <Button variant='link' onClick={this.props.onClose}>{_("Cancel")}</Button>
                   </>}
            >
                <Form isHorizontal onSubmit={this.onSubmit}>
                    <FormGroup fieldId="sich-pretty-hostname" label={_("Pretty host name")}>
                        <TextInput id="sich-pretty-hostname" value={this.state.pretty} onChange={this.onPrettyChanged} />
                    </FormGroup>
                    <FormGroup fieldId="sich-hostname" label={_("Real host name")}
                               helperTextInvalid={this.state.error.join("\n")}
                               validated={this.state.error.length ? "error" : "default"}>
                        <TextInput id="sich-hostname" value={this.state.hostname} onChange={this.onHostnameChanged} />
                    </FormGroup>
                </Form>
            </Modal>);
    }
}
