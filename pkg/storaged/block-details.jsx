/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import * as utils from "./utils.js";
import { StdDetailsLayout } from "./details.jsx";
import * as Content from "./content-views.jsx";

const _ = cockpit.gettext;

export class BlockDetails extends React.Component {
    render() {
        const block = this.props.block;

        const header = (
            <Card>
                <CardTitle><Text component={TextVariants.h2}>{_("Block")}</Text></CardTitle>
                <CardBody>
                    <DescriptionList className="pf-m-horizontal-on-sm">
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "Capacity")}</DescriptionListTerm>
                            <DescriptionListDescription>{ utils.fmt_size_long(block.Size) }</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "Device file")}</DescriptionListTerm>
                            <DescriptionListDescription>{ utils.block_name(block) }</DescriptionListDescription>
                        </DescriptionListGroup>
                    </DescriptionList>
                </CardBody>
            </Card>
        );

        const content = <Content.Block client={this.props.client} block={block} />;

        return <StdDetailsLayout client={this.props.client} header={header} content={content} />;
    }
}
