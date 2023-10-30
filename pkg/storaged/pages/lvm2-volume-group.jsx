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

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { useObject } from "hooks";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { StorageButton, StorageLink } from "../storage-controls.jsx";
import {
    PageChildrenCard, PageCrossrefCard, ActionButtons, new_page, page_type, get_crossrefs, navigate_away_from_page
} from "../pages.jsx";
import {
    fmt_size, fmt_size_long, get_active_usage, teardown_active_usage, for_each_async,
    validate_lvm2_name,
    get_available_spaces, prepare_available_spaces,
    reload_systemd,
} from "../utils.js";

import {
    dialog_open, SelectSpaces, TextInput,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "../dialog.jsx";

import { vgroup_rename, vgroup_delete } from "../vgroup-details.jsx"; // XXX
import { create_logical_volume } from "../content-views.jsx"; // XXX

import { make_lvm2_logical_volume_container } from "../containers/lvm2-logical-volume.jsx";
import { make_lvm2_vdo_pool_container } from "../containers/lvm2-vdo-pool.jsx";
import { make_lvm2_thin_pool_logical_volume_page } from "./lvm2-thin-pool-logical-volume.jsx";
import { make_lvm2_inactive_logical_volume_page } from "./lvm2-inactive-logical-volume.jsx";
import { make_lvm2_unsupported_logical_volume_page } from "./lvm2-unsupported-logical-volume.jsx";
import { make_block_page } from "../create-pages.jsx";

const _ = cockpit.gettext;

export function lvm2_delete_logical_volume_dialog(lvol, page) {
    const vgroup = client.vgroups[lvol.VolumeGroup];
    const block = client.lvols_block[lvol.path];
    const usage = get_active_usage(client, block ? block.path : lvol.path, _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), lvol.Name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Permanently delete logical volume $0/$1?"), vgroup.Name, lvol.Name),
        Teardown: TeardownMessage(usage),
        Action: {
            Danger: _("Deleting a logical volume will delete all data in it."),
            Title: _("Delete"),
            action: async function () {
                await teardown_active_usage(client, usage);
                await lvol.Delete({ 'tear-down': { t: 'b', v: true } });
                await reload_systemd();
                navigate_away_from_page(page);
            }
        },
        Inits: [
            init_active_usage_processes(client, usage)
        ]
    });
}

function create_snapshot(lvol) {
    dialog_open({
        Title: _("Create snapshot"),
        Fields: [
            TextInput("name", _("Name"),
                      { validate: validate_lvm2_name }),
        ],
        Action: {
            Title: _("Create"),
            action: function (vals) {
                return lvol.CreateSnapshot(vals.name, vals.size || 0, { });
            }
        }
    });
}

export function lvm2_create_snapshot_action(lvol) {
    if (!client.lvols[lvol.ThinPool])
        return null;

    return { title: _("Create snapshot"), action: () => create_snapshot(lvol) };
}

function make_lvm2_generic_logical_volume_container(parent, vgroup, lvol) {
    let result = parent;
    if (client.vdo_vols[lvol.path])
        result = make_lvm2_vdo_pool_container(result, vgroup, lvol);
    return result;
}

export function make_lvm2_logical_volume_page(parent, vgroup, lvol) {
    const generic_container = make_lvm2_generic_logical_volume_container(null, vgroup, lvol);

    if (lvol.Type == "pool") {
        make_lvm2_thin_pool_logical_volume_page(parent, vgroup, lvol);
    } else {
        const block = client.lvols_block[lvol.path];
        if (block) {
            const container = make_lvm2_logical_volume_container(generic_container, vgroup, lvol, block);
            make_block_page(parent, block, container);
        } else {
            // If we can't find the block for a active
            // volume, Storaged or something below is
            // probably misbehaving, and we show it as
            // "unsupported".
            if (lvol.Active) {
                make_lvm2_unsupported_logical_volume_page(parent, vgroup, lvol, generic_container);
            } else {
                make_lvm2_inactive_logical_volume_page(parent, vgroup, lvol, generic_container);
            }
        }
    }
}

function make_logical_volume_pages(parent, vgroup) {
    const isVDOPool = lvol => Object.keys(client.vdo_vols).some(v => client.vdo_vols[v].VDOPool == lvol.path);

    (client.vgroups_lvols[vgroup.path] || []).forEach(lvol => {
        // We ignore volumes in a thin pool; they appear as children
        // of their pool.
        //
        // We ignore old-style snapshots because Cockpit would need to
        // treat them specially, and we haven't bothered to write the
        // code for that.
        //
        // We ignore vdo pools; they appear as a container for their
        // single contained logical volume.
        //
        if (lvol.ThinPool == "/" && lvol.Origin == "/" && !isVDOPool(lvol))
            make_lvm2_logical_volume_page(parent, vgroup, lvol);
    });
}

function add_disk(vgroup) {
    function filter_inside_vgroup(spc) {
        let block = spc.block;
        if (client.blocks_part[block.path])
            block = client.blocks[client.blocks_part[block.path].Table];
        const lvol = (block &&
                      client.blocks_lvm2[block.path] &&
                      client.lvols[client.blocks_lvm2[block.path].LogicalVolume]);
        return !lvol || lvol.VolumeGroup != vgroup.path;
    }

    dialog_open({
        Title: _("Add disks"),
        Fields: [
            SelectSpaces("disks", _("Disks"),
                         {
                             empty_warning: _("No disks are available."),
                             validate: function(disks) {
                                 if (disks.length === 0)
                                     return _("At least one disk is needed.");
                             },
                             spaces: get_available_spaces(client).filter(filter_inside_vgroup)
                         })
        ],
        Action: {
            Title: _("Add"),
            action: function(vals) {
                return prepare_available_spaces(client, vals.disks).then(paths =>
                    Promise.all(paths.map(p => vgroup.AddDevice(p, {}))));
            }
        }
    });
}

export function make_lvm2_volume_group_page(parent, vgroup) {
    const has_missing_pvs = vgroup.MissingPhysicalVolumes && vgroup.MissingPhysicalVolumes.length > 0;

    let lvol_excuse = null;
    if (has_missing_pvs)
        lvol_excuse = _("New logical volumes can not be created while a volume group is missing physical volumes.");
    else if (vgroup.FreeSize == 0)
        lvol_excuse = _("No free space");

    const vgroup_page = new_page({
        location: ["vg", vgroup.Name],
        parent,
        name: vgroup.Name,
        columns: [
            _("LVM2 volume group"),
            "/dev/" + vgroup.Name + "/",
            fmt_size(vgroup.Size),
        ],
        has_warning: has_missing_pvs,
        component: LVM2VolumeGroupPage,
        props: { vgroup },
        actions: [
            {
                title: _("Add physical volume"),
                action: () => add_disk(vgroup),
                tag: "pvols",
            },
            {
                title: _("Create new logical volume"),
                action: () => create_logical_volume(client, vgroup),
                excuse: lvol_excuse,
                tag: "lvols",
            },
            {
                title: _("Delete"),
                action: () => vgroup_delete(client, vgroup, parent),
                danger: true,
                tag: "group",
            },
        ],
    });

    make_logical_volume_pages(vgroup_page, vgroup);
}

function vgroup_poller(vgroup) {
    let timer = null;

    if (vgroup.NeedsPolling) {
        timer = window.setInterval(() => { vgroup.Poll() }, 2000);
    }

    function stop() {
        if (timer)
            window.clearInterval(timer);
    }

    return {
        stop
    };
}

const LVM2VolumeGroupPage = ({ page, vgroup }) => {
    const has_missing_pvs = vgroup.MissingPhysicalVolumes && vgroup.MissingPhysicalVolumes.length > 0;

    useObject(() => vgroup_poller(vgroup),
              poller => poller.stop(),
              [vgroup]);

    function is_partial_linear_lvol(block) {
        const lvm2 = client.blocks_lvm2[block.path];
        const lvol = lvm2 && client.lvols[lvm2.LogicalVolume];
        return lvol && lvol.Layout == "linear" && client.lvols_status[lvol.path] == "partial";
    }

    function remove_missing() {
        /* Calling vgroup.RemoveMissingPhysicalVolumes will
           implicitly delete all partial, linear logical volumes.
           Instead of allowing this, we explicitly delete these
           volumes before calling RemoveMissingPhysicalVolumes.
           This allows us to kill processes that keep them busy
           and remove their fstab entries.

           RemoveMissingPhysicalVolumes leaves non-linear volumes
           alone, even if they can't be repaired anymore.  This is
           a bit inconsistent, but *shrug*.
        */

        let usage = get_active_usage(client, vgroup.path, _("delete"));
        usage = usage.filter(u => u.block && is_partial_linear_lvol(u.block));

        if (usage.Blocking) {
            dialog_open({
                Title: cockpit.format(_("$0 is in use"),
                                      vgroup.Name),
                Body: BlockingMessage(usage)
            });
            return;
        }

        dialog_open({
            Title: _("Remove missing physical volumes?"),
            Teardown: TeardownMessage(usage),
            Action: {
                Title: _("Remove"),
                action: function () {
                    return teardown_active_usage(client, usage)
                            .then(function () {
                                return for_each_async(usage,
                                                      u => {
                                                          const lvm2 = client.blocks_lvm2[u.block.path];
                                                          const lvol = lvm2 && client.lvols[lvm2.LogicalVolume];
                                                          return lvol.Delete({ 'tear-down': { t: 'b', v: true } });
                                                      })
                                        .then(() => vgroup.RemoveMissingPhysicalVolumes({}));
                            });
                }
            },
            Inits: [
                init_active_usage_processes(client, usage)
            ]
        });
    }

    let alert = null;
    if (has_missing_pvs)
        alert = (
            <StackItem>
                <Alert variant='warning' isInline
                       actionClose={<StorageButton onClick={remove_missing}>{_("Dismiss")}</StorageButton>}
                       title={_("This volume group is missing some physical volumes.")}>
                    {vgroup.MissingPhysicalVolumes.map(uuid => <div key={uuid}>{uuid}</div>)}
                </Alert>
            </StackItem>);

    return (
        <Stack hasGutter>
            {alert}
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} tag="group" />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Name")}
                                   value={vgroup.Name}
                                   action={<StorageLink onClick={() => vgroup_rename(client, vgroup)}
                                                        excuse={has_missing_pvs && _("A volume group with missing physical volumes can not be renamed.")}>
                                       {_("edit")}
                                   </StorageLink>} />
                            <SDesc title={_("UUID")} value={vgroup.UUID} />
                            <SDesc title={_("Capacity")} value={fmt_size_long(vgroup.Size)} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <StackItem>
                <PageCrossrefCard title={_("Physical volumes")}
                                  actions={<ActionButtons page={page} tag="pvols" />}
                                  crossrefs={get_crossrefs(vgroup)} />
            </StackItem>
            <StackItem>
                <PageChildrenCard title={_("Logical volumes")}
                                  emptyCaption={_("No logical volumes")}
                                  actions={<ActionButtons page={page} tag="lvols" />}
                                  page={page} />
            </StackItem>
        </Stack>
    );
};
