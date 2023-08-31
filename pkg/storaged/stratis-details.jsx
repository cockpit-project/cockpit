/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { PlusIcon, ExclamationTriangleIcon } from "@patternfly/react-icons";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";

import { FilesystemTab, mounting_dialog, is_mounted, is_valid_mount_point, get_fstab_config } from "./fsys-tab.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { StdDetailsLayout } from "./details.jsx";
import { StorageButton, StorageLink, StorageBarMenu, StorageMenuItem, StorageUsageBar } from "./storage-controls.jsx";
import { SidePanel } from "./side-panel.jsx";
import {
    dialog_open,
    TextInput, PassInput, SelectOne, SelectSpaces,
    CheckBoxes, SizeSlider,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "./dialog.jsx";

import {
    fmt_size,
    encode_filename, decode_filename,
    get_active_usage, teardown_active_usage,
    get_available_spaces, prepare_available_spaces,
    reload_systemd, for_each_async
} from "./utils.js";
import { fmt_to_fragments } from "utils.jsx";
import { mount_explanation } from "./format-dialog.jsx";
import { validate_url, get_tang_adv } from "./crypto-keyslots.jsx";

import { std_reply, with_keydesc, with_stored_passphrase, confirm_tang_trust, get_unused_keydesc } from "./stratis-utils.js";

const _ = cockpit.gettext;

const fsys_min_size = 512 * 1024 * 1024;

export function check_stratis_warnings(client, enter_warning) {
    if (!client.features.stratis_grow_blockdevs)
        return;

    for (const p in client.stratis_pools) {
        const blockdevs = client.stratis_pool_blockdevs[p] || [];
        const pool = client.stratis_pools[p];
        if (blockdevs.some(bd => bd.NewPhysicalSize[0] && Number(bd.NewPhysicalSize[1]) > Number(bd.TotalPhysicalSize)))
            enter_warning(p, { warning: "unused-blockdevs" });
        if (pool.AvailableActions && pool.AvailableActions !== "fully_operational")
            enter_warning(p, { warning: "not-fully-operational" });
    }
}

function teardown_block(block) {
    return for_each_async(block.Configuration, c => block.RemoveConfigurationItem(c, {}));
}

function destroy_filesystem(client, fsys) {
    const block = client.slashdevs_block[fsys.Devnode];
    const pool = client.stratis_pools[fsys.Pool];

    return teardown_block(block).then(() => pool.DestroyFilesystems([fsys.path]).then(std_reply));
}

function destroy_pool(client, pool) {
    return for_each_async(client.stratis_pool_filesystems[pool.path], fsys => destroy_filesystem(client, fsys))
            .then(() => client.stratis_manager.DestroyPool(pool.path).then(std_reply));
}

function validate_fs_name(fsys, name, filesystems) {
    if (name == "")
        return _("Name can not be empty.");
    if (!fsys || name != fsys.Name) {
        for (const fs of filesystems) {
            if (fs.Name == name)
                return _("A filesystem with this name exists already in this pool.");
        }
    }
}

function set_mount_options(client, path, vals, forced_options) {
    let mount_options = [];

    if (vals.variant == "nomount" || vals.at_boot == "never")
        mount_options.push("noauto");
    if (vals.mount_options.ro)
        mount_options.push("ro");
    if (vals.at_boot == "never")
        mount_options.push("x-cockpit-never-auto");
    if (vals.at_boot == "nofail")
        mount_options.push("nofail");
    if (vals.at_boot == "netdev")
        mount_options.push("_netdev");
    if (vals.mount_options.extra)
        mount_options.push(vals.mount_options.extra);

    mount_options = mount_options.concat(forced_options);

    let mount_point = vals.mount_point;
    if (mount_point == "")
        return Promise.resolve();
    if (mount_point[0] != "/")
        mount_point = "/" + mount_point;

    const config =
          ["fstab",
              {
                  dir: { t: 'ay', v: encode_filename(mount_point) },
                  type: { t: 'ay', v: encode_filename("auto") },
                  opts: { t: 'ay', v: encode_filename(mount_options.join(",") || "defaults") },
                  freq: { t: 'i', v: 0 },
                  passno: { t: 'i', v: 0 },
              }
          ];

    function udisks_block_for_stratis_fsys() {
        const fsys = client.stratis_filesystems[path];
        return fsys && client.slashdevs_block[fsys.Devnode];
    }

    return client.wait_for(udisks_block_for_stratis_fsys)
            .then(block => {
            // HACK - need a explicit "change" event
                return block.Rescan({})
                        .then(() => {
                            return client.wait_for(() => client.blocks_fsys[block.path])
                                    .then(fsys => {
                                        return block.AddConfigurationItem(config, {})
                                                .then(reload_systemd)
                                                .then(() => {
                                                    if (vals.variant != "nomount")
                                                        return client.mount_at(block, mount_point);
                                                    else
                                                        return Promise.resolve();
                                                });
                                    });
                        });
            });
}

const StratisPoolSidebar = ({ client, pool }) => {
    const blockdevs = client.stratis_pool_blockdevs[pool.path] || [];

    function add_disks() {
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
                                          disabled: pool.Encrypted && !client.features.stratis_encrypted_caches
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

    function render_blockdev(blockdev) {
        const block = client.slashdevs_block[blockdev.PhysicalPath];
        let desc;

        if (!block)
            return null;

        if (blockdev.Tier == 0)
            desc = cockpit.format(_("$0 data"),
                                  fmt_size(Number(blockdev.TotalPhysicalSize)));
        else if (blockdev.Tier == 1)
            desc = cockpit.format(_("$0 cache"),
                                  fmt_size(Number(blockdev.TotalPhysicalSize)));
        else
            desc = cockpit.format(_("$0 of unknown tier"),
                                  fmt_size(Number(blockdev.TotalPhysicalSize)));

        return { client, block, detail: desc, key: blockdev.path };
    }

    const actions = (
        <StorageButton onClick={add_disks}>
            <PlusIcon />
        </StorageButton>);

    return (
        <SidePanel title={_("Block devices")}
                       actions={actions}
                       client={client}
                       rows={blockdevs.map(render_blockdev)} />
    );
};

export function validate_pool_name(client, pool, name) {
    if (name == "")
        return _("Name can not be empty.");
    if ((!pool || name != pool.Name) && client.stratis_poolnames_pool[name])
        return _("A pool with this name exists already.");
}

export function stratis_content_rows(client, pool, options) {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const forced_options = ["x-systemd.requires=stratis-fstab-setup@" + pool.Uuid + ".service"];
    const managed_fsys_sizes = client.features.stratis_managed_fsys_sizes && !pool.Overprovisioning;

    function render_fsys(fsys, offset) {
        const block = client.slashdevs_block[fsys.Devnode];

        if (!block) {
            return {
                props: { key: fsys.Name },
                columns: [{ title: fsys.Name }]
            };
        }

        const [, mount_point] = get_fstab_config(block);
        const fs_is_mounted = is_mounted(client, block);

        function mount() {
            return mounting_dialog(client, block, "mount", forced_options);
        }

        function unmount() {
            return mounting_dialog(client, block, "unmount", forced_options);
        }

        function rename_fsys() {
            dialog_open({
                Title: _("Rename filesystem"),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                                  value: fsys.Name,
                                  validate: name => validate_fs_name(fsys, name, filesystems)
                              })
                ],
                Action: {
                    Title: _("Rename"),
                    action: function (vals) {
                        return fsys.SetName(vals.name).then(std_reply);
                    }
                }
            });
        }

        function snapshot_fsys() {
            if (managed_fsys_sizes && stats.pool_free < Number(fsys.Size)) {
                dialog_open({
                    Title: _("Not enough space"),
                    Body: cockpit.format(_("There is not enough space in the pool to make a snapshot of this filesystem. At least $0 are required but only $1 are available."),
                                         fmt_size(Number(fsys.Size)), fmt_size(stats.pool_free))
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Create a snapshot of filesystem $0"), fsys.Name),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                                  value: "",
                                  validate: name => validate_fs_name(null, name, filesystems)
                              }),
                    TextInput("mount_point", _("Mount point"),
                              {
                                  validate: (val, values, variant) => {
                                      return is_valid_mount_point(client, null, val, variant == "nomount");
                                  }
                              }),
                    CheckBoxes("mount_options", _("Mount options"),
                               {
                                   value: {
                                       ro: false,
                                       extra: false
                                   },
                                   fields: [
                                       { title: _("Mount read only"), tag: "ro" },
                                       { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                                   ]
                               }),
                    SelectOne("at_boot", _("At boot"),
                              {
                                  value: "nofail",
                                  explanation: mount_explanation.nofail,
                                  choices: [
                                      {
                                          value: "local",
                                          title: _("Mount before services start"),
                                      },
                                      {
                                          value: "nofail",
                                          title: _("Mount without waiting, ignore failure"),
                                      },
                                      {
                                          value: "netdev",
                                          title: _("Mount after network becomes available, ignore failure"),
                                      },
                                      {
                                          value: "never",
                                          title: _("Do not mount"),
                                      },
                                  ]
                              }),
                ],
                update: function (dlg, vals, trigger) {
                    if (trigger == "at_boot")
                        dlg.set_options("at_boot", { explanation: mount_explanation[vals.at_boot] });
                },
                Action: {
                    Title: _("Create snapshot and mount"),
                    Variants: [{ tag: "nomount", Title: _("Create snapshot only") }],
                    action: function (vals) {
                        return pool.SnapshotFilesystem(fsys.path, vals.name)
                                .then(std_reply)
                                .then(result => {
                                    if (result[0])
                                        return set_mount_options(client, result[1], vals, forced_options);
                                    else
                                        return Promise.resolve();
                                });
                    }
                }
            });
        }

        function delete_fsys() {
            const usage = get_active_usage(client, block.path, _("delete"));

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in use"),
                                          fsys.Name),
                    Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Confirm deletion of $0"), fsys.Name),
                Teardown: TeardownMessage(usage),
                Action: {
                    Danger: _("Deleting a filesystem will delete all data in it."),
                    Title: _("Delete"),
                    action: function () {
                        return teardown_active_usage(client, usage)
                                .then(() => destroy_filesystem(client, fsys));
                    }
                },
                Inits: [
                    init_active_usage_processes(client, usage)
                ]
            });
        }

        const associated_warnings = ["mismounted-fsys"];
        const warnings = client.path_warnings[block.path] || [];
        const tab_warnings = warnings.filter(w => associated_warnings.indexOf(w.warning) >= 0);
        const name = _("Filesystem");
        let info = null;

        if (tab_warnings.length > 0)
            info = <>{info}<ExclamationTriangleIcon className="ct-icon-exclamation-triangle" /></>;
        if (info)
            info = <>{"\n"}{info}</>;

        const tabs = [
            {
                name,
                renderer: FilesystemTab,
                data: {
                    client,
                    block,
                    warnings: tab_warnings,
                    forced_options
                }
            }
        ];

        const actions = [];
        const menuitems = [];

        if (!fs_is_mounted) {
            actions.push(<StorageButton onlyWide key="mount" onClick={mount}>{_("Mount")}</StorageButton>);
            menuitems.push(<StorageMenuItem onlyNarrow key="mount" onClick={mount}>{_("Mount")}</StorageMenuItem>);
        }

        if (fs_is_mounted)
            menuitems.push(<StorageMenuItem key="unmount" onClick={unmount}>{_("Unmount")}</StorageMenuItem>);
        menuitems.push(<StorageMenuItem key="rename" onClick={rename_fsys}>{_("Rename")}</StorageMenuItem>);
        menuitems.push(<StorageMenuItem key="snapshot" onClick={snapshot_fsys}>{_("Snapshot")}</StorageMenuItem>);
        menuitems.push(<StorageMenuItem key="del" onClick={delete_fsys} danger>{_("Delete")}</StorageMenuItem>);

        const cols = [
            {
                title: (
                    <span>
                        {fsys.Name}
                        {info}
                    </span>)
            },
            {
                title: mount_point
            },
            {
                title: (!managed_fsys_sizes
                    ? <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), stats.pool_total]}
                                           critical={1} total={stats.fsys_total_used} offset={offset} />
                    : <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), Number(fsys.Size)]}
                                           critical={0.95} />
                ),
                props: { className: "pf-v5-u-text-align-right" }
            },
            {
                title: <>{actions}<StorageBarMenu key="menu" menuItems={menuitems} isKebab /></>,
                props: { className: "pf-v5-c-table__action content-action" }
            }
        ];

        return {
            props: { key: fsys.Name },
            columns: cols,
            expandedContent: <ListingPanel tabRenderers={tabs} />
        };
    }

    return filesystems.map((fs, i) => render_fsys(fs, stats.fsys_offsets[i]));
}

function create_fs(client, pool) {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const forced_options = ["x-systemd.requires=stratis-fstab-setup@" + pool.Uuid + ".service"];
    const managed_fsys_sizes = client.features.stratis_managed_fsys_sizes && !pool.Overprovisioning;

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
                              return is_valid_mount_point(client, null, val, variant == "nomount");
                          }
                      }),
            CheckBoxes("mount_options", _("Mount options"),
                       {
                           value: {
                               ro: false,
                               extra: false
                           },
                           fields: [
                               { title: _("Mount read only"), tag: "ro" },
                               { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                           ]
                       }),
            SelectOne("at_boot", _("At boot"),
                      {
                          value: "nofail",
                          explanation: mount_explanation.nofail,
                          choices: [
                              {
                                  value: "local",
                                  title: _("Mount before services start"),
                              },
                              {
                                  value: "nofail",
                                  title: _("Mount without waiting, ignore failure"),
                              },
                              {
                                  value: "netdev",
                                  title: _("Mount after network becomes available, ignore failure"),
                              },
                              {
                                  value: "never",
                                  title: _("Do not mount"),
                              },
                          ]
                      }),
        ],
        update: function (dlg, vals, trigger) {
            if (trigger == "at_boot")
                dlg.set_options("at_boot", { explanation: mount_explanation[vals.at_boot] });
        },
        Action: {
            Title: _("Create and mount"),
            Variants: [{ tag: "nomount", Title: _("Create only") }],
            action: function (vals) {
                return client.stratis_create_filesystem(pool, vals.name, vals.size)
                        .then(std_reply)
                        .then(result => {
                            if (result[0])
                                return set_mount_options(client, result[1][0][0], vals, forced_options);
                            else
                                return Promise.resolve();
                        });
            }
        }
    });
}

function delete_pool(client, pool) {
    const location = cockpit.location;
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
            action: function () {
                return teardown_active_usage(client, usage)
                        .then(() => destroy_pool(client, pool))
                        .then(() => {
                            location.go('/');
                        });
            }
        },
        Inits: [
            init_active_usage_processes(client, usage)
        ]
    });
}

function rename_pool(client, pool) {
    dialog_open({
        Title: _("Rename Stratis pool"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: pool.Name,
                          validate: name => validate_pool_name(client, pool, name)
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

export const StratisPoolDetails = ({ client, pool }) => {
    const key_desc = (pool.Encrypted &&
                      pool.KeyDescription[0] &&
                      pool.KeyDescription[1][1]);
    const can_tang = (client.features.stratis_crypto_binding &&
                      pool.Encrypted &&
                      pool.ClevisInfo[0] && // pool has consistent clevis config
                      (!pool.ClevisInfo[1][0] || pool.ClevisInfo[1][1][0] == "tang")); // not bound or bound to "tang"
    const tang_url = can_tang && pool.ClevisInfo[1][0] ? JSON.parse(pool.ClevisInfo[1][1][1]).url : null;
    const blockdevs = client.stratis_pool_blockdevs[pool.path] || [];
    const managed_fsys_sizes = client.features.stratis_managed_fsys_sizes && !pool.Overprovisioning;
    const stats = client.stratis_pool_stats[pool.path];

    function grow_blockdevs() {
        return for_each_async(blockdevs, bd => pool.GrowPhysicalDevice(bd.Uuid));
    }

    const alerts = [];
    if (client.features.stratis_grow_blockdevs &&
        blockdevs.some(bd => bd.NewPhysicalSize[0] && Number(bd.NewPhysicalSize[1]) > Number(bd.TotalPhysicalSize))) {
        alerts.push(<Alert key="unused-space"
                           isInline
                           variant="warning"
                           title={_("This pool does not use all the space on its block devices.")}>
            {_("Some block devices of this pool have grown in size after the pool was created. The pool can be safely grown to use the newly available space.")}
            <div className="storage_alert_action_buttons">
                <StorageButton onClick={grow_blockdevs}>{_("Grow the pool to take all space")}</StorageButton>
            </div>
        </Alert>);
    }

    if (pool.AvailableActions && pool.AvailableActions !== "fully_operational") {
        const goToStratisLogs = () => cockpit.jump("/system/logs/#/?prio=warn&_SYSTEMD_UNIT=stratisd.service");
        alerts.push(<Alert key="degraded"
                           isInline
                           variant="warning"
                           title={_("This pool is in a degraded state.")}>
            <div className="storage_alert_action_buttons">
                <Button variant="link" isInline onClick={goToStratisLogs}>{_("View logs")}</Button>
            </div>
        </Alert>);
    }

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

    const header = (
        <Card>
            <CardHeader actions={{
                actions: (
                    <>
                        <StorageButton onClick={() => rename_pool(client, pool)}>{_("Rename")}</StorageButton>
                        <StorageButton kind="danger" onClick={() => delete_pool(client, pool)}>{_("Delete")}</StorageButton>
                    </>
                ),
            }}>
                <CardTitle component="h2">
                    {fmt_to_fragments((pool.Encrypted ? _("Encrypted Stratis pool $0") : _("Stratis pool $0")), <b>{pool.Name}</b>)}
                </CardTitle>
            </CardHeader>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">{_("storage", "UUID")}</DescriptionListTerm>
                        <DescriptionListDescription>{ pool.Uuid }</DescriptionListDescription>
                    </DescriptionListGroup>
                    { !managed_fsys_sizes && use &&
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">{_("storage", "Usage")}</DescriptionListTerm>
                        <DescriptionListDescription className="pf-v5-u-align-self-center">
                            <StorageUsageBar stats={use} critical={0.95} />
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                    { pool.Encrypted && client.features.stratis_crypto_binding &&
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">
                            {_("storage", "Passphrase")}
                        </DescriptionListTerm>
                        <DescriptionListDescription>
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
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                    { can_tang &&
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">
                            {_("storage", "Keyserver")}
                        </DescriptionListTerm>
                        <DescriptionListDescription>
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
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                </DescriptionList>
            </CardBody>
        </Card>
    );

    const sidebar = <StratisPoolSidebar client={client} pool={pool} />;
    const rows = stratis_content_rows(client, pool, {});

    const content = (
        <Card>
            <CardHeader actions={{
                actions: <StorageButton onClick={() => create_fs(client, pool)}
                                        excuse={managed_fsys_sizes && stats.pool_free < fsys_min_size ? _("Not enough space for new filesystems") : null}>
                    {_("Create new filesystem")}
                </StorageButton>
            }}>
                <CardTitle component="h2">{_("Filesystems")}</CardTitle>

            </CardHeader>
            <CardBody className="contains-list">
                <ListingTable emptyCaption={_("No filesystems")}
                              aria-label={_("Filesystems")}
                              columns={[_("Name"), _("Used for"), _("Size")]}
                              showHeader={false}
                              rows={rows.filter(row => !!row)} />
            </CardBody>
        </Card>);

    return <StdDetailsLayout client={client}
                             alerts={alerts}
                             header={header}
                             sidebar={sidebar}
                             content={content} />;
};

export function start_pool(client, uuid, show_devs) {
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

const StratisStoppedPoolSidebar = ({ client, uuid }) => {
    const devs = client.stratis_manager.StoppedPools[uuid].devs.v.map(d => d.devnode).sort();

    function render_dev(dev) {
        const block = client.slashdevs_block[dev];

        if (!block)
            return null;

        return { client, block, key: dev };
    }

    return (
        <SidePanel title={_("Block devices")}
                   client={client}
                   rows={devs.map(render_dev)} />
    );
};

export const StratisStoppedPoolDetails = ({ client, uuid }) => {
    const key_desc = client.stratis_stopped_pool_key_description[uuid];
    const clevis_info = client.stratis_stopped_pool_clevis_info[uuid];

    const encrypted = key_desc || clevis_info;
    const can_tang = encrypted && (!clevis_info || clevis_info[0] == "tang");
    const tang_url = (can_tang && clevis_info) ? JSON.parse(clevis_info[1]).url : null;

    function start() {
        return start_pool(client, uuid);
    }

    const actions = <StorageButton kind="primary" spinner onClick={start}>{_("Start")}</StorageButton>;
    const header = (
        <Card>
            <CardHeader actions={{ actions }}>
                <CardTitle component="h2">{_("Stopped Stratis pool")}</CardTitle>
            </CardHeader>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("storage", "UUID")}</DescriptionListTerm>
                        <DescriptionListDescription>{ uuid }</DescriptionListDescription>
                    </DescriptionListGroup>
                    { encrypted && client.features.stratis_crypto_binding &&
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">
                            {_("storage", "Passphrase")}
                        </DescriptionListTerm>
                        <DescriptionListDescription>
                            { key_desc ? cockpit.format(_("using key description $0"), key_desc) : _("none") }
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                    { can_tang && client.features.stratis_crypto_binding &&
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">
                            {_("storage", "Keyserver")}
                        </DescriptionListTerm>
                        <DescriptionListDescription>
                            { tang_url || _("none") }
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                </DescriptionList>
            </CardBody>
        </Card>
    );

    const content = (
        <Card>
            <CardHeader>
                <CardTitle component="h2">{_("Filesystems")}</CardTitle>
            </CardHeader>
            <CardBody className="contains-list">
                <ListingTable emptyCaption={_("Start pool to see filesystems.")}
                              aria-label={_("Filesystems")}
                              columns={[_("Name"), _("Used for"), _("Size")]}
                              showHeader={false}
                              rows={[]} />
            </CardBody>
        </Card>);

    return <StdDetailsLayout client={client}
                             header={header}
                             sidebar={<StratisStoppedPoolSidebar client={client} uuid={uuid} />}
                             content={content} />;
};
