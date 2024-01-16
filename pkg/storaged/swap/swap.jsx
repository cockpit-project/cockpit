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

import { StorageCard, StorageDescription, new_card } from "../pages.jsx";
import { format_dialog } from "../block/format-dialog.jsx";
import {
    fmt_size, decode_filename, encode_filename,
    parse_options, unparse_options, extract_option,
} from "../utils.js";
import { std_lock_action } from "../crypto/actions.jsx";

const _ = cockpit.gettext;

async function set_swap_noauto(block, noauto) {
    for (const conf of block.Configuration) {
        if (conf[0] == "fstab") {
            const options = parse_options(decode_filename(conf[1].opts.v));
            extract_option(options, "defaults");
            extract_option(options, "noauto");
            if (noauto)
                options.push("noauto");
            if (options.length == 0)
                options.push("defaults");
            const new_conf = [
                "fstab",
                Object.assign({ }, conf[1],
                              {
                                  opts: {
                                      t: 'ay',
                                      v: encode_filename(unparse_options(options))
                                  }
                              })
            ];
            await block.UpdateConfigurationItem(conf, new_conf, { });
            return;
        }
    }

    await block.AddConfigurationItem(
        ["fstab", {
            dir: { t: 'ay', v: encode_filename("none") },
            type: { t: 'ay', v: encode_filename("swap") },
            opts: { t: 'ay', v: encode_filename(noauto ? "noauto" : "defaults") },
            freq: { t: 'i', v: 0 },
            passno: { t: 'i', v: 0 },
            "track-parents": { t: 'b', v: true }
        }], { });
}

export function make_swap_card(next, backing_block, content_block) {
    const block_swap = client.blocks_swap[content_block.path];

    async function start() {
        await block_swap.Start({});
        await set_swap_noauto(content_block, false);
    }

    async function stop() {
        await block_swap.Stop({});
        await set_swap_noauto(content_block, true);
    }

    return new_card({
        title: _("Swap"),
        next,
        component: SwapCard,
        props: { block: content_block, block_swap },
        actions: [
            std_lock_action(backing_block, content_block),
            (block_swap && block_swap.Active
                ? { title: _("Stop"), action: stop }
                : null),
            (block_swap && !block_swap.Active
                ? { title: _("Start"), action: start }
                : null),
            { title: _("Format"), action: () => format_dialog(client, backing_block.path), danger: true },
        ]
    });
}

export const SwapCard = ({ card, block, block_swap }) => {
    const is_active = block_swap && block_swap.Active;
    let used;

    useEvent(client.swap_sizes, "changed");

    if (is_active) {
        const samples = client.swap_sizes.data[decode_filename(block.Device)];
        if (samples)
            used = fmt_size(samples[0] - samples[1]);
        else
            used = _("Unknown");
    } else {
        used = "-";
    }

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Used")} value={used} />
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
