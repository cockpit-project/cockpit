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
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { MinusIcon, PlusIcon } from "@patternfly/react-icons";
import * as utils from "./utils.js";
import { StdDetailsLayout } from "./details.jsx";
import { SidePanel } from "./side-panel.jsx";
import { Block } from "./content-views.jsx";
import { StorageButton, StorageOnOff } from "./storage-controls.jsx";
import {
    dialog_open, SelectSpaces, BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "./dialog.jsx";

const _ = cockpit.gettext;

class MDRaidSidebar extends React.Component {
    render() {
        const self = this;
        const client = self.props.client;
        const mdraid = self.props.mdraid;

        function filter_inside_mdraid(spc) {
            let block = spc.block;
            if (client.blocks_part[block.path])
                block = client.blocks[client.blocks_part[block.path].Table];
            return block && block.MDRaid != mdraid.path;
        }

        function rescan(path) {
            // mdraid often forgets to trigger udev, let's do it explicitly
            return client.wait_for(() => client.blocks[path]).then(block => block.Rescan({ }));
        }

        function add_disk() {
            dialog_open({
                Title: _("Add disks"),
                Fields: [
                    SelectSpaces("disks", _("Disks"),
                                 {
                                     empty_warning: _("No disks are available."),
                                     validate: function (disks) {
                                         if (disks.length === 0)
                                             return _("At least one disk is needed.");
                                     },
                                     spaces: utils.get_available_spaces(client).filter(filter_inside_mdraid)
                                 })
                ],
                Action: {
                    Title: _("Add"),
                    action: function(vals) {
                        return utils.prepare_available_spaces(client, vals.disks).then(paths =>
                            Promise.all(paths.map(p => mdraid.AddDevice(p, {}).then(() => rescan(p)))));
                    }
                }
            });
        }

        const members = client.mdraids_members[mdraid.path] || [];
        const dynamic_members = (mdraid.Level != "raid0");

        let n_spares = 0;
        let n_recovering = 0;
        mdraid.ActiveDevices.forEach(function(as) {
            if (as[2].indexOf("spare") >= 0) {
                if (as[1] < 0)
                    n_spares += 1;
                else
                    n_recovering += 1;
            }
        });

        /* Older versions of Udisks/storaged don't have a Running property */
        let running = mdraid.Running;
        if (running === undefined)
            running = mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0;

        function render_member(block) {
            const active_state = mdraid.ActiveDevices.find(as => as[0] == block.path);

            function state_text(state) {
                return {
                    faulty: _("Failed"),
                    in_sync: _("In sync"),
                    spare: active_state[1] < 0 ? _("Spare") : _("Recovering"),
                    write_mostly: _("Write-mostly"),
                    blocked: _("Blocked")
                }[state] || cockpit.format(_("Unknown ($0)"), state);
            }

            const slot = active_state && active_state[1] >= 0 && active_state[1].toString();
            let states = active_state && active_state[2].map(state_text).join(", ");

            if (slot)
                states = cockpit.format(_("Slot $0"), slot) + ", " + states;

            const is_in_sync = (active_state && active_state[2].indexOf("in_sync") >= 0);
            const is_recovering = (active_state && active_state[2].indexOf("spare") >= 0 && active_state[1] >= 0);

            let remove_excuse = false;
            if (!running)
                remove_excuse = _("The RAID device must be running in order to remove disks.");
            else if ((is_in_sync && n_recovering > 0) || is_recovering)
                remove_excuse = _("This disk cannot be removed while the device is recovering.");
            else if (is_in_sync && n_spares < 1)
                remove_excuse = _("A spare disk needs to be added first before this disk can be removed.");
            else if (members.length <= 1)
                remove_excuse = _("The last disk of a RAID device cannot be removed.");

            function remove() {
                return mdraid.RemoveDevice(block.path, { wipe: { t: 'b', v: true } });
            }

            let action = null;
            if (dynamic_members)
                action = (
                    <StorageButton ariaLabel={_("Remove")} onClick={remove} excuse={remove_excuse}>
                        <MinusIcon />
                    </StorageButton>);

            return { client, block, actions: action, detail: states, key: block.path };
        }

        let add_excuse = false;
        if (!running)
            add_excuse = _("The RAID device must be running in order to add spare disks.");

        let action = null;
        if (dynamic_members)
            action = (
                <StorageButton ariaLabel={_("Add")} onClick={add_disk} excuse={add_excuse}>
                    <PlusIcon />
                </StorageButton>);

        return <SidePanel title={_("Disks")} actions={action} rows={members.map(render_member)} />;
    }
}

export class MDRaidDetails extends React.Component {
    render() {
        const client = this.props.client;
        const mdraid = this.props.mdraid;
        const block = mdraid && client.mdraids_block[mdraid.path];

        function format_level(str) {
            return {
                raid0: _("RAID 0"),
                raid1: _("RAID 1"),
                raid4: _("RAID 4"),
                raid5: _("RAID 5"),
                raid6: _("RAID 6"),
                raid10: _("RAID 10")
            }[str] || cockpit.format(_("RAID ($0)"), str);
        }

        let level = format_level(mdraid.Level);
        if (mdraid.NumDevices > 0)
            level += ", " + cockpit.format(_("$0 disks"), mdraid.NumDevices);
        if (mdraid.ChunkSize > 0)
            level += ", " + cockpit.format(_("$0 chunk size"), utils.fmt_size(mdraid.ChunkSize));

        function toggle_bitmap(val) {
            return mdraid.SetBitmapLocation(utils.encode_filename(val ? 'internal' : 'none'), {});
        }

        let bitmap = null;
        if (mdraid.BitmapLocation) {
            const value = utils.decode_filename(mdraid.BitmapLocation) != "none";
            bitmap = (
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("storage", "Bitmap")}</DescriptionListTerm>
                    <DescriptionListDescription>
                        <StorageOnOff state={value} aria-label={_("Toggle bitmap")} onChange={toggle_bitmap} />
                    </DescriptionListDescription>
                </DescriptionListGroup>
            );
        }

        let degraded_message = null;
        if (mdraid.Degraded > 0) {
            const text = cockpit.format(
                cockpit.ngettext("$0 disk is missing", "$0 disks are missing", mdraid.Degraded),
                mdraid.Degraded
            );
            degraded_message = (
                <Alert isInline variant="danger" title={_("The RAID array is in a degraded state")}> {text} </Alert>
            );
        }

        /* Older versions of Udisks/storaged don't have a Running property */
        let running = mdraid.Running;
        if (running === undefined)
            running = mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0;

        function start() {
            return mdraid.Start({ "start-degraded": { t: 'b', v: true } });
        }

        function stop() {
            const usage = utils.get_active_usage(client, block ? block.path : "", _("stop"));

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in use"), utils.mdraid_name(mdraid)),
                    Body: BlockingMessage(usage),
                });
                return;
            }

            if (usage.Teardown) {
                dialog_open({
                    Title: cockpit.format(_("Confirm stopping of $0"),
                                          utils.mdraid_name(mdraid)),
                    Teardown: TeardownMessage(usage),
                    Action: {
                        Title: _("Stop device"),
                        action: function () {
                            return utils.teardown_active_usage(client, usage)
                                    .then(function () {
                                        return mdraid.Stop({});
                                    });
                        }
                    },
                    Inits: [
                        init_active_usage_processes(client, usage)
                    ]
                });
                return;
            }

            return mdraid.Stop({});
        }

        function delete_dialog() {
            const location = cockpit.location;

            function delete_() {
                if (mdraid.Delete)
                    return mdraid.Delete({ 'tear-down': { t: 'b', v: true } }).then(utils.reload_systemd);

                // If we don't have a Delete method, we simulate
                // it by stopping the array and wiping all
                // members.

                function wipe_members() {
                    return Promise.all(client.mdraids_members[mdraid.path].map(member => member.Format('empty', { })));
                }

                if (mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0)
                    return mdraid.Stop({}).then(wipe_members);
                else
                    return wipe_members();
            }

            const usage = utils.get_active_usage(client, block ? block.path : "", _("delete"));

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in use"), utils.mdraid_name(mdraid)),
                    Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Permanently delete $0?"), utils.mdraid_name(mdraid)),
                Teardown: TeardownMessage(usage),
                Action: {
                    Title: _("Delete"),
                    Danger: _("Deleting erases all data on a RAID device."),
                    action: function () {
                        return utils.teardown_active_usage(client, usage)
                                .then(delete_)
                                .then(function () {
                                    location.go('/');
                                });
                    }
                },
                Inits: [
                    init_active_usage_processes(client, usage)
                ]
            });
        }

        const header = (
            <Card>
                <CardHeader actions={{
                    actions: <>
                        { running
                            ? <StorageButton onClick={stop}>{_("Stop")}</StorageButton>
                            : <StorageButton onClick={start}>{_("Start")}</StorageButton>
                        }
                        { "\n" }
                        <StorageButton kind="danger" onClick={delete_dialog}>{_("Delete")}</StorageButton>
                    </>,
                }}>
                    <CardTitle><Text component={TextVariants.h2}>{ cockpit.format(_("RAID device $0"), utils.mdraid_name(mdraid)) }</Text></CardTitle>
                </CardHeader>
                <CardBody>
                    <DescriptionList className="pf-m-horizontal-on-sm">
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "Device")}</DescriptionListTerm>
                            <DescriptionListDescription>{ block ? utils.decode_filename(block.PreferredDevice) : "-" }</DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "UUID")}</DescriptionListTerm>
                            <DescriptionListDescription>{ mdraid.UUID }</DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "Capacity")}</DescriptionListTerm>
                            <DescriptionListDescription>{ utils.fmt_size_long(mdraid.Size) }</DescriptionListDescription>
                        </DescriptionListGroup>

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "RAID level")}</DescriptionListTerm>
                            <DescriptionListDescription>{ level }</DescriptionListDescription>
                        </DescriptionListGroup>

                        { bitmap }

                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "State")}</DescriptionListTerm>
                            <DescriptionListDescription>{ running ? _("Running") : _("Not running") }</DescriptionListDescription>
                        </DescriptionListGroup>
                    </DescriptionList>
                </CardBody>
            </Card>
        );

        const sidebar = <MDRaidSidebar client={this.props.client} mdraid={mdraid} />;

        const content = <Block client={this.props.client} block={block} />;

        return <StdDetailsLayout client={this.props.client} alert={degraded_message}
                                 header={ header }
                                 sidebar={ sidebar }
                                 content={ content }
        />;
    }
}
