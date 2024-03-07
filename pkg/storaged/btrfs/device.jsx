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

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { StorageCard, StorageDescription, new_card, register_crossref } from "../pages.jsx";
import { StorageUsageBar } from "../storage-controls.jsx";
import { std_lock_action } from "../crypto/actions.jsx";
import { std_format_action } from "../block/actions.jsx";
import { btrfs_device_usage } from "./utils.jsx";

const _ = cockpit.gettext;

export function make_btrfs_device_card(next, backing_block, content_block, block_btrfs) {
    const label = block_btrfs && block_btrfs.data.label;
    const uuid = block_btrfs && block_btrfs.data.uuid;
    const use = btrfs_device_usage(client, uuid, block_btrfs.path);

    const btrfs_card = new_card({
        title: _("btrfs device"),
        location: label || uuid,
        next,
        component: BtrfsDeviceCard,
        props: { backing_block, content_block },
        actions: btrfs_device_actions(backing_block, content_block),
    });

    register_crossref({
        key: uuid,
        card: btrfs_card,
        size: <StorageUsageBar stats={use} short />,
    });

    return btrfs_card;
}

export const BtrfsDeviceCard = ({ card, backing_block, content_block }) => {
    const block_btrfs = client.blocks_fsys_btrfs[content_block.path];
    const uuid = block_btrfs && block_btrfs.data.uuid;
    const label = block_btrfs && block_btrfs.data.label;
    const use = btrfs_device_usage(client, uuid, block_btrfs.path);

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("btrfs volume")}>
                        {uuid
                            ? <Button variant="link" isInline role="link"
                                   onClick={() => cockpit.location.go(["btrfs-volume", uuid])}>
                                {label || uuid}
                            </Button>
                            : "-"
                        }
                    </StorageDescription>
                    <StorageDescription title={_("UUID")} value={content_block.IdUUID} />
                    { block_btrfs &&
                    <StorageDescription title={_("Usage")}>
                        <StorageUsageBar key="s" stats={use} />
                    </StorageDescription>
                    }
                </DescriptionList>
            </CardBody>
        </StorageCard>);
};

export function btrfs_device_actions(backing_block, content_block) {
    if (backing_block && content_block)
        return [
            std_lock_action(backing_block, content_block),
            std_format_action(backing_block, content_block),
        ];
    else
        return [];
}
