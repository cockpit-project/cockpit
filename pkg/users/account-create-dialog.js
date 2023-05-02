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

import { Bullseye } from "@patternfly/react-core/dist/esm/layouts/Bullseye/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { has_errors, is_valid_char_name } from "./dialog-utils.js";
import { passwd_change } from "./password-dialogs.js";
import { FormHelper } from "cockpit-components-form-helper";
import { password_quality, PasswordFormFields } from "cockpit-components-password.jsx";
import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";
import { HelpIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

function get_default_home_dir(base_home_dir, user_name) {
    return base_home_dir && user_name
        ? base_home_dir + '/' + user_name
        : "";
}

function AccountCreateBody({ state, errors, change, shells }) {
    const {
        real_name, user_name,
        locked, change_passw_force,
        shell,
    } = state;

    // We want to let user know that password and confirmation password do not match without them having to constantly click on "Create" to validate the form.
    // But we also don't want to show an error message while they are typing the confirmation password, only when they are finished typing it.
    // To solve the issue of telling that user is finished writing the confirmation password, let's do the following:
    // The dialog does not validate if passwords match until:
    //     1. they are at least the same length (which signals user has finished typing)
    // OR
    //     2. user submits the form (which also signals they are finished typing)
    // Once that happens, and passwords do not match, the confirm password is validated after each keystroke.
    let dynamic_password_confirm_error;
    if (state.password_confirm_dirty)
        dynamic_password_confirm_error = validate_password_confirm(state.password_confirm, state.password);

    return (
        <Form isHorizontal onSubmit={apply_modal_dialog}>
            <FormGroup label={_("Full name")}
                       fieldId="accounts-create-real-name">
                <TextInput id="accounts-create-real-name"
                           validated={(errors?.real_name) ? "error" : "default"}
                           value={real_name} onChange={value => change("real_name", value)} />
                <FormHelper fieldId="accounts-create-real-name" helperTextInvalid={errors?.real_name} />
            </FormGroup>

            <FormGroup label={_("User name")}
                       fieldId="accounts-create-user-name">
                <TextInput id="accounts-create-user-name"
                           validated={(errors?.user_name) ? "error" : "default"}
                           value={user_name} onChange={value => change("user_name", value)} />
                <FormHelper fieldId="accounts-create-user-name" helperTextInvalid={errors?.user_name} />
            </FormGroup>

            <FormGroup label={_("Home directory")}
                       fieldId="accounts-create-user-home-dir">
                <TextInput id="accounts-create-user-home-dir"
                    onChange={value => change("home_dir", value)}
                    placeholder={_("Path to directory")}
                    value={state.home_dir} />
                <FormHelper fieldId="accounts-create-user-home-dir" helperTextInvalid={errors?.home_dir} />
            </FormGroup>

            <FormGroup label={_("Shell")}
                       fieldId="accounts-create-user-shell">
                <FormSelect
                        data-selected={shell}
                        id="accounts-create-user-shell"
                        onChange={(_, selection) => { change("shell", selection) }}
                        value={shell}>
                    { shells.map(shell_path => <FormSelectOption key={shell_path} value={shell_path} label={shell_path} />) }
                </FormSelect>
            </FormGroup>

            <FormGroup label={_("User ID")}
                       fieldId="accounts-create-user-uid">
                <TextInput id="accounts-create-user-uid"
                    onChange={value => change("uid", value)}
                    value={state.uid} />
                <FormHelper fieldId="accounts-create-user-uid" helperTextInvalid={errors?.uid} />
            </FormGroup>

            <FormGroup label={_("Authentication")} fieldId="accounts-create-locked" hasNoPaddingTop>
                <Radio id="account-use-password"
                       label={_("Use password")}
                       isChecked={!locked} onChange={(_, checked) => change("locked", !checked)}
                       description={
                           <Checkbox id="accounts-create-force-password-change"
                                     className="pf-u-mb-xs"
                                     label={_("Require password change on first login")}
                                     isChecked={change_passw_force} onChange={(_event, checked) => change("change_passw_force", checked)} />
                       } />

                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem spacer={{ default: 'spacerSm' }}>
                        <Radio id="accounts-create-locked"
                               isChecked={locked} onChange={(_, checked) => change("locked", checked)}
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

            <PasswordFormFields password_label={_("Password")}
                                password_confirm_label={_("Confirm password")}
                                error_password={errors?.password}
                                error_password_confirm={dynamic_password_confirm_error || errors?.password_confirm}
                                idPrefix="accounts-create-password"
                                change={change} />
        </Form>
    );
}

function validate_username(username, accounts) {
    if (!username)
        return _("No user name specified");

    for (let i = 0; i < username.length; i++) {
        if (!is_valid_char_name(username[i]))
            return _("The user name can only consist of letters from a-z, digits, dots, dashes and underscores.");
    }

    for (let k = 0; k < accounts.length; k++) {
        if (accounts[k].name == username)
            return _("This user name already exists");
    }

    return null;
}

function validate_real_name(real_name) {
    if (!real_name)
        return _("No real name specified");

    const real_name_chars = Array.from(real_name);
    if (real_name_chars.includes(':'))
        return _("The full name must not contain colons.");
}

function validate_uid(uid, accounts, min_uid, max_uid, change) {
    if (!uid)
        return undefined;

    const uid_number = Number(uid);
    if (!Number.isInteger(uid_number) || uid_number < 0)
        return _("User ID must be a positive integer");

    if (min_uid && uid_number < min_uid)
        return cockpit.format(_("User ID must not be lower than $0"), min_uid);

    if (max_uid && uid_number > max_uid)
        return cockpit.format(_("User ID must not be higher than $0"), max_uid);

    if (accounts.some(account => account.uid === uid_number)) {
        change("uid_exists", true);
        return _("User ID is already used by another user");
    }
}

function validate_home_dir(dir, directoryExpected) {
    return cockpit.spawn(["test", "!", directoryExpected ? "-d" : "-f", dir], { superuser: "require" });
}

function validate_password(password) {
    if (!password)
        return _("Empty password");

    return null;
}

function validate_password_confirm(password_confirm, password) {
    if (password_confirm !== password)
        return _("The passwords do not match");

    return null;
}

function suggest_username(realname) {
    function remove_diacritics(str) {
        const translate_table = {
            a: '[àáâãäå]',
            ae: 'æ',
            c: '[čç]',
            d: 'ď',
            e: '[èéêë]',
            i: '[íìïî]',
            l: '[ĺľ]',
            n: '[ňñ]',
            o: '[òóôõö]',
            oe: 'œ',
            r: '[ŕř]',
            s: 'š',
            t: 'ť',
            u: '[ùúůûűü]',
            y: '[ýÿ]',
            z: 'ž',
        };
        for (const i in translate_table)
            str = str.replace(new RegExp(translate_table[i], 'g'), i);

        for (let k = 0; k < str.length;) {
            if (!is_valid_char_name(str[k]))
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

export function account_create_dialog(accounts, min_uid, max_uid, shells) {
    let dlg = null;

    const used_ids = accounts.map(a => a.uid);
    const uid = Math.max(min_uid, Math.max(...used_ids.filter(id => id < max_uid)) + 1);

    const state = {
        dialogLoading: true,
        real_name: "",
        user_name: "",
        password: "",
        password_confirm: "",
        password_confirm_dirty: false,
        locked: false,
        confirm_weak: false,
        change_passw_force: false,
        base_home_dir: null,
        shell: null,
        uid,
        uid_exists: false,
        min_uid,
        max_uid,
        home_dir: null,
        home_dir_dirty: false,
    };
    let errors = { };

    let old_password = null;
    let user_name_dirty = false;

    function get_defaults() {
        return cockpit.spawn(["useradd", "-D"], { superuser: "require", err: "message" })
                .catch(e => console.warn("Could not get useradd defaults: ", e.message))
                .then(defaults => {
                    let shell = null;
                    let base_home_dir = null;
                    defaults.split("\n").forEach(item => {
                        if (item.indexOf("SHELL=") === 0) {
                            shell = item.split("=")[1] || "/bin/bash";
                        } else if (item.indexOf("HOME=") === 0) {
                            base_home_dir = item.split("=")[1] || "";
                        }
                    });
                    change("shell", shell);
                    change("base_home_dir", base_home_dir);
                })
                .finally(() => change("dialogLoading", false));
    }

    function change(field, value) {
        state[field] = value;
        errors = { };

        if (field == "user_name") {
            user_name_dirty = true;
            if (!state.home_dir_dirty)
                state.home_dir = get_default_home_dir(state.base_home_dir, value);
        }

        if (!user_name_dirty && field == "real_name") {
            const suggested_username = suggest_username(state.real_name);
            state.user_name = suggested_username;
            if (!state.home_dir_dirty)
                state.home_dir = get_default_home_dir(state.base_home_dir, suggested_username);
        }

        if (state.password != old_password) {
            state.confirm_weak = false;
            old_password = state.password;
        }

        if (field == "change_passw_force")
            state.locked = false;

        // Once password and confirm password are the same length, validate them after each keystroke
        if (field == "password_confirm" && value.length >= state.password.length)
            state.password_confirm_dirty = true;

        if (field == "locked")
            state.change_passw_force = false;

        if (field == "uid")
            state.uid_exists = false;

        if (field == "home_dir") {
            state.home_dir_dirty = true;
            state.home_dir_exists = false;
            state.home_dir_is_file = false;
        }

        update();
    }

    function validate(force_weak, force_home, force_uid, real_name, user_name, password, password_confirm, uid, accounts, min_uid, max_uid, change) {
        const errs = { };

        errs.real_name = validate_real_name(real_name);
        errs.password = validate_password(password);
        errs.password_confirm = validate_password_confirm(password_confirm, password);

        if (password.length > 256)
            errs.password = _("Password is longer than 256 characters");

        errs.user_name = validate_username(user_name, accounts);

        const promises = [];
        // only evaluate password score if no other password error si present
        if (!errs.password) {
            promises.push(
                password_quality(password, force_weak)
                        .catch(ex => {
                            errs.password = (ex.message || ex.toString()).replaceAll("\n", " "); // not-covered: OS error
                        })
            );
        }
        if (!force_uid)
            errs.uid = validate_uid(uid, accounts, min_uid, max_uid, change);

        promises.push(
            validate_home_dir(state.home_dir, false)
                    .catch(() => {
                        errs.home_dir = cockpit.format(_("$0 is an existing file"), state.home_dir);
                        state.home_dir_is_file = true;
                    })
        );

        if (!force_home) {
            promises.push(
                validate_home_dir(state.home_dir, true)
                        .catch(() => {
                            errs.home_dir = cockpit.format(_("The home directory $0 already exists. Its ownership will be changed to the new user."), state.home_dir);
                            state.home_dir_exists = true;
                        })
            );
        }

        return Promise.all(promises)
                .then(() => {
                    errors = errs;
                    return !has_errors(errs);
                });
    }

    function create(real_name, user_name, password, locked, uid, force_change, home_dir, force_home, force_uid) {
        const prog = ["useradd", "--create-home", "-s", state.shell];
        if (real_name) {
            prog.push('-c');
            prog.push(real_name);
        }

        if (uid) {
            prog.push('-u');
            prog.push(uid);
        }

        if (force_uid)
            prog.push('-o'); // Create user with non-unique user-specified UID, useful at certain use cases

        if (home_dir) {
            prog.push('-d');
            prog.push(home_dir);
        }

        prog.push(user_name);
        return cockpit.spawn(prog, { superuser: "require", err: "message" })
                .then(() => passwd_change(user_name, password))
                .then(() => {
                    if (locked)
                        return cockpit.spawn([
                            "usermod",
                            user_name,
                            "--lock"
                        ], { superuser: "require", err: "message" });
                    if (force_change)
                        return cockpit.spawn([
                            "passwd",
                            "-e",
                            user_name
                        ], { superuser: "require", err: "message" });
                })
                .then(() => {
                    if (force_home) {
                        return cockpit.spawn(["id", user_name, "--group"], { superuser: "require", err: "message" })
                                .then(gid => cockpit.spawn(["chown", "-hR", `${user_name}:${gid.trim()}`, home_dir], { superuser: "require", err: "message" }));
                    }
                });
    }

    function passwd_check(force_weak, force_home, force_uid, real_name, user_name, password, password_confirm, locked, home_dir, force_passwd_change, uid, accounts, min_uid, max_uid, change) {
        return validate(force_weak, force_home, force_uid, real_name, user_name, password, password_confirm, uid, accounts, min_uid, max_uid, change).then(valid => {
            if (valid)
                return create(real_name, user_name, password, locked, uid, force_passwd_change, home_dir, force_home, force_uid);
            else {
                if (!errors.real_name && !errors.user_name && !errors.home_dir && !errors.uid && !errors.password_confirm && state.password.length <= 256)
                    state.confirm_weak = true;

                // Once the form is submitted and passwords do not match, validate confirm password after each keystroke
                if (errors.password_confirm)
                    state.password_confirm_dirty = true;

                update();
                return Promise.reject();
            }
        });
    }

    function update() {
        const props = {
            id: "accounts-create-dialog",
            title: _("Create new account"),
        };
        if (state.dialogLoading) {
            props.body = (
                <Bullseye>
                    <Spinner />
                </Bullseye>
            );
        } else {
            props.body = <AccountCreateBody state={state} errors={errors} change={change} shells={shells} />;
        }

        const footer = {
            actions: [
                {
                    caption: _("Create"),
                    style: "primary",
                    clicked: () => passwd_check(
                        false, // force weak password was NOT clicked
                        false, // force user with existing home directory was NOT clicked
                        false, // force user with non-unique UID was NOT clicked
                        state.real_name,
                        state.user_name,
                        state.password,
                        state.password_confirm,
                        state.locked,
                        state.home_dir,
                        state.change_passw_force,
                        state.uid,
                        accounts,
                        state.min_uid,
                        state.max_uid,
                        change
                    ),
                    disabled: state.confirm_weak || state.uid_exists || state.home_dir_exists || state.home_dir_is_file
                }
            ]
        };
        if (state.home_dir_exists) {
            footer.actions.push(
                {
                    caption: _("Create and change ownership of home directory"),
                    style: "warning",
                    clicked: () => passwd_check(
                        false, // force weak password was NOT clicked
                        true, // force user with existing home directory was WAS clicked
                        false, // force user with non-unique UID was NOT clicked
                        state.real_name,
                        state.user_name,
                        state.password,
                        state.password_confirm,
                        state.locked,
                        state.home_dir,
                        state.change_passw_force,
                        state.uid,
                        accounts,
                        state.min_uid,
                        state.max_uid,
                        change
                    ),
                }
            );
        }
        if (state.confirm_weak) {
            footer.actions.push(
                {
                    caption: _("Create account with weak password"),
                    style: "warning",
                    clicked: () => passwd_check(
                        true, // force weak password was WAS clicked
                        false, // force user with existing home directory was NOT clicked
                        false, // force user with non-unique UID was NOT clicked
                        state.real_name,
                        state.user_name,
                        state.password,
                        state.password_confirm,
                        state.locked,
                        state.home_dir,
                        state.change_passw_force,
                        state.uid,
                        accounts,
                        state.min_uid,
                        state.max_uid,
                        change
                    ),
                }
            );
        }
        if (state.uid_exists) {
            footer.actions.push(
                {
                    caption: _("Create account with non-unique UID"),
                    style: "warning",
                    clicked: () => passwd_check(
                        false, // force weak password was NOT clicked
                        false, // force user with existing home directory was NOT clicked
                        true, // force user with non-unique UID was WAS clicked
                        state.real_name,
                        state.user_name,
                        state.password,
                        state.password_confirm,
                        state.locked,
                        state.home_dir,
                        state.change_passw_force,
                        state.uid,
                        accounts,
                        state.min_uid,
                        state.max_uid,
                        change
                    ),
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
    get_defaults();
}
