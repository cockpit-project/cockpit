/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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

/* Dialogs for setting up SSH connection to a remote host. The central and only exported function here is
 * connect_host() at the very bottom of this file.
 */

import React, { useState } from 'react';

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

import cockpit from "cockpit";
import * as credentials from "credentials";
import { Dialogs, DialogResult } from "dialogs";
import { FormHelper } from "cockpit-components-form-helper";
import { ModalError } from "cockpit-components-inline-notification.jsx";

// @ts-expect-error: magic verbatim string import, not a JS module
import ssh_show_default_key_sh from "./ssh-show-default-key.sh";
// @ts-expect-error: magic verbatim string import, not a JS module
import ssh_add_key_sh from "./ssh-add-key.sh";

const _ = cockpit.gettext;

function debug(...args: unknown[]) {
    if (window.debugging === "all" || window.debugging?.includes("connect-ssh"))
        console.debug("cockpit-connect-ssh:", ...args);
}

type Address = {
    address: string,
    port?: number,
    user?: string
};

function split_connection_string(conn_to: string): Address {
    const addr: Address = { address: "" };
    let user_spot = -1;
    let port_spot = -1;

    if (conn_to) {
        user_spot = conn_to.lastIndexOf('@');
        port_spot = conn_to.lastIndexOf(':');
    }

    if (user_spot > 0) {
        addr.user = conn_to.substring(0, user_spot);
        conn_to = conn_to.substring(user_spot + 1);
        port_spot = conn_to.lastIndexOf(':');
    }

    if (port_spot > -1) {
        const port = parseInt(conn_to.substring(port_spot + 1), 10);
        if (!isNaN(port)) {
            addr.port = port;
            conn_to = conn_to.substring(0, port_spot);
        }
    }

    addr.address = conn_to;
    return addr;
}

function try_connect(options: cockpit.ChannelOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        // `binary: false` is the default, but https://github.com/microsoft/TypeScript/issues/58977
        const client = cockpit.channel({ ...options, payload: "echo", binary: false });
        client.send("x");
        client.addEventListener("message", () => {
            resolve();
            client.close();
        });
        client.addEventListener("close", (_ev, options) => reject(options));
    });
}

const UnknownHostDialog = ({ host, error, dialogResult }: {
    host: string,
    error: cockpit.JsonObject,
    dialogResult: DialogResult<void>,
}) => {
    const [inProgress, setInProgress] = useState(false);
    const [verifyExpanded, setVerifyExpanded] = useState(false);
    const [dialogError, setDialogError] = useState("");

    cockpit.assert(error["host-key"] && error["host-fingerprint"],
                   "UnknownHostDialog needs a host-key and host-fingerprint in error");
    const host_key: string = (error["host-key"] as string).trim();
    const host_fp = error["host-fingerprint"] as string;

    const key_type = host_key.split(" ")[1];
    cockpit.assert(key_type, "host-key did not include a key type");

    const scan_cmd = `ssh-keyscan -t ${key_type} localhost | ssh-keygen -lf -`;

    const address = split_connection_string(host);

    const title = cockpit.format(error.problem === "invalid-hostkey" ? _("$0 key changed") : _("Unknown host: $0"),
                                 address.address);
    const submitText = _("Trust and add host");
    let body = null;
    if (error.problem === "invalid-hostkey") {
        body = <>
            <Alert variant='danger' isInline title={_("Changed keys are often the result of an operating system reinstallation. However, an unexpected change may indicate a third-party attempt to intercept your connection.")} />
            <p>{_("To ensure that your connection is not intercepted by a malicious third-party, please verify the host key fingerprint:")}</p>
            <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-fingerprint pf-v5-u-font-family-monospace">{host_fp}</ClipboardCopy>
            <p className="hostkey-type">({key_type})</p>
            <p>{cockpit.format(_("To verify a fingerprint, run the following on $0 while physically sitting at the machine or through a trusted network:"), address.address)}</p>
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
            <p>{cockpit.format(_("You are connecting to $0 for the first time."), address.address)}</p>
            <ExpandableSection toggleText={ _("Verify fingerprint") }
                                isExpanded={verifyExpanded}
                                onToggle={(_ev, value) => setVerifyExpanded(value) }>
                <div>{_("Run this command over a trusted network or physically on the remote machine:")}</div>
                <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-verify-help hostkey-verify-help-cmds pf-v5-u-font-family-monospace">{scan_cmd}</ClipboardCopy>
                <div>{_("The fingerprint should match:")} {fingerprint_help}</div>
                <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} className="hostkey-verify-help hostkey-fingerprint pf-v5-u-font-family-monospace">{host_fp}</ClipboardCopy>
            </ExpandableSection>
        </>;
    }

    const onAddKey = async () => {
        setInProgress(true);
        debug("onAddKey", error);
        try {
            await cockpit.script(ssh_add_key_sh, [host_key, "known_hosts"], { err: "message" });
            dialogResult.resolve();
        } catch (ex) { // not-covered: OS error
            setDialogError((ex as cockpit.BasicError).toString()); // not-covered: OS error
            setInProgress(false); // not-covered: OS error
        }
    };

    return (
        <Modal id="ssh-unknown-host-dialog" isOpen
                position="top" variant="medium"
                onClose={() => dialogResult.reject("cancel")}
                title={title}
                footer={<>
                    <Button variant="primary" onClick={onAddKey} isLoading={inProgress} isDisabled={inProgress}>
                        { submitText }
                    </Button>
                    <Button variant="link" className="btn-cancel" onClick={() => dialogResult.reject("cancel")}>
                        { _("Cancel") }
                    </Button>
                </>}
        >
            <Stack hasGutter>
                { dialogError && <ModalError dialogError={dialogError} />}
                {body}
            </Stack>
        </Modal>
    );
};

interface ChangeAuthProps {
    host: string;
    user?: string;
    error: cockpit.JsonObject,
    dialogResult: DialogResult<void>;
}

interface ChangeAuthState {
    auth: string;
    setup_ssh: boolean,
    custom_password: string;
    custom_password_error: string;
    locked_identity_password: string;
    locked_identity_password_error: string;
    login_setup_new_key_password: string;
    login_setup_new_key_password2: string;
    login_setup_new_key_password2_error: string;
    user: cockpit.UserInfo | null;
    default_ssh_key: { name: string, type?: string, exists: boolean, encrypted: boolean } | null;
    identity_path: string | null;
    in_progress: boolean; // componentDidMount changes to false once loaded
    dialogError: string;
}

class ChangeAuthDialog extends React.Component<ChangeAuthProps, ChangeAuthState> {
    constructor(props: ChangeAuthProps) {
        super(props);

        this.state = {
            auth: "password",
            setup_ssh: false,
            custom_password: "",
            custom_password_error: "",
            locked_identity_password: "",
            locked_identity_password_error: "",
            login_setup_new_key_password: "",
            login_setup_new_key_password2: "",
            login_setup_new_key_password2_error: "",
            user: null,
            default_ssh_key: null,
            identity_path: null,
            in_progress: true, // componentDidMount changes to false once loaded
            dialogError: "",
        };

        this.login = this.login.bind(this);
    }

    // wrapper to silence typescript's "property does not exist"
    keys() {
        // @ts-expect-error: "property does not exist", yes TS, that's why we add it here..
        if (!this.__keys)
            // @ts-expect-error: dito
            this.__keys = credentials.keys_instance();
        // @ts-expect-error: dito
        return this.__keys;
    }

    updateIdentity() {
        const e = this.props.error.error as string;
        const identity_path = e?.startsWith("locked identity") ? e.split(": ")[1] : null;

        this.setState({ identity_path });
    }

    async componentDidMount() {
        try {
            const user = await cockpit.user();
            const output = await cockpit.script(ssh_show_default_key_sh, [], { });
            const info = output.split("\n");
            let default_ssh_key = null;
            if (info[0])
                default_ssh_key = {
                    name: info[0],
                    exists: true,
                    encrypted: info[1] === "encrypted",
                };
            else
                default_ssh_key = {
                    name: user.home + "/.ssh/id_rsa",
                    type: "rsa",
                    exists: false,
                    encrypted: false,
                };

            return this.setState({ in_progress: false, default_ssh_key, user }, this.updateIdentity);
        } catch (ex) { // not-covered: OS error
            const dialogError = (ex as cockpit.BasicError).toString(); // not-covered: dito
            this.setState({ in_progress: false, dialogError }); // not-covered: dito
        }
    }

    componentWillUnmount() {
        // @ts-expect-error: see keys()
        this.__keys?.close();
        // @ts-expect-error: see keys()
        this.__keys = null;
    }

    getSupports() {
        const methods = this.props.error["auth-method-results"] as cockpit.JsonObject;
        return {
            offer_login_password: methods.password && methods.password !== "no-server-support",
            offer_key_password: this.state.identity_path !== null,
        };
    }

    async maybe_create_key(passphrase: string) {
        const key = this.state.default_ssh_key!;
        if (!key.exists)
            await this.keys().create(key.name, key.type, passphrase);
    }

    async authorize_key() {
        const key = this.state.default_ssh_key!;
        const pubkey = await this.keys().get_pubkey(key.name);
        await cockpit.script(
            ssh_add_key_sh, [pubkey.trim()],
            { host: this.props.host, ...this.props.user && { user: this.props.user }, err: "message" }
        );
    }

    async maybe_unlock_key() {
        const { offer_login_password, offer_key_password } = this.getSupports();
        const both = offer_login_password && offer_key_password;

        if ((both && this.state.auth === "key") || (!both && offer_key_password))
            await this.keys().load(this.state.identity_path, this.state.locked_identity_password);
    }

    async login() {
        const options: cockpit.ChannelOptions = { host: this.props.host };
        if (this.props.user)
            options.user = this.props.user;

        let custom_password_error = "";
        let locked_identity_password_error = "";
        let login_setup_new_key_password2_error = "";

        const { offer_login_password, offer_key_password } = this.getSupports();
        const both = offer_login_password && offer_key_password;

        if ((both && this.state.auth === "password") || (!both && offer_login_password)) {
            if (!this.state.custom_password)
                custom_password_error = _("The password can not be empty");

            options.password = this.state.custom_password;
        }

        if ((offer_key_password && !(both && this.state.auth === "password")) && !this.state.locked_identity_password)
            locked_identity_password_error = _("The key password can not be empty");
        if (this.state.setup_ssh && this.state.login_setup_new_key_password !== this.state.login_setup_new_key_password2)
            login_setup_new_key_password2_error = _("The key passwords do not match");

        this.setState({
            custom_password_error,
            locked_identity_password_error,
            login_setup_new_key_password2_error,
        });

        if (custom_password_error || locked_identity_password_error || login_setup_new_key_password2_error)
            return;

        this.setState({ in_progress: true });

        try {
            await this.maybe_unlock_key();
            await try_connect(options);
            if (this.state.setup_ssh) {
                await this.maybe_create_key(this.state.login_setup_new_key_password);
                await this.authorize_key();
            }
            this.props.dialogResult.resolve();
        } catch (ex) {
            const err = ex as cockpit.JsonObject;
            if (err.problem === "no-cockpit")
                // this is handled in a separate dialog, and the SSH connection succeeded at this point
                this.props.dialogResult.reject(err);
            this.setState({ in_progress: false, dialogError: cockpit.message(err) });
        }
    }

    render() {
        const { offer_login_password, offer_key_password } = this.getSupports();
        const both = offer_login_password && offer_key_password;

        let offer_key_setup = true;
        if (!this.state.default_ssh_key)
            offer_key_setup = false;
        else if (this.state.identity_path) {
            // This is a locked, non-default identity that will never
            // be loaded into the agent, so there is no point in
            // offering to change the passphrase.
            offer_key_setup = false;
        }

        const address = split_connection_string(this.props.host);
        const title = cockpit.format(_("Log in to $0"), address.address);
        const submitText = _("Log in");
        let statement: React.ReactNode = null;

        if (!offer_login_password && !offer_key_password)
            statement = <p>{cockpit.format(_("Unable to log in to $0. The host does not accept password login or any of your SSH keys."), this.props.host)}</p>;
        else if (offer_login_password && !offer_key_password)
            statement = <p>{cockpit.format(_("Unable to log in to $0 using SSH key authentication. Please provide the password."), this.props.host)}</p>;
        else if (offer_key_password && !offer_login_password)
            statement = <p>{cockpit.format(_("The SSH key for logging in to $0 is protected by a password, and the host does not allow logging in with a password. Please provide the password of the key at $1."), this.props.host, this.state.identity_path)}</p>;
        else if (both)
            statement = <p>{cockpit.format(_("The SSH key for logging in to $0 is protected. You can log in with either your login password or by providing the password of the key at $1."), this.props.host, this.state.identity_path)}</p>;

        let ssh_key_text = null;
        let ssh_key_details = null;
        if (this.state.default_ssh_key) {
            const key = this.state.default_ssh_key.name;
            const luser = this.state.user!.name;
            const lhost = "localhost";
            const afile = "~/.ssh/authorized_keys";
            const ruser = this.props.user || address.user || this.state.user!.name;
            if (!this.state.default_ssh_key.exists) {
                ssh_key_text = _("Create a new SSH key and authorize it");
                ssh_key_details = <>
                    <p>{cockpit.format(_("A new SSH key at $0 will be created for $1 on $2 and it will be added to the $3 file of $4 on $5."), key, luser, lhost, afile, ruser, address.address)}</p>
                    <FormGroup label={_("Key password")}>
                        <TextInput id="login-setup-new-key-password" onChange={(_event, value) => this.setState({ login_setup_new_key_password: value })}
                                type="password" value={this.state.login_setup_new_key_password} />
                    </FormGroup>
                    <FormGroup label={_("Confirm key password")}>
                        <TextInput id="login-setup-new-key-password2" onChange={(_event, value) => this.setState({ login_setup_new_key_password2: value })}
                                type="password" value={this.state.login_setup_new_key_password2} validated={this.state.login_setup_new_key_password2_error ? "error" : "default"} />
                        <FormHelper helperTextInvalid={this.state.login_setup_new_key_password2_error} />
                    </FormGroup>
                </>;
            } else {
                ssh_key_text = _("Authorize SSH key");
                ssh_key_details = <p>{cockpit.format(_("The SSH key $0 of $1 on $2 will be added to the $3 file of $4 on $5."), key, luser, lhost, afile, ruser, address.address)}</p>;
            }
        }

        const body = <>
            {statement}
            <br />
            {(offer_login_password || offer_key_password) &&
                <Form isHorizontal onSubmit={ev => { ev.preventDefault(); this.login() }}>
                    {both &&
                        <FormGroup label={_("Authentication")} isInline hasNoPaddingTop>
                            <Radio name="auth-method"
                                   isChecked={this.state.auth === "password"}
                                   onChange={() => this.setState({ auth: "password" })}
                                   id="auth-password"
                                   value="password"
                                   label={_("Password")} />
                            <Radio name="auth-method"
                                   isChecked={this.state.auth === "key"}
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
                        <FormGroup label={ _("SSH key login") } hasNoPaddingTop isInline>
                            <Checkbox onChange={(_event, checked) => this.setState({ setup_ssh: checked })}
                                      isChecked={this.state.setup_ssh} id="login-setup-keys"
                                      label={ssh_key_text} body={this.state.setup_ssh ? ssh_key_details : null} />
                        </FormGroup>
                    }
                </Form>
            }
        </>;

        const onCancel = () => this.props.dialogResult.reject("cancel");

        return (
            <Modal id="ssh-change-auth-dialog" isOpen
                   position="top" variant="medium"
                   onClose={onCancel}
                   title={title}
                   footer={<>
                       <Button variant="primary" onClick={this.login} isLoading={this.state.in_progress}
                               isDisabled={this.state.in_progress || (!offer_login_password && !offer_key_password) || !this.state.default_ssh_key || !this.props.error}>
                           { submitText }
                       </Button>
                       <Button variant="link" className="btn-cancel" onClick={onCancel}>
                           { _("Cancel") }
                       </Button>
                   </>}
            >
                <Stack hasGutter>
                    { this.state.dialogError && <ModalError dialogError={this.state.dialogError} /> }
                    {body}
                </Stack>
            </Modal>
        );
    }
}

const NotSupportedDialog = ({ host, error, dialogResult }: {
    host: string,
    error: cockpit.JsonObject,
    dialogResult: DialogResult<void>,
}) => (
    <Modal id="ssh-not-supported-dialog" isOpen
            position="top" variant="medium"
            onClose={() => dialogResult.reject(error)}
            title={_("Cockpit is not installed")}
            footer={
                <Button variant="link" className="btn-cancel" onClick={() => dialogResult.reject(error)}>
                    { _("Close") }
                </Button>
            }
    >
        <Stack hasGutter>
            <p>{cockpit.format(_("A compatible version of Cockpit is not installed on $0."), host)}</p>
        </Stack>
    </Modal>
);

const error_dialogs = {
    "unknown-hostkey": UnknownHostDialog,
    "invalid-hostkey": UnknownHostDialog,
    "authentication-failed": ChangeAuthDialog,
    "no-cockpit": NotSupportedDialog,
};

/**
 * Set up SSH connection to a remote host
 *
 * Cockpit channels support running on a remote machine through SSH via the
 * `host` channel option. This only works (without additional authentication
 * options) if the SSH connection was already established (e.g. through the
 * deprecated shell's "Add Host" feature), or can be established
 * noninteractively (e.g. if you have a passwordless SSH key, or a special
 * noninteractive configuration block in your ~/.ssh/config for the target host).
 *
 * For all other cases, call this function first. It shows various dialogs where
 * the user can specify a login password or unlock their SSH key. If the user
 * does not already have an SSH key, the dialog also offers to create one. It
 * also offers to authorize the user's SSH key to the remote machine/user.
 *
 * Arguments:
 * @dialog_context: The page's `DialogsContext`, see ./dialogs.tsx
 * @host: Same `[user@]host[:port]` format as the channel option; must be
 *        *exactly* the same as for opening the channel afterwards
 * @user: Same as the channel option; overrides `user@` portion of @host
 * Returns: Nothing on success. Afterwards the SSH connection is established and
 *          you can use the `host` option in channels. Throws a "cancel"
 *          exception if the user cancelled the dialog. Most SSH errors are
 *          handled in the dialogs, but you still have to expect and check for
 *          other Cockpit errors with the usual `{ problem: "...", ... }` structure.
 *
 * See pkg/playground/remote.tsx for an example how to use this function.
 *
 * [1] https://github.com/cockpit-project/cockpit/blob/main/doc/protocol.md#command-init
 */
export async function connect_host(dialog_context: Dialogs, host: string, user?: string) {
    const options: cockpit.ChannelOptions = { host, ...user && { user } };
    while (true) {
        try {
            await try_connect(options);
            debug(host, "succeeded");
            break;
        } catch (_ex) {
            const ex = _ex as cockpit.JsonObject;
            // unknown host or changed host key → re-try with private session to get its host key
            if ((ex.problem === "unknown-host" || ex.problem === "invalid-hostkey") && !ex["host-key"]) {
                debug(host, "failed with unknown-host, retrying with private session");
                options.session = "private";
                continue;
            } else {
                // reset
                delete options.session;
            }

            // @ts-expect-error: ex is untyped, and this is too much useless hassle
            const dialog = error_dialogs[ex.problem];
            if (dialog) {
                debug(host, "failed with:", ex, "mapping to", dialog);
                try {
                    const result = await dialog_context.run(dialog, { host, user, error: ex });
                    debug(host, "dialog result:", result);
                } catch (_ex) {
                    const dialog_error = _ex as cockpit.JsonObject;
                    debug(host, "dialog", dialog, "failed with:", dialog_error);
                    if (dialog_error.problem === "no-cockpit") {
                        // avoid another SSH connection
                        await dialog_context.run(NotSupportedDialog, { host, user, error: dialog_error });
                    } else {
                        throw dialog_error;
                    }
                }
            } else {
                debug(host, "terminally failed with:", ex);
                throw ex;
            }
        }
    }
}
