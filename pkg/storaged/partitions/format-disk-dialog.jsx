/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import client from "../client";

import {
    dialog_open,
    SelectOne, CheckBoxes,
    BlockingMessage, TeardownMessage,
    init_teardown_usage
} from "../dialog.jsx";
import { get_active_usage, block_name, teardown_active_usage, reload_systemd } from "../utils.js";
import { job_progress_wrapper } from "../jobs-panel.jsx";

const _ = cockpit.gettext;

export function format_disk(block) {
    const usage = get_active_usage(client, block.path, _("initialize"), _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), block_name(block)),
            Body: BlockingMessage(usage),
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Initialize disk $0"), block_name(block)),
        Teardown: TeardownMessage(usage),
        Fields: [
            SelectOne("type", _("Partitioning"),
                      {
                          value: "gpt",
                          choices: [
                              { value: "dos", title: _("Compatible with all systems and devices (MBR)") },
                              {
                                  value: "gpt",
                                  title: _("Compatible with modern system and hard disks > 2TB (GPT)")
                              },
                              { value: "empty", title: _("No partitioning") }
                          ]
                      }),
            CheckBoxes("erase", _("Overwrite"),
                       {
                           fields: [
                               { tag: "on", title: _("Overwrite existing data with zeros (slower)") }
                           ],
                       }),
        ],
        Action: {
            Title: _("Initialize"),
            Danger: _("Initializing erases all data on a disk."),
            wrapper: job_progress_wrapper(client, block.path),
            disable_on_error: usage.Teardown,
            action: function (vals) {
                const options = {
                    'tear-down': { t: 'b', v: true }
                };
                if (vals.erase.on)
                    options.erase = { t: 's', v: "zero" };
                return teardown_active_usage(client, usage)
                        .then(function () {
                            return block.Format(vals.type, options);
                        })
                        .then(reload_systemd);
            }
        },
        Inits: [
            init_teardown_usage(client, usage)
        ]
    });
}
