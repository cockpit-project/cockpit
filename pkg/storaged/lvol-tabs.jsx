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
import { StorageButton, StorageLink, StorageOnOff } from "./storage-controls.jsx";
import { dialog_open, TextInput } from "./dialog.jsx";
import { get_resize_info, grow_dialog, shrink_dialog } from "./resize.jsx";

const _ = cockpit.gettext;

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

        function rename() {
            lvol_rename(self.props.lvol);
        }

        function grow() {
            grow_dialog(self.props.client, self.props.lvol, { });
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
                            <StorageButton onClick={grow}>{_("Grow")}</StorageButton>
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
