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

import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Card, CardHeader, CardTitle, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ListingTable } from "cockpit-components-table.jsx";

import { StorageBarMenu } from "./storage-controls.jsx";

import { thing_menu_items, thing_rows } from "./things-panel.jsx";
import { drive_rows } from "./drives-panel.jsx";
import { nfs_rows } from "./nfs-panel.jsx";
import { iscsi_menu_items, iscsi_rows, portal_menu_items } from "./iscsi-panel.jsx";
import { other_rows } from "./others-panel.jsx";
import { block_content_rows, vgroup_content_rows, block_menu_items, vgroup_menu_items } from "./content-views.jsx";
import { stratis_content_rows, pool_menu_items } from "./stratis-details.jsx";
import { mdraid_menu_items } from "./mdraid-details.jsx";

import { StoragePlots } from "./plot.jsx";
import { JobsPanel } from "./jobs-panel.jsx";
import { StorageLogsPanel } from "./logs-panel.jsx";
import { fmt_size } from "./utils.js";

const _ = cockpit.gettext;

// XXX - this is terrible code, and is just meant to bring us to a
// point where we can play with the new UX without having to disturb
// the existing code too much.

export const OverviewX = ({ client, plot_state }) => {
    const menu_items = [].concat(
        thing_menu_items(client, { unified: true }),
        iscsi_menu_items(client, { unified: true }));

    const actions = <StorageBarMenu id="devices-menu"
                                    isKebab
                                    label={_("Create devices")}
                                    menuItems={menu_items} />;

    const d_rows = drive_rows(client, { unified: true });
    const i_rows = iscsi_rows(client, { unified: true });

    // Move iSCSI drives from d_rows to their place in i_rows. Ugh.
    for (let i = 0; i < i_rows.length; i++) {
        const session = i_rows[i].portal;
        for (let j = 0; j < d_rows.length; j++) {
            if (client.drives_iscsi_session[d_rows[j].block.Drive] == session) {
                d_rows[j].level = 1;
                i_rows.splice(i + 1, 0, d_rows[j]);
                d_rows.splice(j, 1);
                i += 1;
                j -= 1;
            }
        }
    }

    const top_rows = [].concat(
        d_rows,
        thing_rows(client, { unified: true }),
        i_rows,
        other_rows(client, { unified: true }));

    let rows = [];
    top_rows.forEach(t => {
        let m = [];
        if (t.block)
            m = m.concat(block_menu_items(client, t.block, { unified: true }));
        if (t.vgroup)
            m = m.concat(vgroup_menu_items(client, t.vgroup, { unified: true }));
        if (t.pool)
            m = m.concat(pool_menu_items(client, t.pool, { unified: true }));
        if (t.portal)
            m = m.concat(portal_menu_items(client, t.portal, { unified: true }));
        if (t.mdraid)
            m = m.concat(mdraid_menu_items(client, t.mdraid, { unified: true }));
        const actions = (m.length > 0
            ? <StorageBarMenu isKebab label={_("Create")} menuItems={m} />
            : null);
        const level = t.level || 0;
        rows.push({
            props: {
                key: t.path,
                className: "content-level-" + level,
            },
            columns: [
                { title: t.name }, // XXX - use "ID", name is taken.
                { title: t.type },
                { title: t.location || t.devname },
                { title: fmt_size(t.size), props: { className: "pf-v5-u-text-align-right" } },
                { title: actions, props: { className: "pf-v5-c-table__action content-action" } },
            ],
            go: t.go,
        });
        if (t.block)
            rows = rows.concat(block_content_rows(client, t.block, { unified: true, level: level + 1 }));
        if (t.vgroup)
            rows = rows.concat(vgroup_content_rows(client, t.vgroup, { unified: true, level: level + 1 }));
        if (t.pool)
            rows = rows.concat(stratis_content_rows(client, t.pool, { unified: true, level: level + 1 }));
    });

    rows = rows.concat(nfs_rows(client, { unified: true }));

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
        <Page id="main-storage">
            <PageSection>
                <Stack hasGutter>
                    <Card>
                        <CardBody>
                            <StoragePlots plot_state={plot_state} />
                        </CardBody>
                    </Card>
                    <Card>
                        <CardHeader actions={{ actions }}>
                            <CardTitle component="h2">{_("Storage")}</CardTitle>
                        </CardHeader>
                        <CardBody className="contains-list">
                            <ListingTable
                                id="unified"
                                variant="compact"
                                aria-label={_("Storage")}
                                onRowClick={onRowClick}
                                columns={[
                                    { title: _("ID") },
                                    { title: _("Type") },
                                    { title: _("Location") },
                                    { title: _("Size") },
                                ]}
                                rows={rows} />
                        </CardBody>
                    </Card>
                    <JobsPanel client={client} />
                    <StorageLogsPanel />
                </Stack>
            </PageSection>
        </Page>
    );
};
