/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
