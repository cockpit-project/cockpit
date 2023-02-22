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
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import * as utils from "./utils.js";
import { StdDetailsLayout } from "./details.jsx";
import { Block } from "./content-views.jsx";

const _ = cockpit.gettext;

export class DriveDetails extends React.Component {
    render() {
        const client = this.props.client;
        const drive = this.props.drive;
        const drive_ata = client.drives_ata[drive.path];
        const drive_block = drive && client.drives_block[drive.path];
        const multipath_blocks = drive && client.drives_multipath_blocks[drive.path];

        const DriveDetailsRow = ({ title, value }) => {
            if (!value)
                return null;
            return (
                <DescriptionListGroup>
                    <DescriptionListTerm>{title}</DescriptionListTerm>
                    <DescriptionListDescription>{value}</DescriptionListDescription>
                </DescriptionListGroup>
            );
        };

        let assessment = null;
        if (drive_ata) {
            assessment = (
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("storage", "Assessment")}</DescriptionListTerm>
                    <DescriptionListDescription>
                        <Flex spaceItems={{ default: 'spaceItemsXs' }}>
                            { drive_ata.SmartFailing
                                ? <span className="cockpit-disk-failing">{_("Disk is failing")}</span>
                                : <span>{_("Disk is OK")}</span>
                            }
                            { drive_ata.SmartTemperature > 0
                                ? <span>({utils.format_temperature(drive_ata.SmartTemperature)})</span>
                                : null
                            }
                        </Flex>
                    </DescriptionListDescription>
                </DescriptionListGroup>
            );
        }

        const header = (
            <Card>
                <CardTitle><Text component={TextVariants.h2}>{_("Drive")}</Text></CardTitle>
                <CardBody>
                    <DescriptionList className="pf-m-horizontal-on-sm">
                        <DriveDetailsRow title={_("storage", "Model")} value={drive.Model} />
                        <DriveDetailsRow title={_("storage", "Firmware version")} value={drive.Revision} />
                        <DriveDetailsRow title={_("storage", "Serial number")} value={drive.Serial} />
                        <DriveDetailsRow title={_("storage", "World wide name")} value={drive.WWN} />
                        <DriveDetailsRow title={_("storage", "Capacity")} value={drive.Size ? utils.fmt_size_long(drive.Size) : _("No media inserted")} />
                        { assessment }
                        <DriveDetailsRow title={_("storage", "Device file")} value={drive_block ? utils.block_name(drive_block) : "-"} />
                        {multipath_blocks.length > 0 && (
                            <DriveDetailsRow title={_("storage", "Multipathed devices")} value={multipath_blocks.map(utils.block_name).join(" ")} />
                        )}
                    </DescriptionList>
                </CardBody>
            </Card>
        );

        const content = <Block client={this.props.client} block={drive_block} />;

        return <StdDetailsLayout client={this.props.client} header={header} content={content} />;
    }
}
