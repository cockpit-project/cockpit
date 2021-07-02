/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import { Card, CardBody, CardTitle, CardHeader, CardActions, Text, TextVariants } from "@patternfly/react-core";
import { PlusIcon } from "@patternfly/react-icons";

import { FilesystemTab, mounting_dialog, is_mounted, is_valid_mount_point } from "./fsys-tab.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { StdDetailsLayout } from "./details.jsx";
import { StorageButton, StorageLink, StorageBarMenu, StorageMenuItem, StorageUsageBar } from "./storage-controls.jsx";
import { SidePanel, SidePanelBlockRow } from "./side-panel.jsx";
import {
    dialog_open,
    TextInput, PassInput, SelectOne, SelectSpaces,
    CheckBoxes,
    BlockingMessage, TeardownMessage
} from "./dialog.jsx";

import {
    fmt_size,
    encode_filename, decode_filename,
    get_active_usage, teardown_active_usage,
    get_available_spaces, prepare_available_spaces,
    reload_systemd
} from "./utils.js";
import { fmt_to_fragments } from "./utilsx.jsx";

const _ = cockpit.gettext;

function teardown_block(block) {
    return Promise.all(block.Configuration.map(c => block.RemoveConfigurationItem(c, {})));
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
    return Promise.all(client.stratis_pool_filesystems[pool.path].map(fsys => destroy_filesystem(client, fsys)))
            .then(() => {
                return client.stratis_manager.call("DestroyPool", [pool.path])
                        .then(([result, code, message]) => {
                            if (code)
                                return Promise.reject(message);
                        });
            });
}

function store_passphrase(desc, passphrase) {
    return cockpit.spawn(["stratis", "key", "set", desc, "--keyfile-path", "/dev/stdin"], { superuser: true })
            .input(passphrase);
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

class StratisPoolSidebar extends React.Component {
    render() {
        var { client, pool } = this.props;
        var blockdevs = client.stratis_pool_blockdevs[pool.path] || [];

        function add_disks() {
            if (!pool.Encrypted || !pool.data.KeyDescription || !pool.data.KeyDescription[0]) {
                add_disks_with_keydesc(false);
                return;
            }

            const key_desc = pool.data.KeyDescription[1];
            const manager = client.stratis_manager;
            return manager.client.call(manager.path, "org.storage.stratis2.FetchProperties.r2", "GetProperties", [["KeyList"]])
                    .catch(() => [{ }])
                    .then(([result]) => {
                        let keys = [];
                        if (result.KeyList && result.KeyList[0])
                            keys = result.KeyList[1].v;
                        if (keys.indexOf(key_desc) >= 0)
                            add_disks_with_keydesc(false);
                        else
                            add_disks_with_keydesc(key_desc);
                    });
        }

        function add_disks_with_keydesc(key_desc) {
            dialog_open({
                Title: _("Add Disks"),
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
                                  visible: () => !!key_desc
                              }),
                    SelectSpaces("disks", _("Disks"),
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
                                            return pool.call("AddCacheDevs", [devs])
                                                    .then(([result, code, message]) => {
                                                        if (code)
                                                            return Promise.reject(message);
                                                    });
                                        }
                                    }

                                    if (key_desc) {
                                        return store_passphrase(key_desc, vals.passphrase)
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
                                      fmt_size(blockdev.data.TotalPhysicalSize));
            else if (blockdev.Tier == 1)
                desc = cockpit.format(_("$0 cache"),
                                      fmt_size(blockdev.data.TotalPhysicalSize));
            else
                desc = cockpit.format(_("$0 of unknown tier"),
                                      fmt_size(blockdev.data.TotalPhysicalSize));

            return (
                <SidePanelBlockRow client={client}
                                   block={block}
                                   detail={desc}
                                   key={blockdev.path} />);
        }

        const actions = (
            <StorageButton onClick={add_disks}>
                <PlusIcon />
            </StorageButton>);

        return (
            <SidePanel title={_("Blockdevs")}
                       actions={actions}
                       client={client}>
                { blockdevs.map(render_blockdev) }
            </SidePanel>
        );
    }
}

export class StratisPoolDetails extends React.Component {
    render() {
        var client = this.props.client;
        var pool = this.props.pool;

        function delete_() {
            var location = cockpit.location;
            var usage = get_active_usage(client, pool.path);

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in active use"),
                                          pool.Name),
                    Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Please confirm deletion of $0"), pool.Name),
                Footer: TeardownMessage(usage),
                Action: {
                    Danger: _("Deleting a Stratis pool will erase all data on it."),
                    Title: _("Delete"),
                    action: function () {
                        return teardown_active_usage(client, usage)
                                .then(() => destroy_pool(client, pool))
                                .then(() => {
                                    location.go('/');
                                });
                    }
                }
            });
        }

        function rename() {
            var location = cockpit.location;

            dialog_open({
                Title: _("Rename Stratis Pool"),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                                  value: pool.Name,
                                  validate: function (name) {
                                      if (name == "")
                                          return _("Name can not be empty.");
                                  }
                              })
                ],
                Action: {
                    Title: _("Rename"),
                    action: function (vals) {
                        return pool.SetName(vals.name)
                                .then((result, code, message) => {
                                    if (code)
                                        return Promise.reject(message);
                                    location.go('/');
                                });
                    }
                }
            });
        }

        function set_mount_options(path, vals) {
            const mount_options = [];

            if (!vals.mount_options.auto || pool.Encrypted)
                mount_options.push("noauto");
            if (vals.mount_options.ro)
                mount_options.push("ro");
            if (vals.mount_options.extra)
                mount_options.push(vals.mount_options.extra);

            mount_options.push("x-parent=" + pool.Uuid);

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
                                                console.log("UD", fsys);
                                                return block.AddConfigurationItem(config, {})
                                                        .then(reload_systemd)
                                                        .then(() => {
                                                            if (vals.mount_options.auto)
                                                                return fsys.Mount({ });
                                                            else
                                                                return Promise.resolve();
                                                        });
                                            });
                                });
                    });
        }

        function create_fs() {
            dialog_open({
                Title: _("Create Filesystem"),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                                  validate: function (name) {
                                      if (name == "")
                                          return _("Name can not be empty.");
                                  }
                              }),
                    TextInput("mount_point", _("Mount Point"),
                              {
                                  validate: val => is_valid_mount_point(client, null, val)
                              }),
                    CheckBoxes("mount_options", _("Mount Options"),
                               {
                                   value: {
                                       auto: true,
                                       ro: false,
                                       extra: false
                                   },
                                   fields: [
                                       { title: _("Mount now"), tag: "auto" },
                                       { title: _("Mount read only"), tag: "ro" },
                                       { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                                   ]
                               }),
                ],
                Action: {
                    Title: _("Create"),
                    action: function (vals) {
                        return pool.call("CreateFilesystems", [[vals.name]])
                                .then(([result, code, message]) => {
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

        var use = [Number(pool.data.TotalPhysicalUsed), Number(pool.data.TotalPhysicalSize)];
        var header = (
            <Card>
                <CardHeader>
                    <CardTitle><Text component={TextVariants.h2}>{fmt_to_fragments(_("Stratis Pool $0"), <b>{pool.Name}</b>)}</Text></CardTitle>
                    <CardActions>
                        <StorageButton onClick={rename}>{_("Rename")}</StorageButton>
                        <StorageButton kind="danger" onClick={delete_}>{_("Delete")}</StorageButton>
                    </CardActions>
                </CardHeader>
                <CardBody>
                    <div className="ct-form">
                        <label className="control-label">{_("storage", "UUID")}</label>
                        <div>{ pool.Uuid }</div>

                        { pool.Encrypted &&
                        <>
                            <label className="control-label">{_("storage", "Key description")}</label>
                            <div>{ pool.data.KeyDescription && pool.data.KeyDescription[1] }</div>
                        </>
                        }

                        <label className="control-label">{_("storage", "Use")}</label>
                        <StorageUsageBar stats={use} critical={0.95} />
                    </div>
                </CardBody>
            </Card>
        );

        var sidebar = <StratisPoolSidebar client={client} pool={pool} />;

        var new_fs_link = (
            <div className="pull-right">
                <StorageLink onClick={create_fs}>
                    <span className="pficon pficon-add-circle-o" />
                    {" "}
                    {_("Create new Filesystem")}
                </StorageLink>
            </div>);

        var filesystems = client.stratis_pool_filesystems[pool.path];

        function render_fsys(fsys) {
            const block = client.slashdevs_block[fsys.Devnode];

            if (!block) {
                return {
                    props: { key: fsys.Name },
                    columns: [{ title: fsys.Name }]
                };
            }

            function mount() {
                return mounting_dialog(client, block, "mount");
            }

            function unmount() {
                return mounting_dialog(client, block, "unmount");
            }

            function rename_fsys() {
                dialog_open({
                    Title: _("Rename Filesystem"),
                    Fields: [
                        TextInput("name", _("Name"),
                                  {
                                      value: fsys.Name,
                                      validate: function (name) {
                                          if (name == "")
                                              return _("Name can not be empty.");
                                      }
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
                    Title: cockpit.format(_("Create a copy of filesystem $0"), fsys.Name),
                    Fields: [
                        TextInput("name", _("Name"),
                                  {
                                      value: fsys.Name + "@" + (new Date()).toISOString(),
                                      validate: function (name) {
                                          if (name == "")
                                              return _("Name can not be empty.");
                                      }
                                  }),
                        TextInput("mount_point", _("Mount Point"),
                                  {
                                      validate: val => is_valid_mount_point(client, null, val)
                                  }),
                        CheckBoxes("mount_options", _("Mount Options"),
                                   {
                                       value: {
                                           auto: true,
                                           ro: false,
                                           extra: false
                                       },
                                       fields: [
                                           { title: _("Mount now"), tag: "auto" },
                                           { title: _("Mount read only"), tag: "ro" },
                                           { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                                       ]
                                   })
                    ],
                    Action: {
                        Title: _("Create copy"),
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
                var usage = get_active_usage(client, block.path);

                if (usage.Blocking) {
                    dialog_open({
                        Title: cockpit.format(_("$0 is in active use"),
                                              fsys.Name),
                        Body: BlockingMessage(usage)
                    });
                    return;
                }

                dialog_open({
                    Title: cockpit.format(_("Please confirm deletion of $0"), fsys.Name),
                    Footer: TeardownMessage(usage),
                    Action: {
                        Danger: _("Deleting a filesystem will delete all data in it."),
                        Title: _("Delete"),
                        action: function () {
                            return teardown_active_usage(client, usage)
                                    .then(() => destroy_filesystem(client, fsys));
                        }
                    }
                });
            }

            const cols = [
                { title: fsys.Name }
            ];
            const associated_warnings = ["mismounted-fsys"];
            const warnings = client.path_warnings[block.path] || [];
            const tab_warnings = warnings.filter(w => associated_warnings.indexOf(w.warning) >= 0);
            let name = _("Filesystem");

            if (tab_warnings.length > 0) {
                name = <span><span className="pficon pficon-warning-triangle-o" /> {name}</span>;
                cols.push({ name: <span className="pficon pficon-warning-triangle-o" />, tight: true });
            }

            var tabs = [
                {
                    name: name,
                    renderer: FilesystemTab,
                    data: {
                        client: client,
                        block: block,
                        warnings: tab_warnings
                    }
                }
            ];

            var actions = [];
            var menuitems = [];

            if (is_mounted(client, block))
                menuitems.push(<StorageMenuItem key="unmount" onClick={unmount}>{_("Unmount")}</StorageMenuItem>);
            else
                actions.push(<StorageButton key="mount" onClick={mount}>{_("Mount")}</StorageButton>);

            menuitems.push(<StorageMenuItem key="rename" onClick={rename_fsys}>{_("Rename")}</StorageMenuItem>);
            menuitems.push(<StorageMenuItem key="snapshot" onClick={snapshot_fsys}>{_("Copy")}</StorageMenuItem>);
            menuitems.push(<StorageMenuItem key="del" onClick={delete_fsys}>{_("Delete")}</StorageMenuItem>);
            actions.push(<StorageBarMenu key="menu" menuItems={menuitems} />);

            return {
                props: { key: fsys.Name },
                columns: cols,
                expandedContent: <ListingPanel tabRenderers={tabs}
                                               listingActions={actions} />
            };
        }

        var content = (
            <Card>
                <CardHeader>
                    <CardTitle><Text component={TextVariants.h2}>{_("Filesystems")}</Text></CardTitle>
                    <CardActions>{new_fs_link}</CardActions>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable emptyCaption={_("No filesystems")}
                                  aria-label={_("Filesystems")}
                                  columns={[_("Content"), { title: _("Name"), header: true }, _("Actions")]}
                                  showHeader={false}
                                  variant="compact"
                                  rows={filesystems.map(render_fsys).filter(row => !!row)} />
                </CardBody>
            </Card>);

        return <StdDetailsLayout client={this.props.client}
                                 header={ header }
                                 sidebar={ sidebar }
                                 content={ content } />;
    }
}

export class StratisLockedPoolDetails extends React.Component {
    render() {
        const { client, uuid } = this.props;
        const locked_props = this.props.client.stratis_manager.data.LockedPoolsWithDevs[uuid];
        const key_desc = locked_props.key_description.v[1];
        const devs = locked_props.devs.v.map(d => d.devnode);

        function unlock() {
            const manager = client.stratis_manager;
            return manager.client.call(manager.path, "org.storage.stratis2.FetchProperties.r2", "GetProperties", [["KeyList"]])
                    .catch(() => [{ }])
                    .then(([result]) => {
                        let keys = [];
                        if (result.KeyList && result.KeyList[0])
                            keys = result.KeyList[1].v;
                        if (keys.indexOf(key_desc) >= 0)
                            unlock_with_keydesc(false);
                        else
                            unlock_with_keydesc(key_desc);
                    });
        }

        function unlock_with_keydesc(key_desc) {
            dialog_open({
                Title: _("Unlock"),
                Fields: [
                    PassInput("passphrase", _("Passphrase"),
                              {
                                  visible: () => !!key_desc
                              }),
                ],
                Action: {
                    Title: _("Unlock"),
                    action: function(vals) {
                        function doit() {
                            return client.stratis_manager.UnlockPool(uuid)
                                    .then((result, code, message) => {
                                        if (code)
                                            return Promise.reject(message);
                                    });
                        }

                        if (key_desc) {
                            return store_passphrase(key_desc, vals.passphrase)
                                    .then(doit)
                                    .catch(ex => {
                                        return remove_passphrase(client, key_desc)
                                                .then(() => Promise.reject(ex));
                                    })
                                    .then(() => {
                                        return remove_passphrase(client, key_desc);
                                    });
                        } else
                            return doit();
                    }
                }
            });
        }

        var header = (
            <Card>
                <CardHeader>
                    <CardTitle><Text component={TextVariants.h2}>{_("Locked Stratis Pool")}</Text></CardTitle>
                    <CardActions>
                        <StorageButton kind="primary" onClick={unlock}>{_("Unlock")}</StorageButton>
                    </CardActions>
                </CardHeader>
                <CardBody>
                    <div className="ct-form">
                        <label className="control-label">{_("storage", "UUID")}</label>
                        <div>{ uuid }</div>

                        <label className="control-label">{_("storage", "Key description")}</label>
                        <div>{ key_desc }</div>

                        <label className="control-label">{_("storage", "Blockdevs")}</label>
                        <div>{ devs.join(", ") }</div>
                    </div>
                </CardBody>
            </Card>
        );

        return <StdDetailsLayout client={this.props.client}
                                header={ header }
                                sidebar={ null }
                                content={ null } />;
    }
}
