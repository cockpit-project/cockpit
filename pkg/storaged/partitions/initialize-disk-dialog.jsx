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
import client from "../client";

import {
    dialog_open,
    SelectOneRadio,
    BlockingMessage, TeardownMessage,
    init_teardown_usage
} from "../dialog.jsx";
import { get_active_usage, block_name, teardown_active_usage, reload_systemd } from "../utils.js";
import { job_progress_wrapper } from "../jobs-panel.jsx";

const _ = cockpit.gettext;

export function initialize_disk_dialog(block) {
    const usage = get_active_usage(client, block.path, _("write partition table"), _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), block_name(block)),
            Body: BlockingMessage(usage),
        });
        return;
    }

    const offer_mbr = block.Size < 2 * 1024 * 1024 * 1024 * 1024; // 2 TiB

    dialog_open({
        Title: cockpit.format(_("Initialize $0 for partitions"), block_name(block)),
        Teardown: TeardownMessage(usage),
        Fields: [
            SelectOneRadio("type", _("Type"),
                           {
                               value: "gpt",
                               choices: [
                                   { value: "gpt", title: _("Modern (GPT)") },
                                   { value: "dos", title: _("Legacy (MBR)") },
                               ],
                               visible: () => offer_mbr,
                           }),
        ],
        Action: {
            Title: _("Initialize for partitions"),
            wrapper: job_progress_wrapper(client, block.path),
            disable_on_error: usage.Teardown,
            action: async function (vals) {
                const options = {
                    'tear-down': { t: 'b', v: true }
                };

                await teardown_active_usage(client, usage);
                await block.Format(offer_mbr ? vals.type : "gpt", options);
                await reload_systemd();
            }
        },
        Inits: [
            init_teardown_usage(client, usage)
        ]
    });
}
