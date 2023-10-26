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
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { PageChildrenCard, ParentPageLink, ActionButtons, new_page, page_type, block_location } from "../pages.jsx";
import { block_name, drive_name, format_temperature, fmt_size, fmt_size_long } from "../utils.js";
import { format_disk, erase_disk } from "../content-views.jsx"; // XXX
import { format_dialog } from "../format-dialog.jsx";

import { make_block_pages } from "../create-pages.jsx";

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

    const is_formatted = !client.blocks_available[block.path];

    const drive_page = new_page({
        location: ["drive", block_location(block)],
        parent,
        name: drive_name(drive),
        columns: [
            _("Drive"),
            block_name(block),
            block.Size > 0 ? fmt_size(block.Size) : null
        ],
        actions: [
            (is_formatted  && block.Size > 0
             ? {
                 title: _("Erase"),
                 action: () => erase_disk(client, block),
                 danger: true,
                 excuse: block.ReadOnly ? _("Device is read-only") : null,
                 tag: "content",
             }
             : null),
            (!is_formatted && block.Size > 0
             ? {
                 title: _("Format as filesystem"),
                 action: () => format_dialog(client, block.path),
                 excuse: block.ReadOnly ? _("Device is read-only") : null,
                 tag: "content"
             }
             : null),
            (!is_formatted && block.Size > 0
             ? {
                 title: _("Create partition table"),
                 action: () => format_disk(client, block),
                 excuse: block.ReadOnly ? _("Device is read-only") : null,
                    tag: "content"
             }
             : null)
        ],
        component: DrivePage,
        props: { drive }
    });

    if (is_formatted && block.Size > 0)
        make_block_pages(drive_page, block, null);
}

const DrivePage = ({ page, drive }) => {
    const block = client.drives_block[drive.path];
    const drive_ata = client.drives_ata[drive.path];
    const multipath_blocks = client.drives_multipath_blocks[drive.path];
    const is_partitioned = block && !!client.blocks_ptable[block.path];

    let assessment = null;
    if (drive_ata) {
        assessment = (
            <SDesc title={_("Assessment")}>
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
            </SDesc>);
    }

    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            { client.drives_iscsi_session[drive.path]
                                ? <SDesc title={_("Part of")}>
                                    <ParentPageLink page={page} />
                                </SDesc>
                                : null }
                            <SDesc title={_("Model")} value={drive.Model} />
                            <SDesc title={_("Firmware version")} value={drive.Revision} />
                            <SDesc title={_("Serial number")} value={drive.Serial} />
                            <SDesc title={_("World wide name")} value={drive.WWN} />
                            <SDesc title={_("Capacity")}>
                                {drive.Size
                                    ? fmt_size_long(drive.Size)
                                    : _("No media inserted")
                                }
                            </SDesc>
                            { assessment }
                            <SDesc title={_("Device file")}
                                   value={block ? block_name(block) : "-"} />
                            { multipath_blocks.length > 0 &&
                            <SDesc title={_("Multipathed devices")}
                                     value={multipath_blocks.map(block_name).join(" ")} />
                            }
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            { block && block.Size > 0
                ? (<StackItem>
                    <PageChildrenCard title={is_partitioned ? _("Partitions") : _("Content")}
                                      actions={<ActionButtons page={page} tag="content" />}
                                      emptyCaption={_("Drive is not formatted")}
                                      page={page} />
                </StackItem>)
                : null
            }
        </Stack>
    );
};
