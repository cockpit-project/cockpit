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

import { VolumeIcon } from "../icons/gnome-icons.jsx";
import { StorageButton, StorageLink } from "../storage-controls.jsx";
import {
    StorageCard, StorageDescription, PageTable,
    new_page, new_card, PAGE_CATEGORY_VIRTUAL,
    get_crossrefs, navigate_away_from_card
} from "../pages.jsx";
import { make_block_page } from "../block/create-pages.jsx";
import {
    block_short_name, mdraid_name, encode_filename, decode_filename,
    fmt_size, fmt_size_long, get_active_usage, teardown_active_usage,
    get_available_spaces, prepare_available_spaces,
    reload_systemd, should_ignore,
} from "../utils.js";

import {
    dialog_open, SelectSpaces,
    BlockingMessage, TeardownMessage,
    init_teardown_usage
} from "../dialog.jsx";

import { partitionable_block_actions } from "../partitions/actions.jsx";

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
                init_teardown_usage(client, usage)
            ]
        });
        return;
    }

    return mdraid.Stop({});
}

function mdraid_delete(mdraid, block, card) {
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
            Danger: _("Deleting erases all data on a MDRAID device."),
            action: async function () {
                await teardown_active_usage(client, usage);
                await delete_();
                navigate_away_from_card(card);
            }
        },
        Inits: [
            init_teardown_usage(client, usage)
        ]
    });
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

function missing_bitmap(mdraid) {
    let policy;
    if (mdraid.ConsistencyPolicy)
        policy = mdraid.ConsistencyPolicy;
    else if (mdraid.ActiveDevices.some(a => a[2].indexOf("journal") >= 0))
        policy = "journal";
    else if (mdraid.BitmapLocation && decode_filename(mdraid.BitmapLocation) != "none")
        policy = "bitmap";
    else
        policy = "resync";

    return (mdraid.Level != "raid0" &&
            client.mdraids_members[mdraid.path].some(m => m.Size > 100 * 1024 * 1024 * 1024) &&
            policy == "resync");
}

export function make_mdraid_page(parent, mdraid) {
    const block = client.mdraids_block[mdraid.path];

    if (should_ignore(client, mdraid.path))
        return;

    let add_excuse = false;
    if (!block)
        add_excuse = _("MDRAID device must be running");

    const mdraid_card = new_card({
        title: _("MDRAID device"),
        next: null,
        page_location: ["mdraid", mdraid.UUID],
        page_name: block ? block_short_name(block) : mdraid_name(mdraid),
        page_icon: VolumeIcon,
        page_category: PAGE_CATEGORY_VIRTUAL,
        page_size: mdraid.Size,
        type_extra: !block && _("stopped"),
        id_extra: block && _("MDRAID device"),
        for_summary: true,
        has_warning: mdraid.Degraded > 0 || missing_bitmap(mdraid),
        job_path: mdraid.path,
        component: MDRaidCard,
        props: { mdraid, block },
        actions: [
            (!block &&
             {
                 title: _("Start"),
                 action: () => mdraid_start(mdraid),
                 tag: "device"
             }),
            (mdraid.Level != "raid0" &&
             {
                 title: _("Add disk"),
                 action: () => add_disk(mdraid),
                 excuse: add_excuse,
                 tag: "disks",
             }),
            ...(block ? partitionable_block_actions(block, "device") : []),
            {
                title: _("Delete"),
                action: () => mdraid_delete(mdraid, block, mdraid_card),
                danger: true,
            },
        ],
    });

    if (!block) {
        new_page(parent, mdraid_card);
    } else
        make_block_page(parent, block, mdraid_card);
}

const MDRaidCard = ({ card, mdraid, block }) => {
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

    const alerts = [];
    if (mdraid.Degraded > 0) {
        const text = cockpit.format(
            cockpit.ngettext("$0 disk is missing", "$0 disks are missing", mdraid.Degraded),
            mdraid.Degraded
        );
        alerts.push(
            <Alert isInline variant="danger" key="degraded"
                   title={_("The MDRAID device is in a degraded state")}>
                {text}
            </Alert>);
    }

    function fix_bitmap() {
        return mdraid.SetBitmapLocation(encode_filename("internal"), { });
    }

    if (missing_bitmap(mdraid)) {
        alerts.push(
            <Alert isInline variant="warning" key="bitmap"
                   title={_("This MDRAID device has no write-intent bitmap. Such a bitmap can reduce synchronization times significantly.")}>
                <div className="storage-alert-actions">
                    <StorageButton onClick={fix_bitmap}>{_("Add a bitmap")}</StorageButton>
                </div>
            </Alert>);
    }

    return (
        <StorageCard card={card} alerts={alerts}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")} value={mdraid_name(mdraid)} />
                    <StorageDescription title={_("RAID level")} value={level} />
                    <StorageDescription title={_("State")} value={block ? _("Running") : _("Not running")}
                                        action={block && <StorageLink onClick={() => mdraid_stop(mdraid)}>
                                            {_("Stop")}
                                        </StorageLink>} />
                    <StorageDescription title={_("UUID")} value={mdraid.UUID} />
                    <StorageDescription title={_("Device")} value={block ? decode_filename(block.PreferredDevice) : "-"} />
                    <StorageDescription title={_("Capacity")} value={fmt_size_long(mdraid.Size)} />
                </DescriptionList>
            </CardBody>
            <CardHeader><strong>{_("Disks")}</strong></CardHeader>
            <CardBody className="contains-list">
                <PageTable emptyCaption={_("No disks found")}
                           aria-label={_("MDRAID disks")}
                           crossrefs={get_crossrefs(mdraid)} />
            </CardBody>
        </StorageCard>
    );
};
