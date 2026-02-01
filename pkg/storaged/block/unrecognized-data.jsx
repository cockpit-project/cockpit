/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
