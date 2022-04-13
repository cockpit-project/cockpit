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

import { Checkbox, Form, FormGroup, TextInput, Popover, Flex, FlexItem, Radio } from '@patternfly/react-core';
import { has_errors } from "./dialog-utils.js";
import { passwd_change } from "./password-dialogs.js";
import { password_quality, PasswordFormFields } from "cockpit-components-password.jsx";
import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";
import { HelpIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

function AccountCreateBody({ state, errors, change }) {
    const {
        real_name, user_name,
        locked, change_passw_force
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

            <PasswordFormFields password_label={_("Password")}
                                password_confirm_label={_("Confirm")}
                                error_password={errors && errors.password}
                                error_password_confirm={errors && errors.password_confirm}
                                idPrefix="accounts-create-password"
                                change={change} />

            <FormGroup label={_("Authentication")} fieldId="accounts-create-locked" hasNoPaddingTop>
                <Radio id="account-use-password"
                       label={_("Use password")}
                       isChecked={!locked} onChange={checked => change("locked", !checked)}
                       description={
                           <Checkbox id="accounts-create-force-password-change"
                                     className="pf-u-mb-xs"
                                     label={_("Require password change on first login")}
                                     isChecked={change_passw_force} onChange={checked => change("change_passw_force", checked)} />
                       } />

                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem spacer={{ default: 'spacerSm' }}>
                        <Radio id="accounts-create-locked"
                               isChecked={locked} onChange={checked => change("locked", checked)}
                               label={_("Disallow password authentication")} />
                    </FlexItem>

                    <FlexItem spacer={{ default: 'spacerLg' }}>
                        <Popover bodyContent={_("Other authentication methods are still available even when interactive password authentication is not allowed.")}
                                 showClose={false}>
                            <HelpIcon />
                        </Popover>
                    </FlexItem>
                </Flex>
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

    for (let i = 0; i < username.length; i++) {
        if (!is_valid_char_username(username[i]))
            return _("The user name can only consist of letters from a-z, digits, dots, dashes and underscores.");
    }

    for (let k = 0; k < accounts.length; k++) {
        if (accounts[k].name == username)
            return _("This user name already exists");
    }

    return null;
}

function suggest_username(realname) {
    function remove_diacritics(str) {
        const translate_table = {
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
        for (const i in translate_table)
            str = str.replace(new RegExp(translate_table[i], 'g'), i);

        for (let k = 0; k < str.length;) {
            if (!is_valid_char_username(str[k]))
                str = str.substr(0, k) + str.substr(k + 1);
            else
                k++;
        }

        return str;
    }

    let result = "";
    const name = realname.split(' ');

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
        locked: false,
        confirm_weak: false,
        change_passw_force: false,
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
        }

        if (field == "change_passw_force")
            state.locked = false;

        if (field == "locked")
            state.change_passw_force = false;

        update();
    }

    function validate(force, real_name, user_name, password, password_confirm) {
        const errs = { };

        if (!real_name)
            errors.real_name = _("No real name specified");

        if (password != password_confirm)
            errs.password_confirm = _("The passwords do not match");

        if (password.length > 256)
            errs.password = _("Password is longer than 256 characters");

        errs.user_name = validate_username(user_name, accounts);

        return password_quality(password, force)
                .catch(ex => {
                    errs.password = (ex.message || ex.toString()).replace("\n", " ");
                })
                .then(() => {
                    errors = errs;
                    return !has_errors(errs);
                });
    }

    function create(real_name, user_name, password, locked, force_change) {
        return cockpit.spawn(["/usr/sbin/useradd", "-D"], { superuser: "require" })
                .catch(() => "")
                .then(defaults => {
                    let shell = null;
                    defaults.split("\n").forEach(item => {
                        if (item.indexOf("SHELL=") === 0) {
                            shell = item.split("=")[1] || "";
                        }
                    });
                    const prog = ["/usr/sbin/useradd", "--create-home", "-s", shell || "/bin/bash"];
                    if (real_name) {
                        prog.push('-c');
                        prog.push(real_name);
                    }
                    prog.push(user_name);
                    return cockpit.spawn(prog, { superuser: "require", err: "message" })
                            .then(() => passwd_change(user_name, password))
                            .then(() => {
                                if (locked)
                                    return cockpit.spawn([
                                        "/usr/sbin/usermod",
                                        user_name,
                                        "--lock"
                                    ], { superuser: "require", err: "message" });
                                if (force_change)
                                    return cockpit.spawn([
                                        "/usr/bin/passwd",
                                        "-e",
                                        user_name
                                    ], { superuser: "require", err: "message" });
                            });
                });
    }

    function passwd_check(force_weak, real_name, user_name, password, password_confirm, locked, force_change) {
        return validate(force_weak, real_name, user_name, password, password_confirm).then(valid => {
            if (valid)
                return create(real_name, user_name, password, locked, force_change);
            else {
                if (!errors.real_name && !errors.user_name && !errors.password_confirm && state.password.length <= 256) {
                    state.confirm_weak = true;
                }
                update();
                return Promise.reject();
            }
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
                        return passwd_check(false, state.real_name, state.user_name, state.password, state.password_confirm, state.locked, state.change_passw_force);
                    },
                    disabled: state.confirm_weak
                }
            ]
        };
        if (state.confirm_weak) {
            footer.actions.push(
                {
                    caption: _("Create account with weak password"),
                    style: "warning",
                    clicked: () => {
                        return passwd_check(true, state.real_name, state.user_name, state.password, state.password_confirm, state.locked);
                    }
                }
            );
        }

        if (!dlg)
            dlg = show_modal_dialog(props, footer);
        else {
            dlg.setProps(props);
            dlg.setFooterProps(footer);
        }
    }

    update();
}
