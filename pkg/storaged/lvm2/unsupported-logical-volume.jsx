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

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";

import {
    StorageCard, new_page, new_card
} from "../pages.jsx";

import { lvol_delete } from "./block-logical-volume.jsx";

const _ = cockpit.gettext;

export function make_unsupported_logical_volume_page(parent, vgroup, lvol, next_card) {
    const unsupported_card = new_card({
        title: _("Unsupported logical volume"),
        next: next_card,
        page_location: ["vg", vgroup.Name, lvol.Name],
        page_name: lvol.Name,
        page_size: lvol.Size,
        component: LVM2UnsupportedLogicalVolumeCard,
        props: { vgroup, lvol },
        actions: [
            { title: _("Deactivate"), action: () => lvol.Deactivate({}) },
            { title: _("Delete"), action: () => lvol_delete(lvol, unsupported_card), danger: true },
        ]
    });

    // FIXME: it would be nice to log unsupported volumes with
    // "console.error" so that our tests will detect them more
    // readily. Unfortunately, when a logical volume gets activated,
    // its block device will only appear on D-Bus a little while
    // later, and the logical volume is thus considered unsupported
    // for the little while.
    //
    // This also leads to potential flicker in the UI, so it would be
    // nice to remove this intermediate state also for that reason.

    new_page(parent, unsupported_card);
}

const LVM2UnsupportedLogicalVolumeCard = ({ card, vgroup, lvol }) => {
    return (
        <StorageCard card={card}>
            <CardBody>
                <p>{_("INTERNAL ERROR - This logical volume is marked as active and should have an associated block device. However, no such block device could be found.")}</p>
            </CardBody>
        </StorageCard>);
};
