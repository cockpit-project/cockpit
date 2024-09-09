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

import { get_existing_passphrase, unlock_with_type } from "./keyslots.jsx";
import { set_crypto_auto_option, get_active_usage, teardown_active_usage, block_name } from "../utils.js";
import { dialog_open, PassInput, init_teardown_usage, TeardownMessage, BlockingMessage } from "../dialog.jsx";

const _ = cockpit.gettext;

export function unlock(block) {
    const crypto = client.blocks_crypto[block.path];
    if (!crypto)
        return;

    function unlock_with_passphrase() {
        const crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        dialog_open({
            Title: _("Unlock"),
            Fields: [
                PassInput("passphrase", _("Passphrase"), {})
            ],
            Action: {
                Title: _("Unlock"),
                action: async function (vals) {
                    await unlock_with_type(client, block, vals.passphrase, null);
                    await set_crypto_auto_option(block, true);
                }
            }
        });
    }

    return get_existing_passphrase(block, true).then(type => {
        return (unlock_with_type(client, block, null, type)
                .then(() => set_crypto_auto_option(block, true))
                .catch(() => unlock_with_passphrase()));
    });
}

export function lock(block) {
    const crypto = client.blocks_crypto[block.path];
    if (!crypto)
        return;

    const name = block_name(block);
    const usage = get_active_usage(client, block.path, _("lock"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Lock $0?"), name),
        Teardown: TeardownMessage(usage),
        Action: {
            Title: _("Lock"),
            action: async function () {
                await teardown_active_usage(client, usage);
                await crypto.Lock({});
                await set_crypto_auto_option(block, false);
            }
        },
        Inits: [
            init_teardown_usage(client, usage)
        ]
    });
}

export function std_lock_action(backing_block, content_block) {
    if (backing_block == content_block)
        return null;

    return { title: _("Lock"), action: () => lock(backing_block) };
}
