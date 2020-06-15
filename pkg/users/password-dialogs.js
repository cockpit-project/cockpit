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

import cockpit from 'cockpit';
import React from 'react';
import { superuser } from "superuser";

import { Modal } from 'patternfly-react';
import { Validated, has_errors } from "./dialog-utils.js";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

function passwd_self(old_pass, new_pass) {
    var old_exps = [
        /Current password: $/,
        /.*\(current\) UNIX password: $/,
    ];
    var new_exps = [
        /.*New password: $/,
        /.*Retype new password: $/,
        /.*Enter new \w*\s?password: $/,
        /.*Retype new \w*\s?password: $/
    ];
    var bad_exps = [
        /.*BAD PASSWORD:.*/
    ];
    var too_new_exps = [
        /.*must wait longer to change.*/
    ];

    return new Promise((resolve, reject) => {
        var buffer = "";
        var sent_new = false;
        var failure = _("Old password not accepted");
        var i;

        var proc;
        var timeout = window.setTimeout(function() {
            failure = _("Prompting via passwd timed out");
            proc.close("terminated");
        }, 10 * 1000);

        proc = cockpit.spawn(["/usr/bin/passwd"], { pty: true, environ: ["LC_ALL=C"], err: "out" })
                .always(function() {
                    window.clearInterval(timeout);
                })
                .done(function() {
                    resolve();
                })
                .fail(function(ex) {
                    if (ex.exit_status)
                        ex = new Error(failure);
                    reject(ex);
                })
                .stream(function(data) {
                    buffer += data;
                    for (i = 0; i < old_exps.length; i++) {
                        if (old_exps[i].test(buffer)) {
                            buffer = "";
                            this.input(old_pass + "\n", true);
                            return;
                        }
                    }

                    for (i = 0; i < too_new_exps.length; i++) {
                        if (too_new_exps[i].test(buffer)) {
                            buffer = "";
                            failure = _("You must wait longer to change your password");
                            this.input("\n", true);
                            return;
                        }
                    }

                    for (i = 0; i < new_exps.length; i++) {
                        if (new_exps[i].test(buffer)) {
                            buffer = "";
                            this.input(new_pass + "\n", true);
                            failure = _("Failed to change password");
                            sent_new = true;
                            return;
                        }
                    }

                    if (sent_new)
                        for (i = 0; i < bad_exps.length; i++) {
                            if (bad_exps[i].test(buffer)) {
                                failure = _("New password was not accepted");
                                return;
                            }
                        }
                });
    });
}

export function passwd_change(user, new_pass) {
    return new Promise((resolve, reject) => {
        cockpit.spawn(["chpasswd"], { superuser: "require", err: "out" })
                .input(user + ":" + new_pass)
                .done(function() {
                    resolve();
                })
                .fail(function(ex, response) {
                    if (ex.exit_status) {
                        console.log(ex);
                        if (response)
                            ex = new Error(response);
                        else
                            ex = new Error(_("Failed to change password"));
                    }
                    reject(ex);
                });
    });
}

export function password_quality(password) {
    return new Promise((resolve, reject) => {
        cockpit.spawn('/usr/bin/pwscore', { err: "message" })
                .input(password)
                .done(function(content) {
                    var quality = parseInt(content, 10);
                    if (quality === 0) {
                        reject(new Error(_("Password is too weak")));
                    } else if (quality <= 33) {
                        resolve("weak");
                    } else if (quality <= 66) {
                        resolve("okay");
                    } else if (quality <= 99) {
                        resolve("good");
                    } else {
                        resolve("excellent");
                    }
                })
                .fail(function(ex) {
                    reject(new Error(ex.message || _("Password is not acceptable")));
                });
    });
}

function SetPasswordDialogBody({ state, errors, change }) {
    const {
        need_old, password_old, password, password_confirm,
        password_strength, password_message
    } = state;

    return (
        <Modal.Body>
            <form className="ct-form">
                { need_old && <>
                    <label className="control-label" htmlFor="account-set-password-old" translate="yes">Old Password</label>
                    <Validated errors={errors} error_key="password_old">
                        <input className="form-control check-passwords" type="password" id="account-set-password-old"
        value={password_old} onChange={event => change("password_old", event.target.value)} />
                    </Validated>
                </>
                }

                <label className="control-label" htmlFor="account-set-password-pw1" translate="yes">New Password</label>
                <Validated errors={errors} error_key="password">
                    <input className="form-control check-passwords" type="password" id="account-set-password-pw1"
        value={password} onChange={event => change("password", event.target.value)} />
                </Validated>

                <label className="control-label" htmlFor="account-set-password-pw2" translate="yes">Confirm New Password</label>
                <div className="check-passwords dialog-wrapper">
                    <Validated errors={errors} error_key="password_confirm">
                        <input className="form-control" type="password" id="account-set-password-pw2"
            value={password_confirm} onChange={event => change("password_confirm", event.target.value)} />
                    </Validated>
                    <div id="account-set-password-meter" className={"progress password-strength-meter " + password_strength}>
                        <div className="progress-bar" />
                        <div className="progress-bar" />
                        <div className="progress-bar" />
                        <div className="progress-bar" />
                    </div>
                    <div>
                        <span id="account-set-password-meter-message" className="help-block">{password_message}</span>
                    </div>
                </div>
            </form>
        </Modal.Body>
    );
}

export function set_password_dialog(account, current_user) {
    let dlg = null;

    const change_self = (account.name == current_user && !superuser.allowed);

    const state = {
        need_old: change_self,
        password_old: "",
        password: "",
        password_confirm: "",
        password_strength: "",
        password_message: "",
    };

    let errors = { };

    let old_password = null;

    function change(field, value) {
        state[field] = value;

        if (state.password != old_password) {
            old_password = state.password;
            if (state.password) {
                password_quality(state.password)
                        .catch(ex => "weak")
                        .then(strength => {
                            state.password_strength = strength;
                            if (strength == "excellent")
                                state.password_message = _("Excellent password");
                            else
                                state.password_message = "";
                            update();
                        });
            } else {
                state.password_strength = "";
                state.password_message = "";
            }
        }

        update();
    }

    function validate() {
        errors = { };

        if (state.password != state.password_confirm)
            errors.password_confirm = _("The passwords do not match");

        return password_quality(state.password)
                .catch(ex => {
                    errors.password = ex.message || ex.toString();
                })
                .then(() => {
                    return !has_errors(errors);
                });
    }

    function update() {
        const props = {
            id: "account-set-password-dialog",
            title: _("Set Password"),
            body: <SetPasswordDialogBody state={state} errors={errors} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Set"),
                    style: "primary",
                    clicked: () => {
                        return validate().then(valid => {
                            if (valid) {
                                if (change_self)
                                    return passwd_self(state.password_old, state.password);
                                else
                                    return passwd_change(account.name, state.password);
                            } else {
                                update();
                                return Promise.reject();
                            }
                        });
                    }
                }
            ]
        };

        if (!dlg)
            dlg = show_modal_dialog(props, footer);
        else {
            dlg.setProps(props);
            dlg.setFooterProps(footer);
        }
    }

    update();
}

export function reset_password_dialog(account) {
    var msg = cockpit.format(_("The account '$0' will be forced to change their password on next login"),
                             account.name);

    const props = {
        id: "password-reset",
        title: _("Force password change"),
        body: <Modal.Body><p>{msg}</p></Modal.Body>
    };

    const footer = {
        actions: [
            {
                caption: _("Reset"),
                style: "primary",
                clicked: () => {
                    return cockpit.spawn(["/usr/bin/passwd", "-e", account.name],
                                         { superuser : true, err: "message" });
                }
            }
        ]
    };

    show_modal_dialog(props, footer);
}
