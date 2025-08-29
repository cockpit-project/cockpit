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

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { CardHeader, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Table, Tbody, Tr, Td } from '@patternfly/react-table';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { VolumeIcon } from "../icons/gnome-icons.jsx";
import { fmt_to_fragments } from "utils.jsx";

import { StorageButton, StorageUsageBar, StorageLink, StorageOnOff } from "../storage-controls.jsx";
import {
    StorageCard, StorageDescription, ChildrenTable, PageTable, Actions,
    new_page, new_card, PAGE_CATEGORY_VIRTUAL,
    get_crossrefs, navigate_away_from_card
} from "../pages.jsx";
import {
    get_active_usage, teardown_active_usage, for_each_async,
    get_available_spaces, prepare_available_spaces,
    decode_filename, should_ignore,
} from "../utils.js";

import {
    dialog_open, SelectSpaces, TextInput, PassInput, SelectOne, SizeSlider, CheckBoxes, Group, Message,
    BlockingMessage, TeardownMessage,
    init_teardown_usage
} from "../dialog.jsx";

import { validate_url, get_tang_adv } from "../crypto/tang.jsx";
import { is_valid_mount_point } from "../filesystem/utils.jsx";
import { at_boot_input, update_at_boot_input, mount_options } from "../filesystem/mounting-dialog.jsx";

import {
    validate_pool_name, std_reply, with_stored_passphrase,
    confirm_tang_trust,
    validate_fs_name, set_mount_options, destroy_filesystem
} from "./utils.jsx";
import { make_stratis_filesystem_page } from "./filesystem.jsx";

const _ = cockpit.gettext;

const fsys_min_size = 512 * 1024 * 1024;
const fsys_round_size = 1024 * 1024;

/* Abstractions over the r6 and r8 API revisions, and V1 and V2 pool
 * formats.
 */

/* Key descriptions are returned as an array with elements of type
 *
 * { slot: number | null, keydesc: string }
 *
 * A V1 pool will have at most one entry in the array, and it will
 * have `slot == null`.  V2 pools have zero or more entries with
 * numbered slots.
 */

function get_key_descriptions(pool) {
    const result = [];

    if (!pool.Encrypted)
        return result;

    if (client.stratis_interface_revision < 8) {
        const key_desc = pool.KeyDescription;
        /* The KeyDescription property has type "(b(bs))".

           The first "b" is false when the encryption of the pool is
           inconsistent (not all block devices have the same LUKS
           header). We pretend that the pool doesn't have any
           passphrase in that case.

           The second "b" is true when the pool has a passphrase, and
           the "s" is the description of the key for it.

           Thus, we detect an object of shape

               [ true, [ true, "..." ] ]

           and fish the string out of it.
         */
        if (key_desc[0] && key_desc[1][0])
            result.push({ slot: null, keydesc: key_desc[1][1] });
    } else {
        let key_descs = pool.KeyDescriptions;
        /* The KeyDescriptions property itself has type "v". For a V1
           pool this variant carries a value of type "b(bs)" just as
           with the r6 API (see above). For a V2 pool, it carries a
           "a(us)" value, an array of "slot number plus key
           description".

           Since the property itself has type "v", we need to unwrap
           this variant explicitly.
         */

        /* HACK - https://github.com/stratis-storage/stratisd/issues/3895

           Introduced in stratisd 3.8.0, fixed in stratisd 3.8.3.

           Change notifications drop the variant wrapping for some
           reason, so we only do the unwrapping when "key_descs" is
           indeed a variant.
         */
        if ("t" in key_descs)
            key_descs = key_descs.v;
        if (pool.MetadataVersion == 1) {
            if (key_descs[0] && key_descs[1][0])
                result.push({ slot: null, keydesc: key_descs[1][1] });
        } else if (pool.MetadataVersion == 2) {
            for (const key_desc of key_descs)
                result.push({ slot: key_desc[0], keydesc: key_desc[1] });
        }
    }

    return result;
}

/* Clevis information is returned as an array with elements of type
 *
 *   { slot: number | null, pin: "tang", url: string }
 * | { slot: number | null, pin: string }
 *
 * A V1 pool will have at most one entry in the array, and it will
 * have `slot == null`.  V2 pools have zero or more entries with
 * numbered slots.
 */

function get_clevis_infos(pool) {
    const result = [];

    if (!pool.Encrypted)
        return result;

    if (client.stratis_interface_revision < 8) {
        const clevis_info = pool.ClevisInfo;
        /* The ClevisInfo property has type "(b(b(ss)))".

           The first "b" is false when the encryption of the pool is
           inconsistent (not all block devices have the same LUKS
           header). We pretend that the pool doesn't have any Clevis
           infos in that case.

           The second "b" is true when the pool has a Clevis info, and
           the two "s" are the pin and its JSON encoded configuration,
           respectively.

           Thus, we detect an object of shape

               [ true, [ true, [ "...", "..." ] ] ]

           and fish the strings out of it.

           Cockpit only knows about the "tang" pin in detail, so we
           detect that as well and only then decode the configuration
           in order to extract the url from it.
         */
        if (clevis_info[0] && clevis_info[1][0]) {
            if (clevis_info[1][1][0] == "tang") {
                const config = JSON.parse(clevis_info[1][1][1]);
                result.push({ slot: null, pin: "tang", url: config.url });
            } else {
                result.push({ slot: null, pin: clevis_info[1][1][0] });
            }
        }
    } else {
        let clevis_infos = pool.ClevisInfos;
        /* The ClevisInfos property itself has type "v". For a V1 pool
           this variant carries a value of type "b(b(ss)" just as with
           the r6 API (see above). For a V2 pool, it carries a "a(u(ss))"
           value, an array of "slot number plus pin-plus-config".

           Since the property itself has type "v", we need to unwrap
           this variant explicitly.
         */

        /* HACK - https://github.com/stratis-storage/stratisd/issues/3895

           Introduced in stratisd 3.8.0, fixed in stratisd 3.8.3.

           Change notifications drop the variant wrapping for some
           reason, so we only do the unwrapping when "clevis_infos" is
           indeed a variant.
         */
        if ("t" in clevis_infos)
            clevis_infos = clevis_infos.v;
        if (pool.MetadataVersion == 1) {
            if (clevis_infos[0] && clevis_infos[1][0]) {
                if (clevis_infos[1][1][0] == "tang") {
                    const config = JSON.parse(clevis_infos[1][1][1]);
                    result.push({ slot: null, pin: "tang", url: config.url });
                } else {
                    result.push({ slot: null, pin: clevis_infos[1][1][0] });
                }
            }
        } else if (pool.MetadataVersion == 2) {
            for (const clevis_info of clevis_infos) {
                if (clevis_info[1][0] == "tang") {
                    const config = JSON.parse(clevis_info[1][1]);
                    result.push({ slot: clevis_info[0], pin: "tang", url: config.url });
                } else {
                    result.push({ slot: clevis_info[0], pin: clevis_info[1][0] });
                }
            }
        }
    }

    return result;
}

function bind_keyring(pool, keydesc) {
    if (client.stratis_interface_revision < 8)
        return pool.BindKeyring(keydesc);
    else
        return pool.BindKeyring(keydesc, [false, 0]);
}

function rebind_keyring(pool, keydesc, slot) {
    if (client.stratis_interface_revision < 8)
        return pool.RebindKeyring(keydesc);
    else
        return pool.RebindKeyring(keydesc, [slot !== null, slot || 0]);
}

function unbind_keyring(pool, slot) {
    if (client.stratis_interface_revision < 8)
        return pool.UnbindKeyring();
    else
        return pool.UnbindKeyring([slot !== null, slot || 0]);
}

function bind_clevis(pool, pin, config) {
    if (client.stratis_interface_revision < 8)
        return pool.BindClevis(pin, config);
    else
        return pool.BindClevis(pin, config, [false, 0]);
}

function unbind_clevis(pool, slot) {
    if (client.stratis_interface_revision < 8)
        return pool.UnbindClevis();
    else
        return pool.UnbindClevis([slot !== null, slot || 0]);
}

/* Utilities for key descriptions and passphrases
 */

export async function get_stored_keydescs() {
    return await client.stratis_manager.ListKeys().catch(() => []);
}

async function get_new_keydesc(pool) {
    const key_descs = get_key_descriptions(pool);
    const stored_keydescs = await get_stored_keydescs();

    // Let's arbitrarily stop after 1000 tries to avoid excessive
    // looping.  That shouldn't happen, but...
    let desc;
    for (let i = 0; i < 1000; i++) {
        desc = pool.Name + (i > 0 ? "." + i.toFixed() : "");
        if (!key_descs.find(kd => kd.keydesc == desc) && !stored_keydescs.includes(desc))
            break;
    }
    return desc;
}

function PoolPassphrase(tag, pool, main, stored_keydescs, force) {
    const all_key_descs = get_key_descriptions(pool);
    const clevis_infos = get_clevis_infos(pool);

    const available_key_descs = all_key_descs.filter(kd => !stored_keydescs.includes(kd.keydesc));
    const can_use_passphrase = available_key_descs.length > 0;
    const have_stored_passphrase = all_key_descs.length > available_key_descs.length;
    const need_passphrase = (force || clevis_infos.length == 0) && !have_stored_passphrase;
    const single_tang_url = (clevis_infos.length == 1 && clevis_infos[0].pin == "tang" && !have_stored_passphrase && clevis_infos[0].url);
    const only_tang = clevis_infos.every(ci => ci.pin == "tang") && !have_stored_passphrase;

    if (can_use_passphrase) {
        let extra_explanation;
        if (need_passphrase) {
            extra_explanation = _("Please provide an existing pool passphrase.");
        } else if (single_tang_url) {
            extra_explanation = cockpit.format(_("If the keyserver at $0 is not reachable, you can provide an existing passphrase."), single_tang_url);
        } else if (only_tang) {
            extra_explanation = _("If none of the keyservers is reachable, you can provide an existing passphrase.");
        } else {
            /* Clevis other than "tang" and/or passphrases already in the keyring.
             */
            extra_explanation = _("If none of the non-interactive unlock methods works, you can provide an existing passphrase.");
        }

        return PassInput(tag, _("Pool passphrase"), {
            validate: val => need_passphrase && !val.length && _("Passphrase cannot be empty"),
            explanation: main + " " + extra_explanation,
        });
    } else if (single_tang_url) {
        return Message(main + " " + cockpit.format(_("The keyserver at $0 must be reachable."), single_tang_url));
    } else if (only_tang) {
        return Message(main + " " + _("At least one keyserver must be reachable."));
    } else {
        /* Clevis other than "tang" and/or passphrases already in the keyring.
         */
        return Message(main + " " + _("At least one of the non-interactive unlock methods must work."));
    }
}

async function with_pool_passphrase(pool, passphrase, func) {
    const stored_keydescs = await get_stored_keydescs();
    const key_descs = get_key_descriptions(pool).filter(kd => !stored_keydescs.includes(kd.key_descs));

    if (!passphrase || key_descs.length == 0)
        return func();

    let err;

    for (const kd of key_descs) {
        try {
            return await with_stored_passphrase(client, kd.keydesc, passphrase, func);
        } catch (e) {
            err = e;
        }
    }

    throw err;
}

/* Operations
 */

function destroy_pool(pool) {
    return for_each_async(client.stratis_pool_filesystems[pool.path], fsys => destroy_filesystem(fsys))
            .then(() => client.stratis_manager.DestroyPool(pool.path).then(std_reply));
}

function create_fs(pool) {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const forced_options = ["x-systemd.requires=stratis-fstab-setup@" + pool.Uuid + ".service"];

    let action_variants;
    if (!client.in_anaconda_mode()) {
        action_variants = [
            { tag: null, Title: _("Create and mount") },
            { tag: "nomount", Title: _("Create only") },
        ];
    } else {
        action_variants = [
            { tag: "nomount", Title: _("Create") },
        ];
    }

    dialog_open({
        Title: _("Create filesystem"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          validate: name => validate_fs_name(null, name, filesystems)
                      }),
            Group(_("Stratis filesystem"), [
                CheckBoxes("set_custom_size", null,
                           {
                               value: {
                                   enabled: !pool.Overprovisioning,
                               },
                               fields: [
                                   { tag: "enabled", title: _("Set initial size") },
                               ]
                           }),
                SizeSlider("size", null,
                           {
                               visible: vals => vals.set_custom_size.enabled,
                               min: fsys_min_size,
                               max: pool.Overprovisioning ? stats.pool_total : stats.pool_free,
                               allow_infinite: pool.Overprovisioning,
                               round: fsys_round_size,
                           }),
                CheckBoxes("set_custom_limit", null,
                           {
                               value: {
                                   enabled: false,
                               },
                               fields: [
                                   { tag: "enabled", title: _("Limit size") },
                               ]
                           }),
                SizeSlider("limit", null,
                           {
                               visible: vals => vals.set_custom_limit.enabled,
                               min: fsys_min_size,
                               max: pool.Overprovisioning ? stats.pool_total : stats.pool_free,
                               allow_infinite: true,
                               round: fsys_round_size,
                           }),
            ]),
            TextInput("mount_point", _("Mount point"),
                      {
                          validate: (val, values, variant) => {
                              return is_valid_mount_point(client,
                                                          null,
                                                          client.add_mount_point_prefix(val),
                                                          variant == "nomount");
                          }
                      }),
            mount_options(false, false),
            at_boot_input(),
        ],
        update: update_at_boot_input,
        Action: {
            Variants: action_variants,
            action: async function (vals) {
                let size_spec = [false, ""]; let limit_spec = [false, ""];
                if (vals.set_custom_size.enabled)
                    size_spec = [true, vals.size.toString()];
                if (vals.set_custom_limit.enabled)
                    limit_spec = [true, vals.limit.toString()];
                const result = await pool.CreateFilesystems([[vals.name, size_spec, limit_spec]]).then(std_reply);
                if (result[0])
                    await set_mount_options(result[1][0][0], vals, forced_options);
            }
        }
    });
}

function delete_pool(pool, card) {
    const usage = get_active_usage(client, pool.path, _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"),
                                  pool.Name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Permanently delete $0?"), pool.Name),
        Teardown: TeardownMessage(usage),
        Action: {
            Danger: _("Deleting a Stratis pool will erase all data it contains."),
            Title: _("Delete"),
            action: async function () {
                await teardown_active_usage(client, usage);
                await destroy_pool(pool);
                navigate_away_from_card(card);
            }
        },
        Inits: [
            init_teardown_usage(client, usage)
        ]
    });
}

function rename_pool(pool) {
    dialog_open({
        Title: _("Rename Stratis pool"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: pool.Name,
                          validate: name => validate_pool_name(pool, name)
                      })
        ],
        Action: {
            Title: _("Rename"),
            action: function (vals) {
                return pool.SetName(vals.name).then(std_reply);
            }
        }
    });
}

async function add_disks(pool) {
    const blockdevs = client.stratis_pool_blockdevs[pool.path] || [];
    const is_v1_pool = client.stratis_interface_revision < 8 || pool.MetadataVersion == 1;
    const stored_keydescs = await get_stored_keydescs();

    dialog_open({
        Title: _("Add block devices"),
        Fields: [
            SelectOne("tier", _("Tier"), {
                choices: [
                    { value: "data", title: _("Data") },
                    {
                        value: "cache",
                        title: _("Cache"),
                    }
                ]
            }),
            SelectSpaces("disks", _("Block devices"), {
                empty_warning: _("No disks are available."),
                validate: function(disks) {
                    if (disks.length === 0)
                        return _("At least one disk is needed.");
                },
                spaces: get_available_spaces()
            }),
            ...(is_v1_pool
                ? [PoolPassphrase("pool_passphrase", pool, _("Adding blockdevices requires unlocking the pool."), stored_keydescs, true)]
                : []),
        ],
        Action: {
            Title: _("Add"),
            action: function(vals) {
                return prepare_available_spaces(client, vals.disks)
                        .then(paths => {
                            const devs = paths.map(p => decode_filename(client.blocks[p].PreferredDevice));

                            function add() {
                                if (vals.tier == "data") {
                                    return pool.AddDataDevs(devs).then(std_reply);
                                } else if (vals.tier == "cache") {
                                    const has_cache = blockdevs.some(bd => bd.Tier == 1);
                                    const method = has_cache ? "AddCacheDevs" : "InitCache";
                                    return pool[method](devs).then(std_reply);
                                }
                            }

                            return with_pool_passphrase(pool, vals.pool_passphrase, add);
                        });
            }
        }
    });
}

function make_stratis_filesystem_pages(parent, pool) {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const forced_options = ["x-systemd.requires=stratis-fstab-setup@" + pool.Uuid + ".service"];

    filesystems.forEach((fs, i) => make_stratis_filesystem_page(parent, pool, fs,
                                                                stats.fsys_offsets[i],
                                                                forced_options));
}

export function make_stratis_pool_page(parent, pool) {
    const degraded_ops = pool.AvailableActions && pool.AvailableActions !== "fully_operational";
    const blockdevs = client.stratis_pool_blockdevs[pool.path] || [];
    const can_grow = blockdevs.some(bd => (bd.NewPhysicalSize[0] &&
                                           Number(bd.NewPhysicalSize[1]) > Number(bd.TotalPhysicalSize)));
    const stats = client.stratis_pool_stats[pool.path];

    const use = pool.TotalPhysicalUsed[0] && [Number(pool.TotalPhysicalUsed[1]), Number(pool.TotalPhysicalSize)];

    if (should_ignore(client, pool.path))
        return;

    const pool_card = new_card({
        title: pool.Encrypted ? _("Encrypted Stratis pool") : _("Stratis pool"),
        next: null,
        page_location: ["pool", pool.Uuid],
        page_name: pool.Name,
        page_icon: VolumeIcon,
        page_category: PAGE_CATEGORY_VIRTUAL,
        page_size: (use
            ? <StorageUsageBar key="s" stats={use} short />
            : Number(pool.TotalPhysicalSize)),
        component: StratisPoolCard,
        props: { pool, degraded_ops, can_grow, stats },
        actions: [
            {
                title: _("Add block devices"),
                action: () => add_disks(pool),
            },
            {
                title: _("Delete pool"),
                action: () => delete_pool(pool, pool_card),
                danger: true,
            },
        ],
    });

    let crypto_card = null;
    if (pool.Encrypted) {
        crypto_card = new_card({
            title: _("Encryption tokens"),
            next: pool_card,
            component: StratisEncryptionCard,
            props: { pool },
        });
    }

    const fsys_card = new_card({
        title: _("Stratis filesystems"),
        next: crypto_card || pool_card,
        has_warning: degraded_ops || can_grow,
        component: StratisFilesystemsCard,
        props: { pool, degraded_ops, can_grow, stats },
        actions: [
            {
                title: _("Create new filesystem"),
                action: () => create_fs(pool),
                excuse: ((!pool.Overprovisioning && stats.pool_free < fsys_min_size)
                    ? _("Not enough free space")
                    : null),
            },
        ],
    });

    const p = new_page(parent, fsys_card);
    make_stratis_filesystem_pages(p, pool);
}

const StratisFilesystemsCard = ({ card, pool, degraded_ops, can_grow, stats }) => {
    const blockdevs = client.stratis_pool_blockdevs[pool.path] || [];

    function grow_blockdevs() {
        return for_each_async(blockdevs, bd => pool.GrowPhysicalDevice(bd.Uuid));
    }

    const alerts = [];
    if (can_grow) {
        alerts.push(
            <Alert isInline key="unused"
                   variant="warning"
                   title={_("This pool does not use all the space on its block devices.")}>
                {_("Some block devices of this pool have grown in size after the pool was created. The pool can be safely grown to use the newly available space.")}
                <div className="storage-alert-actions">
                    <StorageButton onClick={grow_blockdevs}>
                        {_("Grow the pool to take all space")}
                    </StorageButton>
                </div>
            </Alert>);
    }

    if (degraded_ops) {
        const goToStratisLogs = () => cockpit.jump("/system/logs/#/?prio=warn&_SYSTEMD_UNIT=stratisd.service");
        alerts.push(
            <Alert isInline key="degraded"
                   variant="warning"
                   title={_("This pool is in a degraded state.")}>
                <div className="storage-alert-actions">
                    <Button variant="link" isInline onClick={goToStratisLogs}>
                        {_("View logs")}
                    </Button>
                </div>
            </Alert>);
    }

    return (
        <StorageCard card={card} alerts={alerts}>
            <ChildrenTable
                emptyCaption={_("No filesystems")}
                aria-label={_("Stratis filesystems pool")}
                page={card.page} />
        </StorageCard>
    );
};

const StratisV1TokenDescriptions = ({
    key_descs,
    add_passphrase,
    change_passphrase,
    remove_passphrase,
    clevis_infos,
    add_tang,
    remove_clevis,
}) => {
    let remove_passphrase_excuse;
    let remove_tang_excuse;

    if (key_descs.length + clevis_infos.length <= 1) {
        remove_passphrase_excuse = _("This passphrase is the only way to unlock the pool and can not be removed.");
        remove_tang_excuse = _("This keyserver is the only way to unlock the pool and can not be removed.");
    }

    return (
        <>
            <StorageDescription title={_("Passphrase")}>
                <Flex>
                    { key_descs.length == 0
                        ? <FlexItem>
                            <StorageLink
                                  onClick={add_passphrase}
                            >
                                {_("Add passphrase")}
                            </StorageLink>
                        </FlexItem>
                        : <>
                            <FlexItem>
                                <StorageLink
                                      onClick={() => change_passphrase(key_descs[0])}
                                >
                                    {_("Change")}
                                </StorageLink>
                            </FlexItem>
                            <FlexItem>
                                <StorageLink
                                      onClick={() => remove_passphrase(key_descs[0])}
                                      excuse={remove_passphrase_excuse}
                                >
                                    {_("Remove")}
                                </StorageLink>
                            </FlexItem>
                        </>
                    }
                </Flex>
            </StorageDescription>
            <StorageDescription title={_("Keyserver")}>
                <Flex>
                    { clevis_infos.length == 0
                        ? <FlexItem>
                            <StorageLink
                                  onClick={add_tang}
                            >
                                {_("Add keyserver")}
                            </StorageLink>
                        </FlexItem>
                        : (clevis_infos[0].pin == "tang"
                            ? <>
                                <FlexItem>
                                    {clevis_infos[0].url}
                                </FlexItem>
                                <FlexItem>
                                    <StorageLink
                                          onClick={() => remove_clevis(clevis_infos[0])}
                                          excuse={remove_tang_excuse}
                                    >
                                        {_("Remove")}
                                    </StorageLink>
                                </FlexItem>
                            </>
                            : <FlexItem>
                                {cockpit.format(_("Clevis \"$0\""), clevis_infos[0].pin)}
                            </FlexItem>
                        )
                    }
                </Flex>
            </StorageDescription>
        </>
    );
};

const StratisV2TokenTable = ({
    pool,
    tokens,
    add_passphrase,
    change_passphrase,
    remove_passphrase,
    add_tang,
    remove_clevis,
}) => {
    let remove_excuse;
    if (tokens.length <= 1)
        remove_excuse = _("Last token can not be removed");

    const free_token_slots = (pool.FreeTokenSlots && pool.FreeTokenSlots[0])
        ? pool.FreeTokenSlots[1]
        : 15 - tokens.length;

    let add_excuse;
    if (free_token_slots <= 0)
        add_excuse = _("No more space for passphrases or keyservers.");

    function make_row(info) {
        let test_location;
        let description;
        let actions;

        if (info.keydesc) {
            test_location = "passphrase";
            description = _("Passphrase");
            actions = [
                {
                    title: _("Change"),
                    action: () => change_passphrase(info),
                },
                {
                    title: _("Remove"),
                    action: () => remove_passphrase(info),
                    excuse: remove_excuse,
                    danger: true,
                },
            ];
        } else if (info.pin == "tang") {
            test_location = info.url;
            description = info.url;
            actions = [
                {
                    title: _("Remove"),
                    action: () => remove_clevis(info),
                    excuse: remove_excuse,
                    danger: true,
                },
            ];
        } else {
            test_location = info.pin;
            description = cockpit.format(_("Clevis \"$0\""), info.pin);
            actions = [
                {
                    title: _("Remove"),
                    action: () => remove_clevis(info),
                    excuse: remove_excuse,
                    danger: true,
                },
            ];
        }

        return (
            <Tr key={info.slot} data-test-row-location={test_location}>
                <Td>{cockpit.format(_("Slot $0"), info.slot)}</Td>
                <Td>{description}</Td>
                <Td modifier="nowrap" className="pf-v6-c-table__action">
                    <Actions onlyMenu actions={actions} />
                </Td>
            </Tr>
        );
    }

    const actions = [
        {
            title: _("Add passphrase"),
            action: add_passphrase,
            excuse: add_excuse
        },
        {
            title: _("Add keyserver"),
            action: add_tang,
            excuse: add_excuse
        },
    ];

    const v2_table = (
        <Table variant="compact">
            <Tbody>
                { tokens.map(make_row) }
            </Tbody>
        </Table>
    );

    return [v2_table, actions];
};

const StratisEncryptionCard = ({ card, pool }) => {
    const key_descs = get_key_descriptions(pool);
    const clevis_infos = get_clevis_infos(pool);
    const is_v1_pool = client.stratis_interface_revision < 8 || pool.MetadataVersion == 1;

    const tokens = key_descs.concat(clevis_infos).sort((a, b) => a.slot - b.slot);

    async function add_passphrase() {
        const stored_keydescs = await get_stored_keydescs();

        dialog_open({
            Title: _("Add passphrase"),
            Fields: [
                PassInput("passphrase", _("Passphrase"),
                          { validate: val => !val.length && _("Passphrase cannot be empty") }),
                PassInput("passphrase2", _("Confirm"),
                          { validate: (val, vals) => vals.passphrase.length && vals.passphrase != val && _("Passphrases do not match") }),
                PoolPassphrase("pool_passphrase", pool, _("Adding a passphrase requires unlocking the pool."), stored_keydescs),
            ],
            Action: {
                Title: _("Save"),
                action: async vals => {
                    const key_desc = await get_new_keydesc(pool);
                    return await with_pool_passphrase(pool, vals.pool_passphrase,
                                                      () => with_stored_passphrase(client, key_desc, vals.passphrase,
                                                                                   () => bind_keyring(pool, key_desc).then(std_reply)));
                }
            }
        });
    }

    async function change_passphrase(info) {
        const stored_keydescs = await get_stored_keydescs();
        const keydesc_set = stored_keydescs.includes(info.keydesc);

        dialog_open({
            Title: _("Change passphrase"),
            Fields: [
                PassInput("old_passphrase", _("Old passphrase"),
                          {
                              visible: vals => !keydesc_set,
                              validate: val => !val.length && _("Passphrase cannot be empty")
                          }),
                PassInput("new_passphrase", _("New passphrase"),
                          { validate: val => !val.length && _("Passphrase cannot be empty") }),
                PassInput("new_passphrase2", _("Confirm"),
                          { validate: (val, vals) => vals.new_passphrase.length && vals.new_passphrase != val && _("Passphrases do not match") })
            ],
            Action: {
                Title: _("Save"),
                action: async vals => {
                    const new_keydesc = await get_new_keydesc(pool);

                    function rebind() {
                        return with_stored_passphrase(client, new_keydesc, vals.new_passphrase,
                                                      () => rebind_keyring(pool, new_keydesc, info.slot).then(std_reply));
                    }

                    if (vals.old_passphrase) {
                        await with_stored_passphrase(client, info.keydesc, vals.old_passphrase, rebind);
                    } else {
                        await rebind();
                    }
                }
            }
        });
    }

    function remove_passphrase(info) {
        dialog_open({
            Title: _("Remove passphrase?"),
            Body: <div>
                <p className="slot-warning">{ fmt_to_fragments(_("Passphrase removal may prevent unlocking $0."), <b>{pool.Name}</b>) }</p>
            </div>,
            Action: {
                DangerButton: true,
                Title: _("Remove"),
                action: function (vals) {
                    return unbind_keyring(pool, info.slot).then(std_reply);
                }
            }
        });
    }

    async function add_tang() {
        const stored_keydescs = await get_stored_keydescs();

        dialog_open({
            Title: _("Add Tang keyserver"),
            Fields: [
                TextInput("tang_url", _("Keyserver address"),
                          {
                              validate: validate_url,
                          }),
                PoolPassphrase("pool_passphrase", pool, _("Adding a keyserver requires unlocking the pool."), stored_keydescs),
            ],
            Action: {
                Title: _("Save"),
                action: function (vals, progress) {
                    return get_tang_adv(vals.tang_url)
                            .then(adv => {
                                function bind() {
                                    return bind_clevis(pool, "tang", JSON.stringify({ url: vals.tang_url, adv }))
                                            .then(std_reply);
                                }
                                confirm_tang_trust(vals.tang_url, adv,
                                                   () => with_pool_passphrase(pool, vals.pool_passphrase, bind));
                            });
                }
            }
        });
    }

    function remove_clevis(info) {
        dialog_open({
            Title: info.pin == "tang" ? _("Remove Tang keyserver?") : _("Remove Clevis token?"),
            Body: <div>
                <p>{ fmt_to_fragments(_("Remove $0?"), <b>{info.pin == "tang" ? info.url : info.pin}</b>) }</p>
                <p className="slot-warning">{ fmt_to_fragments(_("Removal may prevent unlocking $0."), <b>{pool.Name}</b>) }</p>
            </div>,
            Action: {
                DangerButton: true,
                Title: _("Remove"),
                action: function (vals) {
                    return unbind_clevis(pool, info.slot).then(std_reply);
                }
            }
        });
    }

    let v1_descriptions;
    let v2_table;
    let actions;

    if (is_v1_pool) {
        v1_descriptions = StratisV1TokenDescriptions({
            key_descs,
            add_passphrase,
            change_passphrase,
            remove_passphrase,
            clevis_infos,
            add_tang,
            remove_clevis,
        });
    } else if (pool.MetadataVersion == 2) {
        [v2_table, actions] = StratisV2TokenTable({
            pool,
            tokens,
            add_passphrase,
            change_passphrase,
            remove_passphrase,
            add_tang,
            remove_clevis,
        });
    }

    return (
        <StorageCard card={card} actions={<Actions actions={actions} />}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription
                        title={_("Metadata format")}
                        value={is_v1_pool ? "V1" : "V" + pool.MetadataVersion}
                        help={is_v1_pool && _("Pools with metadata format V1 are restricted to at most one passphrase and at most one keyserver.")}
                    />
                    {v1_descriptions}
                </DescriptionList>
            </CardBody>
            {v2_table}
        </StorageCard>
    );
};

const StratisPoolCard = ({ card, pool, degraded_ops, can_grow, stats }) => {
    const use = pool.TotalPhysicalUsed[0] && [Number(pool.TotalPhysicalUsed[1]), Number(pool.TotalPhysicalSize)];

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")}
                           value={pool.Name}
                           action={<StorageLink onClick={() => rename_pool(pool)}>
                               {_("edit")}
                           </StorageLink>} />
                    <StorageDescription title={_("UUID")} value={pool.Uuid} />
                    { use &&
                    <StorageDescription title={_("Usage")}>
                        <StorageUsageBar stats={use} critical={0.80} />
                    </StorageDescription>
                    }
                    <StorageDescription title={_("Overprovisioning")}>
                        <StorageOnOff state={pool.Overprovisioning}
                                      aria-label={_("Allow overprovisioning")}
                                      onChange={() => client.stratis_set_property(pool,
                                                                                  "Overprovisioning",
                                                                                  "b", !pool.Overprovisioning)}
                                      excuse={(pool.Overprovisioning && stats.fsys_total_size > stats.pool_total)
                                          ? _("Virtual filesystem sizes are larger than the pool. Overprovisioning can not be disabled.")
                                          : null} />
                    </StorageDescription>
                    { !pool.Overprovisioning &&
                    <StorageDescription title={_("Allocated")}>
                        <StorageUsageBar stats={[stats.fsys_total_size, stats.pool_total]} critical={2} />
                    </StorageDescription>
                    }
                </DescriptionList>
            </CardBody>
            <CardHeader><strong>{_("Block devices")}</strong></CardHeader>
            <PageTable
                emptyCaption={_("No block devices found")}
                aria-label={_("Stratis block devices")}
                crossrefs={get_crossrefs(pool)} />
        </StorageCard>
    );
};
