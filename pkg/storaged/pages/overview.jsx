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

import { StoragePlots } from "../plot.jsx";
import { StorageMenuItem, StorageBarMenu } from "../storage-controls.jsx";
import { dialog_open } from "../dialog.jsx";
import { StorageLogsPanel } from "../logs-panel.jsx";

import { create_mdraid } from "../mdraids-panel.jsx"; // XXX
import { create_vgroup } from "../vgroups-panel.jsx"; // XXX
import { create_stratis_pool } from "../stratis-panel.jsx"; // XXX
import { iscsi_change_name, iscsi_discover } from "../iscsi-panel.jsx"; // XXX
import { get_other_devices } from "../utils.js"; // XXX

import { new_page, PageChildrenCard } from "../pages.jsx";
import { make_drive_page } from "./drive.jsx";
import { make_btrfs_volume_page } from "./btrfs.jsx";
import { make_lvm2_volume_group_page } from "./lvm2-volume-group.jsx";
import { make_mdraid_page } from "./mdraid.jsx";
import { make_stratis_pool_page } from "./stratis-pool.jsx";
import { make_stratis_stopped_pool_page } from "./stratis-stopped-pool.jsx";
import { make_nfs_page, nfs_fstab_dialog } from "./nfs.jsx";
import { make_iscsi_session_page } from "./iscsi-session.jsx";
import { make_other_page } from "./other.jsx";
import { make_legacy_vdo_page } from "./legacy-vdo.jsx";

const _ = cockpit.gettext;

export function make_overview_page() {
    const overview_page = new_page({
        location: [],
        name: _("Storage"),
        component: OverviewPage
    });

    Object.keys(client.iscsi_sessions).forEach(p => make_iscsi_session_page(overview_page, client.iscsi_sessions[p]));
    Object.keys(client.drives).forEach(p => {
        if (!client.drives_iscsi_session[p])
            make_drive_page(overview_page, client.drives[p]);
    });
    Object.keys(client.vgroups).forEach(p => make_lvm2_volume_group_page(overview_page, client.vgroups[p]));
    Object.keys(client.mdraids).forEach(p => make_mdraid_page(overview_page, client.mdraids[p]));
    Object.keys(client.stratis_pools).map(p => make_stratis_pool_page(overview_page, client.stratis_pools[p]));
    Object.keys(client.stratis_manager.StoppedPools).map(uuid => make_stratis_stopped_pool_page(overview_page, uuid));
    // TODO: this needs to poll? What does udisks do for us?
    const btrfs_uuids = new Set();
    Object.keys(client.blocks_fsys_btrfs).forEach(p => {
        const bfs = client.blocks_fsys_btrfs[p];
        btrfs_uuids.add(bfs.data.uuid);
    });
    for (const uuid of btrfs_uuids) {
        make_btrfs_volume_page(overview_page, uuid);
    }
    client.nfs.entries.forEach(e => make_nfs_page(overview_page, e));
    get_other_devices(client).map(p => make_other_page(overview_page, client.blocks[p]));
    client.legacy_vdo_overlay.volumes.forEach(vdo => make_legacy_vdo_page(overview_page, vdo));
}

const OverviewPage = ({ page, plot_state }) => {
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

    const menu_items = [
        menu_item(null, _("Create RAID device"), () => create_mdraid(client)),
        menu_item(lvm2_feature, _("Create LVM2 volume group"), () => create_vgroup(client)),
        menu_item(stratis_feature, _("Create Stratis pool"), () => create_stratis_pool(client)),
        menu_item(nfs_feature, _("New NFS mount"), () => nfs_fstab_dialog(client, null)),
        menu_item(iscsi_feature, _("Change iSCSI initiater name"), () => iscsi_change_name(client)),
        menu_item(iscsi_feature, _("Add iSCSI portal"), () => iscsi_discover(client)),
    ].filter(item => item !== null);

    const actions = <StorageBarMenu label={_("Create storage device")} menuItems={menu_items} />;

    return (
        <Stack hasGutter>
            <StackItem>
                <Card>
                    <CardBody>
                        <StoragePlots plot_state={plot_state} />
                    </CardBody>
                </Card>
            </StackItem>
            <StackItem>
                <PageChildrenCard title={_("Storage")} page={page} actions={actions} />
            </StackItem>
            <StackItem>
                <StorageLogsPanel />
            </StackItem>
        </Stack>);
};
