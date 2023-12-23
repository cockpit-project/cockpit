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

import { CardHeader, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";

import { VolumeIcon } from "../icons/gnome-icons.jsx";
import {
    StorageCard, StorageDescription, PageTable,
    new_page, new_card, PAGE_CATEGORY_VIRTUAL,
    get_crossrefs
} from "../pages.jsx";
import { dialog_open, PassInput } from "../dialog.jsx";
import { std_reply, with_stored_passphrase } from "./utils.jsx";

const _ = cockpit.gettext;

function start_pool(uuid, show_devs) {
    const devs = client.stratis_manager.StoppedPools[uuid].devs.v.map(d => d.devnode).sort();
    const key_desc = client.stratis_stopped_pool_key_description[uuid];
    const clevis_info = client.stratis_stopped_pool_clevis_info[uuid];

    function start(unlock_method) {
        return client.stratis_start_pool(uuid, unlock_method).then(std_reply);
    }

    function unlock_with_keydesc(key_desc) {
        dialog_open({
            Title: _("Unlock encrypted Stratis pool"),
            Body: (show_devs &&
            <>
                <p>{_("Provide the passphrase for the pool on these block devices:")}</p>
                <List>{devs.map(d => <ListItem key={d}>{d}</ListItem>)}</List>
                <br />
            </>),
            Fields: [
                PassInput("passphrase", _("Passphrase"), { })
            ],
            Action: {
                Title: _("Unlock"),
                action: function(vals) {
                    return with_stored_passphrase(client, key_desc, vals.passphrase,
                                                  () => start("keyring"));
                }
            }
        });
    }

    function unlock_with_keyring() {
        return (client.stratis_list_keys()
                .catch(() => [{ }])
                .then(keys => {
                    if (keys.indexOf(key_desc) >= 0)
                        return start("keyring");
                    else
                        unlock_with_keydesc(key_desc);
                }));
    }

    if (!key_desc && !clevis_info) {
        // Not an encrypted pool, just start it
        return start();
    } else if (key_desc && clevis_info) {
        return start("clevis").catch(unlock_with_keyring);
    } else if (!key_desc && clevis_info) {
        return start("clevis");
    } else if (key_desc && !clevis_info) {
        return unlock_with_keyring();
    }
}

export function make_stratis_stopped_pool_page(parent, uuid) {
    const pool_card = new_card({
        title: _("Stratis pool"),
        type_extra: _("stopped"),
        next: null,
        page_location: ["pool", uuid],
        page_name: uuid,
        page_icon: VolumeIcon,
        page_category: PAGE_CATEGORY_VIRTUAL,
        component: StoppedStratisPoolCard,
        props: { uuid },
        actions: [
            { title: _("Start"), action: from_menu => start_pool(uuid, from_menu), },
        ],
    });

    new_page(parent, pool_card);
}

const StoppedStratisPoolCard = ({ card, uuid }) => {
    const key_desc = client.stratis_stopped_pool_key_description[uuid];
    const clevis_info = client.stratis_stopped_pool_clevis_info[uuid];

    const encrypted = key_desc || clevis_info;
    const can_tang = encrypted && (!clevis_info || clevis_info[0] == "tang");
    const tang_url = (can_tang && clevis_info) ? JSON.parse(clevis_info[1]).url : null;

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("UUID")} value={uuid} />
                    { encrypted && client.features.stratis_crypto_binding &&
                    <StorageDescription title={_("Passphrase")}>
                        { key_desc ? cockpit.format(_("using key description $0"), key_desc) : _("none") }
                    </StorageDescription>
                    }
                    { can_tang && client.features.stratis_crypto_binding &&
                    <StorageDescription title={_("Keyserver")} value={ tang_url || _("none") } />
                    }
                </DescriptionList>
            </CardBody>
            <CardHeader><strong>{_("Block devices")}</strong></CardHeader>
            <CardBody className="contains-list">
                <PageTable emptyCaption={_("No block devices found")}
                           aria-label={_("Stratis block devices")}
                           crossrefs={get_crossrefs(uuid)} />
            </CardBody>
        </StorageCard>
    );
};
