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
import { get_stored_keydescs } from "./pool";

import * as python from "python.js";
import stratis3_start_pool_py from "./stratis3-start-pool.py";

const _ = cockpit.gettext;

/* Starting a pool has to deal with a number of possibilities:

   API REVISION:

   r6: Can only start V1 pools, takes unlock method as argument and
       passphrase in keyring.

   r8: Can start both V1 and V2 pools, takes passphrase via FD,
       unlock method determined by whether or not there is a
       FD.

   METADATA FORMAT:

   V1: Can have at most one passphrase and/or at most one clevis info,
       which are communicated in the StoppedPools manager property of both
       the r6 and r8 API.

   V2: Can have zero or more passphrases and clevis infos, a summary of which is
       communicated in the StoppedPools property.
 */

function is_v1_pool(uuid) {
    if (client.stratis_interface_revision < 8)
        return true;

    const stopped_info = client.stratis_manager.StoppedPools[uuid];
    return !stopped_info.metadata_version.v[0] || stopped_info.metadata_version.v[1] == 1;
}

function stratis_r8_manager_start_pool(uuid, slot, passphrase) {
    const p = python.spawn(
        stratis3_start_pool_py,
        [uuid, slot, passphrase ? 0 : "-"],
        { superuser: "require" });
    if (passphrase)
        p.input(passphrase);
    return p;
}

function get_v1_keydesc(uuid) {
    const stopped_info = client.stratis_manager.StoppedPools[uuid];
    const kd = stopped_info.key_description;
    return kd.v[1].v[1];
}

async function manager_start_pool(uuid, unlock_method, passphrase) {
    if (client.stratis_interface_revision < 8) {
        const start = () => {
            return client.stratis_manager.StartPool(
                uuid, "uuid",
                unlock_method ? [true, unlock_method] : [false, ""])
                    .then(std_reply);
        };
        if (passphrase) {
            const keydesc = get_v1_keydesc(uuid);
            return with_stored_passphrase(client, keydesc, passphrase, start);
        } else {
            return start();
        }
    } else {
        return await stratis_r8_manager_start_pool(uuid, unlock_method ? "any" : "-", passphrase);
    }
}

function start_pool(uuid, show_devs) {
    const stopped_info = client.stratis_manager.StoppedPools[uuid];
    const devs = stopped_info.devs.v.map(d => d.devnode).sort();

    async function prompt_for_passphrase() {
        if (client.stratis_interface_revision < 8) {
            const key_desc = get_v1_keydesc(uuid);
            const stored_keydescs = await get_stored_keydescs();
            if (stored_keydescs.includes(key_desc))
                return await client.stratis_manager.StartPool(uuid, "uuid", [true, "keyring"]).then(std_reply);
        }

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
                    return manager_start_pool(uuid, "keyring", vals.passphrase);
                }
            }
        });
    }

    let have_passphrase;
    let have_clevis;

    if (is_v1_pool(uuid)) {
        const kd = stopped_info.key_description;
        have_passphrase = kd && kd.v[0] && kd.v[1].v[0];
        const ci = stopped_info.clevis_info;
        have_clevis = ci && ci.v[0] && ci.v[1].v[0];
    } else {
        const features = stopped_info.features.v[0] ? stopped_info.features.v[1] : { };
        const encrypted = features.encryption;
        have_passphrase = features.key_description_present;
        have_clevis = features.clevis_present;

        // stratisd 3.8.0 never sets the "key_description_present"
        // or "clevis_present" flags, so we have to try everything
        // when the pool is encrypted. (stratisd 3.8.1 and younger
        // will set at least one of them for encrypted pools.)
        //
        if (encrypted && !have_passphrase && !have_clevis)
            have_passphrase = have_clevis = true;
    }

    if (!have_passphrase && !have_clevis) {
        // Not an encrypted pool, just start it
        return manager_start_pool(uuid, null, null);
    } else if (have_passphrase && have_clevis) {
        return manager_start_pool(uuid, "clevis", null).catch(prompt_for_passphrase);
    } else if (!have_passphrase && have_clevis) {
        return manager_start_pool(uuid, "clevis", null);
    } else if (have_passphrase && !have_clevis) {
        return prompt_for_passphrase();
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
    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("UUID")} value={uuid} />
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
