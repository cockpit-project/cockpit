/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from "react";
import client from "../client";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { StorageCard, StorageDescription, new_card, register_crossref } from "../pages.jsx";
import { std_format_action } from "../block/actions.jsx";
import { std_lock_action } from "../crypto/actions.jsx";
import { StorageUsageBar } from "../storage-controls.jsx";

const _ = cockpit.gettext;

export function make_lvm2_physical_volume_card(next, backing_block, content_block) {
    const block_pvol = client.blocks_pvol[content_block.path];
    const vgroup = block_pvol && client.vgroups[block_pvol.VolumeGroup];

    const pv_card = new_card({
        title: _("LVM2 physical volume"),
        location: {
            label: vgroup ? vgroup.Name : null,
            to: vgroup ? ["vg", vgroup.Name] : null,
        },
        next,
        page_size: (block_pvol
            ? <StorageUsageBar stats={[block_pvol.Size - block_pvol.FreeSize, block_pvol.Size]} short />
            : backing_block.Size),
        component: LVM2PhysicalVolumeCard,
        props: { backing_block, content_block },
        actions: [
            std_lock_action(backing_block, content_block),
            std_format_action(backing_block, content_block),
        ]
    });

    function pvol_remove() {
        return vgroup.RemoveDevice(block_pvol.path, true, {});
    }

    function pvol_empty_and_remove() {
        return (vgroup.EmptyDevice(block_pvol.path, {})
                .then(function() {
                    vgroup.RemoveDevice(block_pvol.path, true, {});
                }));
    }

    if (vgroup) {
        const pvols = client.vgroups_pvols[vgroup.path] || [];
        let remove_action = null;
        let remove_excuse = null;

        if (vgroup.MissingPhysicalVolumes && vgroup.MissingPhysicalVolumes.length > 0) {
            remove_excuse = _("Volume group is missing physical volumes");
        } else if (pvols.length === 1) {
            remove_excuse = _("Last cannot be removed");
        } else if (block_pvol.FreeSize < block_pvol.Size) {
            if (block_pvol.Size <= vgroup.FreeSize)
                remove_action = pvol_empty_and_remove;
            else
                remove_excuse = _("Not enough free space");
        } else {
            remove_action = pvol_remove;
        }

        register_crossref({
            key: vgroup,
            card: pv_card,
            actions: [
                {
                    title: _("Remove"),
                    action: remove_action,
                    excuse: remove_excuse,
                },
            ],
            size: <StorageUsageBar stats={[block_pvol.Size - block_pvol.FreeSize, block_pvol.Size]} short />,
        });
    }

    return pv_card;
}

export const LVM2PhysicalVolumeCard = ({ card, backing_block, content_block }) => {
    const block_pvol = client.blocks_pvol[content_block.path];
    const vgroup = block_pvol && client.vgroups[block_pvol.VolumeGroup];

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Volume group")}>
                        {vgroup
                            ? <Button variant="link" isInline role="link"
                                   onClick={() => cockpit.location.go(["vg", vgroup.Name])}>
                                {vgroup.Name}
                            </Button>
                            : "-"
                        }
                    </StorageDescription>
                    <StorageDescription title={_("UUID")} value={content_block.IdUUID} />
                    { block_pvol &&
                    <StorageDescription title={_("Usage")}>
                        <StorageUsageBar key="s"
                                           stats={[block_pvol.Size - block_pvol.FreeSize,
                                               block_pvol.Size]} />
                    </StorageDescription>
                    }
                </DescriptionList>
            </CardBody>
        </StorageCard>);
};
