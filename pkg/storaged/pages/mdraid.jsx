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

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { StorageButton } from "../storage-controls.jsx";
import { PageChildrenCard, PageCrossrefCard, ActionButtons, new_page, get_crossrefs, page_type } from "../pages.jsx";
import {
    block_name, mdraid_name, encode_filename, decode_filename,
    fmt_size, fmt_size_long, get_active_usage, teardown_active_usage,
    get_available_spaces, prepare_available_spaces,
    reload_systemd,
} from "../utils.js";

import {
    dialog_open, SelectSpaces,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "../dialog.jsx";

import { partitionable_block_actions, make_partitionable_block_pages } from "./drive.jsx";

const _ = cockpit.gettext;

function mdraid_start(mdraid) {
    return mdraid.Start({ "start-degraded": { t: 'b', v: true } });
}

function mdraid_stop(mdraid) {
    const block = client.mdraids_block[mdraid.path];
    const usage = get_active_usage(client, block ? block.path : "", _("stop"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), mdraid_name(mdraid)),
            Body: BlockingMessage(usage),
        });
        return;
    }

    if (usage.Teardown) {
        dialog_open({
            Title: cockpit.format(_("Confirm stopping of $0"),
                                  mdraid_name(mdraid)),
            Teardown: TeardownMessage(usage),
            Action: {
                Title: _("Stop device"),
                action: function () {
                    return teardown_active_usage(client, usage)
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

function mdraid_delete(mdraid, block) {
    const location = cockpit.location;

    function delete_() {
        if (mdraid.Delete)
            return mdraid.Delete({ 'tear-down': { t: 'b', v: true } }).then(reload_systemd);

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

    const usage = get_active_usage(client, block ? block.path : "", _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), mdraid_name(mdraid)),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Permanently delete $0?"), mdraid_name(mdraid)),
        Teardown: TeardownMessage(usage),
        Action: {
            Title: _("Delete"),
            Danger: _("Deleting erases all data on a RAID device."),
            action: function () {
                return teardown_active_usage(client, usage)
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

function start_stop_action(mdraid) {
    let running = mdraid.Running;
    if (running === undefined)
        running = mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0;

    if (running)
        return { title: _("Stop"), action: () => mdraid_stop(mdraid), tag: "device" };
    else
        return { title: _("Start"), action: () => mdraid_start(mdraid), tag: "device" };
}

function add_disk(mdraid) {
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
                             spaces: get_available_spaces(client).filter(filter_inside_mdraid)
                         })
        ],
        Action: {
            Title: _("Add"),
            action: function(vals) {
                return prepare_available_spaces(client, vals.disks).then(paths =>
                    Promise.all(paths.map(p => mdraid.AddDevice(p, {}).then(() => rescan(p)))));
            }
        }
    });
}

export function make_mdraid_page(parent, mdraid) {
    const block = client.mdraids_block[mdraid.path];

    /* Older versions of Udisks/storaged don't have a Running property */
    let running = mdraid.Running;
    if (running === undefined)
        running = mdraid.ActiveDevices && mdraid.ActiveDevices.length > 0;

    // XXX - set has_warning appropriately
    const p = new_page({
        location: ["mdraid", mdraid.UUID],
        parent,
        name: mdraid_name(mdraid),
        columns: [
            _("RAID device"),
            block ? block_name(block) : null,
            fmt_size(mdraid.Size),
        ],
        component: MDRaidPage,
        props: { mdraid, block, running },
        actions: (block ? partitionable_block_actions(block, "content") : [])
                .concat([
                    (mdraid.Level != "raid0" &&
                 {
                     title: _("Add disk"),
                     action: () => add_disk(mdraid),
                     excuse: !running && _("The RAID device must be running in order to add spare disks."),
                     tag: "disks",
                 }),
                    start_stop_action(mdraid),
                    {
                        title: _("Delete"),
                        action: () => mdraid_delete(mdraid, block),
                        danger: true,
                        tag: "device",
                    },
                ]),
    });

    if (block)
        make_partitionable_block_pages(p, block);
}

const MDRaidPage = ({ page, mdraid, block, running }) => {
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
        level += ", " + cockpit.format(_("$0 chunk size"), fmt_size(mdraid.ChunkSize));

    let degraded_message = null;
    if (mdraid.Degraded > 0) {
        const text = cockpit.format(
            cockpit.ngettext("$0 disk is missing", "$0 disks are missing", mdraid.Degraded),
            mdraid.Degraded
        );
        degraded_message = (
            <StackItem>
                <Alert isInline variant="danger" title={_("The RAID array is in a degraded state")}>
                    {text}
                </Alert>
            </StackItem>
        );
    }

    function fix_bitmap() {
        return mdraid.SetBitmapLocation(encode_filename("internal"), { });
    }

    let bitmap_message = null;
    if (mdraid.Level != "raid0" &&
        client.mdraids_members[mdraid.path].some(m => m.Size > 100 * 1024 * 1024 * 1024) &&
        mdraid.BitmapLocation && decode_filename(mdraid.BitmapLocation) == "none") {
        bitmap_message = (
            <StackItem>
                <Alert isInline variant="warning"
                       title={_("This RAID array has no write-intent bitmap. Such a bitmap can reduce sychronization times significantly.")}>
                    <div className="storage_alert_action_buttons">
                        <StorageButton onClick={fix_bitmap}>{_("Add a bitmap")}</StorageButton>
                    </div>
                </Alert>
            </StackItem>
        );
    }

    return (
        <Stack hasGutter>
            {bitmap_message}
            {degraded_message}
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} tag="device" />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Device")} value={block ? decode_filename(block.PreferredDevice) : "-"} />
                            <SDesc title={_("UUID")} value={mdraid.UUID} />
                            <SDesc ttile={_("Capacity")} value={fmt_size_long(mdraid.Size)} />
                            <SDesc title={_("RAID level")} value={level} />
                            <SDesc title={_("State")} value={running ? _("Running") : _("Not running")} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <StackItem>
                <PageCrossrefCard title={_("Disks")}
                                  actions={<ActionButtons page={page} tag="disks" />}
                                  crossrefs={get_crossrefs(mdraid)} />
            </StackItem>
            { block &&
            <StackItem>
                <PageChildrenCard title={client.blocks_ptable[block.path] ? _("Partitions") : _("Content")}
                                  actions={<ActionButtons page={page} tag="content" />}
                                  emptyCaption={_("Device is not formatted")}
                                  page={page} />
            </StackItem>
            }
        </Stack>
    );
};
