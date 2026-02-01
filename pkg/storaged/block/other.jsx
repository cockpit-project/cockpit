/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from "react";
import client from "../client.js";

import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";

import { StorageCard, StorageDescription, new_card } from "../pages.jsx";
import { block_name, should_ignore } from "../utils.js";
import { partitionable_block_actions } from "../partitions/actions.jsx";
import { OtherIcon } from "../icons/gnome-icons.jsx";

import { make_block_page } from "../block/create-pages.jsx";

const _ = cockpit.gettext;

export function make_other_page(parent, block) {
    if (should_ignore(client, block.path))
        return;

    const other_card = new_card({
        title: _("Block device"),
        next: null,
        page_block: block,
        page_icon: OtherIcon,
        for_summary: true,
        job_path: block.path,
        component: OtherCard,
        props: { block },
        actions: partitionable_block_actions(block),
    });

    make_block_page(parent, block, other_card, { partitionable: true });
}

const OtherCard = ({ card, block }) => {
    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Device number")}
                                        value={(block.DeviceNumber >> 8) + ":" + (block.DeviceNumber & 0xFF)} />
                    <StorageDescription title={_("Device file")} value={block_name(block)} />
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
