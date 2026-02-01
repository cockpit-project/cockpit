/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
