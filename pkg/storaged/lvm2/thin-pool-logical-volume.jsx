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

import { StorageCard, StorageDescription, ChildrenTable, new_page, new_card } from "../pages.jsx";
import { fmt_size, validate_lvm2_name } from "../utils.js";
import { dialog_open, TextInput, SizeSlider } from "../dialog.jsx";
import { StorageLink } from "../storage-controls.jsx";
import { grow_dialog } from "../block/resize.jsx";

import { next_default_logical_volume_name } from "./utils.jsx";
import { lvol_rename, lvol_delete } from "./block-logical-volume.jsx";
import { make_lvm2_logical_volume_page } from "./volume-group.jsx";

const _ = cockpit.gettext;

export function make_thin_pool_logical_volume_page(parent, vgroup, lvol) {
    function create_thin() {
        dialog_open({
            Title: _("Create thin volume"),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              value: next_default_logical_volume_name(client, vgroup, "lvol"),
                              validate: validate_lvm2_name
                          }),
                SizeSlider("size", _("Size"),
                           {
                               value: lvol.Size,
                               max: lvol.Size * 3,
                               allow_infinite: true,
                               round: vgroup.ExtentSize
                           })
            ],
            Action: {
                Title: _("Create"),
                action: function (vals) {
                    return vgroup.CreateThinVolume(vals.name, vals.size, lvol.path, { });
                }
            }
        });
    }

    const pool_card = make_lvm2_thin_pool_card(null, vgroup, lvol);

    const thin_vols_card = new_card({
        title: _("Thinly provisioned LVM2 logical volumes"),
        next: pool_card,
        page_location: ["vg", vgroup.Name, lvol.Name],
        page_name: lvol.Name,
        page_size: lvol.Size,
        component: LVM2ThinPoolLogicalVolumeCard,
        props: { vgroup, lvol },
        actions: [
            {
                title: _("Create new thinly provisioned logical volume"),
                action: create_thin,
                tag: "pool",
            },
        ]
    });

    const p = new_page(parent, thin_vols_card);

    client.lvols_pool_members[lvol.path].forEach(member_lvol => {
        make_lvm2_logical_volume_page(p, vgroup, member_lvol);
    });
}

function make_lvm2_thin_pool_card(next, vgroup, lvol) {
    let grow_excuse = null;
    if (vgroup.FreeSize == 0)
        grow_excuse = _("Not enough space");

    const card = new_card({
        title: _("Pool for thinly provisioned LVM2 logical volumes"),
        next,
        component: LVM2ThinPoolCard,
        props: { vgroup, lvol },
        actions: [
            {
                title: _("Grow"),
                action: () => grow_dialog(client, lvol, { }),
                excuse: grow_excuse,
            },
            {
                title: _("Delete"),
                action: () => lvol_delete(lvol, card),
                danger: true,
            },
        ],
    });
    return card;
}

function perc(ratio) {
    return (ratio * 100).toFixed(0) + "%";
}

export const LVM2ThinPoolLogicalVolumeCard = ({ card, vgroup, lvol }) => {
    return (
        <StorageCard card={card}>
            <CardBody className="contains-list">
                <ChildrenTable emptyCaption={_("No logical volumes")}
                               aria-label={_("Thinly provisioned LVM2 logical volumes")}
                               page={card.page} />
            </CardBody>
        </StorageCard>);
};

export const LVM2ThinPoolCard = ({ card, vgroup, lvol }) => {
    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")}
                           value={lvol.Name}
                           action={<StorageLink onClick={() => lvol_rename(lvol)}>
                               {_("edit")}
                           </StorageLink>} />
                    <StorageDescription title={_("Size")} value={fmt_size(lvol.Size)} />
                    <StorageDescription title={_("Data used")} value={perc(lvol.DataAllocatedRatio)} />
                    <StorageDescription title={_("Metadata used")} value={perc(lvol.MetadataAllocatedRatio)} />
                </DescriptionList>
            </CardBody>
        </StorageCard>);
};
