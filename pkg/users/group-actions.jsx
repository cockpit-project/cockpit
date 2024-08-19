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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';
import React from 'react';

import { DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { Divider } from '@patternfly/react-core/dist/esm/components/Divider/index.js';
import { KebabDropdown } from "cockpit-components-dropdown";

import { delete_group_dialog } from "./delete-group-dialog.js";
import { rename_group_dialog } from "./rename-group-dialog.jsx";

const _ = cockpit.gettext;

export const GroupActions = ({ group }) => {
    if (!group.isUserCreatedGroup)
        return null;

    const actions = [
        <DropdownItem key="rename-group"
                      onClick={() => rename_group_dialog(group.name)}>
            {_("Rename group")}
        </DropdownItem>,
        <Divider key="separator" />,
        <DropdownItem key="delete-group"
                      className="delete-resource-red"
                      onClick={() => delete_group_dialog(group)}>
            {_("Delete group")}
        </DropdownItem>
    ];

    return <KebabDropdown dropdownItems={actions} />;
};
