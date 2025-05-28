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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
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

import * as python from "python.js";
import stratis3_start_pool_py from "./stratis3-start-pool.py";

const _ = cockpit.gettext;

async function stratis3_r8_start_pool(uuid, passphrase) {
    if (passphrase) {
        return await python.spawn(stratis3_start_pool_py, [uuid, "passphrase"], { superuser: "require" })
                .input(passphrase);
    } else {
        return await python.spawn(stratis3_start_pool_py, [uuid, "clevis"], { superuser: "require" });
    }
}

function stratis3_r6_start_pool(uuid, unlock_method) {
    return client.stratis_manager.StartPool(uuid, "uuid", [!!unlock_method, unlock_method || ""]).then(std_reply);
}

function start_pool(uuid, show_devs) {
    const devs = client.stratis_manager.StoppedPools[uuid].devs.v.map(d => d.devnode).sort();

    // HACK - if this is a V2 encrypted pool, it needs to be started
    //        with the r8 StartPool method.

    const r8_stopped_pool = client.stratis_manager_r8?.StoppedPools?.[uuid];
    const v2_encrypted = (
        r8_stopped_pool &&
            r8_stopped_pool.metadata_version.v[0] &&
            r8_stopped_pool.metadata_version.v[1] == 2 &&
            r8_stopped_pool.features.v[0] &&
            r8_stopped_pool.features.v[1].encryption);

    // HACK - https://github.com/stratis-storage/stratisd/issues/3805
    //
    // For V2 pools we don't know whether they have clevis or a
    // passphrase, we just have to try everything.

    const key_desc = v2_encrypted ? true : client.stratis_stopped_pool_key_description[uuid];
    const clevis_info = v2_encrypted ? true : client.stratis_stopped_pool_clevis_info[uuid];

    function start_with_clevis() {
        if (v2_encrypted)
            return stratis3_r8_start_pool(uuid, null);
        else
            return stratis3_r6_start_pool(uuid, "clevis");
    }

    function start_with_passphrase(passphrase) {
        if (v2_encrypted)
            return stratis3_r8_start_pool(uuid, passphrase);
        else {
            return with_stored_passphrase(client, key_desc, passphrase,
                                          () => stratis3_r6_start_pool(uuid, "keyring"));
        }
    }

    function prompt_for_passphrase() {
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
                    return start_with_passphrase(vals.passphrase);
                }
            }
        });
    }

    function unlock_with_passphrase() {
        if (v2_encrypted) {
            // HACK - We don't know any concrete key descriptions for
            // stopped V2 pools so we can't check whether they are
            // already set.
            prompt_for_passphrase();
        } else {
            // If the key for this pool is already in the keyring, try
            // that first.
            return (client.stratis_manager.ListKeys()
                    .catch(() => [{ }])
                    .then(keys => {
                        if (keys.indexOf(key_desc) >= 0)
                            return stratis3_r6_start_pool(uuid, "keyring");
                        else
                            prompt_for_passphrase();
                    }));
        }
    }

    if (!key_desc && !clevis_info) {
        // Not an encrypted pool, just start it
        return stratis3_r6_start_pool(uuid, null);
    } else if (key_desc && clevis_info) {
        return start_with_clevis().catch(unlock_with_passphrase);
    } else if (!key_desc && clevis_info) {
        return start_with_clevis();
    } else if (key_desc && !clevis_info) {
        return unlock_with_passphrase();
    }
}

export function make_stratis_stopped_pool_page(parent, uuid) {
    if (client.in_anaconda_mode())
        return;

    const pool_card = new_card({
        title: _("Stratis pool"),
        type_extra: _("stopped"),
        next: null,
        page_location: ["pool", uuid],
        page_name: client.stratis_manager.StoppedPools[uuid]?.name?.v || uuid,
        page_icon: VolumeIcon,
        page_category: PAGE_CATEGORY_VIRTUAL,
        component: StoppedStratisPoolCard,
        props: { uuid },
        actions: [
            { title: _("Start"), action: from_menu => start_pool(uuid, from_menu), spinner: true },
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
                    { encrypted &&
                    <StorageDescription title={_("Passphrase")}>
                        { key_desc ? cockpit.format(_("using key description $0"), key_desc) : _("none") }
                    </StorageDescription>
                    }
                    { can_tang &&
                    <StorageDescription title={_("Keyserver")} value={ tang_url || _("none") } />
                    }
                </DescriptionList>
            </CardBody>
            <CardHeader><strong>{_("Block devices")}</strong></CardHeader>
            <PageTable
                emptyCaption={_("No block devices found")}
                aria-label={_("Stratis block devices")}
                crossrefs={get_crossrefs(uuid)} />
        </StorageCard>
    );
};
