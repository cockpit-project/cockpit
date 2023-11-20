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
import { CardHeader, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { useObject } from "hooks";

import { VolumeIcon } from "../icons/gnome-icons.jsx";
import { StorageButton, StorageLink } from "../storage-controls.jsx";
import {
    StorageCard, StorageDescription, ChildrenTable, PageTable, new_page, new_card, get_crossrefs,
    navigate_to_new_card_location, navigate_away_from_card
} from "../pages.jsx";
import {
    fmt_size_long, get_active_usage, teardown_active_usage, for_each_async,
    validate_lvm2_name,
    get_available_spaces, prepare_available_spaces,
    reload_systemd,
} from "../utils.js";

import {
    dialog_open, SelectSpaces, TextInput,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "../dialog.jsx";

import { create_logical_volume } from "./create-logical-volume-dialog.jsx";
import { make_block_logical_volume_card } from "./block-logical-volume.jsx";
import { make_vdo_pool_card } from "./vdo-pool.jsx";
import { make_thin_pool_logical_volume_page } from "./thin-pool-logical-volume.jsx";
import { make_inactive_logical_volume_page } from "./inactive-logical-volume.jsx";
import { make_unsupported_logical_volume_page } from "./unsupported-logical-volume.jsx";
import { make_block_page } from "../block/create-pages.jsx";

const _ = cockpit.gettext;

function vgroup_rename(client, vgroup, card) {
    dialog_open({
        Title: _("Rename volume group"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: vgroup.Name,
                          validate: validate_lvm2_name
                      })
        ],
        Action: {
            Title: _("Rename"),
            action: async function (vals) {
                await vgroup.Rename(vals.name, { });
                navigate_to_new_card_location(card, ["vg", vals.name]);
            }
        }
    });
}

function vgroup_delete(client, vgroup, card) {
    const usage = get_active_usage(client, vgroup.path, _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"),
                                  vgroup.Name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Permanently delete $0?"), vgroup.Name),
        Teardown: TeardownMessage(usage),
        Action: {
            Danger: _("Deleting erases all data on a volume group."),
            Title: _("Delete"),
            disable_on_error: usage.Teardown,
            action: async function () {
                await teardown_active_usage(client, usage);
                await vgroup.Delete(true, { 'tear-down': { t: 'b', v: true } });
                await reload_systemd();
                navigate_away_from_card(card);
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

function make_generic_logical_volume_card(next, vgroup, lvol) {
    let result = next;
    if (client.vdo_vols[lvol.path])
        result = make_vdo_pool_card(result, vgroup, lvol);
    return result;
}

export function make_lvm2_logical_volume_page(parent, vgroup, lvol) {
    const generic_card = make_generic_logical_volume_card(null, vgroup, lvol);

    if (lvol.Type == "pool") {
        make_thin_pool_logical_volume_page(parent, vgroup, lvol);
    } else {
        const block = client.lvols_block[lvol.path];
        if (block) {
            const lv_card = make_block_logical_volume_card(generic_card, vgroup, lvol, block);
            make_block_page(parent, block, lv_card);
        } else {
            // If we can't find the block for a active volume, UDisks2
            // or something below is probably misbehaving, and we show
            // it as "unsupported".
            if (lvol.Active) {
                make_unsupported_logical_volume_page(parent, vgroup, lvol, generic_card);
            } else {
                make_inactive_logical_volume_page(parent, vgroup, lvol, generic_card);
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
        // We ignore vdo pools; they appear as a card for their
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
        lvol_excuse = _("Volume group is missing physical volumes");
    else if (vgroup.FreeSize == 0)
        lvol_excuse = _("No free space");

    const vgroup_card = new_card({
        title: _("LVM2 volume group"),
        next: null,
        page_location: ["vg", vgroup.Name],
        page_name: vgroup.Name,
        page_icon: VolumeIcon,
        page_size: vgroup.Size,
        job_path: vgroup.path,
        component: LVM2VolumeGroupCard,
        props: { vgroup },
        actions: [
            {
                title: _("Add physical volume"),
                action: () => add_disk(vgroup),
                tag: "pvols",
            },
            {
                title: _("Delete group"),
                action: () => vgroup_delete(client, vgroup, vgroup_card),
                danger: true,
                tag: "group",
            },
        ],
    });

    const lvols_card = new_card({
        title: _("LVM2 logical volumes"),
        next: vgroup_card,
        has_warning: has_missing_pvs,
        component: LVM2LogicalVolumesCard,
        props: { vgroup },
        actions: [
            {
                title: _("Create new logical volume"),
                action: () => create_logical_volume(client, vgroup),
                excuse: lvol_excuse,
                tag: "group",
            },
        ],
    });

    const vgroup_page = new_page(parent, lvols_card);
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

const LVM2LogicalVolumesCard = ({ card, vgroup }) => {
    return (
        <StorageCard card={card}>
            <CardBody className="contains-list">
                <ChildrenTable emptyCaption={_("No logical volumes")}
                               aria-label={_("LVM2 logical volumes")}
                               page={card.page} />
            </CardBody>
        </StorageCard>
    );
};

const LVM2VolumeGroupCard = ({ card, vgroup }) => {
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

    const alerts = [];
    if (has_missing_pvs)
        alerts.push(
            <Alert variant='warning' isInline key="missing"
                   actionClose={<StorageButton onClick={remove_missing}>{_("Dismiss")}</StorageButton>}
                   title={_("This volume group is missing some physical volumes.")}>
                {vgroup.MissingPhysicalVolumes.map(uuid => <div key={uuid}>{uuid}</div>)}
            </Alert>);

    return (
        <StorageCard card={card} alerts={alerts}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")}
                           value={vgroup.Name}
                           action={<StorageLink onClick={() => vgroup_rename(client, vgroup, card)}
                                                excuse={has_missing_pvs && _("A volume group with missing physical volumes can not be renamed.")}>
                               {_("edit")}
                           </StorageLink>} />
                    <StorageDescription title={_("UUID")} value={vgroup.UUID} />
                    <StorageDescription title={_("Capacity")} value={fmt_size_long(vgroup.Size)} />
                </DescriptionList>
            </CardBody>
            <CardHeader><strong>{_("Physical volumes")}</strong></CardHeader>
            <CardBody className="contains-list">
                <PageTable emptyCaption={_("No physical volumes found")}
                           aria-label={_("LVM2 physical volumes")}
                           crossrefs={get_crossrefs(vgroup)} />
            </CardBody>
        </StorageCard>
    );
};
