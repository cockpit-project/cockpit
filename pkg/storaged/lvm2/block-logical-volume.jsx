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
 * Cockpit is distributed in the hopeg that it will be useful, but
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
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { ExclamationTriangleIcon, ExclamationCircleIcon } from "@patternfly/react-icons";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { StorageButton, StorageLink } from "../storage-controls.jsx";

import { check_unused_space, get_resize_info, grow_dialog, shrink_dialog } from "../block/resize.jsx";
import { StorageCard, StorageDescription, new_card, navigate_to_new_card_location, navigate_away_from_card } from "../pages.jsx";
import { block_name, fmt_size, get_active_usage, teardown_active_usage, reload_systemd } from "../utils.js";
import {
    dialog_open, TextInput, SelectSpaces, BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "../dialog.jsx";

import { lvm2_create_snapshot_action } from "./volume-group.jsx";
import { pvs_to_spaces } from "./utils.jsx";

const _ = cockpit.gettext;

export function lvol_rename(lvol) {
    dialog_open({
        Title: _("Rename logical volume"),
        Fields: [
            TextInput("name", _("Name"),
                      { value: lvol.Name })
        ],
        Action: {
            Title: _("Rename"),
            action: function (vals) {
                return lvol.Rename(vals.name, { });
            }
        }
    });
}

export function lvol_delete(lvol, card) {
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
                navigate_away_from_card(card);
            }
        },
        Inits: [
            init_active_usage_processes(client, usage)
        ]
    });
}

function repair(lvol) {
    const vgroup = lvol && client.vgroups[lvol.VolumeGroup];
    if (!vgroup)
        return;

    const summary = client.lvols_stripe_summary[lvol.path];
    const missing = summary.reduce((sum, sub) => sum + (sub["/"] ?? 0), 0);

    function usable(pvol) {
        // must have some free space and not already used for a
        // subvolume other than those that need to be repaired.
        return pvol.FreeSize > 0 && !summary.some(sub => !sub["/"] && sub[pvol.path]);
    }

    const pvs_as_spaces = pvs_to_spaces(client, client.vgroups_pvols[vgroup.path].filter(usable));
    const available = pvs_as_spaces.reduce((sum, spc) => sum + spc.size, 0);

    if (available < missing) {
        dialog_open({
            Title: cockpit.format(_("Unable to repair logical volume $0"), lvol.Name),
            Body: <p>{cockpit.format(_("There is not enough space available that could be used for a repair. At least $0 are needed on physical volumes that are not already used for this logical volume."),
                                     fmt_size(missing))}</p>
        });
        return;
    }

    function enough_space(pvs) {
        const selected = pvs.reduce((sum, pv) => sum + pv.size, 0);
        if (selected < missing)
            return cockpit.format(_("An additional $0 must be selected"), fmt_size(missing - selected));
    }

    dialog_open({
        Title: cockpit.format(_("Repair logical volume $0"), lvol.Name),
        Body: <div><p>{cockpit.format(_("Select the physical volumes that should be used to repair the logical volume. At leat $0 are needed."),
                                      fmt_size(missing))}</p><br /></div>,
        Fields: [
            SelectSpaces("pvs", _("Physical Volumes"),
                         {
                             spaces: pvs_as_spaces,
                             validate: enough_space
                         }),
        ],
        Action: {
            Title: _("Repair"),
            action: function (vals) {
                return lvol.Repair(vals.pvs.map(spc => spc.block.path), { });
            }
        }
    });
}

function deactivate(lvol, block) {
    const vgroup = client.vgroups[lvol.VolumeGroup];
    const usage = get_active_usage(client, block.path, _("deactivate"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), lvol.Name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Deactivate logical volume $0/$1?"), vgroup.Name, lvol.Name),
        Teardown: TeardownMessage(usage),
        Action: {
            Title: _("Deactivate"),
            action: async function () {
                await teardown_active_usage(client, usage);
                await lvol.Deactivate({ });
                await reload_systemd();
            }
        },
        Inits: [
            init_active_usage_processes(client, usage)
        ]
    });
}

export function make_block_logical_volume_card(next, vgroup, lvol, block) {
    const unused_space_warning = check_unused_space(block.path);
    const unused_space = !!unused_space_warning;
    const status_code = client.lvols_status[lvol.path];
    const pool = client.lvols[lvol.ThinPool];

    let { info, shrink_excuse, grow_excuse } = get_resize_info(client, block, unused_space);

    if (!unused_space && !grow_excuse && !pool && vgroup.FreeSize == 0) {
        grow_excuse = _("Not enough space to grow");
    }

    let repair_action = null;
    if (status_code == "degraded" || status_code == "degraded-maybe-partial")
        repair_action = { title: _("Repair"), action: () => repair(lvol) };

    const card = new_card({
        title: _("LVM2 logical volume"),
        next,
        page_location: ["vg", vgroup.Name, lvol.Name],
        page_name: lvol.Name,
        page_size: block.Size,
        for_summary: true,
        has_warning: !!unused_space_warning || !!repair_action,
        has_danger: status_code == "partial",
        job_path: lvol.path,
        component: LVM2LogicalVolumeCard,
        props: { vgroup, lvol, block, unused_space_warning, resize_info: info },
        actions: [
            (!unused_space &&
             {
                 title: _("Shrink"),
                 action: () => shrink_dialog(client, lvol, info),
                 excuse: shrink_excuse,
             }),
            (!unused_space &&
             {
                 title: _("Grow"),
                 action: () => grow_dialog(client, lvol, info),
                 excuse: grow_excuse,
             }),
            {
                title: _("Deactivate"),
                action: () => deactivate(lvol, block),
            },
            lvm2_create_snapshot_action(lvol),
            repair_action,
            {
                title: _("Delete"),
                action: () => lvol_delete(lvol, card),
                danger: true,
            },
        ],
    });
    return card;
}

const LVM2LogicalVolumeCard = ({ card, vgroup, lvol, block, unused_space_warning, resize_info }) => {
    const unused_space = !!unused_space_warning;

    function rename() {
        dialog_open({
            Title: _("Rename logical volume"),
            Fields: [
                TextInput("name", _("Name"),
                          { value: lvol.Name })
            ],
            Action: {
                Title: _("Rename"),
                action: async function (vals) {
                    await lvol.Rename(vals.name, { });
                    navigate_to_new_card_location(card, ["vg", vgroup.Name, vals.name]);
                }
            }
        });
    }

    function shrink_to_fit() {
        return shrink_dialog(client, lvol, resize_info, true);
    }

    function grow_to_fit() {
        return grow_dialog(client, lvol, resize_info, true);
    }

    const layout_desc = {
        raid0: _("Striped (RAID 0)"),
        raid1: _("Mirrored (RAID 1)"),
        raid10: _("Striped and mirrored (RAID 10)"),
        raid4: _("Dedicated parity (RAID 4)"),
        raid5: _("Distributed parity (RAID 5)"),
        raid6: _("Double distributed parity (RAID 6)")
    };

    const layout = lvol.Layout;

    return (
        <StorageCard card={card}
                     alert={unused_space &&
                     <Alert variant="warning"
                                   isInline
                                   title={_("This logical volume is not completely used by its content.")}>
                         {cockpit.format(_("Volume size is $0. Content size is $1."),
                                         fmt_size(unused_space_warning.volume_size),
                                         fmt_size(unused_space_warning.content_size))}
                         <div className='storage-alert-actions'>
                             <StorageButton onClick={shrink_to_fit}>{_("Shrink volume")}</StorageButton>
                             <StorageButton onClick={grow_to_fit}>{_("Grow content")}</StorageButton>
                         </div>
                     </Alert>}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")} value={lvol.Name}
                           action={<StorageLink onClick={rename}>
                               {_("edit")}
                           </StorageLink>} />
                    { !unused_space &&
                    <StorageDescription title={_("Size")} value={fmt_size(lvol.Size)} />
                    }
                    { (layout && layout != "linear") &&
                    <StorageDescription title={_("Layout")} value={layout_desc[layout] || layout} />
                    }
                    <StructureDescription client={client} lvol={lvol} />
                </DescriptionList>
            </CardBody>
        </StorageCard>);
};

export const StructureDescription = ({ client, lvol }) => {
    const vgroup = client.vgroups[lvol.VolumeGroup];
    const pvs = (vgroup && client.vgroups_pvols[vgroup.path]) || [];

    if (!lvol.Structure || pvs.length <= 1)
        return null;

    let status = null;
    const status_code = client.lvols_status[lvol.path];
    if (status_code == "partial") {
        status = _("This logical volume has lost some of its physical volumes and can no longer be used. You need to delete it and create a new one to take its place.");
    } else if (status_code == "degraded") {
        status = _("This logical volume has lost some of its physical volumes but has not lost any data yet. You should repair it to restore its original redundancy.");
    } else if (status_code == "degraded-maybe-partial") {
        status = _("This logical volume has lost some of its physical volumes but might not have lost any data yet. You might be able to repair it.");
    }

    function nice_block_name(block) {
        return block_name(client.blocks[block.CryptoBackingDevice] || block);
    }

    function pvs_box(used, block_path) {
        if (block_path != "/") {
            const block = client.blocks[block_path];
            return <div key={block_path} className="storage-pvs-pv-box">
                <div className="storage-stripe-pv-box-dev">
                    {block ? nice_block_name(block).replace("/dev/", "") : "???"}
                </div>
                <div>{fmt_size(used)}</div>
            </div>;
        } else {
            return <div key={block_path} className="storage-pvs-pv-box">
                <div className="storage-pvs-pv-box-dev">
                    { status_code == "degraded"
                        ? <ExclamationTriangleIcon className="ct-icon-exclamation-triangle" />
                        : <ExclamationCircleIcon className="ct-icon-times-circle" />
                    }
                </div>
                <div>{fmt_size(used)}</div>
            </div>;
        }
    }

    if (lvol.Layout == "linear") {
        const pvs = client.lvols_stripe_summary[lvol.path];
        if (!pvs)
            return null;

        const stripe = Object.keys(pvs).map((path, i) =>
            <FlexItem key={i} className="storage-pvs-box">
                {pvs_box(pvs[path], path)}
            </FlexItem>);

        return (
            <StorageDescription title={_("Physical volumes")}>
                <Flex spaceItems={{ default: "spaceItemsNone" }}
                      alignItems={{ default: "alignItemsStretch" }}>
                    {stripe}
                </Flex>
                {status}
            </StorageDescription>);
    }

    function stripe_box(used, block_path) {
        if (block_path != "/") {
            const block = client.blocks[block_path];
            return <div key={block_path} className="storage-stripe-pv-box">
                <div className="storage-stripe-pv-box-dev">
                    {block ? nice_block_name(block).replace("/dev/", "") : "???"}
                </div>
                <div>{fmt_size(used)}</div>
            </div>;
        } else {
            return <div key={block_path} className="storage-stripe-pv-box">
                <div className="storage-stripe-pv-box-dev">
                    { status_code == "degraded"
                        ? <ExclamationTriangleIcon className="ct-icon-exclamation-triangle" />
                        : <ExclamationCircleIcon className="ct-icon-times-circle" />
                    }
                </div>
                <div>{fmt_size(used)}</div>
            </div>;
        }
    }

    if (lvol.Layout == "mirror" || lvol.Layout.indexOf("raid") == 0) {
        const summary = client.lvols_stripe_summary[lvol.path];
        if (!summary)
            return null;

        const stripes = summary.map((pvs, i) =>
            <FlexItem key={i} className="storage-stripe-box">
                {Object.keys(pvs).map(path => stripe_box(pvs[path], path))}
            </FlexItem>);

        return (
            <>
                <StorageDescription title={_("Stripes")}>
                    <Flex alignItems={{ default: "alignItemsStretch" }}>{stripes}</Flex>
                    {status}
                    {lvol.SyncRatio != 1.0
                        ? <div>{cockpit.format(_("$0 synchronized"), lvol.SyncRatio * 100 + "%")}</div>
                        : null}
                </StorageDescription>
            </>);
    }

    return null;
};
