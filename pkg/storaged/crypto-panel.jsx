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
import { SortByDirection } from '@patternfly/react-table';

import { ListingTable } from "cockpit-components-table.jsx";
import { block_name, get_block_link_parts, go_to_block } from "./utils.js";
import { OptionalPanel } from "./optional-panel.jsx";
import { get_fstab_config } from "./fsys-tab.jsx";

const _ = cockpit.gettext;

export class LockedCryptoPanel extends React.Component {
    render() {
        const client = this.props.client;

        function is_locked_crypto(path) {
            const block = client.blocks[path];
            const crypto = client.blocks_crypto[path];
            const cleartext = client.blocks_cleartext[path];
            if (crypto && !cleartext && !block.HintIgnore) {
                const [, mount_point] = get_fstab_config(block, true);
                return !mount_point;
            }
            return false;
        }

        function make_locked_crypto(path) {
            const block = client.blocks[path];

            const parts = get_block_link_parts(client, block.path);
            const name = cockpit.format(parts.format, parts.link);

            return {
                props: { path, client, key: path },
                columns: [
                    { title: name },
                    { title: block_name(block) },
                ]
            };
        }

        const locked_cryptos = Object.keys(client.blocks).filter(is_locked_crypto)
                .map(make_locked_crypto);

        if (locked_cryptos.length == 0)
            return null;

        function onRowClick(event, row) {
            if (!event || event.button !== 0)
                return;
            go_to_block(row.props.client, row.props.path);
        }

        return (
            <OptionalPanel id="locked-cryptos"
                title={_("Locked devices")}>
                <ListingTable
                    sortBy={{ index: 0, direction: SortByDirection.asc }}
                    aria-label={_("Locked devices")}
                    onRowClick={onRowClick}
                    columns={[
                        { title: _("Name"), sortable: true },
                        { title: _("Device"), sortable: true },
                    ]}
                    rows={locked_cryptos} />
            </OptionalPanel>
        );
    }
}
