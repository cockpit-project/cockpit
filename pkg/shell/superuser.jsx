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
import { Modal } from 'patternfly-react';
import { Button } from '@patternfly/react-core';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { StatelessSelect, SelectEntry } from 'cockpit-components-select.jsx';
import "form-layout.scss";

const _ = cockpit.gettext;

export function can_do_sudo(host) {
    return cockpit.spawn(["sudo", "-v", "-n"], { err: "out", environ: ["LC_ALL=C"], host: host })
            .then(() => true,
                  (err, out) => !(err.exit_status == 1 && out.match("Sorry, user .+ may not run sudo on .+\\.")));
}

function storage_key(host) {
    const local_key = window.localStorage.getItem("superuser-key");
    if (!host || host == "localhost")
        return local_key;
    else if (host.indexOf("@") >= 0)
        return "superuser:" + host;
    else if (local_key)
        return local_key + "@" + host;
    else
        return null;
}

class UnlockDialog extends React.Component {
    render() {
        const { state } = this.props;

        let body = null;
        if (state.prompt) {
            if (!state.prompt.message && !state.prompt.prompt) {
                state.prompt.message = _("Please authenticate to gain administrative access");
                state.prompt.prompt = _("Password");
            }
            body = <form className="ct-form" onSubmit={state.apply}>
                { state.prompt.message && <span>{state.prompt.message}</span> }
                { state.prompt.prompt && <label className="control-label">{state.prompt.prompt}</label> }
                <input type={state.prompt.echo ? "text" : "password"} className="form-control" value={state.prompt.value}
                       autoFocus
                       onChange={event => {
                           state.change(event.target.value);
                       }} />
            </form>;
        } else if (state.method)
            body = <form className="ct-form" onSubmit={state.apply}>
                <label className="control-label">{_("Method")}</label>
                <StatelessSelect extraClass="form-control"
                                 selected={state.method}
                                 onChange={state.change}>
                    { state.methods.map(m => <SelectEntry key={m} data={m}>{m}</SelectEntry>) }
                </StatelessSelect>
            </form>;
        else if (state.message)
            body = <p>{state.message}</p>;

        return (
            <Modal show={!state.closed} animation={false}>
                <Modal.Header>
                    <Modal.Title>{_("Administrative access")}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {body}
                </Modal.Body>
                <Modal.Footer>
                    { state.error && <ModalError dialogError={state.error} />}
                    { !state.message &&
                        <Button variant='primary' onClick={state.apply} disabled={state.busy}>
                            {_("Authenticate")}
                        </Button>
                    }
                    <Button variant='link' className='btn-cancel' onClick={state.cancel} disabled={!state.cancel}>
                        {state.message ? _("Close") : _("Cancel")}
                    </Button>
                    { state.busy && <div className="spinner pull-right" /> }
                </Modal.Footer>
            </Modal>);
    }
}

class LockDialog extends React.Component {
    constructor() {
        super();
        this.state = {
            error: null
        };
    }

    render() {
        const { onclose, proxy } = this.props;

        const close = () => {
            this.setState({ error: null });
            onclose();
        };

        const apply = () => {
            this.setState({ error: null });
            proxy.Stop()
                    .then(() => {
                        return cockpit.spawn(["sudo", "-k"], { host: this.props.host }).always(() => {
                            const key = storage_key(this.props.host);
                            if (key)
                                window.localStorage.setItem(key, "none");
                            onclose();
                        });
                    })
                    .catch(err => {
                        this.setState({ error: err.toString() });
                    });
        };

        return (
            <Modal show={this.props.show} animation={false}>
                <Modal.Header>
                    <Modal.Title>{_("Switch to limited access")}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>{_("Limited access mode restricts administrative privileges. Some parts of the web console will have reduced functionality.")}</p>
                    <p>{_("Your browser will remember your access level across sessions.")}</p>
                </Modal.Body>
                <Modal.Footer>
                    { this.state.error && <ModalError dialogError={this.state.error} />}
                    <Button variant='primary' onClick={apply}>
                        {_("Limit access")}
                    </Button>
                    <Button variant='link' className='btn-cancel' onClick={close}>
                        {_("Cancel")}
                    </Button>
                </Modal.Footer>
            </Modal>);
    }
}

export class SuperuserDialogs extends React.Component {
    constructor(props) {
        super();

        this.state = {
            show: false,
            unlocked: false,

            show_lock_dialog: false,
            unlock_dialog_state: { closed: true }
        };
    }

    connect(host) {
        if (this.superuser_connection)
            this.superuser_connection.close();

        this.superuser_connection = cockpit.dbus(null, { bus: "internal", host: host });
        this.superuser = this.superuser_connection.proxy("cockpit.Superuser", "/superuser");
        this.superuser.addEventListener("changed", () => {
            const key = storage_key(host);
            if (key) {
                // Reset wanted state if we fail to gain admin privs.
                // Failing to gain admin privs might take a noticeable
                // time, and we don't want to suffer through the
                // associated intermediate UI state on every login.
                const want = window.localStorage.getItem(key);
                if (this.superuser.Current == "none" && this.superuser.Current != want)
                    window.localStorage.setItem(key, this.superuser.Current);
            }

            this.setState({
                show: this.superuser.Current != "root" && this.superuser.Current != "init",
                unlocked: this.superuser.Current != "none"
            });
        });

        this.setState({
            show: this.superuser.Current != "root" && this.superuser.Current != "init",
            unlocked: this.superuser.Current != "none",

            show_lock_dialog: false,
            unlock_dialog_state: { closed: true }
        });
    }

    componentDidMount() {
        this.componentDidUpdate({});
    }

    componentDidUpdate(prevProps) {
        if (!this.superuser_connection || prevProps.host != this.props.host)
            this.connect(this.props.host);
    }

    componentWillUnmount() {
        this.connect(null);
    }

    /* We have to drive the unlock dialog state from here since we
     * might want to call proxy.Start before opening it.
     */

    set_unlock_state(state) {
        this.setState({ unlock_dialog_state: state });
    }

    update_unlock_state(state) {
        this.set_unlock_state(Object.assign(this.state.unlock_dialog_state, state));
    }

    unlock(error) {
        this.superuser.Stop().always(() => {
            can_do_sudo(this.props.host).then(can_do => {
                if (!can_do)
                    this.set_unlock_state({
                        message: _("You can not gain administrative access."),
                        cancel: () => this.set_unlock_state({ closed: true })
                    });
                else
                    this.start("sudo", error);
            });
        });
    }

    start(method, error) {
        const cancel = () => {
            this.superuser.Stop();
            this.set_unlock_state({ busy: true, prompt: this.state.unlock_dialog_state.prompt });
        };

        this.set_unlock_state({
            busy: true,

            error: error,
            cancel: cancel
        });

        let did_prompt = false;

        const onprompt = (event, message, prompt, def, echo) => {
            did_prompt = true;
            const p = { message: message, prompt: prompt, value: def, echo: echo };
            this.set_unlock_state({
                prompt: p,

                error: this.state.unlock_dialog_state.error,
                change: val => {
                    p.value = val;
                    this.update_unlock_state({ prompt: p });
                },
                cancel: cancel,
                apply: () => {
                    this.superuser.Answer(p.value);
                    this.set_unlock_state({
                        busy: true,
                        cancel: cancel
                    });
                }
            });
        };

        this.superuser.addEventListener("Prompt", onprompt);
        this.superuser.Start(method)
                .then(() => {
                    this.superuser.removeEventListener("Prompt", onprompt);

                    const key = storage_key(this.props.host);
                    if (key)
                        window.localStorage.setItem(key, method);
                    if (did_prompt)
                        this.set_unlock_state({ closed: true });
                    else
                        this.set_unlock_state({
                            message: _("You now have administrative access."),
                            cancel: () => this.set_unlock_state({ closed: true })
                        });
                })
                .catch(err => {
                    console.warn(err);
                    this.superuser.removeEventListener("Prompt", onprompt);
                    if (err && err.message != "cancelled") {
                        if (did_prompt)
                            this.unlock(_("This didn't work, please try again"));
                        else
                            this.set_unlock_state({
                                message: _("Something went wrong"),
                                error: err.toString(),
                                cancel: () => this.set_unlock_state({ closed: true })
                            });
                    } else
                        this.set_unlock_state({ closed: true });
                });
    }

    lock() {
        this.setState({ show_lock_dialog: true });
    }

    render () {
        if (!this.state.show || this.state.unlocked == null ||
            !this.superuser.Bridges || this.superuser.Bridges.length == 0)
            return null;

        const trigger = this.props.create_trigger(this.state.unlocked,
                                                  this.state.unlocked ? () => this.lock() : () => this.unlock(null));

        return (
            <>
                {trigger}

                <UnlockDialog proxy={this.superuser}
                              state={this.state.unlock_dialog_state} />

                <LockDialog proxy={this.superuser}
                            host={this.props.host}
                            show={this.state.show_lock_dialog}
                            onclose={() => this.setState({ show_lock_dialog: false })} />
            </>);
    }
}

export class SuperuserIndicator extends React.Component {
    render() {
        function create_trigger(unlocked, onclick) {
            return (
                <Button variant="link" onClick={onclick}>
                    {unlocked ? _("Administrative access") : _("Limited access")}
                </Button>);
        }

        return <SuperuserDialogs host={this.props.host} create_trigger={create_trigger} />;
    }
}
