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

import { dialog_open } from "./dialog.jsx";
import { TangKeyVerification } from "./crypto-keyslots.jsx";

const _ = cockpit.gettext;

export function std_reply(result, code, message) {
    if (code)
        return Promise.reject(message);
    else
        return Promise.resolve(result);
}

export function with_keydesc(client, pool, func) {
    if (!pool.KeyDescription ||
        !pool.KeyDescription[0] ||
        !pool.KeyDescription[1][0]) {
        return func(false);
    } else {
        const keydesc = pool.KeyDescription[1][1];
        return client.stratis_list_keys()
                .catch(() => []) // not-covered: internal error
                .then(keys => func(keydesc, keys.indexOf(keydesc) >= 0));
    }
}

export function with_stored_passphrase(client, keydesc, passphrase, func) {
    return client.stratis_store_passphrase(keydesc, passphrase)
            .then(func)
            .finally(() => {
                return client.stratis_manager.UnsetKey(keydesc)
                        .then(std_reply)
                        .catch(ex => { console.warn("Failed to remove passphrase from key ring", ex.toString()) }); // not-covered: internal error
            });
}

export function get_unused_keydesc(client, desc_prefix) {
    return client.stratis_list_keys()
            .catch(() => []) // not-covered: internal error
            .then(keys => {
                let desc;
                for (let i = 0; i < 1000; i++) {
                    desc = desc_prefix + (i > 0 ? "." + i.toFixed() : "");
                    if (keys.indexOf(desc) == -1)
                        break;
                }
                return desc;
            });
}

export function confirm_tang_trust(url, adv, action) {
    dialog_open({
        Title: _("Verify key"),
        Body: <TangKeyVerification url={url} adv={adv} />,
        Action: {
            Title: _("Trust key"),
            action
        }
    });
}
