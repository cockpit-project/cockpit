/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import * as utils from "./utils.js";

import React from "react";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ExclamationTriangleIcon, ExclamationCircleIcon } from "@patternfly/react-icons";
import { StorageButton, StorageLink, StorageOnOff } from "./storage-controls.jsx";
import { dialog_open, TextInput } from "./dialog.jsx";
import { get_resize_info, grow_dialog, shrink_dialog } from "./resize.jsx";
import { fmt_size } from "./utils.js";

const _ = cockpit.gettext;

export function check_partial_lvols(client, path, enter_warning) {
    if (client.lvols_status[path] && client.lvols_status[path] != "") {
        enter_warning(path, {
            warning: "partial-lvol",
            danger: client.lvols_status[path] != "degraded"
        });
    }
}

function lvol_rename(lvol) {
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

const StructureDescription = ({ client, lvol }) => {
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
        return utils.block_name(client.blocks[block.CryptoBackingDevice] || block);
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
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Physical volumes")}</DescriptionListTerm>
                <DescriptionListDescription>
                    <Flex spaceItems={{ default: "spaceItemsNone" }}
                          alignItems={{ default: "alignItemsStretch" }}>
                        {stripe}
                    </Flex>
                    {status}
                </DescriptionListDescription>
            </DescriptionListGroup>);
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
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Stripes")}</DescriptionListTerm>
                    <DescriptionListDescription>
                        <Flex alignItems={{ default: "alignItemsStretch" }}>{stripes}</Flex>
                        {status}
                        {lvol.SyncRatio != 1.0
                            ? <div>{cockpit.format(_("$0 synchronized"), lvol.SyncRatio * 100 + "%")}</div>
                            : null}
                    </DescriptionListDescription>
                </DescriptionListGroup>
            </>);
    }

    return null;
};

export class BlockVolTab extends React.Component {
    render() {
        const self = this;
        const client = self.props.client;
        const lvol = self.props.lvol;
        const pool = client.lvols[lvol.ThinPool];
        const block = client.lvols_block[lvol.path];
        const vgroup = client.vgroups[lvol.VolumeGroup];
        const unused_space_warning = self.props.warnings.find(w => w.warning == "unused-space");
        const unused_space = !!unused_space_warning;

        function rename() {
            lvol_rename(lvol);
        }

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

        const layout = this.props.lvol.Layout;

        return (
            <div>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Name")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Flex>
                                <FlexItem>{this.props.lvol.Name}</FlexItem>
                                <FlexItem><StorageLink onClick={rename}>{_("edit")}</StorageLink></FlexItem>
                            </Flex>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    { (layout && layout != "linear") &&
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Layout")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Flex>
                                <FlexItem>{layout_desc[layout] || layout}</FlexItem>
                            </Flex>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                    <StructureDescription client={client} lvol={this.props.lvol} />
                    { !unused_space &&
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Size")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {utils.fmt_size(this.props.lvol.Size)}
                            <div className="tab-row-actions">
                                <StorageButton excuse={shrink_excuse} onClick={shrink}>{_("Shrink")}</StorageButton>
                                <StorageButton excuse={grow_excuse} onClick={grow}>{_("Grow")}</StorageButton>
                            </div>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                </DescriptionList>
                { unused_space &&
                <>
                    <br />
                    <Alert variant="warning"
                           isInline
                           title={_("This logical volume is not completely used by its content.")}>
                        {cockpit.format(_("Volume size is $0. Content size is $1."),
                                        utils.fmt_size(unused_space_warning.volume_size),
                                        utils.fmt_size(unused_space_warning.content_size))}
                        <div className='storage_alert_action_buttons'>
                            <StorageButton excuse={shrink_excuse} onClick={shrink}>{_("Shrink volume")}</StorageButton>
                            <StorageButton excuse={grow_excuse} onClick={grow}>{_("Grow content")}</StorageButton>
                        </div>
                    </Alert>
                </>
                }
            </div>
        );
    }
}

function perc(ratio) {
    return (ratio * 100).toFixed(0) + "%";
}

export class PoolVolTab extends React.Component {
    render() {
        const self = this;
        const client = self.props.client;
        const lvol = self.props.lvol;
        const vgroup = client.vgroups[lvol.VolumeGroup];

        function rename() {
            lvol_rename(self.props.lvol);
        }

        function grow() {
            grow_dialog(self.props.client, self.props.lvol, { });
        }

        let grow_excuse = null;
        if (vgroup.FreeSize == 0) {
            grow_excuse = (
                <div>
                    {_("Not enough space to grow.")}
                    <br />
                    {_("Free up space in this group: Shrink or delete other logical volumes or add another physical volume.")}
                </div>
            );
        }

        return (
            <DescriptionList className="pf-m-horizontal-on-sm">
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Name")}</DescriptionListTerm>
                    <DescriptionListDescription>
                        <Flex>
                            <FlexItem>{this.props.lvol.Name}</FlexItem>
                            <FlexItem><StorageLink onClick={rename}>{_("edit")}</StorageLink></FlexItem>
                        </Flex>
                    </DescriptionListDescription>
                </DescriptionListGroup>

                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Size")}</DescriptionListTerm>
                    <DescriptionListDescription>
                        {utils.fmt_size(this.props.lvol.Size)}
                        <DescriptionListDescription className="tab-row-actions">
                            <StorageButton excuse={grow_excuse} onClick={grow}>{_("Grow")}</StorageButton>
                        </DescriptionListDescription>
                    </DescriptionListDescription>
                </DescriptionListGroup>

                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Data used")}</DescriptionListTerm>
                    <DescriptionListDescription>{perc(this.props.lvol.DataAllocatedRatio)}</DescriptionListDescription>
                </DescriptionListGroup>

                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Metadata used")}</DescriptionListTerm>
                    <DescriptionListDescription>{perc(this.props.lvol.MetadataAllocatedRatio)}</DescriptionListDescription>
                </DescriptionListGroup>
            </DescriptionList>
        );
    }
}

export const VDOPoolTab = ({ client, lvol }) => {
    const vdo_iface = client.vdo_vols[lvol.path];
    const vdo_pool_vol = client.lvols[vdo_iface.VDOPool];

    if (!vdo_pool_vol)
        return null;

    function grow() {
        grow_dialog(client, vdo_pool_vol, { });
    }

    function toggle_compression() {
        const new_state = !vdo_iface.Compression;
        return vdo_iface.EnableCompression(new_state, {})
                .then(() => client.wait_for(() => vdo_iface.Compression === new_state));
    }

    function toggle_deduplication() {
        const new_state = !vdo_iface.Deduplication;
        return vdo_iface.EnableDeduplication(new_state, {})
                .then(() => client.wait_for(() => vdo_iface.Deduplication === new_state));
    }

    const used_pct = perc(vdo_iface.UsedSize / vdo_pool_vol.Size);

    return (
        <DescriptionList className="pf-m-horizontal-on-sm">
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Name")}</DescriptionListTerm>
                <DescriptionListDescription>{vdo_pool_vol.Name}</DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
                <DescriptionListTerm>{_("Size")}</DescriptionListTerm>
                <DescriptionListDescription>
                    {utils.fmt_size(vdo_pool_vol.Size)}
                    <DescriptionListDescription className="tab-row-actions">
                        <StorageButton onClick={grow}>{_("Grow")}</StorageButton>
                    </DescriptionListDescription>
                </DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
                <DescriptionListTerm>{_("Data used")}</DescriptionListTerm>
                <DescriptionListDescription>{utils.fmt_size(vdo_iface.UsedSize)} ({used_pct})</DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
                <DescriptionListTerm>{_("Metadata used")}</DescriptionListTerm>
                <DescriptionListDescription>{perc(lvol.MetadataAllocatedRatio)}</DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
                <DescriptionListTerm>{_("Compression")}</DescriptionListTerm>
                <DescriptionListDescription>
                    <StorageOnOff state={vdo_iface.Compression} aria-label={_("Use compression")} onChange={toggle_compression} />
                </DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
                <DescriptionListTerm>{_("Deduplication")}</DescriptionListTerm>
                <DescriptionListDescription>
                    <StorageOnOff state={vdo_iface.Deduplication} aria-label={_("Use deduplication")} onChange={toggle_deduplication} />
                </DescriptionListDescription>
            </DescriptionListGroup>
        </DescriptionList>
    );
};
