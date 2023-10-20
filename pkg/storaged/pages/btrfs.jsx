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
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { PageChildrenCard, PageCrossrefCard, ActionButtons, new_page, page_type, get_crossrefs } from "../pages.jsx";
import { fmt_size, fmt_size_long } from "../utils.js";

const _ = cockpit.gettext;

function btrfs_usage(uuid) {
    const block_devices = client.uuids_btrfs_blocks[uuid];
    console.log(block_devices);

    let size = 0;
    for (const block_device of block_devices) {
        size += client.blocks[block_device.path].Size;
    }
    const used = client.blocks_fsys_btrfs[block_devices[0].path].data.used;

    // const block_fsys = client.blocks_fsys[volume.path];
    // const mount_point = block_fsys && block_fsys.MountPoints[0];
    // let use = mount_point && client.fsys_sizes.data[decode_filename(mount_point)];
    // if (!use) {
    //     const blocks = [];
    //     Object.keys(client.blocks_fsys_btrfs).forEach(obj_path => {
    //         const blk = client.blocks_fsys_btrfs[obj_path];
    //         if (blk.data.uuid === volume.data.uuid) {
    //             blocks.push(client.blocks[obj_path]);
    //         }
    //     });
    //     use = [volume.data.used, blocks.reduce((sum, b) => sum + b.Size, 0)];
    // }
    // console.log(use);
    return [used, size];
}

/*
 * Udisks is a disk/block library so it manages that, btrfs turns this a bit
 * around and has one "volume" which can have multiple blocks by a unique uuid.
 */
export function make_btrfs_volume_page(parent, uuid) {
    const block_devices = client.uuids_btrfs_blocks[uuid];

    const device = client.blocks_fsys_btrfs[block_devices[0].path];
    // TODO: label is optional, but do we want to show uuid then?
    const name = device.data.label || uuid;
    const total_capacity = btrfs_usage(uuid)[1];
    const btrfs_volume_page = new_page({
        location: ["btrfs-volume", name],
        parent,
        name,
        columns: [
            _("Btrfs volume"),
            "",
            fmt_size(total_capacity),
        ],
        component: BtrfsVolumePage,
        props: { block_devices, name: device.data.label, uuid: device.data.uuid, total_capacity },
        actions: [],
    });

    for (const blk of block_devices) {
        const device = client.blocks_fsys_btrfs[blk.path];
        device.GetSubvolumes(false, {}).then(subvolumes => {
            for (const subvolume of subvolumes) {
                make_btrfs_volume_subvolume(btrfs_volume_page, uuid, subvolume);
            }
        });
    }
}

function make_btrfs_volume_subvolume(parent, uuid, subvol) {
    const [id, parent_id, path] = subvol;
    new_page({
        location: ["btrfs-volume", uuid, id],
        parent,
        name: path,
        columns: [
            _("Btrfs subvolume"),
            id,
            parent_id,
        ],
        component: BtrfsVolumePage,
        props: { uuid, id, parent_id, path },
        actions: [],
    });
}

const BtrfsVolumePage = ({ page, block_devices, name, uuid, total_capacity, subvolumes }) => {
    let crossrefs = [];
    for (const blk of block_devices) {
        crossrefs = crossrefs.concat(get_crossrefs(blk));
    }
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Label")} value={name} />
                            <SDesc title={_("UUID")} value={uuid} />
                            <SDesc title={_("Capacity")} value={fmt_size_long(total_capacity)} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <StackItem>
                <PageCrossrefCard title={_("Devices")}
                                  crossrefs={crossrefs} />
            </StackItem>
            <StackItem>
                <PageChildrenCard title={_("Subvolumes")}
                                  emptyCaption={_("No subvolumes")}
                                  page={page} />
            </StackItem>
        </Stack>
    );
};
