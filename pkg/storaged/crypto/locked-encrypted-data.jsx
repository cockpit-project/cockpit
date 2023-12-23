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
import client from "../client";

import { StorageCard, new_card } from "../pages.jsx";
import { format_dialog } from "../block/format-dialog.jsx";
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
            { title: _("Format"), action: () => format_dialog(client, block.path), danger: true },
        ]
    });
}
