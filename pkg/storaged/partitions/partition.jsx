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

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { StorageButton, StorageLink } from "../storage-controls.jsx";
import {
    dialog_open,
    SelectOne, TextInput,
    init_active_usage_processes, BlockingMessage, TeardownMessage
} from "../dialog.jsx";
import { block_name, fmt_size, get_active_usage, teardown_active_usage, reload_systemd } from "../utils.js";
import { check_unused_space, get_resize_info, free_space_after_part, grow_dialog, shrink_dialog } from "../block/resize.jsx";
import { StorageCard, StorageDescription, new_card, navigate_away_from_card } from "../pages.jsx";

const _ = cockpit.gettext;

export function delete_partition(block, card) {
    const block_part = client.blocks_part[block.path];
    const name = block_name(block);
    const usage = get_active_usage(client, block.path, _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Permanently delete $0?"), name),
        Teardown: TeardownMessage(usage),
        Action: {
            Danger: _("Deleting a partition will delete all data in it."),
            Title: _("Delete"),
            action: async function () {
                await teardown_active_usage(client, usage);
                await block_part.Delete({ 'tear-down': { t: 'b', v: true } });
                await reload_systemd();
                navigate_away_from_card(card);
            }
        },
        Inits: [
            init_active_usage_processes(client, usage)
        ]
    });
}

export function make_partition_card(next, block) {
    const block_part = client.blocks_part[block.path];
    const unused_space_warning = check_unused_space(block.path);
    const unused_space = !!unused_space_warning;
    let { info, shrink_excuse, grow_excuse } = get_resize_info(client, block, unused_space);

    if (!unused_space_warning && !grow_excuse && free_space_after_part(client, block_part) == 0) {
        grow_excuse = _("No free space after this partition");
    }

    const card = new_card({
        title: _("Partition"),
        next,
        page_block: block,
        for_summary: true,
        has_warning: !!unused_space_warning,
        component: PartitionCard,
        props: { block, unused_space_warning, resize_info: info },
        actions: [
            (!unused_space &&
             {
                 title: _("Shrink"),
                 action: () => shrink_dialog(client, block_part, info),
                 excuse: shrink_excuse,
             }),
            (!unused_space &&
             {
                 title: _("Grow"),
                 action: () => grow_dialog(client, block_part, info),
                 excuse: grow_excuse,
             }),
            {
                title: _("Delete"),
                action: () => delete_partition(block, card),
                danger: true,
            },
        ],
    });
    return card;
}

const gpt_type_names = {
    "21686148-6449-6e6f-744e-656564454649": _("BIOS boot partition"),
    "c12a7328-f81f-11d2-ba4b-00a0c93ec93b": _("EFI system partition"),
    "9e1a2d38-c612-4316-aa26-8b49521e5a8b": _("PowerPC PReP boot partition"),
    "0657fd6d-a4ab-43c4-84e5-0933c84b4f4f": _("Linux swap space"),
    "0fc63daf-8483-4772-8e79-3d69d8477de4": _("Linux filesystem data"),
    "e6d6d379-f507-44c2-a23c-238f2a3df928": _("Logical Volume Manager partition"),
};

const mbr_type_names = {
    ef: _("EFI system partition"),
    82: _("Linux swap space"),
    83: _("Linux filesystem data"),
    "8e": _("Logical Volume Manager partition"),
};

const PartitionCard = ({ card, block, unused_space_warning, resize_info }) => {
    const block_part = client.blocks_part[block.path];
    const unused_space = !!unused_space_warning;
    const block_ptable = client.blocks_ptable[block_part.Table];
    const type_names = block_ptable?.Type == "dos" ? mbr_type_names : gpt_type_names;
    const type = block_part.Type.replace(/^0x/, "").toLowerCase();

    function shrink_to_fit() {
        return shrink_dialog(client, block_part, resize_info, true);
    }

    function grow_to_fit() {
        return grow_dialog(client, block_part, resize_info, true);
    }

    function set_type_dialog() {
        const choices = Object.keys(type_names).map(k => ({ value: k, title: type_names[k] }));
        choices.push({ title: _("Custom"), value: "custom" });

        function validate_type(val) {
            if (block_ptable.Type == "dos") {
                const hex_rx = /^[a-fA-F0-9]{2}$/;
                if (!hex_rx.test(val))
                    return _("Type must contain exactly two hexadecimal characters (0 to 9, A to F).");
            } else {
                /* We let people use any 128 bit value as a UUID, even
                   those that are not defined by RFC 4122. This is
                   what the rest of the storage stack does as well,
                   and the "BIOS boot" UUID is in fact invalid
                   according to RFC 4122.

                   But we do insist that the dashes are in the right
                   place, because UDisks2 does as well.
                */
                const uuid_rx_1 = /^[a-fA-F0-9-]*$/;
                if (!uuid_rx_1.test(val))
                    return _("Type can only contain the characters 0 to 9, A to F, and \"-\".");
                const uuid_rx_2 = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
                if (!uuid_rx_2.test(val))
                    return _("Type must be of the form NNNNNNNN-NNNN-NNNN-NNNN-NNNNNNNNNNNN.");
            }
        }

        dialog_open({
            Title: cockpit.format(_("Set partition type of $0"), block_name(block)),
            Fields: [
                SelectOne("type", _("Type"),
                          {
                              value: (type_names[type] ? type : "custom"),
                              choices,
                          }),
                TextInput("custom", _("Custom type"),
                          {
                              value: type,
                              validate: validate_type,
                              visible: vals => vals.type == "custom",
                          }),
            ],
            Action: {
                Danger: !client.in_anaconda_mode() && _("Changing partition types might prevent the system from booting."),
                Title: _("Save"),
                action: async function (vals) {
                    let t = vals.type == "custom" ? vals.custom : vals.type;
                    if (block_ptable?.Type == "dos")
                        t = "0x" + t;
                    await block_part.SetType(t, { });
                }
            },
        });
    }

    return (
        <StorageCard card={card}
                     alert={unused_space &&
                     <Alert variant="warning" isInline
                                   title={_("This partition is not completely used by its content.")}>
                         {cockpit.format(_("Partition size is $0. Content size is $1."),
                                         fmt_size(unused_space_warning.volume_size),
                                         fmt_size(unused_space_warning.content_size))}
                         <div className='storage-alert-actions'>
                             <StorageButton onClick={shrink_to_fit}>
                                 {_("Shrink partition")}
                             </StorageButton>
                             <StorageButton onClick={grow_to_fit}>
                                 {_("Grow content")}
                             </StorageButton>
                         </div>
                     </Alert>}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")} value={block_part.Name || "-"} />
                    <StorageDescription title={_("UUID")} value={block_part.UUID} />
                    <StorageDescription title={_("Type")}
                                        value={type_names[type] || type}
                                        action={<StorageLink onClick={set_type_dialog}>
                                            {_("edit")}
                                        </StorageLink>} />
                    { !unused_space &&
                    <StorageDescription title={_("Size")} value={fmt_size(block_part.Size)} />
                    }
                </DescriptionList>
            </CardBody>
        </StorageCard>);
};
