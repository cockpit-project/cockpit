/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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
                <TextInput id="group-name" onChange={val => change("name", val)} value={name} />
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
            titleIconVariant: 'warning',
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
