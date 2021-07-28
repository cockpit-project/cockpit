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
import { Alert, Button, Modal } from '@patternfly/react-core';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { host_superuser_storage_key } from './machines/machines';
import { LockIcon } from '@patternfly/react-icons';

import "form-layout.scss";

const _ = cockpit.gettext;

function sudo_polish(msg) {
    if (!msg)
        return msg;

    msg = msg.replace(/^\[sudo] /, "");
    msg = msg[0].toUpperCase() + msg.slice(1);

    return msg;
}

class UnlockDialog extends React.Component {
    render() {
        const { state } = this.props;

        let title = null;
        let title_icon = null;
        let body = null;
        let footer = null;

        if (state.prompt) {
            if (!state.prompt.message && !state.prompt.prompt) {
                state.prompt.message = _("Please authenticate to gain administrative access");
                state.prompt.prompt = _("Password");
            }

            title = _("Switch to administrative access");

            body = (
                <>
                    { state.error && <><Alert variant={state.error_variant || 'danger'} isInline title={state.error} /><br /></> }
                    <form className="ct-form"
                          onSubmit={event => { state.apply(); event.preventDefault(); return false }}>
                        { state.prompt.message && <span>{state.prompt.message}</span> }
                        { state.prompt.prompt && <label className="control-label">{state.prompt.prompt}</label> }
                        <input className="form-control" type={state.prompt.echo ? "text" : "password"}
                               value={state.prompt.value}
                               autoFocus
                               disabled={state.busy}
                               onChange={event => {
                                   state.change(event.target.value);
                               }} />
                    </form>
                </>);

            footer = (
                <>
                    <Button variant='primary' onClick={state.apply} isDisabled={state.busy}>
                        {_("Authenticate")}
                    </Button>
                    <Button variant='link' className='btn-cancel' onClick={state.cancel} isDisabled={!state.cancel}>
                        {_("Cancel")}
                    </Button>
                    { state.busy &&
                        <div className="dialog-wait-ct">
                            <div className="spinner spinner-sm" />
                        </div>
                    }
                </>);
        } else if (state.message) {
            title = _("Administrative access");
            body = <p>{state.message}</p>;
            footer = (
                <Button variant="secondary" className='btn-cancel' onClick={state.cancel}>
                    {_("Close")}
                </Button>);
        } else if (state.error) {
            title_icon = "danger";
            title = _("Problem becoming administrator");
            body = <p>{state.error}</p>;
            footer = (
                <Button variant="secondary" className='btn-cancel' onClick={state.cancel}>
                    {_("Close")}
                </Button>);
        }

        return (
            <Modal isOpen={!state.closed} position="top" variant="medium"
                   onClose={this.props.onClose}
                   title={title}
                   titleIconVariant={title_icon}
                   footer={footer}>
                {body}
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
        const { onClose, proxy } = this.props;

        const close = () => {
            this.setState({ error: null });
            onClose();
        };

        const apply = () => {
            this.setState({ error: null });
            proxy.Stop()
                    .then(() => {
                        return cockpit.spawn(["sudo", "-k"], { host: this.props.host }).always(() => {
                            const key = host_superuser_storage_key(this.props.host);
                            if (key)
                                window.localStorage.setItem(key, "none");
                            onClose();
                        });
                    })
                    .catch(err => {
                        this.setState({ error: err.toString() });
                    });
        };
        const footer = (
            <>
                {this.state.error && <ModalError dialogError={this.state.error} />}
                <Button variant='primary' onClick={apply}>
                    {_("Limit access")}
                </Button>
                <Button variant='link' className='btn-cancel' onClick={close}>
                    {_("Cancel")}
                </Button>
            </>
        );

        return (
            <Modal isOpen={this.props.show} position="top" variant="medium"
                onClose={close}
                footer={footer}
                title={_("Switch to limited access")}>
                <>
                    <p>{_("Limited access mode restricts administrative privileges. Some parts of the web console will have reduced functionality.")}</p>
                    <p>{_("Your browser will remember your access level across sessions.")}</p>
                </>
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
            const key = host_superuser_storage_key(host);
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

    unlock() {
        this.superuser.Stop().always(() => {
            this.start("sudo");
        });
    }

    start(method) {
        const cancel = () => {
            this.superuser.Stop();
            this.set_unlock_state({
                busy: true,
                prompt: this.state.unlock_dialog_state.prompt,
                error: this.state.unlock_dialog_state.error
            });
        };

        this.set_unlock_state({
            busy: true,
            prompt: this.state.unlock_dialog_state.prompt,
            cancel: cancel
        });

        let did_prompt = false;

        const onprompt = (event, message, prompt, def, echo, error) => {
            const p = {
                message: sudo_polish(message),
                prompt: sudo_polish(prompt),
                value: def,
                echo: echo
            };
            this.set_unlock_state({
                prompt: p,

                error: sudo_polish(error) || this.state.unlock_dialog_state.error,
                error_variant: did_prompt ? 'danger' : 'warning',
                change: val => {
                    p.value = val;
                    this.update_unlock_state({ prompt: p });
                },
                cancel: cancel,
                apply: () => {
                    this.superuser.Answer(p.value);
                    this.set_unlock_state({
                        busy: true,
                        prompt: this.state.unlock_dialog_state.prompt,
                        cancel: cancel
                    });
                }
            });
            did_prompt = true;
        };

        this.superuser.addEventListener("Prompt", onprompt);
        this.superuser.Start(method)
                .then(() => {
                    this.superuser.removeEventListener("Prompt", onprompt);

                    const key = host_superuser_storage_key(this.props.host);
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
                        this.set_unlock_state({
                            error: sudo_polish(err.toString()),
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
                              state={this.state.unlock_dialog_state}
                              onClose={() => this.set_unlock_state({ closed: true }) } />

                <LockDialog proxy={this.superuser}
                            host={this.props.host}
                            show={this.state.show_lock_dialog}
                            onClose={() => this.setState({ show_lock_dialog: false })} />
            </>);
    }
}

export class SuperuserIndicator extends React.Component {
    render() {
        function create_trigger(unlocked, onclick) {
            return (
                <Button variant="link" onClick={onclick} className={unlocked ? "ct-unlocked" : "ct-locked"}>
                    <span className="ct-lock-wrapper">
                        <LockIcon />
                        {unlocked ? _("Administrative access") : _("Limited access")}
                    </span>
                </Button>);
        }

        return <SuperuserDialogs host={this.props.host} create_trigger={create_trigger} />;
    }
}
