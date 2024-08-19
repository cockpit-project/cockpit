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

import { get_init_superuser_for_options } from "./machines/machines";
import * as credentials from "credentials";
import ssh_show_default_key_sh from "../lib/ssh-show-default-key.sh";
import ssh_add_key_sh from "../lib/ssh-add-key.sh";

import React from 'react';
import PropTypes from 'prop-types';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { OutlinedQuestionCircleIcon } from "@patternfly/react-icons";

import { FormHelper } from "cockpit-components-form-helper";
import { ModalError } from "cockpit-components-inline-notification.jsx";

const _ = cockpit.gettext;

export const codes = {
    "no-cockpit": "not-supported",
    "not-supported": "not-supported",
    "protocol-error": "not-supported",
    "authentication-not-supported": "change-auth",
    "authentication-failed": "change-auth",
    "no-forwarding": "change-auth",
    "unknown-hostkey": "unknown-hostkey",
    "invalid-hostkey": "invalid-hostkey",
    "not-found": "add-machine",
    "unknown-host": "unknown-host"
};

function full_address(machines_ins, address) {
    const machine = machines_ins.lookup(address);
    if (machine && machine.address !== "localhost")
        return machine.connection_string;

    return address;
}

function is_method_supported(methods, method) {
    const result = methods[method];
    return result ? result !== "no-server-support" : false;
}

function prevent_default(callback) {
    return event => {
        callback();
        event.preventDefault();
        return false;
    };
}

class NotSupported extends React.Component {
    render() {
        return (
            <Modal id="hosts_setup_server_dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.onClose}
                   title={_("Cockpit is not installed")}
                   footer={
                       <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                           { _("Close") }
                       </Button>
                   }
            >
                <Stack hasGutter>
                    { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                    <p>{cockpit.format(_("A compatible version of Cockpit is not installed on $0."), this.props.full_address)}</p>
                </Stack>
            </Modal>
        );
    }
}

class AddMachine extends React.Component {
    constructor(props) {
        super(props);

        let address_parts = null;
        if (this.props.full_address)
            address_parts = this.props.machines_ins.split_connection_string(this.props.full_address);

        let host_address = "";
        let host_user = "";
        if (address_parts) {
            host_address = address_parts.address;
            if (address_parts.port)
                host_address += ":" + address_parts.port;
            host_user = address_parts.user;
        }

        let color = props.machines_ins.unused_color();
        let old_machine = null;
        if (props.old_address)
            old_machine = props.machines_ins.lookup(props.old_address);
        if (old_machine)
            color = this.rgb2Hex(old_machine.color);

        this.state = {
            user: host_user || "",
            address: host_address || "",
            color,
            addressError: "",
            inProgress: false,
            old_machine,
            userChanged: false,
        };

        this.onAddressChange = this.onAddressChange.bind(this);
        this.onAddHost = this.onAddHost.bind(this);
    }

    rgb2Hex(c) {
        function toHex(d) {
            return ("0" + (parseInt(d, 10).toString(16)))
                    .slice(-2);
        }

        if (c[0] === "#")
            return c;

        const colors = /rgb\((\d*), (\d*), (\d*)\)/.exec(c);
        return "#" + toHex(colors[1]) + toHex(colors[2]) + toHex(colors[3]);
    }

    onAddressChange() {
        let error = "";
        if (this.state.address.search(/\s+/) !== -1)
            error = _("The IP address or hostname cannot contain whitespace.");
        else {
            const machine = this.props.machines_ins.lookup(this.state.address);
            const machine_address = machine ? full_address(this.props.machines_ins, machine.address) : undefined;
            if (machine && machine.on_disk && machine_address != this.props.old_address) {
                if (machine.visible)
                    error = _("This machine has already been added.");
                else if (!this.state.userChanged)
                    this.setState({ user: machine.user, color: this.rgb2Hex(machine.color) });
            } else if (this.state.old_machine && !machine && !this.state.userChanged) { // When editing host by changing its address generate new color
                this.setState((_, prevProps) => ({ color: prevProps.machines_ins.unused_color(), userChanged: true }));
            }
        }

        this.setState({ addressError: error });

        return error;
    }

    onAddHost() {
        const parts = this.props.machines_ins.split_connection_string(this.state.address);
        // user in "User name:" field wins over user in connection string
        const address = this.props.machines_ins.generate_connection_string(this.state.user || parts.user, parts.port, parts.address);

        if (this.onAddressChange())
            return;

        this.props.setAddress(address);

        if (this.state.old_machine && address === this.state.old_machine.connection_string) {
            this.props.setError(null);
            this.setState({ inProgress: true });
            this.props.run(this.props.machines_ins.change(this.state.old_machine.key, { color: this.state.color }))
                    .catch(ex => {
                        this.setState({ inProgress: false });
                        throw ex;
                    });
            return;
        }

        this.props.setError(null);
        this.setState({ inProgress: true });

        this.props.setGoal(() => {
            const parts = this.props.machines_ins.split_connection_string(this.state.address);
            // user in "User name:" field wins over user in connection string
            const address = this.props.machines_ins.generate_connection_string(this.state.user || parts.user, parts.port, parts.address);

            return new Promise((resolve, reject) => {
                this.props.machines_ins.add(address, this.state.color)
                        .then(() => {
                            // When changing address of machine, hide the old one
                            if (this.state.old_machine && this.state.old_machine != this.props.machines_ins.lookup(address)) {
                                this.props.machines_ins.change(this.state.old_machine.key, { visible: false })
                                        .then(resolve);
                            } else {
                                resolve();
                            }
                        })
                        .catch(ex => {
                            ex.message = cockpit.format(_("Failed to add machine: $0"), cockpit.message(ex));
                            this.setState({ dialogError: cockpit.message(ex), inProgress: false });
                            reject(ex);
                        });
            });
        });

        this.props.run(this.props.try2Connect(address), ex => {
            if (ex.problem === "no-host") {
                let host_id_port = address;
                let port = "22";
                const port_index = host_id_port.lastIndexOf(":");
                if (port_index === -1)
                    host_id_port = address + ":22";
                else
                    port = host_id_port.substr(port_index + 1);

                ex.message = cockpit.format(_("Unable to contact the given host $0. Make sure it has ssh running on port $1, or specify another port in the address."), host_id_port, port);
                ex.problem = "not-found";
            }
            this.setState({ inProgress: false });
            this.props.setError(ex);
        });
    }

    render() {
        const invisible = this.props.machines_ins.addresses.filter(addr => {
            const m = this.props.machines_ins.lookup(addr);
            return !m || !m.visible;
        });

        const callback = this.onAddHost;
        const title = this.state.old_machine ? _("Edit host") : _("Add new host");
        const submitText = this.state.old_machine ? _("Set") : _("Add");

        const body = <Form isHorizontal onSubmit={prevent_default(callback)}>
            <FormGroup label={_("Host")}>
                <TextInput id="add-machine-address" onChange={(_event, address) => this.setState({ address })}
                        validated={this.state.addressError ? "error" : "default"} onBlur={this.onAddressChange}
                        isDisabled={this.props.old_address === "localhost"} list="options" value={this.state.address} />
                <datalist id="options">
                    {invisible.map(a => <option key={a} value={a} />)}
                </datalist>
                <FormHelper helperTextInvalid={this.state.addressError} helperText={_("Can be a hostname, IP address, alias name, or ssh:// URI")} />
            </FormGroup>
            <FormGroup label={_("User name")}>
                <TextInput id="add-machine-user" onChange={(_event, value) => this.setState({ user: value, userChanged: true })}
                        isDisabled={this.props.old_address === "localhost"} value={this.state.user} />
                <FormHelper helperText={_("When empty, connect with the current user")} />
            </FormGroup>
            <FormGroup label={_("Color")}>
                <input type="color" value={this.state.color} onChange={(e) => this.setState({ color: e.target.value }) } />
            </FormGroup>
        </Form>;

        return (
            <Modal id="hosts_setup_server_dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.onClose}
                   title={title}
                   footer={<>
                       <Button variant="primary" onClick={callback} isLoading={this.state.inProgress}
                               isDisabled={this.state.address === "" || this.state.addressError !== "" || this.state.inProgress}>
                           { submitText }
                       </Button>
                       <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                           { _("Cancel") }
                       </Button>
                   </>}
            >
                <Stack hasGutter>
                    { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                    {body}
                </Stack>
            </Modal>
        );
    }
}

class MachinePort extends React.Component {
    constructor(props) {
        super(props);

        const machine = props.machines_ins.lookup(props.full_address);
        if (!machine) {
            props.onClose();
            return;
        }

        this.state = {
            port: machine.port,
        };

        this.onChangePort = this.onChangePort.bind(this);
    }

    onChangePort() {
        const promise = new Promise((resolve, reject) => {
            const parts = this.props.machines_ins.split_connection_string(this.props.full_address);
            parts.port = this.state.port;
            const address = this.props.machines_ins.generate_connection_string(parts.user,
                                                                               parts.port,
                                                                               parts.address);
            const self = this;

            function update_host(ex) {
                self.props.setAddress(address);
                self.props.machines_ins.change(parts.address, { port: parts.port })
                        .then(() => {
                            // We failed before so try to connect again now that the machine is saved
                            if (ex) {
                                self.props.try2Connect(address)
                                        .then(self.props.complete)
                                        .catch(reject);
                            } else {
                                resolve();
                            }
                        })
                        .catch(ex => reject(cockpit.format(_("Failed to edit machine: $0"), cockpit.message(ex))));
            }

            this.props.try2Connect(address)
                    .then(update_host)
                    .catch(ex => {
                        // any other error means progress, so save
                        if (ex.problem !== 'no-host')
                            update_host(ex);
                        else
                            reject(ex);
                    });
        });

        this.props.run(promise);
    }

    render() {
        const callback = this.onChangePort;
        const title = cockpit.format(_("Could not contact $0"), this.props.full_address);
        const submitText = _("Update");

        const body = <>
            <p>
                <span>{cockpit.format(_("Unable to contact $0."), this.props.full_address)}</span>
                <span>{_("Is sshd running on a different port?")}</span>
            </p>
            <Form isHorizontal onSubmit={prevent_default(callback)}>
                <FormGroup label={_("Port")}>
                    <TextInput id="edit-machine-port" onChange={(_event, value) => this.setState({ port: value })} />
                </FormGroup>
            </Form>
        </>;

        return (
            <Modal id="hosts_setup_server_dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.onClose}
                   title={title}
                   footer={<>
                       <Button variant="primary" onClick={callback} isLoading={this.state.inProgress}
                               isDisabled={this.state.inProgress}>
                           { submitText }
                       </Button>
                       <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                           { _("Cancel") }
                       </Button>
                   </>}
            >
                <Stack hasGutter>
                    { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                    {body}
                </Stack>
            </Modal>
        );
    }
}

class HostKey extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            inProgress: false,
            verifyExpanded: false,
            error_options: props.error_options,
        };

        this.onAddKey = this.onAddKey.bind(this);
    }

    componentDidMount() {
        if (!this.props.error_options || !this.props.error_options["host-key"]) {
            const options = {};
            let match_problem = this.props.template;
            if (this.props.template == "unknown-host") {
                options.session = "private";
                match_problem = "unknown-hostkey";
            }

            this.props.try2Connect(this.props.full_address, options)
                    .then(this.props.complete)
                    .catch(ex => {
                        if (ex.problem !== match_problem) {
                            this.props.setError(ex);
                        } else {
                            this.setState({ error_options: ex });
                        }
                    });
        }
    }

    onAddKey() {
        this.setState({ inProgress: true });

        const key = this.state.error_options["host-key"];
        const machine = this.props.machines_ins.lookup(this.props.full_address);
        let q;
        if (!machine || machine.on_disk) {
            q = this.props.machines_ins.add_key(key);
        } else {
            // When machine isn't saved to disk don't save the key either
            q = this.props.machines_ins.change(this.props.full_address, { host_key: key });
        }

        this.props.run(q.then(() => {
            return this.props.try2Connect(this.props.full_address, {})
                    .catch(ex => {
                        if ((ex.problem == "invalid-hostkey" || ex.problem == "unknown-hostkey") && machine && !machine.on_disk)
                            this.props.machines_ins.change(this.props.full_address, { host_key: null });
                        else {
                            this.setState({ inProgress: false });
                            throw ex;
                        }
                    });
        }));
    }

    render() {
        let key_type = "";
        let fp = "";
        if (this.state.error_options && this.state.error_options["host-key"]) {
            key_type = this.state.error_options["host-key"].split(" ")[1];
            fp = this.state.error_options["host-fingerprint"];
        }

        const scan_cmd = `ssh-keyscan -t ${key_type} localhost | ssh-keygen -lf -`;

        const callback = this.onAddKey;
        const title = cockpit.format(this.props.template === "invalid-hostkey" ? _("$0 key changed") : _("New host: $0"),
                                     this.props.host);
        const submitText = _("Trust and add host");
        let unknown = false;
        let body = null;
        if (!key_type) {
            unknown = true;
        } else if (this.props.template === "invalid-hostkey") {
            body = <>
                <Alert variant='danger' isInline title={_("Changed keys are often the result of an operating system reinstallation. However, an unexpected change may indicate a third-party attempt to intercept your connection.")} />
                <p>{_("To ensure that your connection is not intercepted by a malicious third-party, please verify the host key fingerprint:")}</p>
                <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-fingerprint pf-v5-u-font-family-monospace">{fp}</ClipboardCopy>
                <p className="hostkey-type">({key_type})</p>
                <p>{cockpit.format(_("To verify a fingerprint, run the following on $0 while physically sitting at the machine or through a trusted network:"), this.props.host)}</p>
                <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-verify-help-cmds pf-v5-u-font-family-monospace">{scan_cmd}</ClipboardCopy>
                <p>{_("The resulting fingerprint is fine to share via public methods, including email.")}</p>
                <p>{_("If the fingerprint matches, click 'Trust and add host'. Otherwise, do not connect and contact your administrator.")}</p>
            </>;
        } else {
            const fingerprint_help = <Popover bodyContent={
                _("The resulting fingerprint is fine to share via public methods, including email. If you are asking someone else to do the verification for you, they can send the results using any method.")}>
                <OutlinedQuestionCircleIcon />
            </Popover>;
            body = <>
                <p>{cockpit.format(_("You are connecting to $0 for the first time."), this.props.host)}</p>
                <ExpandableSection toggleText={ _("Verify fingerprint") }
                                   isExpanded={this.state.verifyExpanded}
                                   onToggle={(_ev, verifyExpanded) => this.setState({ verifyExpanded }) }>
                    <div>{_("Run this command over a trusted network or physically on the remote machine:")}</div>
                    <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-verify-help hostkey-verify-help-cmds pf-v5-u-font-family-monospace">{scan_cmd}</ClipboardCopy>
                    <div>{_("The fingerprint should match:")} {fingerprint_help}</div>
                    <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-verify-help hostkey-fingerprint pf-v5-u-font-family-monospace">{fp}</ClipboardCopy>
                </ExpandableSection>
                <Alert variant='warning' isInline isPlain title={_("Malicious pages on a remote machine may affect other connected hosts")} />
            </>;
        }

        return (
            <Modal id="hosts_setup_server_dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.onClose}
                   title={title}
                   footer={<>
                       { unknown ||
                           <Button variant="primary" onClick={callback} isLoading={this.state.inProgress}
                                   isDisabled={this.state.inProgress}>
                               { submitText }
                           </Button>
                       }
                       <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                           { _("Cancel") }
                       </Button>
                   </>}
            >
                <Stack hasGutter>
                    { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                    {body}
                </Stack>
            </Modal>
        );
    }
}

class ChangeAuth extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            auth: "password",
            auto_login: false,
            custom_password: "",
            custom_password_error: "",
            locked_identity_password: "",
            locked_identity_password_error: "",
            login_setup_new_key_password: "",
            login_setup_new_key_password_error: "",
            login_setup_new_key_password2: "",
            login_setup_new_key_password2_error: "",
            user: "",
            default_ssh_key: null,
            identity_path: null,
            inProgress: true, // componentDidMount changes to false once loaded
        };

        this.keys = null;
        if (credentials)
            this.keys = credentials.keys_instance();

        this.getSupports = this.getSupports.bind(this);
        this.updateIdentity = this.updateIdentity.bind(this);
        this.login = this.login.bind(this);
        this.maybe_create_key = this.maybe_create_key.bind(this);
        this.authorize_key = this.authorize_key.bind(this);
        this.maybe_unlock_key = this.maybe_unlock_key.bind(this);
    }

    updateIdentity() {
        let identity_path = null;
        if (this.props.error_options && this.props.error_options.error && this.props.error_options.error.startsWith("locked identity"))
            identity_path = this.props.error_options.error.split(": ")[1];

        const default_ssh_key = this.state.default_ssh_key;
        if (default_ssh_key && default_ssh_key.encrypted)
            default_ssh_key.unaligned_passphrase = identity_path && identity_path === default_ssh_key.name;

        this.setState({ identity_path, default_ssh_key });
    }

    componentDidMount() {
        cockpit.user()
                .then(user =>
                    cockpit.script(ssh_show_default_key_sh, [], { })
                            .then(data => {
                                let default_ssh_key = null;
                                const info = data.split("\n");
                                if (info[0])
                                    default_ssh_key = { name: info[0], exists: true, encrypted: info[1] === "encrypted" };
                                else
                                    default_ssh_key = { name: user.home + "/.ssh/id_rsa", type: "rsa", exists: false };

                                return this.setState({ inProgress: false, default_ssh_key, user }, this.updateIdentity);
                            })
                )
                .catch(ex => { this.setState({ inProgress: false }); this.props.setError(ex) });

        if (!this.props.error_options || this.props.error_options["auth-method-results"] === null) {
            this.props.try2Connect(this.props.full_address)
                    .then(this.props.complete)
                    .catch(ex => {
                        this.setState({ inProgress: false });
                        this.props.setError(ex);
                    });
        }
    }

    componentWillUnmount() {
        if (this.keys)
            this.keys.close();
        this.keys = null;
    }

    componentDidUpdate(prevProps) {
        if (prevProps.error_options !== this.props.error_options)
            this.updateIdentity();
    }

    getSupports() {
        let methods = null;
        let available = null;

        let offer_login_password = false;
        let offer_key_password = false;

        if (this.props.error_options) {
            available = {};

            methods = this.props.error_options["auth-method-results"];
            if (methods) {
                for (const method in methods) {
                    if (is_method_supported(methods, method)) {
                        available[method] = true;
                    }
                }
            }

            offer_login_password = !!available.password;
            offer_key_password = this.state.identity_path !== null;
        } else {
            offer_login_password = true;
            offer_key_password = false;
        }

        return {
            offer_login_password,
            offer_key_password,
        };
    }

    maybe_create_key(passphrase) {
        if (!this.state.default_ssh_key.exists)
            return this.keys.create(this.state.default_ssh_key.name, this.state.default_ssh_key.type, passphrase);
        else
            return Promise.resolve();
    }

    authorize_key(host) {
        return this.keys.get_pubkey(this.state.default_ssh_key.name)
                .then(data => cockpit.script(ssh_add_key_sh, [data.trim()], { host, err: "message" }));
    }

    maybe_unlock_key() {
        const { offer_login_password, offer_key_password } = this.getSupports();
        const both = offer_login_password && offer_key_password;

        if ((both && this.state.auth === "key") || (!both && offer_key_password))
            return this.keys.load(this.state.identity_path, this.state.locked_identity_password);
        else
            return Promise.resolve();
    }

    login() {
        const options = {};
        const user = this.props.machines_ins.split_connection_string(this.props.full_address).user || "";
        const do_key_password_change = this.state.auto_login && this.state.default_ssh_key.unaligned_passphrase;

        let custom_password_error = "";
        let locked_identity_password_error = "";
        let login_setup_new_key_password_error = "";
        let login_setup_new_key_password2_error = "";

        const { offer_login_password, offer_key_password } = this.getSupports();
        const both = offer_login_password && offer_key_password;

        if ((both && this.state.auth === "password") || (!both && offer_login_password)) {
            if (!this.state.custom_password)
                custom_password_error = _("The password can not be empty");

            options.password = this.state.custom_password;
            options.session = 'shared';
            if (!user) {
                /* we don't want to save the default user for everyone
                 * so we pass current user as an option, but make sure the
                 * session isn't private
                 */
                if (this.state.user && this.state.user.name)
                    options.user = this.state.user.name;
                options["temp-session"] = false; /* Compatibility option */
            }
        }

        if ((offer_key_password && !(both && this.state.auth === "password")) && !this.state.locked_identity_password)
            locked_identity_password_error = _("The key password can not be empty");

        if (this.state.auto_login && !do_key_password_change && this.state.login_setup_new_key_password !== this.state.login_setup_new_key_password2)
            login_setup_new_key_password2_error = _("The key passwords do not match");

        if (do_key_password_change && !this.state.login_setup_new_key_password)
            login_setup_new_key_password_error = _("The new key password can not be empty");

        if (do_key_password_change && this.state.login_setup_new_key_password !== this.state.login_setup_new_key_password2)
            login_setup_new_key_password2_error = _("The key passwords do not match");

        if (custom_password_error || locked_identity_password_error || login_setup_new_key_password_error || login_setup_new_key_password2_error) {
            this.setState({
                custom_password_error,
                locked_identity_password_error,
                login_setup_new_key_password_error,
                login_setup_new_key_password2_error,
            });
            return;
        }

        this.setState({ inProgress: true });
        const machine = this.props.machines_ins.lookup(this.props.full_address);

        this.props.run(this.maybe_unlock_key()
                .then(() => {
                    return this.props.try2Connect(this.props.full_address, options)
                            .then(() => {
                                if (machine)
                                    return this.props.machines_ins.change(machine.address, { user });
                                else
                                    return Promise.resolve();
                            })
                            .then(() => {
                                if (do_key_password_change)
                                    return this.keys.change(this.state.default_ssh_key.name, this.state.locked_identity_password, this.state.login_setup_new_key_password);
                                else if (this.state.auto_login)
                                    return this.maybe_create_key(this.state.login_setup_new_key_password)
                                            .then(() => this.authorize_key(this.props.full_address));
                                else
                                    return Promise.resolve();
                            });
                })
                .catch(ex => {
                    this.setState({ inProgress: false });
                    throw ex;
                }));
    }

    render() {
        const { offer_login_password, offer_key_password } = this.getSupports();
        const both = offer_login_password && offer_key_password;

        let offer_key_setup = true;
        let show_password_advice = true;
        if (!this.state.default_ssh_key)
            offer_key_setup = false;
        else if (this.state.default_ssh_key.unaligned_passphrase)
            offer_key_setup = (both && this.state.auth === "key") || (!both && offer_key_password);
        else if (this.state.identity_path) {
            // This is a locked, non-default identity that will never
            // be loaded into the agent, so there is no point in
            // offering to change the passphrase.
            show_password_advice = false;
            offer_key_setup = false;
        }

        const callback = this.login;
        const title = cockpit.format(_("Log in to $0"), this.props.full_address);
        const submitText = _("Log in");
        let statement = "";

        if (!offer_login_password && !offer_key_password)
            statement = <p>{cockpit.format(_("Unable to log in to $0. The host does not accept password login or any of your SSH keys."), this.props.full_address)}</p>;
        else if (offer_login_password && !offer_key_password)
            statement = <p>{cockpit.format(_("Unable to log in to $0 using SSH key authentication. Please provide the password. You may want to set up your SSH keys for automatic login."), this.props.full_address)}</p>;
        else if (offer_key_password && !offer_login_password)
            statement = <>
                <p>{cockpit.format(_("The SSH key for logging in to $0 is protected by a password, and the host does not allow logging in with a password. Please provide the password of the key at $1."), this.props.full_address, this.state.identity_path)}</p>
                {show_password_advice && <span className="password-change-advice">{_("You may want to change the password of the key for automatic login.")}</span>}
            </>;
        else if (both)
            statement = <>
                <p>{cockpit.format(_("The SSH key for logging in to $0 is protected. You can log in with either your login password or by providing the password of the key at $1."), this.props.full_address, this.state.identity_path)}</p>
                {show_password_advice && <span className="password-change-advice">{_("You may want to change the password of the key for automatic login.")}</span>}
            </>;

        let auto_text = null;
        let auto_details = null;
        if (this.state.default_ssh_key) {
            const lmach = this.props.machines_ins.lookup(null);
            const key = this.state.default_ssh_key.name;
            const luser = this.state.user.name;
            const lhost = lmach ? lmach.label || lmach.address : "localhost";
            const afile = "~/.ssh/authorized_keys";
            const ruser = this.props.machines_ins.split_connection_string(this.props.full_address).user || this.state.user.name;
            const rhost = this.props.machines_ins.split_connection_string(this.props.full_address).address;
            if (!this.state.default_ssh_key.exists) {
                auto_text = _("Create a new SSH key and authorize it");
                auto_details = <>
                    <p>{cockpit.format(_("A new SSH key at $0 will be created for $1 on $2 and it will be added to the $3 file of $4 on $5."), key, luser, lhost, afile, ruser, rhost)}</p>
                    <FormGroup label={_("Key password")}>
                        <TextInput id="login-setup-new-key-password" onChange={(_event, value) => this.setState({ login_setup_new_key_password: value })}
                                type="password" value={this.state.login_setup_new_key_password} validated={this.state.login_setup_new_key_password_error ? "error" : "default"} />
                        <FormHelper helperTextInvalid={this.state.login_setup_new_key_password_error} />
                    </FormGroup>
                    <FormGroup label={_("Confirm key password")}>
                        <TextInput id="login-setup-new-key-password2" onChange={(_event, value) => this.setState({ login_setup_new_key_password2: value })}
                                type="password" value={this.state.login_setup_new_key_password2} validated={this.state.login_setup_new_key_password2_error ? "error" : "default"} />
                        <FormHelper helperTextInvalid={this.state.login_setup_new_key_password2_error} />
                    </FormGroup>
                    <p>{cockpit.format(_("In order to allow log in to $0 as $1 without password in the future, use the login password of $2 on $3 as the key password, or leave the key password blank."), rhost, ruser, luser, lhost)}</p>
                </>;
            } else if (this.state.default_ssh_key.unaligned_passphrase) {
                auto_text = cockpit.format(_("Change the password of $0"), key);
                auto_details = <>
                    <p>{cockpit.format(_("By changing the password of the SSH key $0 to the login password of $1 on $2, the key will be automatically made available and you can log in to $3 without password in the future."), key, luser, lhost, afile, rhost)}</p>
                    <FormGroup label={_("New key password")}>
                        <TextInput id="login-setup-new-key-password" onChange={(_event, value) => this.setState({ login_setup_new_key_password: value })}
                                type="password" value={this.state.login_setup_new_key_password} validated={this.state.login_setup_new_key_password_error ? "error" : "default"} />
                        <FormHelper helperTextInvalid={this.state.login_setup_new_key_password_error} />
                    </FormGroup>
                    <FormGroup label={_("Confirm new key password")} validated={this.state.login_setup_new_key_password2_error ? "error" : "default"}>
                        <TextInput id="login-setup-new-key-password2" onChange={(_event, value) => this.setState({ login_setup_new_key_password2: value })}
                                type="password" value={this.state.login_setup_new_key_password2} validated={this.state.login_setup_new_key_password2_error ? "error" : "default"} />

                        <FormHelper helperTextInvalid={this.state.login_setup_new_key_password2_error} />
                    </FormGroup>
                    <p>{cockpit.format(_("In order to allow log in to $0 as $1 without password in the future, use the login password of $2 on $3 as the key password, or leave the key password blank."), rhost, ruser, luser, lhost)}</p>
                </>;
            } else {
                auto_text = _("Authorize SSH key");
                auto_details = <>
                    <p>{cockpit.format(_("The SSH key $0 of $1 on $2 will be added to the $3 file of $4 on $5."), key, luser, lhost, afile, ruser, rhost)}</p>
                    <p>{_("This will allow you to log in without password in the future.")}</p>
                </>;
            }
        }

        const body = <>
            {statement}
            <br />
            {(offer_login_password || offer_key_password) &&
                <Form isHorizontal onSubmit={prevent_default(callback)}>
                    {both &&
                        <FormGroup label={_("Authentication")} isInline hasNoPaddingTop>
                            <Radio isChecked={this.state.auth === "password"}
                                   onChange={() => this.setState({ auth: "password" })}
                                   id="auth-password"
                                   value="password"
                                   label={_("Password")} />
                            <Radio isChecked={this.state.auth === "key"}
                                   onChange={() => this.setState({ auth: "key" })}
                                   id="auth-key"
                                   value="key"
                                   label={_("SSH key")} />
                        </FormGroup>
                    }
                    {((both && this.state.auth === "password") || (!both && offer_login_password)) &&
                        <FormGroup label={_("Password")}>
                            <TextInput id="login-custom-password" onChange={(_event, value) => this.setState({ custom_password: value })}
                                       type="password" value={this.state.custom_password} validated={this.state.custom_password_error ? "error" : "default"} />
                            <FormHelper helperTextInvalid={this.state.custom_password_error} />
                        </FormGroup>
                    }
                    {((both && this.state.auth === "key") || (!both && offer_key_password)) &&
                        <FormGroup label={_("Key password")}>
                            <TextInput id="locked-identity-password" onChange={(_event, value) => this.setState({ locked_identity_password: value })}
                                    type="password" autoComplete="new-password" value={this.state.locked_identity_password} validated={this.state.locked_identity_password_error ? "error" : "default"} />
                            <FormHelper
                                helperText={cockpit.format(_("The SSH key $0 will be made available for the remainder of the session and will be available for login to other hosts as well."), this.state.identity_path)}
                                helperTextInvalid={this.state.locked_identity_password_error} />
                        </FormGroup>
                    }
                    {offer_key_setup &&
                        <FormGroup label={ _("Automatic login") } hasNoPaddingTop isInline>
                            <Checkbox onChange={(_event, checked) => this.setState({ auto_login: checked })}
                                      isChecked={this.state.auto_login} id="login-setup-keys"
                                      label={auto_text} body={this.state.auto_login ? auto_details : null} />
                        </FormGroup>
                    }
                </Form>
            }
        </>;

        return (
            <Modal id="hosts_setup_server_dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.onClose}
                   title={title}
                   footer={<>
                       <Button variant="primary" onClick={callback} isLoading={this.state.inProgress}
                               isDisabled={this.state.inProgress || (!offer_login_password && !offer_key_password) || !this.state.default_ssh_key || !this.props.error_options}>
                           { submitText }
                       </Button>
                       <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                           { _("Cancel") }
                       </Button>
                   </>}
            >
                <Stack hasGutter>
                    { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                    {body}
                </Stack>
            </Modal>
        );
    }
}

export class HostModal extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            current_template: this.props.template || "add-machine",
            address: full_address(props.machines_ins, props.address),
            old_address: full_address(props.machines_ins, props.address),
            error_options: null,
            dialogError: "", // Error to be shown in the modal
        };

        this.promise_callback = null;

        this.addressOrLabel = this.addressOrLabel.bind(this);
        this.changeContent = this.changeContent.bind(this);
        this.try2Connect = this.try2Connect.bind(this);
        this.setGoal = this.setGoal.bind(this);
        this.setError = this.setError.bind(this);
        this.setAddress = this.setAddress.bind(this);
        this.run = this.run.bind(this);
        this.complete = this.complete.bind(this);
    }

    addressOrLabel() {
        const machine = this.props.machines_ins.lookup(this.state.address);
        let host = this.props.machines_ins.split_connection_string(this.state.address).address;
        if (machine && machine.label)
            host = machine.label;
        return host;
    }

    changeContent(template, error_options) {
        if (this.state.current_template !== template)
            this.setState({ current_template: template, error_options });
    }

    try2Connect(address, options) {
        return new Promise((resolve, reject) => {
            const conn_options = { ...options, payload: "echo", host: address };

            conn_options["init-superuser"] = get_init_superuser_for_options(conn_options);

            const machine = this.props.machines_ins.lookup(address);
            if (machine && machine.host_key && !machine.on_disk) {
                conn_options['temp-session'] = false; // Compatibility option
                conn_options.session = 'shared';
                conn_options['host-key'] = machine.host_key;
            }

            const client = cockpit.channel(conn_options);
            client.send("x");
            client.addEventListener("message", () => {
                resolve();
                client.close();
            });
            client.addEventListener("close", (event, options) => {
                reject(options);
            });
        });
    }

    complete() {
        if (this.promise_callback)
            this.promise_callback().then(this.props.onClose);
        else
            this.props.onClose();
    }

    setGoal(callback) {
        this.promise_callback = callback;
    }

    setError(error) {
        if (error === null)
            return this.setState({ dialogError: null });

        let template = null;
        if (error.problem && error.command === "close")
            template = codes[error.problem];

        if (template && this.state.current_template !== template)
            this.changeContent(template, error);
        else
            this.setState({ error_options: error, dialogError: cockpit.message(error) });
    }

    setAddress(address) {
        this.setState({ address });
    }

    run(promise, failure_callback) {
        return new Promise((resolve, reject) => {
            const promise_funcs = [];
            const self = this;

            function next(i) {
                promise_funcs[i]()
                        .then(val => {
                            i = i + 1;
                            if (i < promise_funcs.length) {
                                next(i);
                            } else {
                                resolve();
                                self.props.onClose();
                            }
                        })
                        .catch(ex => {
                            if (failure_callback)
                                failure_callback(ex);
                            else
                                self.setError(ex);
                        });
            }

            promise_funcs.push(() => { return promise });

            if (this.promise_callback)
                promise_funcs.push(this.promise_callback);

            if (this.props.caller_callback)
                promise_funcs.push(() => this.props.caller_callback(this.state.address));

            next(0);
        });
    }

    render() {
        const template = this.state.current_template;

        const props = {
            template,
            host: this.addressOrLabel(),
            full_address: this.state.address,
            old_address: this.state.old_address,
            address_data: this.props.machines_ins.split_connection_string(this.state.address),
            error_options: this.state.error_options,
            dialogError: this.state.dialogError,
            machines_ins: this.props.machines_ins,
            onClose: this.props.onClose,
            run: this.run,
            setGoal: this.setGoal,
            setError: this.setError,
            setAddress: this.setAddress,
            try2Connect: this.try2Connect,
            complete: this.complete,
        };

        if (template === "add-machine")
            return <AddMachine {...props} />;
        else if (template === "unknown-hostkey" || template === "unknown-host" || template === "invalid-hostkey")
            return <HostKey {...props} />;
        else if (template === "change-auth")
            return <ChangeAuth {...props} />;
        else if (template === "change-port")
            return <MachinePort {...props} />;
        else if (template === "not-supported")
            return <NotSupported {...props} />;

        console.error("Unknown template:", template);
        return null;
    }
}

HostModal.propTypes = {
    machines_ins: PropTypes.object.isRequired,
    onClose: PropTypes.func.isRequired,
    caller_callback: PropTypes.func,
    address: PropTypes.string,
    template: PropTypes.string,
};
