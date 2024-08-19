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
import { StorageOnOff } from "../storage-controls.jsx";

import { grow_dialog } from "../block/resize.jsx";
import { StorageCard, StorageDescription, new_card } from "../pages.jsx";
import { fmt_size } from "../utils.js";

const _ = cockpit.gettext;

export function make_vdo_pool_card(next, vgroup, lvol) {
    const vdo_iface = client.vdo_vols[lvol.path];
    const vdo_pool_vol = client.lvols[vdo_iface.VDOPool];

    if (!vdo_pool_vol)
        return null;

    return new_card({
        title: _("LVM2 VDO pool"),
        next,
        component: LVM2VDOPoolCard,
        props: { vgroup, lvol, vdo_iface, vdo_pool_vol },
        actions: [
            {
                title: _("Grow"),
                action: () => grow_dialog(client, vdo_pool_vol, { }),
            }
        ],
    });
}

const LVM2VDOPoolCard = ({ card, vgroup, lvol, vdo_iface, vdo_pool_vol }) => {
    function toggle_compression() {
        const new_state = !vdo_iface.Compression;
        return vdo_iface.EnableCompression(new_state, {})
                .then(() => client.wait_for(() => vdo_iface.Compression === new_state));
    }

    function toggle_deduplication() {
        const new_state = !vdo_iface.Deduplication;
        return vdo_iface.EnableDeduplication(new_state, {})
                .then(() => client.wait_for(() => vdo_iface.Deduplication === new_state));
    }

    function perc(ratio) {
        return (ratio * 100).toFixed(0) + "%";
    }

    const used_pct = perc(vdo_iface.UsedSize / vdo_pool_vol.Size);

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")} value={vdo_pool_vol.Name} />
                    <StorageDescription title={_("Size")} value={fmt_size(vdo_pool_vol.Size)} />
                    <StorageDescription title={_("Data used")}>
                        {fmt_size(vdo_iface.UsedSize)} ({used_pct})
                    </StorageDescription>
                    <StorageDescription title={_("Metadata used")} value={perc(lvol.MetadataAllocatedRatio)} />
                    <StorageDescription title={_("Compression")}>
                        <StorageOnOff state={vdo_iface.Compression} aria-label={_("Use compression")}
                                      onChange={toggle_compression} />
                    </StorageDescription>
                    <StorageDescription title={_("Deduplication")}>
                        <StorageOnOff state={vdo_iface.Deduplication} aria-label={_("Use deduplication")}
                                      onChange={toggle_deduplication} />
                    </StorageDescription>
                </DescriptionList>
            </CardBody>
        </StorageCard>);
};
