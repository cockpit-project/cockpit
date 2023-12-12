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

import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";

import { StorageCard, StorageDescription, new_card } from "../pages.jsx";
import { block_name } from "../utils.js";
import { partitionable_block_actions } from "../partitions/actions.jsx";
import { OtherIcon } from "../icons/gnome-icons.jsx";

import { make_block_page } from "../block/create-pages.jsx";

const _ = cockpit.gettext;

export function make_other_page(parent, block) {
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

    make_block_page(parent, block, other_card);
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
