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
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup, FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { DatePicker } from "@patternfly/react-core/dist/esm/components/DatePicker/index.js";

import { has_errors } from "./dialog-utils.js";
import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";
import * as timeformat from "timeformat.js";

const _ = cockpit.gettext;

function AccountExpirationDialogBody({ state, errors, change }) {
    const { mode, before, date } = state;

    return (
        <Form className="expiration-modal" onSubmit={apply_modal_dialog}>
            <FormGroup validated={errors && errors.date ? "error" : "default"}>
                <Radio id="account-expiration-never" name="mode" value="never"
                       label={_("Never expire account")}
                       isChecked={mode == "never"} onChange={() => change("mode", "never")} />
                <Radio id="account-expiration-expires" name="mode" value="expires"
                       label={
                           <Flex>
                               <span>{before}</span>
                               <DatePicker aria-label={_("Pick date")}
                                           buttonAriaLabel={_("Toggle date picker")}
                                           locale={timeformat.dateFormatLang()}
                                           weekStart={timeformat.firstDayOfWeek()}
                                           onChange={(_, str) => change("date", str)}
                                           invalidFormatText=""
                                           id="account-expiration-input"
                                           value={date}
                                           appendTo={() => document.body}
                                           isDisabled={mode !== "expires"} />
                           </Flex>
                       }
                       isChecked={mode == "expires"} onChange={() => change("mode", "expires")} />
                {errors && errors.date &&
                <FormHelperText isError isHidden={false}>
                    {errors.date}
                </FormHelperText>}
            </FormGroup>
        </Form>
    );
}

export function account_expiration_dialog(account, expire_date) {
    let dlg = null;

    const parts = _("Expire account on");

    const state = {
        mode: expire_date ? "expires" : "never",
        before: parts,
        date: expire_date ? expire_date.toISOString().substr(0, 10) : ""
    };

    let errors = { };

    function change(field, value) {
        state[field] = value;
        update();
    }

    // Datepicker does not provide information about the validity of the date so we need to do it here
    // https://github.com/patternfly/patternfly-react/issues/5564
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
            title: _("Account expiration"),
            body: <AccountExpirationDialogBody state={state} errors={errors} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Change"),
                    style: "primary",
                    clicked: () => {
                        if (validate()) {
                            const prog = ["/usr/sbin/usermod", "-e"];
                            if (state.mode == "expires") {
                                const date = new Date(state.date + "T12:00:00Z");
                                prog.push(date.toISOString().substr(0, 10));
                            } else
                                prog.push("");
                            prog.push(account.name);
                            return cockpit.spawn(prog, { superuser: true, err: "message" });
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
        <Form className="expiration-modal" onSubmit={apply_modal_dialog}>
            <FormGroup>
                <Radio id="password-expiration-never" name="mode" value="never"
                       label={_("Never expire password")}
                       isChecked={mode == "never"} onChange={() => change("mode", "never")} />
                <Radio id="password-expiration-expires" name="mode" value="expires"
                       label={<>
                           <span id="password-expiration-before">{before}</span>
                           <TextInput className="size-text-ct" id="password-expiration-input"
                                  validated={(errors && errors.days) ? "error" : "default"}
                                  value={days} onChange={value => change("days", value)} isDisabled={mode != "expires"} />
                           <span id="password-expiration-after">{after}</span>
                       </>}
                       isChecked={mode == "expires"} onChange={() => change("mode", "expires")} />
                {(errors && errors.days) &&
                <FormHelperText isError isHidden={false}>
                    {errors.days}
                </FormHelperText>}
            </FormGroup>
        </Form>
    );
}

export function password_expiration_dialog(account, expire_days) {
    let dlg = null;

    /* TRANSLATORS: This is split up and therefore cannot use ngettext plurals */
    const parts = _("Require password change every $0 days").split("$0");

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
            title: _("Password expiration"),
            body: <PasswordExpirationDialogBody state={state} errors={errors} change={change} />,
            variant: "small"
        };

        const footer = {
            actions: [
                {
                    caption: _("Change"),
                    style: "primary",
                    clicked: () => {
                        if (validate()) {
                            const days = state.mode == "expires" ? parseInt(state.days) : 99999;
                            return cockpit.spawn(["passwd", "-x", String(days), account.name],
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
