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

import { HDDIcon, SSDIcon, MediaDriveIcon } from "../icons/gnome-icons.jsx";
import { StorageCard, StorageDescription, new_card, new_page } from "../pages.jsx";
import { block_name, drive_name, fmt_size_long, should_ignore } from "../utils.js";
import { make_block_page } from "../block/create-pages.jsx";
import { partitionable_block_actions } from "../partitions/actions.jsx";
import { isSmartOK, SmartCard } from "./smart-details.jsx";

const _ = cockpit.gettext;

export function make_drive_page(parent, drive) {
    let block = client.drives_block[drive.path];

    if (!block) {
        // A drive without a primary block device might be
        // a unconfigured multipath device.  Try to hobble
        // along here by arbitrarily picking one of the
        // multipath devices.
        block = client.drives_multipath_blocks[drive.path][0];
    }

    if (!block)
        return;

    if (should_ignore(client, block.path))
        return;

    let cls;
    if (client.drives_iscsi_session[drive.path])
        cls = "iscsi";
    else if (drive.MediaRemovable || drive.Media)
        cls = "media";
    else
        cls = (drive.RotationRate === 0) ? "ssd" : "hdd";

    const drive_title = {
        media: _("Media drive"),
        ssd: _("Solid State Drive"),
        hdd: _("Hard Disk Drive"),
        iscsi: _("iSCSI Drive"),
    };

    const drive_icon = {
        media: MediaDriveIcon,
        ssd: SSDIcon,
        hdd: HDDIcon,
    };

    let card = new_card({
        title: drive_title[cls] || _("Drive"),
        next: null,
        page_block: block,
        page_icon: drive_icon[cls],
        for_summary: true,
        id_extra: drive_name(drive),
        job_path: drive.path,
        component: DriveCard,
        props: { drive },
        actions: block.Size > 0 ? partitionable_block_actions(block) : [],
    });

    let smart_info, drive_type;
    if (client.drives_ata[drive.path]) {
        smart_info = client.drives_ata[drive.path];
        drive_type = "ata";
    } else if (client.nvme_controller[drive.path]) {
        smart_info = client.nvme_controller[drive.path];
        drive_type = "nvme";
    }

    if (smart_info !== undefined && (cls === "hdd" || cls === "ssd")) {
        card = new_card({
            title: _("Device health (SMART)"),
            next: card,
            has_danger: !isSmartOK(drive_type, smart_info),
            has_warning: (smart_info.SmartNumBadSectors > 0 || smart_info.SmartNumAttributesFailing > 0),
            component: SmartCard,
            props: { smart_info, drive_type },
        });
    }

    if (block.Size > 0) {
        make_block_page(parent, block, card, { partitionable: true });
    } else {
        new_page(parent, card);
    }
}

const DriveCard = ({ card, page, drive }) => {
    const block = client.drives_block[drive.path];
    const multipath_blocks = client.drives_multipath_blocks[drive.path];

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Vendor")} value={drive.Vendor} />
                    <StorageDescription title={_("Model")} value={drive.Model} />
                    <StorageDescription title={_("Firmware version")} value={drive.Revision} />
                    <StorageDescription title={_("Serial number")} value={drive.Serial} />
                    <StorageDescription title={_("World wide name")} value={drive.WWN} />
                    <StorageDescription title={_("Capacity")}>
                        {drive.Size
                            ? fmt_size_long(drive.Size)
                            : _("No media inserted")
                        }
                    </StorageDescription>
                    <StorageDescription title={_("Device file")}
                           value={block ? block_name(block) : "-"} />
                    { multipath_blocks.length > 0 &&
                    <StorageDescription title={_("Multipathed devices")}
                             value={multipath_blocks.map(block_name).join(" ")} />
                    }
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
