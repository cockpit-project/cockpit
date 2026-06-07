/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

import {
    get_init_superuser_for_options, split_connection_string, generate_connection_string,
    type Machine, type Machines
} from "./machines/machines";
import * as credentials from "credentials";
import ssh_show_default_key_sh from "../lib/ssh-show-default-key.sh";
import ssh_add_key_sh from "../lib/ssh-add-key.sh";

import React from 'react';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { OutlinedQuestionCircleIcon, ExternalLinkAltIcon } from "@patternfly/react-icons";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Content, ContentVariants } from "@patternfly/react-core/dist/esm/components/Content";

import { FormHelper } from "cockpit-components-form-helper";
import { ModalError } from "cockpit-components-inline-notification.jsx";
import { fmt_to_fragments } from "utils.js";

import type { ShellState } from "./state";

const _ = cockpit.gettext;

interface ConnectionError {
    problem?: string;
    command?: string;
    message?: string;
    "host-key"?: string;
    "host-fingerprint"?: string;
    "auth-method-results"?: Record<string, string> | null;
    error?: string;
}

interface HostModalProperties {
    address?: string;
    template?: string;
    error_options?: ConnectionError;
}

interface HostModalStateEvents extends cockpit.EventMap {
    changed: () => void;
}

interface HostModalStateObj {
    state: null;
    modal_properties: HostModalProperties | null;
    modal_callback: ((result: string | null) => Promise<void>) | null;
    show_modal: (properties: HostModalProperties) => Promise<string | null>;
    close_modal: () => void;
}

export const HostModalState = () => {
    const obj: HostModalStateObj = {
        state: null,
        modal_properties: null,
        modal_callback: null,
        show_modal,
        close_modal,
    };
    const self = cockpit.event_target<HostModalStateObj, HostModalStateEvents>(obj);

    function show_modal(properties: HostModalProperties) {
        return new Promise<string | null>((resolve) => {
            self.modal_properties = properties;
            self.modal_callback = result => { resolve(result); return Promise.resolve() };
            self.dispatchEvent("changed");
        });
    }

    function close_modal() {
        self.modal_properties = null;
        self.modal_callback = null;
        self.dispatchEvent("changed");
    }

    return self;
};

function jump_to_new_connection_string(shell_state: ShellState, connection_string: string) {
    const addr = split_connection_string(connection_string).address;
    shell_state.loader.connect(addr);
    shell_state.jump({ host: addr });
}

export async function add_host(state: ReturnType<typeof HostModalState>, shell_state: ShellState) {
    const connection_string = await state.show_modal({ });
    if (connection_string)
        jump_to_new_connection_string(shell_state, connection_string);
}

export const codes: Record<string, string> = {
    danger: "connect",
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

export async function edit_host(state: ReturnType<typeof HostModalState>, shell_state: ShellState, machine: Machine) {
    const { current_machine } = shell_state;
    const connection_string = await state.show_modal({ address: machine.address });
    if (connection_string) {
        const addr = split_connection_string(connection_string).address;
        if (machine == current_machine && addr != machine.address)
            jump_to_new_connection_string(shell_state, connection_string);
    }
}

export async function connect_host(state: ReturnType<typeof HostModalState>, shell_state: ShellState, machine: Machine) {
    if (machine.connection_string == "localhost" ||
        machine.state == "connected" ||
        machine.state == "connecting") {
        shell_state.loader.connect(machine.address);
        return machine.connection_string;
    }

    let connection_string = null;

    if (machine.problem && codes[machine.problem]) {
        connection_string = await state.show_modal({
            address: machine.address,
            template: codes[machine.problem],
        });
    } else if (!window.sessionStorage.getItem("connection-warning-shown")) {
        connection_string = await state.show_modal({
            address: machine.address,
            template: "connect"
        });
    } else {
        try {
            await try2Connect(shell_state.machines, machine.connection_string);
            connection_string = machine.connection_string;
        } catch (err) {
            const error = err as ConnectionError;
            connection_string = await state.show_modal({
                address: machine.address,
                template: codes[error.problem ?? ""] || "change-port",
                error_options: error,
            });
        }
    }

    if (connection_string) {
        const parts = split_connection_string(connection_string);
        shell_state.loader.connect(parts.address);
        shell_state.update();
    }

    return connection_string;
}

function full_address(machines_ins: Machines, address: string) {
    const machine = machines_ins.lookup(address);
    if (machine && machine.address !== "localhost")
        return machine.connection_string;

    return address;
}

function is_method_supported(methods: Record<string, string>, method: string) {
    const result = methods[method];
    return result ? result !== "no-server-support" : false;
}

function prevent_default(callback: () => void) {
    return (event: React.FormEvent) => {
        callback();
        event.preventDefault();
        return false;
    };
}

interface DialogCommonProps {
    template: string;
    host: string;
    full_address: string;
    old_address: string;
    address_data: ReturnType<typeof split_connection_string>;
    error_options: ConnectionError | null;
    dialogError: string | null;
    machines_ins: Machines;
    onClose: () => void;
    run: (promise: Promise<void>, failure_callback?: (ex: ConnectionError) => void) => Promise<void>;
    setGoal: (callback: () => Promise<void>) => void;
    setError: (error: ConnectionError | null, keep_message?: boolean) => void;
    setAddress: (address: string) => void;
    complete: () => void;
}

interface NotSupportedProps {
    onClose: () => void;
    dialogError: string | null;
    full_address: string;
}

class NotSupported extends React.Component<NotSupportedProps> {
    render() {
        return (
            <Modal id="hosts_setup_server_dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.onClose}
            >
                <ModalHeader title={_("Cockpit is not installed")} />
                <ModalBody>
                    <Stack hasGutter>
                        { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                        <p>{cockpit.format(_("A compatible version of Cockpit is not installed on $0."), this.props.full_address)}</p>
                    </Stack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="secondary" className="btn-cancel" onClick={this.props.onClose}>
                        { _("Close") }
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}

interface ConnectProps {
    onClose: () => void;
    machines_ins: Machines;
    full_address: string;
    host: string;
    run: (promise: Promise<void>, failure_callback?: (ex: ConnectionError) => void) => Promise<void>;
    setError: (error: ConnectionError | null, keep_message?: boolean) => void;
}

interface ConnectState {
    inProgress: boolean;
}

class Connect extends React.Component<ConnectProps, ConnectState> {
    constructor(props: ConnectProps) {
        super(props);

        this.state = {
            inProgress: false,
        };
    }

    onConnect() {
        window.sessionStorage.setItem("connection-warning-shown", "true");
        this.setState({ inProgress: true });
        this.props.run(try2Connect(this.props.machines_ins, this.props.full_address), ex => {
            let keep_message = false;
            if (ex.problem === "no-host") {
                let host_id_port = this.props.full_address;
                let port = "22";
                const port_index = host_id_port.lastIndexOf(":");
                if (port_index === -1) {
                    host_id_port = this.props.full_address + ":22";
                } else {
                    port = host_id_port.substring(port_index + 1);
                }

                ex.message = cockpit.format(_("Unable to contact the given host $0. Make sure it has ssh running on port $1, or specify another port in the address."), host_id_port, port);
                ex.problem = "not-found";
                keep_message = true;
            }
            this.setState({ inProgress: false });
            this.props.setError(ex, keep_message);
        });
    }

    render() {
        return (
            <Modal id="hosts_connect_server_dialog" isOpen
                   position="top" variant="small"
                   onClose={this.props.onClose}
            >
                <ModalHeader title={fmt_to_fragments(_("Connect to $0?"), <b className="ct-heading-font-weight">{this.props.host}</b>)}
                    titleIconVariant="warning"
                />
                <ModalBody>
                    <Content component={ContentVariants.p}>
                        {_("Connected hosts can fully control each other. This includes running programs that could harm your system or steal data. Only connect to trusted machines.")}
                    </Content>
                    <Content component={ContentVariants.p}>
                        <a href="https://cockpit-project.org/guide/latest/multi-host.html" target="blank" rel="noopener noreferrer">
                            <ExternalLinkAltIcon /> {_("Read more")}
                        </a>
                    </Content>
                </ModalBody>
                <ModalFooter>
                    <HelperText>
                        <HelperTextItem>{_("You will be reminded once per session.")}</HelperTextItem>
                    </HelperText>
                    <Button variant="warning" isLoading={this.state.inProgress}
                                    onClick={() => this.onConnect()}>
                        {_("Connect")}
                    </Button>
                    <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                        { _("Cancel") }
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}

interface AddMachineProps {
    full_address: string;
    old_address: string;
    machines_ins: Machines;
    dialogError: string | null;
    onClose: () => void;
    run: (promise: Promise<void>, failure_callback?: (ex: ConnectionError) => void) => Promise<void>;
    setGoal: (callback: () => Promise<void>) => void;
    setError: (error: ConnectionError | null, keep_message?: boolean) => void;
    setAddress: (address: string) => void;
}

interface AddMachineState {
    user: string;
    address: string;
    color: string;
    addressError: string;
    inProgress: boolean;
    old_machine: Machine | null;
    userChanged: boolean;
    dialogError?: string;
}

class AddMachine extends React.Component<AddMachineProps, AddMachineState> {
    constructor(props: AddMachineProps) {
        super(props);

        let address_parts = null;
        if (this.props.full_address)
            address_parts = split_connection_string(this.props.full_address);

        let host_address = "";
        let host_user = "";
        if (address_parts) {
            host_address = address_parts.address;
            if (address_parts.port)
                host_address += ":" + address_parts.port;
            host_user = address_parts.user || "";
        }

        let color = props.machines_ins.unused_color();
        let old_machine: Machine | null = null;
        if (props.old_address)
            old_machine = props.machines_ins.lookup(props.old_address);
        if (old_machine)
            color = this.rgb2Hex(old_machine.color || "");
        if (old_machine && !old_machine.visible)
            old_machine = null;

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

    rgb2Hex(c: string) {
        function toHex(d: string) {
            return ("0" + (parseInt(d, 10).toString(16)))
                    .slice(-2);
        }

        if (c[0] === "#")
            return c;

        const colors = /rgb\((\d*), (\d*), (\d*)\)/.exec(c);
        cockpit.assert(colors, "invalid color format");
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
                    this.setState({ user: machine.user || "", color: this.rgb2Hex(machine.color || "") });
            } else if (this.state.old_machine && !machine && !this.state.userChanged) {
                this.setState(() => ({ color: this.props.machines_ins.unused_color(), userChanged: true }));
            }
        }

        this.setState({ addressError: error });

        return error;
    }

    onAddHost() {
        const parts = split_connection_string(this.state.address);
        const address = generate_connection_string(this.state.user || parts.user || null, parts.port ? String(parts.port) : null, parts.address);

        if (this.onAddressChange())
            return;

        this.props.setAddress(address);

        if (this.state.old_machine && address === this.state.old_machine.connection_string) {
            this.props.setError(null);
            this.setState({ inProgress: true });
            this.props.run(this.props.machines_ins.change(this.state.old_machine.key, { color: this.state.color }))
                    .catch(() => {
                        this.setState({ inProgress: false });
                    });
            return;
        }

        this.props.setError(null);
        this.setState({ inProgress: true });

        this.props.setGoal(() => {
            const parts = split_connection_string(this.state.address);
            const address = generate_connection_string(this.state.user || parts.user || null, parts.port ? String(parts.port) : null, parts.address);

            return new Promise<void>((resolve, reject) => {
                this.props.machines_ins.add(address, this.state.color)
                        .then(() => {
                            if (this.state.old_machine && this.state.old_machine != this.props.machines_ins.lookup(address)) {
                                cockpit.assert(this.state.old_machine, "old_machine is null");
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

        if (!window.sessionStorage.getItem("connection-warning-shown")) {
            this.props.setError({ problem: "danger", command: "close" });
        } else {
            this.props.run(try2Connect(this.props.machines_ins, address), ex => {
                if (ex.problem === "no-host") {
                    let host_id_port = address;
                    let port = "22";
                    const port_index = host_id_port.lastIndexOf(":");
                    if (port_index === -1) {
                        host_id_port = address + ":22";
                    } else {
                        port = host_id_port.substring(port_index + 1);
                    }

                    ex.message = cockpit.format(_("Unable to contact the given host $0. Make sure it has ssh running on port $1, or specify another port in the address."), host_id_port, port);
                    ex.problem = "not-found";
                }
                this.setState({ inProgress: false });
                this.props.setError(ex);
            });
        }
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
            >
                <ModalHeader title={title} />
                <ModalBody>
                    <Stack hasGutter>
                        { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                        {body}
                    </Stack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" onClick={callback} isLoading={this.state.inProgress}
                            isDisabled={this.state.address === "" || this.state.addressError !== "" || this.state.inProgress}>
                        { submitText }
                    </Button>
                    <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                        { _("Cancel") }
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}

interface MachinePortProps {
    machines_ins: Machines;
    full_address: string;
    dialogError: string | null;
    onClose: () => void;
    run: (promise: Promise<void>, failure_callback?: (ex: ConnectionError) => void) => Promise<void>;
    setAddress: (address: string) => void;
    complete: () => void;
}

interface MachinePortState {
    port: number | undefined;
    inProgress: boolean;
}

class MachinePort extends React.Component<MachinePortProps, MachinePortState> {
    constructor(props: MachinePortProps) {
        super(props);

        const machine = props.machines_ins.lookup(props.full_address);
        if (!machine) {
            props.onClose();
            return;
        }

        this.state = {
            port: machine.port,
            inProgress: false,
        };

        this.onChangePort = this.onChangePort.bind(this);
    }

    onChangePort() {
        const promise = new Promise<void>((resolve, reject) => {
            const parts = split_connection_string(this.props.full_address);
            const port = this.state.port;
            const address = generate_connection_string(parts.user || null, port ? String(port) : null, parts.address);

            const update_host = (ex?: ConnectionError) => {
                this.props.setAddress(address);
                this.props.machines_ins.change(parts.address, port !== undefined ? { port } : {})
                        .then(() => {
                            if (ex) {
                                try2Connect(this.props.machines_ins, address)
                                        .then(this.props.complete)
                                        .catch(reject);
                            } else {
                                resolve();
                            }
                        })
                        .catch(ex => reject(cockpit.format(_("Failed to edit machine: $0"), cockpit.message(ex))));
            };

            try2Connect(this.props.machines_ins, address)
                    .then(() => update_host())
                    .catch(ex => {
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
                    <TextInput id="edit-machine-port" onChange={(_event, value) => this.setState({ port: parseInt(value) || undefined })} />
                </FormGroup>
            </Form>
        </>;

        return (
            <Modal id="hosts_setup_server_dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.onClose}
            >
                <ModalHeader title={title} />
                <ModalBody>
                    <Stack hasGutter>
                        { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                        {body}
                    </Stack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" onClick={callback} isLoading={this.state.inProgress}
                            isDisabled={this.state.inProgress}>
                        { submitText }
                    </Button>
                    <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                        { _("Cancel") }
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}

interface HostKeyProps {
    template: string;
    host: string;
    full_address: string;
    machines_ins: Machines;
    error_options: ConnectionError | null;
    dialogError: string | null;
    onClose: () => void;
    run: (promise: Promise<void>, failure_callback?: (ex: ConnectionError) => void) => Promise<void>;
    setError: (error: ConnectionError | null, keep_message?: boolean) => void;
    complete: () => void;
}

interface HostKeyState {
    inProgress: boolean;
    verifyExpanded: boolean;
    error_options: ConnectionError | null;
}

class HostKey extends React.Component<HostKeyProps, HostKeyState> {
    constructor(props: HostKeyProps) {
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
            const options: Record<string, string> = {};
            let match_problem = this.props.template;
            if (this.props.template == "unknown-host") {
                options.session = "private";
                match_problem = "unknown-hostkey";
            }

            try2Connect(this.props.machines_ins, this.props.full_address, options)
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

        cockpit.assert(this.state.error_options, "error_options is null");
        const key = this.state.error_options["host-key"];
        cockpit.assert(key, "host-key is null");
        const machine = this.props.machines_ins.lookup(this.props.full_address);
        let q;
        if (!machine || machine.on_disk) {
            q = this.props.machines_ins.add_key(key);
        } else {
            q = this.props.machines_ins.change(this.props.full_address, { host_key: key });
        }

        this.props.run(q.then(() => {
            return try2Connect(this.props.machines_ins, this.props.full_address, {})
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
            fp = this.state.error_options["host-fingerprint"] || "";
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
                <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-fingerprint pf-v6-u-font-family-monospace">{fp}</ClipboardCopy>
                <p className="hostkey-type">({key_type})</p>
                <p>{cockpit.format(_("To verify a fingerprint, run the following on $0 while physically sitting at the machine or through a trusted network:"), this.props.host)}</p>
                <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-verify-help-cmds pf-v6-u-font-family-monospace">{scan_cmd}</ClipboardCopy>
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
                    <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-verify-help hostkey-verify-help-cmds pf-v6-u-font-family-monospace">{scan_cmd}</ClipboardCopy>
                    <div>{_("The fingerprint should match:")} {fingerprint_help}</div>
                    <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-verify-help hostkey-fingerprint pf-v6-u-font-family-monospace">{fp}</ClipboardCopy>
                </ExpandableSection>
                <Alert variant='warning' isInline isPlain title={_("Malicious pages on a remote machine may affect other connected hosts")} />
            </>;
        }

        return (
            <Modal id="hosts_setup_server_dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.onClose}
            >
                <ModalHeader title={title} />
                <ModalBody>
                    <Stack hasGutter>
                        { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                        {body}
                    </Stack>
                </ModalBody>
                <ModalFooter>
                    { unknown ||
                        <Button variant="primary" onClick={callback} isLoading={this.state.inProgress}
                                isDisabled={this.state.inProgress}>
                            { submitText }
                        </Button>
                    }
                    <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                        { _("Cancel") }
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}

interface DefaultSshKey {
    name: string;
    type?: string;
    exists: boolean;
    encrypted?: boolean;
    unaligned_passphrase?: boolean;
}

interface ChangeAuthProps {
    full_address: string;
    machines_ins: Machines;
    error_options: ConnectionError | null;
    dialogError: string | null;
    onClose: () => void;
    run: (promise: Promise<void>, failure_callback?: (ex: ConnectionError) => void) => Promise<void>;
    setError: (error: ConnectionError | null, keep_message?: boolean) => void;
    complete: () => void;
}

interface ChangeAuthState {
    auth: string;
    auto_login: boolean;
    custom_password: string;
    custom_password_error: string;
    locked_identity_password: string;
    locked_identity_password_error: string;
    login_setup_new_key_password: string;
    login_setup_new_key_password_error: string;
    login_setup_new_key_password2: string;
    login_setup_new_key_password2_error: string;
    user: cockpit.UserInfo | null;
    default_ssh_key: DefaultSshKey | null;
    identity_path: string | null;
    inProgress: boolean;
}

class ChangeAuth extends React.Component<ChangeAuthProps, ChangeAuthState> {
    keys: credentials.Keys | null;

    constructor(props: ChangeAuthProps) {
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
            user: null,
            default_ssh_key: null,
            identity_path: null,
            inProgress: true,
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
        let identity_path: string | null = null;
        if (this.props.error_options && this.props.error_options.error && this.props.error_options.error.startsWith("locked identity"))
            identity_path = this.props.error_options.error.split(": ")[1];

        const default_ssh_key = this.state.default_ssh_key;
        if (default_ssh_key && default_ssh_key.encrypted)
            default_ssh_key.unaligned_passphrase = identity_path !== null && identity_path === default_ssh_key.name;

        this.setState({ identity_path, default_ssh_key });
    }

    componentDidMount() {
        cockpit.user()
                .then(user =>
                    cockpit.script(ssh_show_default_key_sh, [], { })
                            .then(data => {
                                let default_ssh_key: DefaultSshKey;
                                const info = data.split("\n");
                                if (info[0])
                                    default_ssh_key = { name: info[0], exists: true, encrypted: info[1] === "encrypted" };
                                else
                                    default_ssh_key = { name: user.home + "/.ssh/id_rsa", type: "rsa", exists: false };

                                return this.setState({ inProgress: false, default_ssh_key, user }, this.updateIdentity);
                            })
                )
                .catch(ex => { this.setState({ inProgress: false }); this.props.setError(ex as ConnectionError) });

        if (!this.props.error_options || this.props.error_options["auth-method-results"] === null) {
            try2Connect(this.props.machines_ins, this.props.full_address)
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

    componentDidUpdate(prevProps: ChangeAuthProps) {
        if (prevProps.error_options !== this.props.error_options)
            this.updateIdentity();
    }

    getSupports() {
        let methods: Record<string, string> | null | undefined = null;
        let available: Record<string, boolean> | null = null;

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

    maybe_create_key(passphrase: string) {
        cockpit.assert(this.keys, "keys is null");
        cockpit.assert(this.state.default_ssh_key, "default_ssh_key is null");
        if (!this.state.default_ssh_key.exists)
            return this.keys.create(this.state.default_ssh_key.name, this.state.default_ssh_key.type || "rsa", passphrase);
        else
            return Promise.resolve();
    }

    async authorize_key(host: string): Promise<void> {
        cockpit.assert(this.keys, "keys is null");
        cockpit.assert(this.state.default_ssh_key, "default_ssh_key is null");
        const data = await this.keys.get_pubkey(this.state.default_ssh_key.name);
        await cockpit.script(ssh_add_key_sh, [data.trim()], { host, err: "message" });
    }

    maybe_unlock_key() {
        cockpit.assert(this.keys, "keys is null");
        const { offer_login_password, offer_key_password } = this.getSupports();
        const both = offer_login_password && offer_key_password;

        if ((both && this.state.auth === "key") || (!both && offer_key_password)) {
            cockpit.assert(this.state.identity_path, "identity_path is null");
            return this.keys.load(this.state.identity_path, this.state.locked_identity_password);
        } else
            return Promise.resolve();
    }

    login() {
        const options: Record<string, string | boolean> = {};
        const user = split_connection_string(this.props.full_address).user || "";
        cockpit.assert(this.state.default_ssh_key, "default_ssh_key is null");
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
                    return try2Connect(this.props.machines_ins, this.props.full_address, options)
                            .then(() => {
                                if (machine)
                                    return this.props.machines_ins.change(machine.address, { user });
                                else
                                    return Promise.resolve();
                            })
                            .then(() => {
                                cockpit.assert(this.keys, "keys is null");
                                cockpit.assert(this.state.default_ssh_key, "default_ssh_key is null");
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
            show_password_advice = false;
            offer_key_setup = false;
        }

        const callback = this.login;
        const title = cockpit.format(_("Log in to $0"), this.props.full_address);
        const submitText = _("Log in");
        let statement: React.ReactNode = "";

        if (!offer_login_password && !offer_key_password)
            statement = <p>{cockpit.format(_("Unable to log in to $0. The host does not accept password login or any of your SSH keys."), this.props.full_address)}</p>;
        else if (offer_login_password && !offer_key_password)
            statement = <p>{cockpit.format(_("Unable to log in to $0 using SSH key authentication. Please provide the password. You may want to set up your SSH keys for automatic login."), this.props.full_address)}</p>;
        else if (offer_key_password && !offer_login_password)
            statement = <>
                <p>{cockpit.format(_("The SSH key for logging in to $0 is protected by a password, and the host does not allow logging in with a password. Please provide the password of the key at $1."), this.props.full_address, this.state.identity_path || "")}</p>
                {show_password_advice && <span className="password-change-advice">{_("You may want to change the password of the key for automatic login.")}</span>}
            </>;
        else if (both)
            statement = <>
                <p>{cockpit.format(_("The SSH key for logging in to $0 is protected. You can log in with either your login password or by providing the password of the key at $1."), this.props.full_address, this.state.identity_path || "")}</p>
                {show_password_advice && <span className="password-change-advice">{_("You may want to change the password of the key for automatic login.")}</span>}
            </>;

        let auto_text: string | null = null;
        let auto_details: React.ReactNode = null;
        if (this.state.default_ssh_key) {
            const lmach = this.props.machines_ins.lookup("localhost");
            const key = this.state.default_ssh_key.name;
            const luser = this.state.user?.name || "";
            const lhost = lmach ? lmach.label || lmach.address : "localhost";
            const afile = "~/.ssh/authorized_keys";
            const ruser = split_connection_string(this.props.full_address).user || this.state.user?.name || "";
            const rhost = split_connection_string(this.props.full_address).address;
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
                    <FormGroup label={_("Confirm new key password")}>
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
                                   name="auth-method"
                                   value="password"
                                   label={_("Password")} />
                            <Radio isChecked={this.state.auth === "key"}
                                   onChange={() => this.setState({ auth: "key" })}
                                   id="auth-key"
                                   name="auth-method"
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
                                helperText={cockpit.format(_("The SSH key $0 will be made available for the remainder of the session and will be available for login to other hosts as well."), this.state.identity_path || "")}
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
            >
                <ModalHeader title={title} />
                <ModalBody>
                    <Stack hasGutter>
                        { this.props.dialogError && <ModalError dialogError={this.props.dialogError} />}
                        {body}
                    </Stack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="primary" onClick={callback} isLoading={this.state.inProgress}
                            isDisabled={this.state.inProgress || (!offer_login_password && !offer_key_password) || !this.state.default_ssh_key || !this.props.error_options}>
                        { submitText }
                    </Button>
                    <Button variant="link" className="btn-cancel" onClick={this.props.onClose}>
                        { _("Cancel") }
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}

function try2Connect(machines_ins: Machines, address: string, options?: Record<string, string | boolean>) {
    return new Promise<void>((resolve, reject) => {
        const conn_options: Record<string, unknown> = { ...options, payload: "echo", host: address };

        conn_options["init-superuser"] = get_init_superuser_for_options(conn_options as Record<string, string>);

        const machine = machines_ins.lookup(address);
        if (machine && machine.host_key && !machine.on_disk) {
            conn_options['temp-session'] = false; // Compatibility option
            conn_options.session = 'shared';
            conn_options['host-key'] = machine.host_key;
        }

        const client = cockpit.channel({ ...conn_options, binary: false } as cockpit.ChannelOpenOptions & { binary: false });
        client.send("x");
        client.addEventListener("message", () => {
            resolve();
            client.close();
        });
        client.addEventListener("close", (_event, options) => {
            reject(options);
        });
    });
}

interface HostModalInnerProps {
    machines_ins: Machines;
    onClose: () => void;
    caller_callback?: (address: string | null) => Promise<void>;
    caller_cancelled?: () => void;
    address?: string;
    template?: string;
    error_options?: ConnectionError;
}

interface HostModalInnerState {
    current_template: string;
    address: string;
    old_address: string;
    error_options: ConnectionError | null;
    dialogError: string | null;
}

class HostModalInner extends React.Component<HostModalInnerProps, HostModalInnerState> {
    promise_callback: (() => Promise<void>) | null;

    constructor(props: HostModalInnerProps) {
        super(props);

        this.state = {
            current_template: this.props.template || "add-machine",
            address: full_address(props.machines_ins, props.address || ""),
            old_address: full_address(props.machines_ins, props.address || ""),
            error_options: this.props.error_options || null,
            dialogError: "",
        };

        this.promise_callback = null;

        this.addressOrLabel = this.addressOrLabel.bind(this);
        this.changeContent = this.changeContent.bind(this);
        this.setGoal = this.setGoal.bind(this);
        this.setError = this.setError.bind(this);
        this.setAddress = this.setAddress.bind(this);
        this.run = this.run.bind(this);
        this.complete = this.complete.bind(this);
    }

    addressOrLabel() {
        const machine = this.props.machines_ins.lookup(this.state.address);
        let host = split_connection_string(this.state.address).address;
        if (machine && machine.label)
            host = machine.label;
        return host;
    }

    changeContent(template: string, error_options: ConnectionError, with_error_message: boolean) {
        if (this.state.current_template !== template)
            this.setState({
                current_template: template,
                error_options,
                dialogError: with_error_message ? cockpit.message(error_options as cockpit.JsonObject) : null,
            });
    }

    complete() {
        if (this.promise_callback)
            this.promise_callback().then(this.props.onClose);
        else
            this.props.onClose();
    }

    setGoal(callback: () => Promise<void>) {
        this.promise_callback = callback;
    }

    setError(error: ConnectionError | null, keep_message_on_change?: boolean) {
        if (error === null)
            return this.setState({ dialogError: null });

        let template = null;
        if (error.problem && error.command === "close")
            template = codes[error.problem];

        if (template && this.state.current_template !== template)
            this.changeContent(template, error, !!keep_message_on_change);
        else
            this.setState({ error_options: error, dialogError: cockpit.message(error as cockpit.JsonObject) });
    }

    setAddress(address: string) {
        this.setState({ address });
    }

    run(promise: Promise<void>, failure_callback?: (ex: ConnectionError) => void) {
        return new Promise<void>((resolve) => {
            const promise_funcs: (() => Promise<void>)[] = [];

            const next = (i: number) => {
                promise_funcs[i]()
                        .then(() => {
                            i = i + 1;
                            if (i < promise_funcs.length) {
                                next(i);
                            } else {
                                resolve();
                                this.props.onClose();
                            }
                        })
                        .catch((ex: ConnectionError) => {
                            if (failure_callback)
                                failure_callback(ex);
                            else
                                this.setError(ex);
                        });
            };

            promise_funcs.push(() => { return promise });

            if (this.promise_callback)
                promise_funcs.push(this.promise_callback);

            if (this.props.caller_callback)
                promise_funcs.push(() => {
                    cockpit.assert(this.props.caller_callback, "caller_callback is null");
                    return this.props.caller_callback(this.state.address);
                });

            next(0);
        });
    }

    render() {
        const template = this.state.current_template;

        const props: DialogCommonProps = {
            template,
            host: this.addressOrLabel(),
            full_address: this.state.address,
            old_address: this.state.old_address,
            address_data: split_connection_string(this.state.address),
            error_options: this.state.error_options,
            dialogError: this.state.dialogError,
            machines_ins: this.props.machines_ins,
            onClose: () => {
                if (this.props.caller_cancelled)
                    this.props.caller_cancelled();
                this.props.onClose();
            },
            run: this.run,
            setGoal: this.setGoal,
            setError: this.setError,
            setAddress: this.setAddress,
            complete: this.complete,
        };

        if (template === "connect")
            return <Connect {...props} />;
        else if (template === "add-machine")
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

interface HostModalProps {
    state: ReturnType<typeof HostModalState>;
    machines: Machines;
}

export const HostModal = ({ state, machines }: HostModalProps) => {
    if (!state.modal_properties)
        return null;

    const extra: Pick<HostModalInnerProps, 'caller_callback' | 'caller_cancelled'> = {};
    if (state.modal_callback) {
        extra.caller_callback = state.modal_callback;
        extra.caller_cancelled = () => {
            cockpit.assert(state.modal_callback, "modal_callback is null");
            state.modal_callback(null);
        };
    }

    return <HostModalInner machines_ins={machines}
                           onClose={() => state.close_modal()}
                           {...state.modal_properties}
                           {...extra} />;
};
