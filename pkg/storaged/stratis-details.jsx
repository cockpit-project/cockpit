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

import { Card, CardActions, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { PlusIcon, ExclamationTriangleIcon } from "@patternfly/react-icons";

import { FilesystemTab, mounting_dialog, is_mounted, is_valid_mount_point, get_fstab_config } from "./fsys-tab.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { StdDetailsLayout } from "./details.jsx";
import { StorageButton, StorageBarMenu, StorageMenuItem, StorageUsageBar } from "./storage-controls.jsx";
import { SidePanel } from "./side-panel.jsx";
import {
    dialog_open,
    TextInput, PassInput, SelectOne, SelectSpaces,
    CheckBoxes,
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
import { never_auto_explanation } from "./format-dialog.jsx";

const _ = cockpit.gettext;

function teardown_block(block) {
    return for_each_async(block.Configuration, c => block.RemoveConfigurationItem(c, {}));
}

function destroy_filesystem(client, fsys) {
    const block = client.slashdevs_block[fsys.Devnode];
    const pool = client.stratis_pools[fsys.Pool];

    return teardown_block(block)
            .then(() => {
                return pool.call("DestroyFilesystems", [[fsys.path]])
                        .then(([result, code, message]) => {
                            if (code)
                                return Promise.reject(message);
                        });
            });
}

function destroy_pool(client, pool) {
    return for_each_async(client.stratis_pool_filesystems[pool.path], fsys => destroy_filesystem(client, fsys))
            .then(() => {
                return client.stratis_manager.call("DestroyPool", [pool.path])
                        .then(([result, code, message]) => {
                            if (code)
                                return Promise.reject(message);
                        });
            });
}

function remove_passphrase(client, key_desc) {
    return client.stratis_manager.UnsetKey(key_desc)
            .then((result, code, message) => {
                if (code)
                    return Promise.reject(message);
            })
            .catch(ex => {
                console.warn("Failed to remove passphrase from key ring", ex.toString());
            });
}

const StratisPoolSidebar = ({ client, pool }) => {
    const blockdevs = client.stratis_pool_blockdevs[pool.path] || [];

    function add_disks() {
        if (!pool.Encrypted ||
            !pool.KeyDescription ||
            !pool.KeyDescription[0] ||
            !pool.KeyDescription[1][0]) {
            add_disks_with_keydesc(false);
            return;
        }

        const key_desc = pool.KeyDescription[1][1];
        return client.stratis_list_keys()
                .then(keys => {
                    if (keys.indexOf(key_desc) >= 0)
                        add_disks_with_keydesc(false);
                    else
                        add_disks_with_keydesc(key_desc);
                })
                .catch(ex => {
                    console.warn("Failed fetch properties", ex.toString());
                });
    }

    function add_disks_with_keydesc(key_desc) {
        dialog_open({
            Title: _("Add block devices"),
            Fields: [
                SelectOne("tier", _("Tier"),
                          {
                              choices: [
                                  { value: "data", title: _("Data") },
                                  { value: "cache", title: _("Cache"), disabled: pool.Encrypted }
                              ]
                          }),
                PassInput("passphrase", _("Passphrase"),
                          {
                              visible: () => !!key_desc,
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
                                        return pool.call("AddDataDevs", [devs])
                                                .then(([result, code, message]) => {
                                                    if (code)
                                                        return Promise.reject(message);
                                                });
                                    } else if (vals.tier == "cache") {
                                        const has_cache = blockdevs.some(bd => bd.Tier == 1);
                                        const method = has_cache ? "AddCacheDevs" : "InitCache";
                                        return pool.call(method, [devs])
                                                .then(([result, code, message]) => {
                                                    if (code)
                                                        return Promise.reject(message);
                                                });
                                    }
                                }

                                if (key_desc) {
                                    return client.stratis_store_passphrase(key_desc, vals.passphrase)
                                            .then(add)
                                            .catch(ex => {
                                                return remove_passphrase(client, key_desc)
                                                        .then(() => Promise.reject(ex));
                                            })
                                            .then(() => {
                                                return remove_passphrase(client, key_desc);
                                            });
                                } else
                                    return add();
                            });
                }
            }
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

export const StratisPoolDetails = ({ client, pool }) => {
    const filesystems = client.stratis_pool_filesystems[pool.path];

    const forced_options = ["x-systemd.requires=stratis-fstab-setup@" + pool.Uuid + ".service"];

    function delete_() {
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

    function rename() {
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
                    return pool.SetName(vals.name)
                            .then((result, code, message) => {
                                if (code)
                                    return Promise.reject(message);
                            });
                }
            }
        });
    }

    function set_mount_options(path, vals) {
        let mount_options = [];

        if (!vals.mount_options.auto || vals.mount_options.never_auto)
            mount_options.push("noauto");
        if (vals.mount_options.ro)
            mount_options.push("ro");
        if (vals.mount_options.never_auto)
            mount_options.push("x-cockpit-never-auto");
        if (vals.mount_options.extra)
            mount_options.push(vals.mount_options.extra);

        mount_options = mount_options.concat(forced_options);

        let mount_point = vals.mount_point;
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
                                                        if (vals.mount_options.auto)
                                                            return client.mount_at(block, mount_point);
                                                        else
                                                            return Promise.resolve();
                                                    });
                                        });
                            });
                });
    }

    function validate_fs_name(fsys, name) {
        if (name == "")
            return _("Name can not be empty.");
        if (!fsys || name != fsys.Name) {
            for (const fs of filesystems) {
                if (fs.Name == name)
                    return _("A filesystem with this name exists already in this pool.");
            }
        }
    }

    function create_fs() {
        dialog_open({
            Title: _("Create filesystem"),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              validate: name => validate_fs_name(null, name)
                          }),
                TextInput("mount_point", _("Mount point"),
                          {
                              validate: val => is_valid_mount_point(client, null, val)
                          }),
                CheckBoxes("mount_options", _("Mount options"),
                           {
                               value: {
                                   auto: true,
                                   ro: false,
                                   never_auto: false,
                                   extra: false
                               },
                               fields: [
                                   { title: _("Mount now"), tag: "auto" },
                                   { title: _("Mount read only"), tag: "ro" },
                                   {
                                       title: _("Never mount at boot"),
                                       tag: "never_auto",
                                       tooltip: never_auto_explanation,
                                   },
                                   { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                               ]
                           }),
            ],
            Action: {
                Title: _("Create"),
                action: function (vals) {
                    return client.stratis_create_filesystem(pool, vals.name)
                            .then((result, code, message) => {
                                if (code)
                                    return Promise.reject(message);

                                if (result[0])
                                    return set_mount_options(result[1][0][0], vals);
                                else
                                    return Promise.resolve();
                            });
                }
            }
        });
    }

    const use = pool.TotalPhysicalUsed[0] && [Number(pool.TotalPhysicalUsed[1]), Number(pool.TotalPhysicalSize)];

    const header = (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Text component={TextVariants.h2}>
                        {fmt_to_fragments((pool.Encrypted ? _("Encrypted Stratis pool $0") : _("Stratis pool $0")), <b>{pool.Name}</b>)}
                    </Text>
                </CardTitle>
                <CardActions>
                    <StorageButton onClick={rename}>{_("Rename")}</StorageButton>
                    <StorageButton kind="danger" onClick={delete_}>{_("Delete")}</StorageButton>
                </CardActions>
            </CardHeader>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">{_("storage", "UUID")}</DescriptionListTerm>
                        <DescriptionListDescription>{ pool.Uuid }</DescriptionListDescription>
                    </DescriptionListGroup>
                    { use &&
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">{_("storage", "Usage")}</DescriptionListTerm>
                        <DescriptionListDescription className="pf-u-align-self-center">
                            <StorageUsageBar stats={use} critical={0.95} />
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                </DescriptionList>
            </CardBody>
        </Card>
    );

    const sidebar = <StratisPoolSidebar client={client} pool={pool} />;

    function render_fsys(fsys, offset, total) {
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
                                  validate: name => validate_fs_name(fsys, name)
                              })
                ],
                Action: {
                    Title: _("Rename"),
                    action: function (vals) {
                        return fsys.SetName(vals.name)
                                .then((result, code, message) => {
                                    if (code)
                                        return Promise.reject(message);
                                });
                    }
                }
            });
        }

        function snapshot_fsys() {
            dialog_open({
                Title: cockpit.format(_("Create a snapshot of filesystem $0"), fsys.Name),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                                  value: "",
                                  validate: name => validate_fs_name(null, name)
                              }),
                    TextInput("mount_point", _("Mount point"),
                              {
                                  validate: val => is_valid_mount_point(client, null, val)
                              }),
                    CheckBoxes("mount_options", _("Mount options"),
                               {
                                   value: {
                                       auto: true,
                                       ro: false,
                                       never_auto: false,
                                       extra: false
                                   },
                                   fields: [
                                       { title: _("Mount now"), tag: "auto" },
                                       { title: _("Mount read only"), tag: "ro" },
                                       {
                                           title: _("Never mount at boot"),
                                           tag: "never_auto",
                                           tooltip: never_auto_explanation,
                                       },
                                       { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                                   ]
                               })
                ],
                Action: {
                    Title: _("Create snapshot"),
                    action: function (vals) {
                        return pool.SnapshotFilesystem(fsys.path, vals.name)
                                .then((result, code, message) => {
                                    if (code)
                                        return Promise.reject(message);

                                    if (result[0])
                                        return set_mount_options(result[1], vals);
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
        menuitems.push(<StorageMenuItem key="del" onClick={delete_fsys}>{_("Delete")}</StorageMenuItem>);

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
                title: <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])),
                    Number(pool.TotalPhysicalSize)]}
                                        critical={1} total={total} offset={offset} />,
                props: { className: "ct-text-align-right" }
            },
            {
                title: <>{actions}<StorageBarMenu key="menu" menuItems={menuitems} isKebab /></>,
                props: { className: "pf-c-table__action content-action" }
            }
        ];

        return {
            props: { key: fsys.Name },
            columns: cols,
            expandedContent: <ListingPanel tabRenderers={tabs} />
        };
    }

    const offsets = [];
    let total = 0;
    filesystems.forEach(fs => {
        offsets.push(total);
        total += fs.Used[0] ? Number(fs.Used[1]) : 0;
    });

    const rows = filesystems.map((fs, i) => render_fsys(fs, offsets[i], total));

    const content = (
        <Card>
            <CardHeader>
                <CardTitle><Text component={TextVariants.h2}>{_("Filesystems")}</Text></CardTitle>
                <CardActions>
                    <StorageButton onClick={create_fs}>{_("Create new filesystem")}</StorageButton>
                </CardActions>
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
                             header={header}
                             sidebar={sidebar}
                             content={content} />;
};

export function unlock_pool(client, uuid, show_devs) {
    const manager = client.stratis_manager;
    const locked_props = manager.LockedPools[uuid];
    const devs = locked_props.devs.v.map(d => d.devnode).sort();

    if (!locked_props.key_description ||
        locked_props.key_description.t != "(bv)" ||
        !locked_props.key_description.v[0] ||
        locked_props.key_description.v[1].t != "(bs)" ||
        !locked_props.key_description.v[1].v[0]) {
        dialog_open({
            Title: _("Error"),
            Body: _("This pool can not be unlocked here because its key description is not in the expected format.")
        });
        return;
    }

    const key_desc = locked_props.key_description.v[1].v[1];

    function unlock() {
        return client.stratis_unlock_pool(uuid)
                .then((result, code, message) => {
                    if (code)
                        return Promise.reject(message);
                });
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
                    return client.stratis_store_passphrase(key_desc, vals.passphrase)
                            .then(unlock)
                            .catch(ex => {
                                return remove_passphrase(client, key_desc)
                                        .then(() => Promise.reject(ex));
                            })
                            .then(() => {
                                return remove_passphrase(client, key_desc);
                            });
                }
            }
        });
    }

    return manager.client.call(manager.path, "org.storage.stratis2.FetchProperties.r2", "GetProperties", [["KeyList"]])
            .catch(() => [{ }])
            .then(([result]) => {
                let keys = [];
                if (result.KeyList && result.KeyList[0])
                    keys = result.KeyList[1].v;
                if (keys.indexOf(key_desc) >= 0)
                    return unlock();
                else
                    unlock_with_keydesc(key_desc);
            });
}

const StratisLockedPoolSidebar = ({ client, uuid }) => {
    const locked_props = client.stratis_manager.LockedPools[uuid];
    const devs = locked_props.devs.v.map(d => d.devnode).sort();

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

export const StratisLockedPoolDetails = ({ client, uuid }) => {
    function unlock() {
        return unlock_pool(client, uuid);
    }

    const header = (
        <Card>
            <CardHeader>
                <CardTitle><Text component={TextVariants.h2}>{_("Locked encrypted Stratis pool")}</Text></CardTitle>
                <CardActions>
                    <StorageButton kind="primary" onClick={unlock}>{_("Unlock")}</StorageButton>
                </CardActions>
            </CardHeader>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("storage", "UUID")}</DescriptionListTerm>
                        <DescriptionListDescription>{ uuid }</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </CardBody>
        </Card>
    );

    const content = (
        <Card>
            <CardHeader>
                <CardTitle><Text component={TextVariants.h2}>{_("Filesystems")}</Text></CardTitle>
            </CardHeader>
            <CardBody className="contains-list">
                <ListingTable emptyCaption={_("Unlock pool to see filesystems.")}
                              aria-label={_("Filesystems")}
                              columns={[_("Name"), _("Used for"), _("Size")]}
                              showHeader={false}
                              rows={[]} />
            </CardBody>
        </Card>);

    return <StdDetailsLayout client={client}
                             header={header}
                             sidebar={<StratisLockedPoolSidebar client={client} uuid={uuid} />}
                             content={content} />;
};
