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
import { Form, FormGroup, TextInput } from '@patternfly/react-core';

import { has_errors } from "./dialog-utils.js";
import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";
import { password_quality, PasswordFormFields } from "cockpit-components-password.jsx";

const _ = cockpit.gettext;

function passwd_self(old_pass, new_pass) {
    const old_exps = [
        /Current password: $/,
        /Current Password: $/,
        /.*\(current\) UNIX password: $/,
    ];
    const new_exps = [
        /.*New password: $/,
        /.*Retype new password: $/,
        /.*Enter new \w*\s?password: $/,
        /.*Retype new \w*\s?password: $/
    ];
    const bad_exps = [
        /.*BAD PASSWORD:.*/
    ];
    const too_new_exps = [
        /.*must wait longer to change.*/
    ];

    return new Promise((resolve, reject) => {
        let buffer = "";
        let sent_new = false;
        let failure = _("Old password not accepted");

        const timeout = window.setTimeout(function() {
            failure = _("Prompting via passwd timed out");
            proc.close("timeout");
        }, 10 * 1000);

        const proc = cockpit.spawn(["/usr/bin/passwd"], { pty: true, environ: ["LC_ALL=C"], err: "out" })
                .always(function() {
                    window.clearInterval(timeout);
                })
                .done(function() {
                    resolve();
                })
                .fail(function(ex) {
                    if (ex.exit_status || ex.problem == "timeout")
                        ex = new Error(failure);
                    reject(ex);
                })
                .stream(function(data) {
                    buffer += data;

                    for (let i = 0; i < too_new_exps.length; i++) {
                        if (too_new_exps[i].test(buffer)) {
                            failure = _("You must wait longer to change your password");
                        }
                    }

                    if (sent_new) {
                        for (let i = 0; i < bad_exps.length; i++) {
                            if (bad_exps[i].test(buffer)) {
                                failure = _("New password was not accepted");
                            }
                        }
                    }

                    for (let i = 0; i < old_exps.length; i++) {
                        if (old_exps[i].test(buffer)) {
                            buffer = "";
                            this.input(old_pass + "\n", true);
                            return;
                        }
                    }

                    for (let i = 0; i < new_exps.length; i++) {
                        if (new_exps[i].test(buffer)) {
                            buffer = "";
                            this.input(new_pass + "\n", true);
                            failure = _("Failed to change password");
                            sent_new = true;
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

function SetPasswordDialogBody({ state, errors, change }) {
    const {
        need_old, password_old, password, password_confirm,
        password_strength, password_message, current_user,
    } = state;

    return (
        <Form isHorizontal onSubmit={apply_modal_dialog}>
            { need_old &&
            <>
                <input hidden disabled value={current_user} />
                <FormGroup label={_("Old password")}
                           helperTextInvalid={errors && errors.password_old}
                           validated={(errors && errors.password_old) ? "error" : "default"}
                           fieldId="account-set-password-old">
                    <TextInput className="check-passwords" type="password" id="account-set-password-old"
                               autocomplete="current-password" value={password_old} onChange={value => change("password_old", value)} />
                </FormGroup>
            </> }
            <PasswordFormFields password={password}
                                password_confirm={password_confirm}
                                password_label={_("New password")}
                                password_confirm_label={_("Confirm new password")}
                                password_strength={password_strength}
                                password_message={password_message}
                                error_password={errors && errors.password}
                                error_password_confirm={errors && errors.password_confirm}
                                idPrefix="account-set-password"
                                change={change} />
        </Form>
    );
}

export function set_password_dialog(account, current_user) {
    let dlg = null;

    const change_self = (account.name == current_user && !superuser.allowed);

    const state = {
        need_old: change_self,
        current_user: current_user,
        password_old: "",
        password: "",
        password_confirm: "",
        password_strength: "",
        confirm_weak: false,
    };

    let errors = { };

    let old_password = null;

    function change(field, value) {
        state[field] = value;

        if (state.password != old_password) {
            state.confirm_weak = false;
            old_password = state.password;
            errors = { };
            if (state.password) {
                password_quality(state.password)
                        .catch(ex => {
                            return { value: 0 };
                        })
                        .then(strength => {
                            state.password_strength = strength.value;
                            state.password_message = strength.message;
                            update();
                        });
            } else {
                state.password_strength = "";
            }
        }

        update();
    }

    function validate(force) {
        errors = { };

        if (state.password != state.password_confirm)
            errors.password_confirm = _("The passwords do not match");

        if (state.password.length > 256)
            errors.password = _("Password is longer than 256 characters");

        return password_quality(state.password, force)
                .catch(ex => {
                    errors.password = (ex.message || ex.toString()).replace("\n", " ");
                    errors.password += "\n" + cockpit.format(_("Click $0 again to use the password anyway."), _("Set password"));
                })
                .then(() => {
                    return !has_errors(errors);
                });
    }

    function update() {
        const props = {
            id: "account-set-password-dialog",
            title: _("Set password"),
            body: <SetPasswordDialogBody state={state} errors={errors} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Set password"),
                    style: "primary",
                    clicked: () => {
                        const second_click = state.confirm_weak;
                        state.confirm_weak = !state.confirm_weak;

                        return validate(second_click).then(valid => {
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
    const msg = cockpit.format(_("The account '$0' will be forced to change their password on next login"),
                               account.name);

    const props = {
        id: "password-reset",
        title: _("Force password change"),
        body: <p>{msg}</p>
    };

    const footer = {
        actions: [
            {
                caption: _("Reset password"),
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
