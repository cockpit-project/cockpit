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
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { StorageCard, StorageDescription, new_card } from "../pages.jsx";
import { std_format_action } from "./actions.jsx";
import { std_lock_action } from "../crypto/actions.jsx";

const _ = cockpit.gettext;

export function make_unrecognized_data_card(next, backing_block, content_block) {
    return new_card({
        title: _("Unrecognized data"),
        next,
        component: UnrecognizedDataCard,
        props: { backing_block, content_block },
        actions: [
            std_lock_action(backing_block, content_block),
            std_format_action(backing_block, content_block),
        ]
    });
}

export const UnrecognizedDataCard = ({ card, backing_block, content_block }) => {
    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Usage")} value={content_block.IdUsage || "-"} />
                    <StorageDescription title={_("Type")} value={content_block.IdType || "-"} />
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
