/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

import { StorageCard, new_card } from "../pages.jsx";
import { std_format_action } from "../block/actions.jsx";
import { unlock } from "./actions.jsx";

const _ = cockpit.gettext;

export function make_locked_encrypted_data_card(next, block) {
    return new_card({
        title: _("Locked data"),
        next,
        page_block: block,
        component: StorageCard,
        props: { block },
        actions: [
            { title: _("Unlock"), action: () => unlock(block) },
            std_format_action(block, null),
        ]
    });
}
