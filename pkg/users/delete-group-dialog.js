/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 Red Hat, Inc.
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
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Text, TextContent } from "@patternfly/react-core/dist/esm/components/Text/index.js";

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

export function delete_group_dialog(group) {
    const props = {
        id: "group-confirm-delete-dialog",
        title: cockpit.format(_("Permanently delete $0 group?"), group.name),
        body: group.userlistPrimary.length > 0
            ? <Stack hasGutter>
                <TextContent>
                    <Text>
                        {_("This group is the primary group for the following users:")}
                    </Text>
                </TextContent>
                <List>
                    {group.userlistPrimary.map(account => <ListItem key={account}>{account}</ListItem>)}
                </List>
            </Stack>
            : null
    };

    const footer = {
        actions: [
            {
                caption: group.userlistPrimary.length > 0 ? _("Force delete") : _("Delete"),
                style: "danger",
                clicked: () => {
                    const prog = ["groupdel"];
                    if (group.userlistPrimary.length > 0)
                        prog.push("-f");
                    prog.push(group.name);

                    return cockpit.spawn(prog, { superuser: "require", err: "message" });
                }
            }
        ]
    };

    show_modal_dialog(props, footer);
}
