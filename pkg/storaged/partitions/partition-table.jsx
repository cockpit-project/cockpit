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

import { get_partitions } from "../utils.js";
import { StorageCard, ChildrenTable, new_page, new_card } from "../pages.jsx";
import { format_dialog } from "../block/format-dialog.jsx";
import { make_block_page } from "../block/create-pages.jsx";

import { make_partition_card, delete_partition } from "./partition.jsx";

const _ = cockpit.gettext;

function make_partition_pages(parent, block) {
    const block_ptable = client.blocks_ptable[block.path];
    let counter = 0;

    function make_free_space_page(parent, start, size, enable_dos_extended) {
        counter++;
        const card = new_card({
            page_name: _("Free space"),
            page_key: "free-space-" + counter,
            page_size: size,
            actions: [
                {
                    title: _("Create partition"),
                    action: () => format_dialog(client, block.path, start, size,
                                                enable_dos_extended),
                }
            ],
        });
        new_page(parent, card);
    }

    function make_extended_partition_page(parent, partition) {
        const card = new_card({
            page_name: _("Extended partition"),
            page_size: partition.size,
            actions: [
                { title: _("Delete"), action: () => delete_partition(partition.block, card), danger: true },
            ]
        });
        const page = new_page(parent, card);
        process_partitions(page, partition.partitions, false);
    }

    function process_partitions(parent, partitions, enable_dos_extended) {
        let i, p;
        for (i = 0; i < partitions.length; i++) {
            p = partitions[i];
            if (p.type == 'free')
                make_free_space_page(parent, p.start, p.size, enable_dos_extended);
            else if (p.type == 'container')
                make_extended_partition_page(parent, p);
            else {
                const card = make_partition_card(null, p.block);
                make_block_page(parent, p.block, card);
            }
        }
    }

    process_partitions(parent, get_partitions(client, block),
                       block_ptable.Type == 'dos');
}

export function make_partition_table_page(parent, block, next_card) {
    const block_ptable = client.blocks_ptable[block.path];

    const parts_card = new_card({
        title: (block_ptable.Type
            ? cockpit.format(_("$0 partitions"), block_ptable.Type.toLocaleUpperCase())
            : _("Partitions")),
        next: next_card,
        component: PartitionsCard,
        props: { },
    });

    const p = new_page(parent, parts_card, { sorted: false });
    make_partition_pages(p, block);
}

const PartitionsCard = ({ card }) => {
    return (
        <StorageCard card={card}>
            <CardBody className="contains-list">
                <ChildrenTable emptyCaption={_("No partitions found")}
                               aria-label={_("Partitions")}
                               page={card.page} />
            </CardBody>
        </StorageCard>
    );
};
