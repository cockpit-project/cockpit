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

import { Form, FormGroup, TextInput } from '@patternfly/react-core';
import { show_modal_dialog, apply_modal_dialog } from "cockpit-components-dialog.jsx";

import { has_errors, is_valid_char_name } from "./dialog-utils.js";

const _ = cockpit.gettext;

function GroupCreateBody({ state, errors, change }) {
    const {
        name, id,
    } = state;

    return (
        <Form isHorizontal onSubmit={apply_modal_dialog}>
            <FormGroup label={_("Name")}
                       helperTextInvalid={errors && errors.name}
                       validated={(errors && errors.name) ? "error" : "default"}
                       fieldId="groups-create-name">
                <TextInput id="groups-create-name"
                           validated={(errors && errors.name) ? "error" : "default"}
                           value={name} onChange={value => change("name", value)} />
            </FormGroup>

            <FormGroup label={_("ID")}
                       hasNoPaddingTop
                       helperTextInvalid={errors && errors.id}
                       validated={(errors && errors.id) ? "error" : "default"}
                       isStack
                       fieldId="groups-create-id">
                <TextInput id="groups-create-id"
                           validated={(errors && errors.id) ? "error" : "default"}
                           value={id} onChange={value => change("id", value)} />
            </FormGroup>
        </Form>
    );
}

function validate_name(name, groups) {
    if (!name)
        return _("No group name specified");

    for (let i = 0; i < name.length; i++) {
        if (!is_valid_char_name(name[i]))
            return _("The group name can only consist of letters from a-z, digits, dots, dashes and underscores");
    }

    for (let k = 0; k < groups.length; k++) {
        if (groups[k].name == name)
            return _("A group with this name already exists");
    }

    return null;
}

function validate_group(id, groups) {
    if (!id)
        return _("No ID specified");

    const id_num = parseInt(id);
    if (id_num.toString() !== id || id_num < 0)
        return _("The group ID must be positive integer");

    return null;
}

export function group_create_dialog(groups, setGroupsCardExpanded) {
    //  Handle also the case where logindef == null, i.e. the file does not exist.
    //  While that's unusual, "empty /etc" is a goal, and it shouldn't crash the page.
    cockpit.file("/etc/login.defs").read()
            .then(logindef => {
                const gids = groups
                        .filter(g => g.name !== 'nobody')
                        .map(group => group.gid);
                const min_gid = parseInt(logindef.match(/^GID_MIN\s+(\d+)/m)[1] || 500);
                const max_gid = parseInt(logindef.match(/^GID_MAX\s+(\d+)/m)[1] || 60000);

                change("id", (Math.max(min_gid, Math.max(...gids.filter(id => id < max_gid)) + 1) + 1).toString());
            }, () => Promise.resolve());

    let dlg = null;
    const state = {
        name: "",
        id: "",
    };
    let errors = { };

    function change(field, value) {
        state[field] = value;
        errors = { };

        update();
    }

    function validate(name, id) {
        const errs = { };

        errs.name = validate_name(name, groups);
        errs.id = validate_group(id, groups);
        errors = errs;

        return !has_errors(errs);
    }

    function create(name, id) {
        const valid = validate(name, id);
        if (valid) {
            const group_add_cmd = ["groupadd", name, "-g", id];

            return cockpit.spawn(group_add_cmd, { superuser: "require", err: "message" });
        } else {
            update();
            return Promise.reject();
        }
    }

    function update() {
        const props = {
            id: "groups-create-dialog",
            title: _("Create new group"),
            body: <GroupCreateBody state={state} errors={errors} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Create"),
                    style: "primary",
                    clicked: () => create(state.name, state.id).then(() => setGroupsCardExpanded(true))
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
