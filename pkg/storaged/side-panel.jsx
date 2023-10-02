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

import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { ListingTable } from "cockpit-components-table.jsx";
import { get_block_link_parts, block_name } from "./utils.js";

const _ = cockpit.gettext;

export class SidePanel extends React.Component {
    render() {
        const rows = this.props.rows.filter(row => !!row);

        // Find new items for animations
        const children = rows.map(row => {
            if (row.block) {
                const client = row.client;
                const parts = get_block_link_parts(client, row.block.path);
                const backing = client.blocks[row.block.CryptoBackingDevice];
                row.name = cockpit.format(parts.format, parts.link);
                row.devname = block_name(backing || row.block);
                row.go = () => { cockpit.location.go([row.devname.replace(/^\/dev\//, "")]) };
            }

            const eat_event = (event) => {
                // Stop events from disabled actions. Otherwise they would
                // reach the <tr> element and cause spurious navigation.
                event.stopPropagation();
            };

            return {
                props: { },
                columns: [
                    row.name,
                    row.devname,
                    row.detail,
                    {
                        title: <div role="presentation"
                                  onClick={eat_event}
                                  onKeyDown={eat_event}>
                            {row.actions}
                        </div>
                    }
                ],
                go: row.go
            };
        });

        function onRowClick(event, row) {
            if (!event || event.button !== 0)
                return;

            // StorageBarMenu sets this to tell us not to navigate when
            // the kebabs are opened.
            if (event.defaultPrevented)
                return;

            if (row.go)
                row.go();
        }

        return (
            <Card>
                <CardHeader actions={{ actions: this.props.actions }}>
                    <CardTitle component="h2">{this.props.title}</CardTitle>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable emptyCaption={this.props.empty_text}
                                  onRowClick={onRowClick}
                                  columns={[_("ID"), _("Device"), _("Detail"), ""]}
                                  showHeader={false}
                                  rows={children} />
                </CardBody>
            </Card>
        );
    }
}
