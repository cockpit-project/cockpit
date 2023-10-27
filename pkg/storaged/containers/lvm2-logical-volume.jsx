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
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { StorageButton, StorageLink } from "../storage-controls.jsx";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { check_unused_space, get_resize_info, grow_dialog, shrink_dialog } from "../resize.jsx";
import { new_container, navigate_to_new_page_location, ActionButtons } from "../pages.jsx";
import { fmt_size } from "../utils.js";
import { lvm2_delete_logical_volume_dialog, lvm2_create_snapshot_action } from "../pages/lvm2-volume-group.jsx";
import {
    dialog_open, TextInput, SelectSpaces,
} from "../dialog.jsx";

import { StructureDescription } from "../lvol-tabs.jsx"; // XXX
import { pvs_to_spaces } from "../content-views.jsx"; // XXX

const _ = cockpit.gettext;

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

export function make_lvm2_logical_volume_container(parent, vgroup, lvol, block) {
    const unused_space_warning = check_unused_space(block.path);
    const status_code = client.lvols_status[lvol.path];
    let repair_action = null;

    if (status_code == "degraded" || status_code == "degraded-maybe-partial")
        repair_action = { title: _("Repair"), action: () => repair(lvol) };

    const cont = new_container({
        parent,
        page_name: lvol.Name,
        page_location: ["vg", vgroup.Name, lvol.Name],
        stored_on_format: _("LVM2 logical volume in $0"),
        has_warning: !!unused_space_warning || !!repair_action,
        has_danger: status_code == "partial",
        component: LVM2LogicalVolumeContainer,
        props: { vgroup, lvol, block, unused_space_warning },
        actions: [
            { title: _("Deactivate"), action: () => lvol.Deactivate({}) },
            lvm2_create_snapshot_action(lvol),
            repair_action,
            { title: _("Delete"), action: () => lvm2_delete_logical_volume_dialog(lvol, cont.page), danger: true },
        ],
    });
    return cont;
}

const LVM2LogicalVolumeContainer = ({ container, vgroup, lvol, block, unused_space_warning }) => {
    const pool = client.lvols[lvol.ThinPool];
    const unused_space = !!unused_space_warning;

    let { info, shrink_excuse, grow_excuse } = get_resize_info(client, block, unused_space);

    if (!unused_space && !grow_excuse && !pool && vgroup.FreeSize == 0) {
        grow_excuse = (
            <div>
                {_("Not enough space to grow.")}
                <br />
                {_("Free up space in this group: Shrink or delete other logical volumes or add another physical volume.")}
            </div>
        );
    }

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
                    navigate_to_new_page_location(container.page, ["vg", vgroup.Name, vals.name]);
                }
            }
        });
    }

    function shrink() {
        return shrink_dialog(client, lvol, info, unused_space);
    }

    function grow() {
        return grow_dialog(client, lvol, info, unused_space);
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
        <SCard title={_("LVM2 logical volume")} actions={<ActionButtons container={container} />}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <SDesc title={_("Name")}>
                        <Flex>
                            <FlexItem>{lvol.Name}</FlexItem>
                            <FlexItem>
                                <StorageLink onClick={rename}>
                                    {_("edit")}
                                </StorageLink>
                            </FlexItem>
                        </Flex>
                    </SDesc>
                    { (layout && layout != "linear") &&
                    <SDesc title={_("Layout")} value={layout_desc[layout] || layout} />
                    }
                    <StructureDescription client={client} lvol={lvol} />
                    { !unused_space &&
                    <SDesc title={_("Size")}>
                        {fmt_size(lvol.Size)}
                        <div className="tab-row-actions">
                            <StorageButton excuse={shrink_excuse} onClick={shrink}>{_("Shrink")}</StorageButton>
                            <StorageButton excuse={grow_excuse} onClick={grow}>{_("Grow")}</StorageButton>
                        </div>
                    </SDesc>
                    }
                </DescriptionList>
                { unused_space &&
                <>
                    <br />
                    <Alert variant="warning"
                           isInline
                           title={_("This logical volume is not completely used by its content.")}>
                        {cockpit.format(_("Volume size is $0. Content size is $1."),
                                        fmt_size(unused_space_warning.volume_size),
                                        fmt_size(unused_space_warning.content_size))}
                        <div className='storage_alert_action_buttons'>
                            <StorageButton excuse={shrink_excuse} onClick={shrink}>{_("Shrink volume")}</StorageButton>
                            <StorageButton excuse={grow_excuse} onClick={grow}>{_("Grow content")}</StorageButton>
                        </div>
                    </Alert>
                </>
                }
            </CardBody>
        </SCard>);
};
