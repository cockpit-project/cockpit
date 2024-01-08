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
import { useEvent } from "hooks";

import {
    block_name, fmt_size, validate_fsys_label
} from "../utils.js";
import {
    dialog_open, TextInput,
} from "../dialog.jsx";
import { StorageLink, StorageUsageBar, StorageSize } from "../storage-controls.jsx";
import { StorageCard, StorageDescription, new_card, useIsNarrow } from "../pages.jsx";

import { format_dialog } from "../block/format-dialog.jsx";
import { is_mounted, MountPoint, mount_point_text } from "./utils.jsx";
import { mounting_dialog } from "./mounting-dialog.jsx";
import { check_mismounted_fsys, MismountAlert } from "./mismounting.jsx";

const _ = cockpit.gettext;

/* This page is used in a variety of cases, which can be distinguished
 * by looking at the "backing_block" and "content_block" parameters:
 *
 * not-encrypted: backing_block == content_block,
 *                content_block != null
 *
 * encrypted and unlocked: backing_block != content_block,
 *                         backing_block != null,
 *                         content_block != null
 *
 * encrypted and locked: backing_block != null,
 *                       content_block == null
 *
 * "backing_block" is always non-null and always refers to the block
 * device that we want to talk about in the UI. "content_block" (when
 * non-null) is the block that we need to use for filesystem related
 * actions, such as mounting. It's the one with the
 * "o.fd.UDisks2.Filesystem" interface.
 *
 * When "content_block" is null, then "backing_block" is a locked LUKS
 * device, but we could figure out the fstab entry for the filesystem
 * that's on it.
 */

const MountPointUsageBar = ({ mount_point, block, short }) => {
    useEvent(client.fsys_sizes, "changed");
    const narrow = useIsNarrow();

    const stats = client.fsys_sizes.data[mount_point];
    if (stats)
        return <StorageUsageBar stats={stats} critical={0.95} block={block_name(block)} short={short} />;
    else if (short && !narrow)
        return <StorageSize size={block.Size} />;
    else
        return fmt_size(block.Size);
};

export function make_filesystem_card(next, backing_block, content_block, fstab_config) {
    const [, mount_point] = fstab_config;
    const mismount_warning = check_mismounted_fsys(backing_block, content_block, fstab_config);
    const mounted = content_block && is_mounted(client, content_block);

    const mp_text = mount_point_text(mount_point, mounted);
    if (mp_text == null)
        return null;

    return new_card({
        title: content_block ? cockpit.format(_("$0 filesystem"), content_block.IdType) : _("Filesystem"),
        location: mp_text,
        next,
        page_size: <MountPointUsageBar mount_point={mount_point} block={backing_block} short />,
        has_warning: !!mismount_warning,
        component: FilesystemCard,
        props: { backing_block, content_block, fstab_config, mismount_warning },
        actions: [
            content_block && mounted
                ? { title: _("Unmount"), action: () => mounting_dialog(client, content_block, "unmount") }
                : { title: _("Mount"), action: () => mounting_dialog(client, content_block || backing_block, "mount") },
            { title: _("Format"), action: () => format_dialog(client, backing_block.path), danger: true },
        ]
    });
}

export const FilesystemCard = ({
    card, backing_block, content_block, fstab_config, mismount_warning
}) => {
    function rename_dialog() {
        // assert(content_block)
        const block_fsys = client.blocks_fsys[content_block.path];

        dialog_open({
            Title: _("Filesystem name"),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              validate: name => validate_fsys_label(name, content_block.IdType),
                              value: content_block.IdLabel
                          })
            ],
            Action: {
                Title: _("Save"),
                action: function (vals) {
                    return block_fsys.SetLabel(vals.name, {});
                }
            }
        });
    }

    const [, mount_point] = fstab_config;
    const mounted = content_block && is_mounted(client, content_block);

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")}
                           value={content_block?.IdLabel || "-"}
                           action={<StorageLink onClick={rename_dialog}
                                                excuse={!content_block ? _("Filesystem is locked") : null}>
                               {_("edit")}
                           </StorageLink>} />
                    <StorageDescription title={_("Mount point")}>
                        <MountPoint fstab_config={fstab_config}
                                    backing_block={backing_block} content_block={content_block} />
                    </StorageDescription>
                    { mounted &&
                    <StorageDescription title={_("Usage")}>
                        <MountPointUsageBar mount_point={mount_point} block={backing_block} />
                    </StorageDescription>
                    }
                </DescriptionList>
            </CardBody>
            { mismount_warning &&
            <CardBody>
                <MismountAlert warning={mismount_warning}
                                 fstab_config={fstab_config}
                                 backing_block={backing_block} content_block={content_block} />
            </CardBody>
            }
        </StorageCard>);
};
