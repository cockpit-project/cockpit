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

import { Modal } from 'patternfly-react';
import { Validated, has_errors } from "./dialog-utils.js";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

function AccountExpirationDialogBody({ state, errors, change }) {
    const { mode, before, after, date } = state;

    return (
        <Modal.Body className="expiration-modal">
            <form>
                <table className="form-table-ct">
                    <tbody>
                        <tr>
                            <td>
                                <label>
                                    <input type="radio" id="account-expiration-never" name="mode" value="never"
                   checked={mode == "never"} onChange={event => change("mode", "never")} />
                                    <span>{_("Never lock account")}</span>
                                </label>
                            </td>
                        </tr>
                        <tr>
                            <td>
                                <label className="dialog-wrapper">
                                    <Validated errors={errors} error_key="date">
                                        <input type="radio" id="account-expiration-expires" name="mode" value="expires"
            checked={mode == "expires"} onChange={event => change("mode", "expires")} />
                                        <span id="account-expiration-before">{before}</span>
                                        <input type='text' className="form-control size-text-ct" id="account-expiration-input"
        value={date} onChange={event => change("date", event.target.value)} disabled={mode != "expires"} />
                                        <span id="account-expiration-after">{after}</span>
                                    </Validated>
                                </label>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </form>
        </Modal.Body>);
}

export function account_expiration_dialog(account, expire_date) {
    let dlg = null;

    /* TRANSLATORS: This is split up and therefore cannot use ngettext plurals */
    var parts = _("Lock account on $0").split("$0");

    const state = {
        mode: expire_date ? "expires" : "never",
        before: parts[0],
        after: parts[1],
        date: expire_date ? expire_date.toISOString() : ""
    };

    let errors = { };

    function change(field, value) {
        state[field] = value;
        update();
    }

    function validate() {
        errors = { };

        if (state.mode == "expires") {
            if (!state.date)
                errors.date = _("Please specify an expiration date");
            else {
                const date = new Date(state.date + "T12:00:00Z");
                if (isNaN(date.getTime()) || date.getTime() < 0)
                    errors.date = _("Invalid expiration date");
            }
        }

        return !has_errors(errors);
    }

    function update() {
        const props = {
            id: "account-expiration",
            title: _("Account Expiration"),
            body: <AccountExpirationDialogBody state={state} errors={errors} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Change"),
                    style: "primary",
                    clicked: () => {
                        if (validate()) {
                            var prog = ["/usr/sbin/usermod", "-e"];
                            if (state.mode == "expires") {
                                const date = new Date(state.date + "T12:00:00Z");
                                prog.push(date.toISOString().substr(0, 10));
                            } else
                                prog.push("");
                            prog.push(account.name);
                            return cockpit.spawn(prog, { superuser : true, err: "message" });
                        } else {
                            update();
                            return Promise.reject();
                        }
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

function PasswordExpirationDialogBody({ state, errors, change }) {
    const { mode, before, after, days } = state;

    return (
        <Modal.Body className="expiration-modal">
            <form>
                <table className="form-table-ct">
                    <tbody>
                        <tr>
                            <td>
                                <label>
                                    <input type="radio" id="password-expiration-never" name="mode" value="never"
                   checked={mode == "never"} onChange={event => change("mode", "never")} />
                                    <span>{_("Never expire password")}</span>
                                </label>
                            </td>
                        </tr>
                        <tr>
                            <td>
                                <label className="dialog-wrapper">
                                    <Validated errors={errors} error_key="days">
                                        <input type="radio" id="password-expiration-expires" name="mode" value="expires"
                   checked={mode == "expires"} onChange={event => change("mode", "expires")} />
                                        <span id="password-expiration-before">{before}</span>
                                        <input type='text' className="form-control size-text-ct" id="password-expiration-input"
        value={days} onChange={event => change("days", event.target.value)} disabled={mode != "expires"} />
                                        <span id="password-expiration-after">{after}</span>
                                    </Validated>
                                </label>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </form>
        </Modal.Body>);
}

export function password_expiration_dialog(account, expire_days) {
    let dlg = null;

    /* TRANSLATORS: This is split up and therefore cannot use ngettext plurals */
    var parts = _("Require password change every $0 days").split("$0");

    if (parseInt(expire_days) >= 99999)
        expire_days = null;

    const state = {
        mode: expire_days ? "expires" : "never",
        before: parts[0],
        after: parts[1],
        days: expire_days || ""
    };

    let errors = { };

    function change(field, value) {
        state[field] = value;
        update();
    }

    function validate() {
        errors = { };

        if (state.mode == "expires") {
            const days = parseInt(state.days);
            if (isNaN(days) || days < 0)
                errors.days = _("Invalid number of days");
        }

        return !has_errors(errors);
    }

    function update() {
        const props = {
            id: "password-expiration",
            title: _("Password Expiration"),
            body: <PasswordExpirationDialogBody state={state} errors={errors} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Change"),
                    style: "primary",
                    clicked: () => {
                        if (validate()) {
                            const days = state.mode == "expires" ? parseInt(state.days) : 99999;
                            return cockpit.spawn(["/usr/bin/passwd", "-x", String(days), account.name],
                                                 { superuser: true, err: "message" });
                        } else {
                            update();
                            return Promise.reject();
                        }
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
