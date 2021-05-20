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

import { Checkbox, Form, FormGroup, TextInput } from '@patternfly/react-core';
import { has_errors } from "./dialog-utils.js";
import { passwd_change } from "./password-dialogs.js";
import { password_quality, PasswordFormFields } from "cockpit-components-password.jsx";
import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

function AccountCreateBody({ state, errors, change }) {
    const {
        real_name, user_name,
        password, password_confirm, password_strength, password_message,
        locked
    } = state;

    return (
        <Form isHorizontal onSubmit={apply_modal_dialog}>
            <FormGroup label={_("Full name")}
                       helperTextInvalid={errors && errors.real_name}
                       validated={(errors && errors.real_name) ? "error" : "default"}
                       fieldId="accounts-create-real-name">
                <TextInput id="accounts-create-real-name"
                           validated={(errors && errors.real_name) ? "error" : "default"}
                           value={real_name} onChange={value => change("real_name", value)} />
            </FormGroup>

            <FormGroup label={_("User name")}
                       helperTextInvalid={errors && errors.user_name}
                       validated={(errors && errors.user_name) ? "error" : "default"}
                       fieldId="accounts-create-user-name">
                <TextInput id="accounts-create-user-name"
                           validated={(errors && errors.user_name) ? "error" : "default"}
                           value={user_name} onChange={value => change("user_name", value)} />
            </FormGroup>

            <PasswordFormFields password={password}
                                password_confirm={password_confirm}
                                password_label={_("Password")}
                                password_confirm_label={_("Confirm")}
                                password_strength={password_strength}
                                password_message={password_message}
                                error_password={errors && errors.password}
                                error_password_confirm={errors && errors.password_confirm}
                                idPrefix="accounts-create-password"
                                change={change} />

            <FormGroup label={_("Access")} fieldId="accounts-create-locked" isInline>
                <Checkbox id="accounts-create-locked"
                          label={_("Lock account")}
                          isChecked={locked} onChange={checked => change("locked", checked)} />
            </FormGroup>
        </Form>
    );
}

function is_valid_char_username(c) {
    return (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '.' || c == '_' || c == '-';
}

function validate_username(username, accounts) {
    if (!username)
        return _("No user name specified");

    for (var i = 0; i < username.length; i++) {
        if (!is_valid_char_username(username[i]))
            return _("The user name can only consist of letters from a-z, digits, dots, dashes and underscores.");
    }

    for (var k = 0; k < accounts.length; k++) {
        if (accounts[k].name == username)
            return _("This user name already exists");
    }

    return null;
}

function suggest_username(realname) {
    function remove_diacritics(str) {
        var translate_table = {
            a :  '[àáâãäå]',
            ae:  'æ',
            c :  '[čç]',
            d :  'ď',
            e :  '[èéêë]',
            i :  '[íìïî]',
            l :  '[ĺľ]',
            n :  '[ňñ]',
            o :  '[òóôõö]',
            oe:  'œ',
            r :  '[ŕř]',
            s :  'š',
            t :  'ť',
            u :  '[ùúůûűü]',
            y :  '[ýÿ]',
            z :  'ž',
        };
        for (var i in translate_table)
            str = str.replace(new RegExp(translate_table[i], 'g'), i);

        for (var k = 0; k < str.length;) {
            if (!is_valid_char_username(str[k]))
                str = str.substr(0, k) + str.substr(k + 1);
            else
                k++;
        }

        return str;
    }

    var result = "";
    var name = realname.split(' ');

    if (name.length === 1)
        result = name[0].toLowerCase();
    else if (name.length > 1)
        result = name[0][0].toLowerCase() + name[name.length - 1].toLowerCase();

    return remove_diacritics(result);
}

export function account_create_dialog(accounts) {
    let dlg = null;
    const state = {
        real_name: "",
        user_name: "",
        password: "",
        password_confirm: "",
        password_strength: "",
        password_message: "",
        locked: false,
        confirm_weak: false,
    };
    let errors = { };

    let old_password = null;
    let user_name_dirty = false;

    function change(field, value) {
        state[field] = value;
        errors = { };

        if (field == "user_name")
            user_name_dirty = true;

        if (!user_name_dirty && field == "real_name")
            state.user_name = suggest_username(state.real_name);

        if (state.password != old_password) {
            state.confirm_weak = false;
            old_password = state.password;
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
                state.password_message = "";
            }
        }

        update();
    }

    function validate(force) {
        errors = { };

        if (!state.real_name)
            errors.real_name = _("No real name specified");

        if (state.password != state.password_confirm)
            errors.password_confirm = _("The passwords do not match");

        if (state.password.length > 256)
            errors.password = _("Password is longer than 256 characters");

        errors.user_name = validate_username(state.user_name, accounts);

        return password_quality(state.password, force)
                .catch(ex => {
                    errors.password = (ex.message || ex.toString()).replace("\n", " ");
                    errors.password += "\n" + cockpit.format(_("Click $0 again to use the password anyway."), _("Create"));
                })
                .then(() => !has_errors(errors));
    }

    function create() {
        return cockpit.spawn(["/usr/sbin/useradd", "-D"])
                .catch(() => "")
                .then(defaults => {
                    let shell = null;
                    defaults.split("\n").forEach(item => {
                        if (item.indexOf("SHELL=") === 0) {
                            shell = item.split("=")[1] || "";
                        }
                    });
                    var prog = ["/usr/sbin/useradd", "--create-home", "-s", shell || "/bin/bash"];
                    if (state.real_name) {
                        prog.push('-c');
                        prog.push(state.real_name);
                    }
                    prog.push(state.user_name);
                    return cockpit.spawn(prog, { superuser: "require", err: "message" })
                            .then(() => passwd_change(state.user_name, state.password))
                            .then(() => {
                                if (state.locked)
                                    return cockpit.spawn([
                                        "/usr/sbin/usermod",
                                        state.user_name,
                                        "--lock"
                                    ], { superuser: "require", err: "message" });
                            });
                });
    }

    function update() {
        const props = {
            id: "accounts-create-dialog",
            title: _("Create new account"),
            body: <AccountCreateBody state={state} errors={errors} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Create"),
                    style: "primary",
                    clicked: () => {
                        const second_click = state.confirm_weak;
                        state.confirm_weak = !state.confirm_weak;
                        return validate(second_click).then(valid => {
                            if (valid)
                                return create();
                            else {
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
