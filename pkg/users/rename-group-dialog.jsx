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

const _ = cockpit.gettext;

function RenameGroupDialogBody({ state, change }) {
    const { name } = state;

    return (
        <Form isHorizontal onSubmit={apply_modal_dialog}>
            <FormGroup fieldId="group-name" label={_("New name")}>
                <TextInput id="group-name" onChange={(_event, val) => change("name", val)} value={name} />
            </FormGroup>
            <HelperText>
                <HelperTextItem variant="warning">{_("Renaming a group may affect sudo and similar rules")}</HelperTextItem>
            </HelperText>
        </Form>
    );
}

export function rename_group_dialog(group) {
    let dlg = null;

    const state = {
        name: group
    };

    function change(field, value) {
        state[field] = value;
        update();
    }

    function update() {
        const props = {
            id: "group-confirm-rename-dialog",
            title: cockpit.format(_("Rename group $0"), group),
            body: <RenameGroupDialogBody state={state} change={change} />,
            variant: 'small',
        };

        const footer = {
            actions: [
                {
                    caption: _("Rename"),
                    style: "primary",
                    clicked: () => cockpit.spawn(["groupmod", group, "--new-name", state.name], { superuser: "require", err: "message" }).then(dlg.close)
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
