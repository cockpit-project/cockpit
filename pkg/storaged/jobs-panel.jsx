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

import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DataList, DataListCell, DataListItem, DataListItemCells, DataListItemRow } from "@patternfly/react-core/dist/esm/components/DataList/index.js";

import { StorageButton } from "./storage-controls.jsx";
import { block_name, mdraid_name, lvol_name, format_delay } from "./utils.js";

const _ = cockpit.gettext;

/* Human readable descriptions of the symbolic "Operation"
 * property of job objects.  These are from the storaged
 * documentation at
 *
 * http://storaged.org/doc/udisks2-api/latest/gdbus-org.freedesktop.UDisks2.Job.html
 */

const descriptions = {
    'ata-smart-selftest': _("SMART self-test of $target"),
    'drive-eject': _("Ejecting $target"),
    'encrypted-unlock': _("Unlocking $target"),
    'encrypted-lock': _("Locking $target"),
    'encrypted-modify': _("Modifying $target"),
    'encrypted-resize': _("Resizing $target"),
    'swapspace-start': _("Starting swapspace $target"),
    'swapspace-stop': _("Stopping swapspace $target"),
    'filesystem-mount': _("Mounting $target"),
    'filesystem-unmount': _("Unmounting $target"),
    'filesystem-modify': _("Modifying $target"),
    'filesystem-resize': _("Resizing $target"),
    'filesystem-check': _("Checking $target"),
    'filesystem-repair': _("Repairing $target"),
    'format-erase': _("Erasing $target"),
    'format-mkfs': _("Creating filesystem on $target"),
    'loop-setup': _("Setting up loop device $target"),
    'partition-modify': _("Modifying $target"),
    'partition-delete': _("Deleting $target"),
    'partition-create': _("Creating partition $target"),
    cleanup: _("Cleaning up for $target"),
    'ata-secure-erase': _("Securely erasing $target"),
    'ata-enhanced-secure-erase': _("Very securely erasing $target"),
    'md-raid-stop': _("Stopping RAID device $target"),
    'md-raid-start': _("Starting RAID device $target"),
    'md-raid-fault-device': _("Marking $target as faulty"),
    'md-raid-remove-device': _("Removing $target from RAID device"),
    'md-raid-create': _("Creating RAID device $target"),
    'mdraid-check-job': _("Checking RAID device $target"),
    'mdraid-repair-job': _("Checking and repairing RAID device $target"),
    'mdraid-recover-job': _("Recovering RAID device $target"),
    'mdraid-sync-job': _("Synchronizing RAID device $target"),
    'lvm-lvol-delete': _("Deleting $target"),
    'lvm-lvol-activate': _("Activating $target"),
    'lvm-lvol-deactivate': _("Deactivating $target"),
    'lvm-lvol-snapshot': _("Creating snapshot of $target"),
    'lvm-vg-create': _("Creating LVM2 volume group $target"),
    'lvm-vg-delete': _("Deleting LVM2 volume group $target"),
    'lvm-vg-add-device': _("Adding physical volume to $target"),
    'lvm-vg-rem-device': _("Removing physical volume from $target"),
    'lvm-vg-empty-device': _("Emptying $target"),
    'lvm-vg-create-volume': _("Creating logical volume $target"),
    'lvm-vg-rename': _("Renaming $target"),
    'lvm-vg-resize': _("Resizing $target")
};

function make_description(client, job) {
    let fmt = descriptions[job.Operation];
    if (!fmt)
        fmt = _("Operation '$operation' on $target");

    const target = job.Objects.map(function (path) {
        if (client.blocks[path])
            return block_name(client.blocks[client.blocks[path].CryptoBackingDevice] || client.blocks[path]);
        else if (client.mdraids[path])
            return mdraid_name(client.mdraids[path]);
        else if (client.vgroups[path])
            return client.vgroups[path].Name;
        else if (client.lvols[path])
            return lvol_name(client.lvols[path]);
        else
            return _("unknown target");
    }).join(", ");

    return cockpit.format(fmt, { operation: job.Operation, target });
}

class JobRow extends React.Component {
    render() {
        const job = this.props.job;

        function cancel() {
            return job.Cancel({});
        }

        let remaining = null;
        if (job.ExpectedEndTime > 0) {
            const d = job.ExpectedEndTime / 1000 - this.props.now;
            if (d > 0)
                remaining = format_delay(d);
        }

        return (
            <DataListItem>
                <DataListItemRow>
                    <DataListItemCells
                        dataListCells={[
                            <DataListCell key="desc" className="job-description" isFilled={false}>
                                {make_description(this.props.client, job)}
                            </DataListCell>,
                            <DataListCell key="progress" isFilled={false}>
                                {job.ProgressValid && (job.Progress * 100).toFixed() + "%"}
                            </DataListCell>,
                            <DataListCell key="remaining">
                                {remaining}
                            </DataListCell>,
                            <DataListCell key="job-action" isFilled={false} alignRight>
                                { job.Cancelable ? <StorageButton onClick={cancel}>{_("Cancel")}</StorageButton> : null }
                            </DataListCell>,
                        ]}
                    />
                </DataListItemRow>
            </DataListItem>
        );
    }
}

export class JobsPanel extends React.Component {
    constructor() {
        super();
        this.reminder = null;
    }

    componentWillUnmount() {
        if (this.reminder) {
            window.clearTimeout(this.reminder);
            this.reminder = null;
        }
    }

    render() {
        const client = this.props.client;
        const server_now = new Date().getTime() + client.time_offset;

        function cmp_job(path_a, path_b) {
            return client.jobs[path_a].StartTime - client.jobs[path_b].StartTime;
        }

        function job_is_stable(path) {
            const j = client.jobs[path];

            const age_ms = server_now - j.StartTime / 1000;
            if (age_ms >= 2000)
                return true;

            if (j.ExpectedEndTime > 0 && (j.ExpectedEndTime / 1000 - server_now) >= 2000)
                return true;

            return false;
        }

        let jobs = [];
        let have_reminder = false;
        for (const p in client.jobs) {
            if (job_is_stable(p)) {
                jobs.push(p);
            } else if (!have_reminder) {
                // If there is a unstable job, we have to check again in a bit since being
                // stable or not depends on the current time.
                if (this.reminder)
                    window.clearTimeout(this.reminder);
                this.reminder = window.setTimeout(() => { this.setState({}) }, 1000);
                have_reminder = true;
            }
        }

        if (jobs.length === 0)
            return null;

        jobs = jobs.sort(cmp_job);

        return (
            <Card className="detail-jobs">
                <CardTitle component="h2">{_("Jobs")}</CardTitle>
                <CardBody className="contains-list">
                    <DataList isCompact aria-label={_("Jobs")}>
                        { jobs.map((p) => <JobRow key={p} client={client} job={client.jobs[p]} now={server_now} />) }
                    </DataList>
                </CardBody>
            </Card>
        );
    }
}

export function job_progress_wrapper(client, path1, path2) {
    return function (vals, progress_callback, action_function) {
        function client_changed() {
            const job = client.path_jobs[path1] || client.path_jobs[path2];
            if (job) {
                let desc = make_description(client, job);
                if (job.ProgressValid)
                    desc += cockpit.format(" ($0%)", (job.Progress * 100).toFixed());
                progress_callback(desc, job.Cancelable ? () => job.Cancel({}) : null);
            } else {
                progress_callback(null, null);
            }
        }

        client.addEventListener("changed", client_changed);
        return action_function(vals, progress_callback)
                .finally(() => { client.removeEventListener("changed", client_changed) });
    };
}
