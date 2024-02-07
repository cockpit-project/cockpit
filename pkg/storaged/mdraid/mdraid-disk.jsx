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
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { StorageCard, StorageDescription, new_card, register_crossref } from "../pages.jsx";
import { format_dialog } from "../block/format-dialog.jsx";
import { block_short_name, fmt_size, mdraid_name } from "../utils.js";
import { std_lock_action } from "../crypto/actions.jsx";

const _ = cockpit.gettext;

export function make_mdraid_disk_card(next, backing_block, content_block) {
    const mdraid = client.mdraids[content_block.MDRaidMember];
    const mdraid_block = mdraid && client.mdraids_block[mdraid.path];

    const disk_card = new_card({
        title: _("MDRAID disk"),
        next,
        location: mdraid_block ? block_short_name(mdraid_block) : (mdraid ? mdraid_name(mdraid) : null),
        component: MDRaidDiskCard,
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

        let remove_excuse = null;
        if (!mdraid_block)
            remove_excuse = _("The MDRAID device must be running");
        else if ((is_in_sync && n_recovering > 0) || is_recovering)
            remove_excuse = _("MDRAID device is recovering");
        else if (is_in_sync && n_spares < 1)
            remove_excuse = _("Need a spare disk");
        else if (members.length <= 1)
            remove_excuse = _("Last disk can not be removed");

        let remove_action = null;
        if (mdraid.Level != "raid0")
            remove_action = {
                title: _("Remove"),
                action: () => mdraid.RemoveDevice(content_block.path, { wipe: { t: 'b', v: true } }),
                excuse: remove_excuse
            };

        register_crossref({
            key: mdraid,
            card: disk_card,
            actions: [
                remove_action
            ],
            size: fmt_size(content_block.Size),
            extra: states,
        });
    }

    return disk_card;
}

export const MDRaidDiskCard = ({ card, backing_block, content_block, mdraid }) => {
    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("MDRAID device")}>
                        {mdraid
                            ? <Button variant="link" isInline role="link"
                                   onClick={() => cockpit.location.go(["mdraid", mdraid.UUID])}>
                                {mdraid_name(mdraid)}
                            </Button>
                            : "-"
                        }
                    </StorageDescription>
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
