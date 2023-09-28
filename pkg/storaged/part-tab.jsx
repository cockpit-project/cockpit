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

import React from "react";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { StorageButton } from "./storage-controls.jsx";
import { get_resize_info, free_space_after_part, grow_dialog, shrink_dialog } from "./resize.jsx";

import cockpit from "cockpit";
import * as utils from "./utils.js";

const _ = cockpit.gettext;

export const PartitionTab = ({ client, block, warnings }) => {
    const block_part = client.blocks_part[block.path];
    const unused_space_warning = warnings.find(w => w.warning == "unused-space");
    const unused_space = !!unused_space_warning;

    let { info, shrink_excuse, grow_excuse } = get_resize_info(client, block, unused_space);

    if (!unused_space && !grow_excuse && free_space_after_part(client, block_part) == 0) {
        grow_excuse = _("No free space after this partition");
    }

    function shrink() {
        return shrink_dialog(client, block_part, info, unused_space);
    }

    function grow() {
        return grow_dialog(client, block_part, info, unused_space);
    }

    return (
        <div>
            <DescriptionList className="pf-m-horizontal-on-sm">
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Name")}</DescriptionListTerm>
                    <DescriptionListDescription>{block_part.Name || "-"}</DescriptionListDescription>
                </DescriptionListGroup>
                { !unused_space &&
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Size")}</DescriptionListTerm>
                    <DescriptionListDescription>
                        {utils.fmt_size(block_part.Size)}
                        <div className="tab-row-actions">
                            <StorageButton excuse={shrink_excuse} onClick={shrink}>{_("Shrink")}</StorageButton>
                            <StorageButton excuse={grow_excuse} onClick={grow}>{_("Grow")}</StorageButton>
                        </div>
                    </DescriptionListDescription>
                </DescriptionListGroup>
                }
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("UUID")}</DescriptionListTerm>
                    <DescriptionListDescription>{block_part.UUID}</DescriptionListDescription>
                </DescriptionListGroup>

                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Type")}</DescriptionListTerm>
                    <DescriptionListDescription>{block_part.Type}</DescriptionListDescription>
                </DescriptionListGroup>
            </DescriptionList>
            { unused_space &&
            <>
                <br />
                <Alert variant="warning"
                         isInline
                         title={_("This partition is not completely used by its content.")}>
                    {cockpit.format(_("Partition size is $0. Content size is $1."),
                                    utils.fmt_size(unused_space_warning.volume_size),
                                    utils.fmt_size(unused_space_warning.content_size))}
                    <div className='storage_alert_action_buttons'>
                        <StorageButton excuse={shrink_excuse} onClick={shrink}>{_("Shrink partition")}</StorageButton>
                        <StorageButton excuse={grow_excuse} onClick={grow}>{_("Grow content")}</StorageButton>
                    </div>
                </Alert>
            </>
            }
        </div>
    );
};
