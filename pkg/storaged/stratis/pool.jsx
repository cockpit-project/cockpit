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

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { CardHeader, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { VolumeIcon } from "../icons/gnome-icons.jsx";
import { fmt_to_fragments } from "utils.jsx";

import { StorageButton, StorageUsageBar, StorageLink } from "../storage-controls.jsx";
import {
    StorageCard, StorageDescription, ChildrenTable, PageTable,
    new_page, new_card, PAGE_CATEGORY_VIRTUAL,
    get_crossrefs, navigate_away_from_card
} from "../pages.jsx";
import {
    get_active_usage, teardown_active_usage, for_each_async,
    get_available_spaces, prepare_available_spaces,
    decode_filename, should_ignore,
} from "../utils.js";

import {
    dialog_open, SelectSpaces, TextInput, PassInput, SelectOne, SizeSlider,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "../dialog.jsx";

import { validate_url, get_tang_adv } from "../crypto/tang.jsx";
import { is_valid_mount_point } from "../filesystem/utils.jsx";
import { at_boot_input, update_at_boot_input, mount_options } from "../filesystem/mounting-dialog.jsx";

import {
    validate_pool_name, std_reply, with_keydesc, with_stored_passphrase,
    confirm_tang_trust, get_unused_keydesc,
    validate_fs_name, set_mount_options, destroy_filesystem
} from "./utils.jsx";
import { make_stratis_filesystem_page } from "./filesystem.jsx";

const _ = cockpit.gettext;

const fsys_min_size = 512 * 1024 * 1024;

function destroy_pool(pool) {
    return for_each_async(client.stratis_pool_filesystems[pool.path], fsys => destroy_filesystem(fsys))
            .then(() => client.stratis_manager.DestroyPool(pool.path).then(std_reply));
}

function create_fs(pool) {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const forced_options = ["x-systemd.requires=stratis-fstab-setup@" + pool.Uuid + ".service"];
    const managed_fsys_sizes = !pool.Overprovisioning;

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
            SizeSlider("size", _("Size"),
                       {
                           visible: () => managed_fsys_sizes,
                           min: fsys_min_size,
                           max: stats.pool_free,
                           round: 512
                       }),
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
            action: function (vals) {
                return pool.CreateFilesystems([[vals.name, vals.size ? [true, vals.size.toString()] : [false, ""]]])
                        .then(std_reply)
                        .then(result => {
                            if (result[0])
                                return set_mount_options(result[1][0][0], vals, forced_options);
                            else
                                return Promise.resolve();
                        });
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
            init_active_usage_processes(client, usage)
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

function add_disks(pool) {
    const blockdevs = client.stratis_pool_blockdevs[pool.path] || [];

    with_keydesc(client, pool, (keydesc, keydesc_set) => {
        const ask_passphrase = keydesc && !keydesc_set;

        dialog_open({
            Title: _("Add block devices"),
            Fields: [
                SelectOne("tier", _("Tier"),
                          {
                              choices: [
                                  { value: "data", title: _("Data") },
                                  {
                                      value: "cache",
                                      title: _("Cache"),
                                  }
                              ]
                          }),
                PassInput("passphrase", _("Passphrase"),
                          {
                              visible: () => ask_passphrase,
                              validate: val => !val.length && _("Passphrase cannot be empty"),
                          }),
                SelectSpaces("disks", _("Block devices"),
                             {
                                 empty_warning: _("No disks are available."),
                                 validate: function(disks) {
                                     if (disks.length === 0)
                                         return _("At least one disk is needed.");
                                 },
                                 spaces: get_available_spaces(client)
                             })
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

                                if (ask_passphrase) {
                                    return with_stored_passphrase(client, keydesc, vals.passphrase, add);
                                } else
                                    return add();
                            });
                }
            }
        });
    });
}

function make_stratis_filesystem_pages(parent, pool) {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const forced_options = ["x-systemd.requires=stratis-fstab-setup@" + pool.Uuid + ".service"];
    const managed_fsys_sizes = !pool.Overprovisioning;

    filesystems.forEach((fs, i) => make_stratis_filesystem_page(parent, pool, fs,
                                                                stats.fsys_offsets[i],
                                                                forced_options,
                                                                managed_fsys_sizes));
}

export function make_stratis_pool_page(parent, pool) {
    const degraded_ops = pool.AvailableActions && pool.AvailableActions !== "fully_operational";
    const blockdevs = client.stratis_pool_blockdevs[pool.path] || [];
    const can_grow = blockdevs.some(bd => (bd.NewPhysicalSize[0] &&
                                           Number(bd.NewPhysicalSize[1]) > Number(bd.TotalPhysicalSize)));
    const managed_fsys_sizes = !pool.Overprovisioning;
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
        page_size: ((!managed_fsys_sizes && use)
            ? <StorageUsageBar key="s" stats={use} short />
            : Number(pool.TotalPhysicalSize)),
        component: StratisPoolCard,
        props: { pool, degraded_ops, can_grow, managed_fsys_sizes, stats },
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

    const fsys_card = new_card({
        title: _("Stratis filesystems"),
        next: pool_card,
        has_warning: degraded_ops || can_grow,
        component: StratisFilesystemsCard,
        props: { pool, degraded_ops, can_grow, managed_fsys_sizes, stats },
        actions: [
            {
                title: _("Create new filesystem"),
                action: () => create_fs(pool),
                excuse: (managed_fsys_sizes && stats.pool_free < fsys_min_size
                    ? _("Not enough space")
                    : null),
            },
        ],

    });

    const p = new_page(parent, fsys_card);
    make_stratis_filesystem_pages(p, pool);
}

const StratisFilesystemsCard = ({ card, pool, degraded_ops, can_grow, managed_fsys_sizes, stats }) => {
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
            <CardBody className="contains-list">
                <ChildrenTable emptyCaption={_("No filesystems")}
                               aria-label={_("Stratis filesystems pool")}
                               page={card.page} />
            </CardBody>
        </StorageCard>
    );
};

const StratisPoolCard = ({ card, pool, degraded_ops, can_grow, managed_fsys_sizes, stats }) => {
    const key_desc = (pool.Encrypted &&
                      pool.KeyDescription[0] &&
                      pool.KeyDescription[1][1]);
    const can_tang = (pool.Encrypted &&
                      pool.ClevisInfo[0] && // pool has consistent clevis config
                      (!pool.ClevisInfo[1][0] || pool.ClevisInfo[1][1][0] == "tang")); // not bound or bound to "tang"
    const tang_url = can_tang && pool.ClevisInfo[1][0] ? JSON.parse(pool.ClevisInfo[1][1][1]).url : null;

    function add_passphrase() {
        dialog_open({
            Title: _("Add passphrase"),
            Fields: [
                PassInput("passphrase", _("Passphrase"),
                          { validate: val => !val.length && _("Passphrase cannot be empty") }),
                PassInput("passphrase2", _("Confirm"),
                          { validate: (val, vals) => vals.passphrase.length && vals.passphrase != val && _("Passphrases do not match") })
            ],
            Action: {
                Title: _("Save"),
                action: vals => {
                    return get_unused_keydesc(client, pool.Name)
                            .then(keydesc => {
                                return with_stored_passphrase(client, keydesc, vals.passphrase,
                                                              () => pool.BindKeyring(keydesc))
                                        .then(std_reply);
                            });
                }
            }
        });
    }

    function change_passphrase() {
        with_keydesc(client, pool, (keydesc, keydesc_set) => {
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
                    action: vals => {
                        function rebind() {
                            return get_unused_keydesc(client, pool.Name)
                                    .then(new_keydesc => {
                                        return with_stored_passphrase(client, new_keydesc, vals.new_passphrase,
                                                                      () => pool.RebindKeyring(new_keydesc))
                                                .then(std_reply);
                                    });
                        }

                        if (vals.old_passphrase) {
                            return with_stored_passphrase(client, keydesc, vals.old_passphrase, rebind);
                        } else {
                            return rebind();
                        }
                    }
                }
            });
        });
    }

    function remove_passphrase() {
        dialog_open({
            Title: _("Remove passphrase?"),
            Body: <div>
                <p className="slot-warning">{ fmt_to_fragments(_("Passphrase removal may prevent unlocking $0."), <b>{pool.Name}</b>) }</p>
            </div>,
            Action: {
                DangerButton: true,
                Title: _("Remove"),
                action: function (vals) {
                    return pool.UnbindKeyring().then(std_reply);
                }
            }
        });
    }

    function add_tang() {
        return with_keydesc(client, pool, (keydesc, keydesc_set) => {
            dialog_open({
                Title: _("Add Tang keyserver"),
                Fields: [
                    TextInput("tang_url", _("Keyserver address"),
                              {
                                  validate: validate_url
                              }),
                    PassInput("passphrase", _("Pool passphrase"),
                              {
                                  visible: () => !keydesc_set,
                                  validate: val => !val.length && _("Passphrase cannot be empty"),
                                  explanation: _("Adding a keyserver requires unlocking the pool. Please provide the existing pool passphrase.")
                              })
                ],
                Action: {
                    Title: _("Save"),
                    action: function (vals, progress) {
                        return get_tang_adv(vals.tang_url)
                                .then(adv => {
                                    function bind() {
                                        return pool.BindClevis("tang", JSON.stringify({ url: vals.tang_url, adv }))
                                                .then(std_reply);
                                    }
                                    confirm_tang_trust(vals.tang_url, adv,
                                                       () => {
                                                           if (vals.passphrase)
                                                               return with_stored_passphrase(client, keydesc,
                                                                                             vals.passphrase, bind);
                                                           else
                                                               return bind();
                                                       });
                                });
                    }
                }
            });
        });
    }

    function remove_tang() {
        dialog_open({
            Title: _("Remove Tang keyserver?"),
            Body: <div>
                <p>{ fmt_to_fragments(_("Remove $0?"), <b>{tang_url}</b>) }</p>
                <p className="slot-warning">{ fmt_to_fragments(_("Keyserver removal may prevent unlocking $0."), <b>{pool.Name}</b>) }</p>
            </div>,
            Action: {
                DangerButton: true,
                Title: _("Remove"),
                action: function (vals) {
                    return pool.UnbindClevis().then(std_reply);
                }
            }
        });
    }

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
                    { !managed_fsys_sizes && use &&
                    <StorageDescription title={_("Usage")}>
                        <StorageUsageBar stats={use} critical={0.95} />
                    </StorageDescription>
                    }
                    { pool.Encrypted &&
                    <StorageDescription title={_("Passphrase")}>
                        <Flex>
                            { !key_desc
                                ? <FlexItem><StorageLink onClick={add_passphrase}>{_("Add passphrase")}</StorageLink></FlexItem>
                                : <>
                                    <FlexItem><StorageLink onClick={change_passphrase}>{_("Change")}</StorageLink></FlexItem>
                                    <FlexItem>
                                        <StorageLink onClick={remove_passphrase}
                                                       excuse={!tang_url ? _("This passphrase is the only way to unlock the pool and can not be removed.") : null}>
                                            {_("Remove")}
                                        </StorageLink>
                                    </FlexItem>
                                </>
                            }
                        </Flex>
                    </StorageDescription>
                    }
                    { can_tang &&
                    <StorageDescription title={_("Keyserver")}>
                        <Flex>
                            { tang_url == null
                                ? <FlexItem><StorageLink onClick={add_tang}>{_("Add keyserver")}</StorageLink></FlexItem>
                                : <>
                                    <FlexItem>{ tang_url }</FlexItem>
                                    <FlexItem>
                                        <StorageLink onClick={remove_tang}
                                                       excuse={!key_desc ? _("This keyserver is the only way to unlock the pool and can not be removed.") : null}>
                                            {_("Remove")}
                                        </StorageLink>
                                    </FlexItem>
                                </>
                            }
                        </Flex>
                    </StorageDescription>
                    }
                </DescriptionList>
            </CardBody>
            <CardHeader><strong>{_("Block devices")}</strong></CardHeader>
            <CardBody className="contains-list">
                <PageTable emptyCaption={_("No block devices found")}
                           aria-label={_("Stratis block devices")}
                           crossrefs={get_crossrefs(pool)} />
            </CardBody>
        </StorageCard>
    );
};
