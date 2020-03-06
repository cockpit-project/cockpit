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
import { Modal, Button } from 'patternfly-react';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { StatelessSelect, SelectEntry } from 'cockpit-components-select.jsx';
import "form-layout.scss";

const _ = cockpit.gettext;

class UnlockDialog extends React.Component {
    render() {
        const { state } = this.props;

        let body = null;
        if (state.prompt) {
            if (!state.prompt.message && !state.prompt.prompt) {
                state.prompt.message = _("Please authenticate to gain administrative access");
                state.prompt.prompt = _("Password");
            }
            body = <form className="ct-form">
                { state.prompt.message && <span>{state.prompt.message}</span> }
                { state.prompt.prompt && <label className="control-label">{state.prompt.prompt}</label> }
                <input type={state.prompt.echo ? "text" : "password"} className="form-control" value={state.prompt.value}
                       onChange={event => {
                           state.change(event.target.value);
                       }} />
            </form>;
        } else if (state.method)
            body = <form className="ct-form">
                <label className="control-label">{_("Password")}</label>
                <StatelessSelect extraClass="form-control"
                                 selected={state.method}
                                 onChange={state.change}>
                    { state.methods.map(m => <SelectEntry key={m} data={m}>{m}</SelectEntry>) }
                </StatelessSelect>
            </form>;
        else if (state.password !== undefined)
            body = <form className="ct-form">
                <span>{_("Please authenticate to gain administrative access")}</span>
                <label className="control-label">{_("Password")}</label>
                <input type="password" className="form-control" value={state.password}
                       onChange={event => {
                           state.change(event.target.value);
                       }} />
            </form>;
        else if (state.message)
            body = <p>{state.message}</p>;

        return (
            <Modal show={!state.closed}>
                <Modal.Header>
                    <Modal.Title>{_("Administrative access")}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {body}
                </Modal.Body>
                <Modal.Footer>
                    { state.error && <ModalError dialogError={state.error} />}
                    { state.busy && <div className="spinner pull-left" /> }
                    <Button bsStyle='default' className='btn-cancel' onClick={state.cancel} disabled={!state.cancel}>
                        {state.message ? _("Close") : _("Cancel")}
                    </Button>
                    { !state.message &&
                        <Button bsStyle='primary' onClick={state.apply} disabled={state.busy}>
                            {_("Authenticate")}
                        </Button>
                    }
                </Modal.Footer>
            </Modal>);
    }
}

class LockDialog extends React.Component {
    constructor(props) {
        super();
        this.state = {
            error: null
        };
    }

    render() {
        const { onclose, proxy } = this.props;

        const apply = () => {
            proxy.Stop()
                    .then(() => {
                        const key = window.localStorage.getItem("superuser:key");
                        if (key)
                            window.localStorage.setItem(key, "none");
                        onclose();
                    })
                    .catch(err => {
                        this.setState({ error: err.toString() });
                    });
        };

        return (
            <Modal show={this.props.show}>
                <Modal.Header>
                    <Modal.Title>{_("Limited access")}</Modal.Title>
                </Modal.Header>
                <Modal.Footer>
                    { this.state.error && <ModalError dialogError={this.state.error} />}
                    <Button bsStyle='default' className='btn-cancel' onClick={onclose}>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary' onClick={apply}>
                        {_("Apply")}
                    </Button>
                </Modal.Footer>
            </Modal>);
    }
}

export class SuperuserDialogs extends React.Component {
    constructor() {
        super();

        this.superuser_connection = cockpit.dbus(null, { bus: "internal" });
        this.superuser = this.superuser_connection.proxy("cockpit.Superuser", "/superuser");
        this.superuser.addEventListener("changed", () => {
            this.setState({
                show: this.superuser.Current != "root",
                unlocked: this.superuser.Current != "none"
            });
        });

        this.state = {
            show: this.superuser.Current != "root",
            unlocked: this.superuser.Current != "none",

            show_lock_dialog: false,
            unlock_dialog_state: { closed: true }
        };
    }

    componentWillUnmount() {
        this.superuser_connection.close();
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
            if (this.superuser.Bridges.length == 1) {
                this.password(this.superuser.Bridges[0], error);
            } else {
                this.set_unlock_state({
                    method: this.superuser.Bridges[0],
                    methods: this.superuser.Bridges,

                    error: error,
                    change: val => this.update_unlock_state({ method: val }),
                    cancel: () => this.set_unlock_state({ closed: true }),
                    apply: () => this.password(this.state.unlock_dialog_state.method)
                });
            }
        });
    }

    password(method, error) {
        this.set_unlock_state({
            password: "",

            error: error,
            change: val => this.update_unlock_state({ password: val }),
            cancel: () => this.set_unlock_state({ closed: true }),
            apply: () => this.start(method, this.state.unlock_dialog_state.password)
        });
    }

    start(method, password) {
        const cancel = () => {
            this.superuser.Stop();
            this.set_unlock_state({ busy: true, prompt: this.state.unlock_dialog_state.prompt });
        };

        this.set_unlock_state({
            busy: true,

            cancel: cancel
        });

        let did_prompt = this.superuser.Bridges.length > 1 || true;

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
        this.superuser.Start(method, password)
                .then(() => {
                    this.superuser.removeEventListener("Prompt", onprompt);

                    const key = window.localStorage.getItem("superuser:key");
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
                            show={this.state.show_lock_dialog}
                            onclose={() => this.setState({ show_lock_dialog: false })} />
            </>);
    }
}

export class SuperuserIndicator extends React.Component {
    render() {
        function create_trigger(unlocked, onclick) {
            return (
                <span className="navbar-text" onClick={onclick}>
                    {unlocked ? _("Administrative access") : _("Limited access")}
                </span>);
        }

        return <SuperuserDialogs create_trigger={create_trigger} />;
    }
}
