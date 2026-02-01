/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
        page_category: PAGE_CATEGORY_NETWORK,
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
            <ChildrenTable
                emptyCaption={_("No drives found")}
                aria-label={_("iSCSI drives")}
                page={card.page} />
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
