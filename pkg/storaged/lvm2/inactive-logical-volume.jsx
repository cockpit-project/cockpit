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
