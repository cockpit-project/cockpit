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
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";

import {
    ParentPageLink, PageChildrenCard,
    new_page, ActionButtons, page_type,
} from "../pages.jsx";
import { fmt_size, validate_lvm2_name } from "../utils.js";
import {
    dialog_open, TextInput, SizeSlider,
} from "../dialog.jsx";
import { StorageLink, StorageSize } from "../storage-controls.jsx";
import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { grow_dialog } from "../resize.jsx";
import { next_default_logical_volume_name } from "../content-views.jsx"; // XXX
import { lvol_rename } from "../lvol-tabs.jsx"; // XXX
import { make_lvm2_logical_volume_page, lvm2_delete_logical_volume_dialog } from "./lvm2-volume-group.jsx";

const _ = cockpit.gettext;

export function make_lvm2_thin_pool_logical_volume_page(parent, vgroup, lvol) {
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

    let grow_excuse = null;
    if (vgroup.FreeSize == 0) {
        grow_excuse = (
            <div>
                {_("Not enough space to grow.")}
                <br />
                {_("Free up space in this group: Shrink or delete other logical volumes or add another physical volume.")}
            </div>
        );
    }

    const p = new_page({
        location: ["vg", vgroup.Name, lvol.Name],
        parent,
        name: lvol.Name,
        columns: [
            _("Pool for thinly provisioned logical volumes"),
            null,
            <StorageSize key="s" size={lvol.Size} />,
        ],
        component: LVM2ThinPoolLogicalVolumePage,
        props: { vgroup, lvol },
        actions: [
            {
                title: _("Create thinly provisioned logical volume"),
                action: create_thin,
                tag: "volumes",
            },
            {
                title: _("Grow"),
                action: () => grow_dialog(client, lvol, { }),
                excuse: grow_excuse,
                tag: "pool",
            },
            {
                title: _("Delete"),
                action: () => lvm2_delete_logical_volume_dialog(lvol, p),
                danger: true,
                tag: "pool",
            },
        ]
    });

    client.lvols_pool_members[lvol.path].forEach(member_lvol => {
        make_lvm2_logical_volume_page(p, vgroup, member_lvol);
    });
}

function perc(ratio) {
    return (ratio * 100).toFixed(0) + "%";
}

export const LVM2ThinPoolLogicalVolumePage = ({ page, vgroup, lvol }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} tag="pool" />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Stored on")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                            <SDesc title={_("Name")}
                                   value={lvol.Name}
                                   action={<StorageLink onClick={() => lvol_rename(lvol)}>
                                       {_("edit")}
                                   </StorageLink>} />
                            <SDesc title={_("Size")} value={fmt_size(lvol.Size)} />
                            <SDesc title={_("Data used")} value={perc(lvol.DataAllocatedRatio)} />
                            <SDesc title={_("Metadata used")} value={perc(lvol.MetadataAllocatedRatio)} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <StackItem>
                <PageChildrenCard title={_("Thinly provisioned logical volumes")}
                                  emptyCaption={_("No logical volumes")}
                                  actions={<ActionButtons page={page} tag="volumes" />}
                                  page={page} />
            </StackItem>
        </Stack>);
};
