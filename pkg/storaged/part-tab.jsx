/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

import React from "react";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import cockpit from "cockpit";
import * as utils from "./utils.js";

const _ = cockpit.gettext;

export class PartitionTab extends React.Component {
    render() {
        const block_part = this.props.client.blocks_part[this.props.block.path];

        return (
            <DescriptionList className="pf-m-horizontal-on-sm">
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Name")}</DescriptionListTerm>
                    <DescriptionListDescription>{block_part.Name || "-"}</DescriptionListDescription>
                </DescriptionListGroup>

                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Size")}</DescriptionListTerm>
                    <DescriptionListDescription>{utils.fmt_size(block_part.Size)}</DescriptionListDescription>
                </DescriptionListGroup>

                <DescriptionListGroup>
                    <DescriptionListTerm>{_("UUID")}</DescriptionListTerm>
                    <DescriptionListDescription>{block_part.UUID}</DescriptionListDescription>
                </DescriptionListGroup>

                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Type")}</DescriptionListTerm>
                    <DescriptionListDescription>{block_part.Type}</DescriptionListDescription>
                </DescriptionListGroup>
            </DescriptionList>
        );
    }
}
