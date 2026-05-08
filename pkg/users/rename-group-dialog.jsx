/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';
import React from 'react';
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { apply_modal_dialog, show_modal_dialog } from "cockpit-components-dialog.jsx";
import { FormHelper } from "cockpit-components-form-helper";
import { has_errors, is_valid_char_name } from "./dialog-utils.js";

const _ = cockpit.gettext;

function RenameGroupDialogBody({ state, errors, change }) {
    const { name } = state;

    return (
        <Form isHorizontal onSubmit={apply_modal_dialog}>
            <FormGroup fieldId="group-name" label={_("New name")}>
                <TextInput id="group-name"
                           validated={(errors?.name) ? "error" : "default"}
                           onChange={(_event, val) => change("name", val)} value={name} />
                <FormHelper fieldId="group-name" helperTextInvalid={errors?.name} />
            </FormGroup>
            <HelperText>
                <HelperTextItem variant="warning">{_("Renaming a group may affect sudo and similar rules")}</HelperTextItem>
            </HelperText>
        </Form>
    );
}

function validate_name(name) {
    if (!name)
        return _("Group name cannot be empty");

    for (let i = 0; i < name.length; i++) {
        if (!is_valid_char_name(name[i]))
            return _("The group name can only consist of letters from a-z, digits, dots, dashes and underscores");
    }

    return null;
}

export function rename_group_dialog(group) {
    let dlg = null;

    const state = {
        name: group
    };
    let errors = { };

    function change(field, value) {
        state[field] = value;
        errors = { };
        update();
    }

    function update() {
        const props = {
            id: "group-confirm-rename-dialog",
            title: cockpit.format(_("Rename group $0"), group),
            body: <RenameGroupDialogBody state={state} errors={errors} change={change} />,
            variant: 'small',
        };

        const footer = {
            actions: [
                {
                    caption: _("Rename"),
                    style: "primary",
                    clicked: () => {
                        errors.name = validate_name(state.name);
                        if (has_errors(errors)) {
                            update();
                            return Promise.reject();
                        }
                        return cockpit.spawn(["groupmod", group, "--new-name", state.name], { superuser: "require", err: "message" }).then(dlg.close);
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
