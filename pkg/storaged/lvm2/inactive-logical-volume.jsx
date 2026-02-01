/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

import {
    StorageCard, new_page, new_card
} from "../pages.jsx";

import { lvol_delete } from "./block-logical-volume.jsx";
import { lvm2_create_snapshot_action } from "./volume-group.jsx";

const _ = cockpit.gettext;

export function make_inactive_logical_volume_page(parent, vgroup, lvol, next_card) {
    const inactive_card = new_card({
        title: _("Inactive logical volume"),
        next: next_card,
        page_location: ["vg", vgroup.Name, lvol.Name],
        page_name: lvol.Name,
        page_size: lvol.Size,
        component: StorageCard,
        actions: [
            { title: _("Activate"), action: () => lvol.Activate({}) },
            lvm2_create_snapshot_action(lvol),
            { title: _("Delete"), action: () => lvol_delete(lvol, inactive_card), danger: true },
        ]
    });

    new_page(parent, inactive_card);
}
