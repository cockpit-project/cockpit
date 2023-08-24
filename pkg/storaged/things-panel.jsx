/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import { install_dialog } from "cockpit-components-install-dialog.jsx";

import { SidePanel } from "./side-panel.jsx";
import { create_mdraid, mdraid_rows } from "./mdraids-panel.jsx";
import { create_vgroup, vgroup_rows } from "./vgroups-panel.jsx";
import { vdo_rows } from "./vdos-panel.jsx";
import { StorageBarMenu, StorageMenuItem } from "./storage-controls.jsx";
import { stratis_feature, create_stratis_pool, stratis_rows } from "./stratis-panel.jsx";
import { dialog_open } from "./dialog.jsx";

const _ = cockpit.gettext;

export function thing_menu_items(client, options) {
    // See OptionalPanel for a description of the "feature"
    // argument here.

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
                                    if (options.update)
                                        options.update();
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

    const menu_items = [
        menu_item(null, _("Create RAID device"), () => create_mdraid(client)),
        menu_item(lvm2_feature, _("Create LVM2 volume group"), () => create_vgroup(client)),
        menu_item(stratis_feature(client), _("Create Stratis pool"), () => create_stratis_pool(client))
    ].filter(item => item !== null);

    return menu_items;
}

export function thing_rows(client, options) {
    return [].concat(
        mdraid_rows(client, options),
        vgroup_rows(client, options),
        vdo_rows(client, options),
        stratis_rows(client, options));
}

export class ThingsPanel extends React.Component {
    render() {
        const { client } = this.props;

        const actions = <StorageBarMenu id="devices-menu"
                                        label={_("Create devices")}
                                        menuItems={thing_menu_items(client, { update: () => this.setState({}) })} />;

        const devices = thing_rows(client, {});

        return (
            <SidePanel id="devices"
                       title={_("Devices")}
                       actions={actions}
                       empty_text={_("No devices")}
                       show_all_text={cockpit.format(cockpit.ngettext("Show $0 device", "Show all $0 devices", devices.length), devices.length)}
                       client={client}
                       rows={devices} />
        );
    }
}
