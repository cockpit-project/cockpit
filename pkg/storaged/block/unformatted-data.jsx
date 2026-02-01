/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

import { StorageCard, new_card } from "../pages.jsx";
import { std_format_action } from "./actions.jsx";
import { std_lock_action } from "../crypto/actions.jsx";

const _ = cockpit.gettext;

export function make_unformatted_data_card(next, backing_block, content_block) {
    return new_card({
        title: _("Unformatted data"),
        next,
        component: StorageCard,
        actions: [
            std_lock_action(backing_block, content_block),
            std_format_action(backing_block, content_block),
        ]
    });
}
