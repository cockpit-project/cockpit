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

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { StorageCard, StorageDescription, new_card, new_page } from "../pages.jsx";
import { StorageUsageBar } from "../storage-controls.jsx";
import { get_fstab_config_with_client } from "../utils.js";
import { btrfs_usage } from "./utils.jsx";
import { mounting_dialog } from "../filesystem/mounting-dialog.jsx";
import { check_mismounted_fsys, MismountAlert } from "../filesystem/mismounting.jsx";
import { is_mounted, mount_point_text, MountPoint } from "../filesystem/utils.jsx";
import client from "../client.js";

const _ = cockpit.gettext;

function subvolume_unmount(volume, subvol, forced_options) {
    const block = client.blocks[volume.path];
    mounting_dialog(client, block, "unmount", forced_options, subvol);
}

function subvolume_mount(volume, subvol, forced_options) {
    const block = client.blocks[volume.path];
    mounting_dialog(client, block, "mount", forced_options, subvol);
}

export function make_btrfs_subvolume_page(parent, volume, subvol) {
    const actions = [];

    const use = btrfs_usage(client, volume);
    const block = client.blocks[volume.path];
    const fstab_config = get_fstab_config_with_client(client, block, false, subvol);
    const [, mount_point] = fstab_config;
    const mismount_warning = check_mismounted_fsys(block, block, fstab_config, subvol);
    const mounted = is_mounted(client, block, subvol);
    const mp_text = mount_point_text(mount_point, mounted);
    if (mp_text == null)
        return null;
    const forced_options = [`subvol=${subvol.pathname}`];

    if (mounted) {
        actions.push({
            title: _("Unmount"),
            action: () => subvolume_unmount(volume, subvol, forced_options),
        });
    } else {
        actions.push({
            title: _("Mount"),
            action: () => subvolume_mount(volume, subvol, forced_options),
        });
    }

    const card = new_card({
        title: _("btrfs subvolume"),
        next: null,
        page_location: ["btrfs", volume.data.uuid, subvol.pathname],
        page_name: subvol.pathname,
        page_size: is_mounted && <StorageUsageBar stats={use} short />,
        location: mp_text,
        component: BtrfsSubvolumeCard,
        has_warning: !!mismount_warning,
        props: { subvol, mount_point, mismount_warning, block, fstab_config, forced_options },
        actions,
    });
    new_page(parent, card);
}

const BtrfsSubvolumeCard = ({ card, subvol, mismount_warning, block, fstab_config, forced_options }) => {
    return (
        <StorageCard card={card} alert={mismount_warning &&
        <MismountAlert warning={mismount_warning}
                                    fstab_config={fstab_config}
                                    backing_block={block} content_block={block} subvol={subvol} />}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")} value={subvol.pathname} />
                    <StorageDescription title={_("ID")} value={subvol.id} />
                    <StorageDescription title={_("Mount point")}>
                        <MountPoint fstab_config={fstab_config}
                                    backing_block={block} content_block={block}
                                    forced_options={forced_options} subvol={subvol} />
                    </StorageDescription>
                </DescriptionList>
            </CardBody>
        </StorageCard>);
};
