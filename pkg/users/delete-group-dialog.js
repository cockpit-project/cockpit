/*
 * Copyright (C) 2022 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';
import React from 'react';
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Content, } from "@patternfly/react-core/dist/esm/components/Content/index.js";

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

export function delete_group_dialog(group) {
    const props = {
        id: "group-confirm-delete-dialog",
        title: cockpit.format(_("Permanently delete $0 group?"), group.name),
        body: group.userlistPrimary.length > 0
            ? <Stack hasGutter>
                <Content>
                    <Content component="p">
                        {_("This group is the primary group for the following users:")}
                    </Content>
                </Content>
                <List>
                    {group.userlistPrimary.map(account => <ListItem className='list-item' key={account}>{account}</ListItem>)}
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
