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

import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { PlusIcon, MinusIcon } from "@patternfly/react-icons";

import * as utils from "./utils.js";
import { fmt_to_fragments } from "utils.jsx";
import { StdDetailsLayout } from "./details.jsx";
import { SidePanel } from "./side-panel.jsx";
import { VGroup } from "./content-views.jsx";
import { StorageButton } from "./storage-controls.jsx";
import {
    dialog_open, TextInput, SelectSpaces,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "./dialog.jsx";

const _ = cockpit.gettext;

class VGroupSidebar extends React.Component {
    render() {
        const self = this;
        const client = self.props.client;
        const vgroup = self.props.vgroup;
        const pvols = client.vgroups_pvols[vgroup.path] || [];

        function filter_inside_vgroup(spc) {
            let block = spc.block;
            if (client.blocks_part[block.path])
                block = client.blocks[client.blocks_part[block.path].Table];
            const lvol = (block &&
                        client.blocks_lvm2[block.path] &&
                        client.lvols[client.blocks_lvm2[block.path].LogicalVolume]);
            return !lvol || lvol.VolumeGroup != vgroup.path;
        }

        function add_disk() {
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
                                     spaces: utils.get_available_spaces(client).filter(filter_inside_vgroup)
                                 })
                ],
                Action: {
                    Title: _("Add"),
                    action: function(vals) {
                        return utils.prepare_available_spaces(client, vals.disks).then(paths =>
                            Promise.all(paths.map(p => vgroup.AddDevice(p, {}))));
                    }
                }
            });
        }

        function render_pvol(pvol) {
            let remove_action = null;
            let remove_excuse = null;

            function pvol_remove() {
                return vgroup.RemoveDevice(pvol.path, true, {});
            }

            function pvol_empty_and_remove() {
                return (vgroup.EmptyDevice(pvol.path, {})
                        .then(function() {
                            vgroup.RemoveDevice(pvol.path, true, {});
                        }));
            }

            if (pvols.length === 1) {
                remove_excuse = _("The last physical volume of a volume group cannot be removed.");
            } else if (pvol.FreeSize < pvol.Size) {
                if (pvol.Size <= vgroup.FreeSize)
                    remove_action = pvol_empty_and_remove;
                else
                    remove_excuse = cockpit.format(
                        _("There is not enough free space elsewhere to remove this physical volume. At least $0 more free space is needed."),
                        utils.fmt_size(pvol.Size - vgroup.FreeSize)
                    );
            } else {
                remove_action = pvol_remove;
            }

            return {
                client,
                block: client.blocks[pvol.path],
                key: pvol.path,
                detail: cockpit.format(_("$0, $1 free"), utils.fmt_size(pvol.Size), utils.fmt_size(pvol.FreeSize)),
                actions: <StorageButton aria-label={_("Remove")} onClick={remove_action} excuse={remove_excuse}>
                    <MinusIcon />
                </StorageButton>
            };
        }

        return (
            <SidePanel title={_("Physical volumes")}
                       actions={<StorageButton aria-label={_("Add")} onClick={add_disk}><PlusIcon /></StorageButton>}
                       rows={pvols.map(render_pvol)} />
        );
    }
}

export function vgroup_rename(client, vgroup) {
    const location = cockpit.location;

    dialog_open({
        Title: _("Rename volume group"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: vgroup.Name,
                          validate: utils.validate_lvm2_name
                      })
        ],
        Action: {
            Title: _("Rename"),
            action: function (vals) {
                return vgroup.Rename(vals.name, { })
                        .then(function () {
                            location.go(['vg', vals.name]);
                        });
            }
        }
    });
}

export function vgroup_delete(client, vgroup) {
    const location = cockpit.location;
    const usage = utils.get_active_usage(client, vgroup.path, _("delete"));

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
            action: function () {
                return utils.teardown_active_usage(client, usage)
                        .then(function () {
                            return vgroup.Delete(true,
                                                 { 'tear-down': { t: 'b', v: true } })
                                    .then(utils.reload_systemd)
                                    .then(function () {
                                        location.go('/');
                                    });
                        });
            }
        },
        Inits: [
            init_active_usage_processes(client, usage)
        ]
    });
}

export class VGroupDetails extends React.Component {
    constructor() {
        super();
        this.poll_timer = null;
    }

    ensurePolling(needs_polling) {
        if (needs_polling && this.poll_timer === null) {
            this.poll_timer = window.setInterval(() => { this.props.vgroup.Poll() }, 2000);
        } else if (!needs_polling && this.poll_timer !== null) {
            window.clearInterval(this.poll_timer);
            this.poll_timer = null;
        }
    }

    componentWillUnmount() {
        this.ensurePolling(false);
    }

    render() {
        const client = this.props.client;
        const vgroup = this.props.vgroup;

        this.ensurePolling(vgroup.NeedsPolling);

        const header = (
            <Card>
                <CardHeader actions={{
                    actions: (
                        <>
                            <StorageButton onClick={() => vgroup_rename(client, vgroup)}>{_("Rename")}</StorageButton>
                            { "\n" }
                            <StorageButton kind="danger" onClick={() => vgroup_delete(client, vgroup)}>{_("Delete")}</StorageButton>
                        </>
                    ),
                }}>
                    <CardTitle component="h2">{fmt_to_fragments(_("LVM2 volume group $0"), <b>{vgroup.Name}</b>)}</CardTitle>
                </CardHeader>
                <CardBody>
                    <DescriptionList className="pf-m-horizontal-on-sm">
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "UUID")}</DescriptionListTerm>
                            <DescriptionListDescription>{ vgroup.UUID }</DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "Capacity")}</DescriptionListTerm>
                            <DescriptionListDescription>{ utils.fmt_size_long(vgroup.Size) }</DescriptionListDescription>
                        </DescriptionListGroup>
                    </DescriptionList>
                </CardBody>
            </Card>
        );

        const sidebar = <VGroupSidebar client={this.props.client} vgroup={vgroup} />;

        const content = <VGroup client={this.props.client} vgroup={vgroup} />;

        return <StdDetailsLayout client={this.props.client} header={ header } sidebar={ sidebar } content={ content } />;
    }
}
