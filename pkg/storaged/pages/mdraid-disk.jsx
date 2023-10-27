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

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import {
    ParentPageLink, PageContainerStackItems,
    new_page, block_location, ActionButtons, page_type,
    register_crossref,
} from "../pages.jsx";
import { format_dialog } from "../format-dialog.jsx";
import { block_name, mdraid_name, fmt_size } from "../utils.js";
import { std_lock_action } from "../actions.jsx";

const _ = cockpit.gettext;

export function make_mdraid_disk_page(parent, backing_block, content_block, container) {
    const mdraid = client.mdraids[content_block.MDRaidMember];

    const p = new_page({
        location: [block_location(backing_block)],
        parent,
        container,
        name: block_name(backing_block),
        columns: [
            _("RAID disk"),
            mdraid ? mdraid_name(mdraid) : null,
            fmt_size(backing_block.Size)
        ],
        component: MDRaidDiskPage,
        props: { backing_block, content_block, mdraid },
        actions: [
            std_lock_action(backing_block, content_block),
            { title: _("Format"), action: () => format_dialog(client, backing_block.path), danger: true },
        ]
    });

    if (mdraid) {
        const members = client.mdraids_members[mdraid.path] || [];
        let n_spares = 0;
        let n_recovering = 0;
        mdraid.ActiveDevices.forEach(function(as) {
            if (as[2].indexOf("spare") >= 0) {
                if (as[1] < 0)
                    n_spares += 1;
                else
                    n_recovering += 1;
            }
        });

        /* Older versions of Udisks/storaged don't have a Running property */
        let running = mdraid.Running;
        if (running === undefined)
            running = mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0;

        const active_state = mdraid.ActiveDevices.find(as => as[0] == content_block.path);

        const state_text = (state) => {
            return {
                faulty: _("Failed"),
                in_sync: _("In sync"),
                spare: active_state[1] < 0 ? _("Spare") : _("Recovering"),
                write_mostly: _("Write-mostly"),
                blocked: _("Blocked")
            }[state] || cockpit.format(_("Unknown ($0)"), state);
        };

        const slot = active_state && active_state[1] >= 0 && active_state[1].toString();
        let states = active_state && active_state[2].map(state_text).join(", ");

        if (slot)
            states = cockpit.format(_("Slot $0"), slot) + ", " + states;

        const is_in_sync = (active_state && active_state[2].indexOf("in_sync") >= 0);
        const is_recovering = (active_state && active_state[2].indexOf("spare") >= 0 && active_state[1] >= 0);

        let remove_excuse = false;
        if (!running)
            remove_excuse = _("The RAID device must be running in order to remove disks.");
        else if ((is_in_sync && n_recovering > 0) || is_recovering)
            remove_excuse = _("This disk cannot be removed while the device is recovering.");
        else if (is_in_sync && n_spares < 1)
            remove_excuse = _("A spare disk needs to be added first before this disk can be removed.");
        else if (members.length <= 1)
            remove_excuse = _("The last disk of a RAID device cannot be removed.");

        let remove_action = null;
        if (mdraid.Level != "raid0")
            remove_action = {
                title: _("Remove"),
                action: () => mdraid.RemoveDevice(content_block.path, { wipe: { t: 'b', v: true } }),
                excuse: remove_excuse
            };

        register_crossref({
            key: mdraid,
            page: p,
            actions: [
                remove_action
            ],
            size: states,
        });
    }
}

export const MDRaidDiskPage = ({ page, backing_block, content_block, mdraid }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Stored on")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                            <SDesc title={_("RAID device")}>
                                {mdraid
                                    ? <Button variant="link" isInline role="link"
                                           onClick={() => cockpit.location.go(["mdraid", mdraid.UUID])}>
                                        {mdraid_name(mdraid)}
                                    </Button>
                                    : "-"
                                }
                            </SDesc>
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>);
};
