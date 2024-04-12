/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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
import client from "../client.js";

import {
    block_name, get_active_usage, teardown_active_usage,
} from "../utils.js";

import {
    dialog_open,
    CheckBoxes,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "../dialog.jsx";

import { job_progress_wrapper } from "../jobs-panel.jsx";

const _ = cockpit.gettext;

export function erase_dialog(block) {
    const usage = get_active_usage(client, block.path, _("erase"), _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), block_name(block)),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Erase $0"), block_name(block)),
        Teardown: TeardownMessage(usage),
        Action: {
            Title: _("Erase"),
            Danger: _("This will erase all data on the storage device."),
            wrapper: job_progress_wrapper(client, block.path),
            disable_on_error: usage.Teardown,
            action: async function (vals) {
                const options = {
                    'tear-down': { t: 'b', v: true }
                };

                await teardown_active_usage(client, usage);
                await block.Format("empty", options);
            }
        },
        Inits: [
            init_active_usage_processes(client, usage),
        ]
    });
}
