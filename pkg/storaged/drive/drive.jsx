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
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { HDDIcon, SSDIcon, MediaDriveIcon } from "../icons/gnome-icons.jsx";
import { StorageCard, StorageDescription, new_card, new_page } from "../pages.jsx";
import { block_name, drive_name, format_temperature, fmt_size_long } from "../utils.js";
import { make_block_page } from "../block/create-pages.jsx";
import { partitionable_block_actions } from "../partitions/actions.jsx";

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

    const drive_card = new_card({
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

    if (block.Size > 0) {
        make_block_page(parent, block, drive_card);
    } else {
        new_page(parent, drive_card);
    }
}

const DriveCard = ({ card, page, drive }) => {
    const block = client.drives_block[drive.path];
    const drive_ata = client.drives_ata[drive.path];
    const multipath_blocks = client.drives_multipath_blocks[drive.path];

    let assessment = null;
    if (drive_ata) {
        assessment = (
            <StorageDescription title={_("Assessment")}>
                <Flex spaceItems={{ default: 'spaceItemsXs' }}>
                    { drive_ata.SmartFailing
                        ? <span className="cockpit-disk-failing">{_("Disk is failing")}</span>
                        : <span>{_("Disk is OK")}</span>
                    }
                    { drive_ata.SmartTemperature > 0
                        ? <span>({format_temperature(drive_ata.SmartTemperature)})</span>
                        : null
                    }
                </Flex>
            </StorageDescription>);
    }

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
                    { assessment }
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
