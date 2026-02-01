/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';
import React from 'react';
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";

import { has_errors } from "./dialog-utils.js";
import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

function ShellDialogBody({ state, errors, change, shells }) {
    const { shell } = state;
    return (
        <Form className="shell-modal" onSubmit={apply_modal_dialog}>
            <FormGroup fieldId="edit-user-shell">
                <FormSelect
                        data-selected={shell}
                        id="edit-user-shell"
                        onChange={(_, selection) => { change("shell", selection) }}
                        value={shell}>
                    { shells.map(shell_path => <FormSelectOption key={shell_path} value={shell_path} label={shell_path} />) }
                </FormSelect>
            </FormGroup>
        </Form>
    );
}

export function account_shell_dialog(account, shells) {
    let dlg = null;

    const state = {
        shell: account.shell,
    };

    let errors = { };

    function change(field, value) {
        state[field] = value;
        update();
    }

    function validate() {
        errors = { };

        return !has_errors(errors);
    }

    function update() {
        const props = {
            id: "shell-dialog",
            title: _("Change shell"),
            body: <ShellDialogBody state={state} errors={errors} change={change} shells={shells} />,
            variant: "small"
        };

        const footer = {
            actions: [
                {
                    caption: _("Change"),
                    style: "primary",
                    clicked: () => {
                        if (validate()) {
                            return cockpit.spawn(["usermod", "--shell", state.shell, account.name],
                                                 { superuser: "require", err: "message" });
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
