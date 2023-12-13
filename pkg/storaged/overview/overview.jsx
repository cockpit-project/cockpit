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
import client from "../client";

import { install_dialog } from "cockpit-components-install-dialog.jsx";

import { Card, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DropdownGroup, DropdownList } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';

import { StoragePlots } from "../plot.jsx";
import { StorageMenuItem, StorageBarMenu } from "../storage-controls.jsx";
import { dialog_open } from "../dialog.jsx";
import { StorageLogsPanel } from "../logs-panel.jsx";

import { create_mdraid } from "../mdraid/create-dialog.jsx";
import { create_vgroup } from "../lvm2/create-dialog.jsx";
import { create_stratis_pool } from "../stratis/create-dialog.jsx";
import { iscsi_change_name, iscsi_discover } from "../iscsi/create-dialog.jsx";
import { get_other_devices } from "../utils.js";

import { new_page, new_card, StorageCard, ChildrenTable } from "../pages.jsx";
import { make_drive_page } from "../drive/drive.jsx";
import { make_lvm2_volume_group_page } from "../lvm2/volume-group.jsx";
import { make_mdraid_page } from "../mdraid/mdraid.jsx";
import { make_stratis_pool_page } from "../stratis/pool.jsx";
import { make_stratis_stopped_pool_page } from "../stratis/stopped-pool.jsx";
import { make_nfs_page, nfs_fstab_dialog } from "../nfs/nfs.jsx";
import { make_iscsi_session_page } from "../iscsi/session.jsx";
import { make_other_page } from "../block/other.jsx";

const _ = cockpit.gettext;

export function make_overview_page() {
    const overview_card = new_card({
        title: _("Storage"),
        page_location: [],
        page_name: _("Storage"),
        component: OverviewCard
    });

    const overview_page = new_page(null, overview_card);

    Object.keys(client.iscsi_sessions).forEach(p => make_iscsi_session_page(overview_page, client.iscsi_sessions[p]));
    Object.keys(client.drives).forEach(p => {
        if (!client.drives_iscsi_session[p])
            make_drive_page(overview_page, client.drives[p]);
    });
    Object.keys(client.vgroups).forEach(p => make_lvm2_volume_group_page(overview_page, client.vgroups[p]));
    Object.keys(client.mdraids).forEach(p => make_mdraid_page(overview_page, client.mdraids[p]));
    Object.keys(client.stratis_pools).map(p => make_stratis_pool_page(overview_page, client.stratis_pools[p]));
    Object.keys(client.stratis_manager.StoppedPools).map(uuid => make_stratis_stopped_pool_page(overview_page, uuid));
    client.nfs.entries.forEach(e => make_nfs_page(overview_page, e));
    get_other_devices(client).map(p => make_other_page(overview_page, client.blocks[p]));
}

const OverviewCard = ({ card, plot_state }) => {
    function menu_item(feature, title, action) {
        const feature_enabled = !feature || feature.is_enabled();
        const required_package = feature && feature.package;

        if (!feature_enabled && !(required_package && client.features.packagekit))
            return null;

        function install_then_action() {
            if (!feature_enabled) {
                install_dialog(required_package, feature.dialog_options).then(
                    () => {
                        feature.enable()
                                .then(action)
                                .catch(error => {
                                    dialog_open({
                                        Title: _("Error"),
                                        Body: error.toString()
                                    });
                                });
                    },
                    () => null /* ignore cancel */);
            } else {
                action();
            }
        }

        return <StorageMenuItem key={title} onClick={install_then_action}>{title}</StorageMenuItem>;
    }

    const lvm2_feature = {
        is_enabled: () => client.features.lvm2
    };

    const stratis_feature = {
        is_enabled: () => client.features.stratis,
        package: client.get_config("stratis_package", false),
        enable: () => {
            return cockpit.spawn(["systemctl", "start", "stratisd"], { superuser: true })
                    .then(() => client.stratis_start());
        },

        dialog_options: {
            title: _("Install Stratis support"),
            text: _("The $0 package must be installed to create Stratis pools.")
        }
    };

    const nfs_feature = {
        is_enabled: () => client.features.nfs,
        package: client.get_config("nfs_client_package", false),
        enable: () => {
            client.features.nfs = true;
            client.nfs.start();
            return Promise.resolve();
        },

        dialog_options: {
            title: _("Install NFS support")
        }
    };

    const iscsi_feature = {
        is_enabled: () => client.features.iscsi,
    };

    const local_menu_items = [
        menu_item(null, _("Create MDRAID device"), () => create_mdraid()),
        menu_item(lvm2_feature, _("Create LVM2 volume group"), () => create_vgroup()),
        menu_item(stratis_feature, _("Create Stratis pool"), () => create_stratis_pool()),
    ].filter(item => !!item);

    const net_menu_items = [
        !client.in_anaconda_mode() && menu_item(nfs_feature, _("New NFS mount"), () => nfs_fstab_dialog(null, null)),
        menu_item(iscsi_feature, _("Change iSCSI initiater name"), () => iscsi_change_name()),
        menu_item(iscsi_feature, _("Add iSCSI portal"), () => iscsi_discover()),
    ].filter(item => !!item);

    const groups = [];

    if (local_menu_items.length > 0)
        groups.push(
            <DropdownGroup key="local" label={_("Local storage")}>
                <DropdownList>
                    {local_menu_items}
                </DropdownList>
            </DropdownGroup>);

    if (net_menu_items.length > 0)
        groups.push(
            <DropdownGroup key="net" label={_("Networked storage")}>
                <DropdownList>
                    {net_menu_items}
                </DropdownList>
            </DropdownGroup>);

    const actions = <StorageBarMenu label={_("Create storage device")} menuItems={groups} />;

    return (
        <Stack hasGutter>
            { !client.in_anaconda_mode() &&
            <StackItem>
                <Card>
                    <CardBody>
                        <StoragePlots plot_state={plot_state} />
                    </CardBody>
                </Card>
            </StackItem>
            }
            <StackItem>
                <StorageCard card={card} actions={actions}>
                    <CardBody className="contains-list">
                        <ChildrenTable emptyCaption={_("No storage found")}
                                       aria-label={_("Storage")}
                                       show_icons
                                       page={card.page} />
                    </CardBody>
                </StorageCard>
            </StackItem>
            { !client.in_anaconda_mode() &&
            <StackItem>
                <StorageLogsPanel />
            </StackItem>
            }
        </Stack>);
};
