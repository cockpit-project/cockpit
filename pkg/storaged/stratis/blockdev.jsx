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
import { format_dialog } from "../block/format-dialog.jsx";
import { fmt_size } from "../utils.js";
import { std_lock_action } from "../crypto/actions.jsx";

const _ = cockpit.gettext;

export function make_stratis_blockdev_card(next, backing_block, content_block) {
    const blockdev = client.blocks_stratis_blockdev[content_block.path];
    const pool = blockdev && client.stratis_pools[blockdev.Pool];
    const stopped_pool = client.blocks_stratis_stopped_pool[content_block.path];

    const blockdev_card = new_card({
        title: _("Stratis block device"),
        location: pool ? pool.Name : stopped_pool,
        next,
        component: StratisBlockdevCard,
        props: { backing_block, content_block, pool, stopped_pool },
        actions: [
            std_lock_action(backing_block, content_block),
            { title: _("Format"), action: () => format_dialog(client, backing_block.path), danger: true },
        ]
    });

    if (pool || stopped_pool) {
        let extra;
        if (blockdev && blockdev.Tier == 0)
            extra = _("data");
        else if (blockdev && blockdev.Tier == 1)
            extra = _("cache");
        else
            extra = null;

        register_crossref({
            key: pool || stopped_pool,
            card: blockdev_card,
            actions: [],
            size: blockdev ? fmt_size(Number(blockdev.TotalPhysicalSize)) : fmt_size(content_block.Size),
            extra,
        });
    }

    return blockdev_card;
}

export const StratisBlockdevCard = ({ card, backing_block, content_block, pool, stopped_pool }) => {
    const pool_name = pool ? pool.Name : stopped_pool;
    const pool_uuid = pool ? pool.Uuid : stopped_pool;

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Stratis pool")}>
                        {(pool || stopped_pool)
                            ? <Button variant="link" isInline role="link"
                                   onClick={() => cockpit.location.go(["pool", pool_uuid])}>
                                {pool_name}
                            </Button>
                            : "-"
                        }
                    </StorageDescription>
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
