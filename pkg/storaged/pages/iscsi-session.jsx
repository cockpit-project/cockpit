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

import cockpit from "cockpit";
import React from "react";
import client from "../client";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { PageChildrenCard, new_page, page_type, ActionButtons } from "../pages.jsx";

import { make_drive_page } from "./drive.jsx";

const _ = cockpit.gettext;

async function disconnect(session, goto_page) {
    const loc = cockpit.location;
    await session.Logout({ 'node.startup': { t: 's', v: "manual" } });
    loc.go(goto_page.location);
}

export function make_iscsi_session_page(parent, session) {
    const p = new_page({
        location: ["iscsi", session.data.target_name],
        parent,
        name: session.data.target_name,
        columns: [
            _("iSCSI portal"),
            session.data.persistent_address + ":" + session.data.persistent_port,
            null,
        ],
        component: ISCSISessionPage,
        props: { session },
        actions: [
            {
                title: _("Disconnect"),
                action: () => disconnect(session, parent),
                danger: true
            },
        ]
    });

    if (client.iscsi_sessions_drives[session.path])
        client.iscsi_sessions_drives[session.path].forEach(d => make_drive_page(p, d));
}

const ISCSISessionPage = ({ page, session }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Address")} value={session.data.address} />
                            <SDesc title={_("Target")} value={session.data.target_name} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <StackItem>
                <PageChildrenCard title={_("Drives")} page={page} />
            </StackItem>
        </Stack>
    );
};
