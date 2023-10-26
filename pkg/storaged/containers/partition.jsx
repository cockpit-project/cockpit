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

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { dialog_open, init_active_usage_processes, BlockingMessage, TeardownMessage } from "../dialog.jsx";
import { StorageButton } from "../storage-controls.jsx";
import { block_name, fmt_size, get_active_usage, teardown_active_usage, reload_systemd } from "../utils.js";
import { check_unused_space, get_resize_info, free_space_after_part, grow_dialog, shrink_dialog } from "../resize.jsx";
import { new_container, navigate_away_from_page, ActionButtons } from "../pages.jsx";

const _ = cockpit.gettext;

export function delete_partition(block, page) {
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
                navigate_away_from_page(page);
            }
        },
        Inits: [
            init_active_usage_processes(client, usage)
        ]
    });
}

export function make_partition_container(parent, block) {
    const block_part = client.blocks_part[block.path];
    const unused_space_warning = check_unused_space(block.path);
    const unused_space = !!unused_space_warning;
    let { info, shrink_excuse, grow_excuse } = get_resize_info(client, block, unused_space);

    if (!unused_space_warning && !grow_excuse && free_space_after_part(client, block_part) == 0) {
        grow_excuse = _("No free space after this partition");
    }

    const cont = new_container({
        stored_on_format: _("Partition of $0"),
        has_warning: !!unused_space_warning,
        component: PartitionContainer,
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
                action: () => delete_partition(block, cont.page),
                danger: !client.blocks_available[block.path],
            },
        ],
    });
    return cont;
}

const PartitionContainer = ({ container, block, unused_space_warning, resize_info }) => {
    const block_part = client.blocks_part[block.path];
    const unused_space = !!unused_space_warning;

    function shrink_to_fit() {
        return shrink_dialog(client, block_part, resize_info, true);
    }

    function grow_to_fit() {
        return grow_dialog(client, block_part, resize_info, true);
    }

    return (
        <SCard title={_("Partition")} actions={<ActionButtons container={container} />}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <SDesc title={_("Name")} value={block_part.Name || "-"} />
                    { !unused_space &&
                    <SDesc title={_("Size")} value={fmt_size(block_part.Size)} />
                    }
                    <SDesc title={_("UUID")} value={block_part.UUID} />
                    <SDesc title={_("Type")} value={block_part.Type} />
                </DescriptionList>
                { unused_space &&
                <>
                    <br />
                    <Alert variant="warning"
                             isInline
                             title={_("This partition is not completely used by its content.")}>
                        {cockpit.format(_("Partition size is $0. Content size is $1."),
                                        fmt_size(unused_space_warning.volume_size),
                                        fmt_size(unused_space_warning.content_size))}
                        <div className='storage_alert_action_buttons'>
                            <StorageButton onClick={shrink_to_fit}>
                                {_("Shrink partition")}
                            </StorageButton>
                            <StorageButton onClick={grow_to_fit}>
                                {_("Grow content")}
                            </StorageButton>
                        </div>
                    </Alert>
                </>
                }
            </CardBody>
        </SCard>);
};
