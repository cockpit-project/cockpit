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
import React, { useState } from 'react';

import { Dropdown, DropdownItem, DropdownSeparator, KebabToggle } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";

import { delete_group_dialog } from "./delete-group-dialog.js";
import { rename_group_dialog } from "./rename-group-dialog.jsx";

const _ = cockpit.gettext;

export const GroupActions = ({ group, accounts, isMainPage }) => {
    const [isKebabOpen, setKebabOpen] = useState(false);
    const actions = [];

    if (isMainPage) {
        actions.push(
            <DropdownItem key="edit-group"
                          onClick={ev => { ev.preventDefault(); cockpit.location.go(["group", group.name]) }}>
                {_("Edit group")}
            </DropdownItem>
        );
    } else if (group.isUserCreatedGroup) {
        actions.push(
            <DropdownItem key="rename-group"
                          onClick={() => { setKebabOpen(false); rename_group_dialog(group.name) }}>
                {_("Rename")}
            </DropdownItem>
        );
    }

    if (group.isUserCreatedGroup) {
        actions.push(
            <DropdownSeparator key="separator" />,
            <DropdownItem key="delete-group"
                          className={group.uid === 0 ? "" : "delete-resource-red"}
                          onClick={() => { setKebabOpen(false); delete_group_dialog(group) }}>
                {isMainPage ? _("Delete group") : _("Delete")}
            </DropdownItem>
        );
    }

    if (actions.length === 0)
        return null;

    const kebab = (
        <Dropdown toggle={<KebabToggle onToggle={setKebabOpen} />}
                isPlain
                isOpen={isKebabOpen}
                position="right"
                dropdownItems={actions} />
    );
    return kebab;
};
