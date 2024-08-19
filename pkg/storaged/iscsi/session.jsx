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

import cockpit from "cockpit";
import React from "react";
import client from "../client";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { NetworkIcon } from "../icons/gnome-icons.jsx";
import {
    new_page, new_card, PAGE_CATEGORY_NETWORK,
    StorageDescription, ChildrenTable, StorageCard
} from "../pages.jsx";

import { make_drive_page } from "../drive/drive.jsx";

const _ = cockpit.gettext;

async function disconnect(session, goto_page) {
    const loc = cockpit.location;
    await session.Logout({ 'node.startup': { t: 's', v: "manual" } });
    loc.go(goto_page.location);
}

export function make_iscsi_session_page(parent, session) {
    const session_card = new_card({
        title: _("iSCSI portal"),
        next: null,
        page_location: ["iscsi", session.data.target_name],
        page_name: session.data.target_name,
        page_icon: NetworkIcon,
        page_categroy: PAGE_CATEGORY_NETWORK,
        component: ISCSISessionCard,
        props: { session },
        actions: [
            {
                title: _("Disconnect"),
                action: () => disconnect(session, parent),
                danger: true
            },
        ]
    });

    const drives_card = new_card({
        title: _("iSCSI drives"),
        next: session_card,
        component: ISCSIDrivesCard,
        props: { session },
    });

    const p = new_page(parent, drives_card);

    if (client.iscsi_sessions_drives[session.path])
        client.iscsi_sessions_drives[session.path].forEach(d => make_drive_page(p, d));
}

const ISCSIDrivesCard = ({ card, session }) => {
    return (
        <StorageCard card={card}>
            <CardBody className="contains-list">
                <ChildrenTable emptyCaption={_("No drives found")}
                               aria-label={_("iSCSI drives")}
                               page={card.page} />
            </CardBody>
        </StorageCard>
    );
};

const ISCSISessionCard = ({ card, session }) => {
    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Address")} value={session.data.address} />
                    <StorageDescription title={_("Target")} value={session.data.target_name} />
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
