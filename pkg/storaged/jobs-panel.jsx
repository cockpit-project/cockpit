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
import { StorageButton } from "./storage-controls.jsx";
import { block_name, mdraid_name, lvol_name, format_delay } from "./utils.js";

const _ = cockpit.gettext;

/* Human readable descriptions of the symbolic "Operation"
 * property of job objects.  These are from the storaged
 * documentation at
 *
 *   http://storaged.org/doc/udisks2-api/gdbus-org.freedesktop.UDisks2.Job.html
 */

var descriptions = {
    'ata-smart-selftest':          _("SMART self-test of $target"),
    'drive-eject':                 _("Ejecting $target"),
    'encrypted-unlock':            _("Unlocking $target"),
    'encrypted-lock':              _("Locking $target"),
    'encrypted-modify':            _("Modifying $target"),
    'encrypted-resize':            _("Resizing $target"),
    'swapspace-start':             _("Starting swapspace $target"),
    'swapspace-stop':              _("Stopping swapspace $target"),
    'filesystem-mount':            _("Mounting $target"),
    'filesystem-unmount':          _("Unmounting $target"),
    'filesystem-modify':           _("Modifying $target"),
    'filesystem-resize':           _("Resizing $target"),
    'filesystem-check':            _("Checking $target"),
    'filesystem-repair':           _("Repairing $target"),
    'format-erase':                _("Erasing $target"),
    'format-mkfs':                 _("Creating filesystem on $target"),
    'loop-setup':                  _("Setting up loop device $target"),
    'partition-modify':            _("Modifying $target"),
    'partition-delete':            _("Deleting $target"),
    'partition-create':            _("Creating partition $target"),
    'cleanup':                     _("Cleaning up for $target"),
    'ata-secure-erase':            _("Securely erasing $target"),
    'ata-enhanced-secure-erase':   _("Very securely erasing $target"),
    'md-raid-stop':                _("Stopping RAID Device $target"),
    'md-raid-start':               _("Starting RAID Device $target"),
    'md-raid-fault-device':        _("Marking $target as faulty"),
    'md-raid-remove-device':       _("Removing $target from RAID Device"),
    'md-raid-create':              _("Creating RAID Device $target"),
    'mdraid-check-job':            _("Checking RAID Device $target"),
    'mdraid-repair-job':           _("Checking and Repairing RAID Device $target"),
    'mdraid-recover-job':          _("Recovering RAID Device $target"),
    'mdraid-sync-job':             _("Synchronizing RAID Device $target"),
    'lvm-lvol-delete':             _("Deleting $target"),
    'lvm-lvol-activate':           _("Activating $target"),
    'lvm-lvol-deactivate':         _("Deactivating $target"),
    'lvm-lvol-snapshot':           _("Creating snapshot of $target"),
    'lvm-vg-create':               _("Creating volume group $target"),
    'lvm-vg-delete':               _("Deleting volume group $target"),
    'lvm-vg-add-device':           _("Adding physical volume to $target"),
    'lvm-vg-rem-device':           _("Removing physical volume from $target"),
    'lvm-vg-empty-device':         _("Emptying $target"),
    'lvm-vg-create-volume':        _("Creating logical volume $target"),
    'lvm-vg-rename':               _("Renaming $target"),
    'lvm-vg-resize':               _("Resizing $target")
};

function make_description(client, job) {
    var fmt = descriptions[job.Operation];
    if (!fmt)
        fmt = _("Operation '$operation' on $target");

    var target = job.Objects.map(function (path) {
        if (client.blocks[path])
            return block_name(client.blocks[path]);
        else if (client.mdraids[path])
            return mdraid_name(client.mdraids[path]);
        else if (client.vgroups[path])
            return client.vgroups[path].Name;
        else if (client.lvols[path])
            return lvol_name(client.lvols[path]);
        else
            return _("unknown target");
    }).join(", ");

    return cockpit.format(fmt, { operation: job.Operation, target: target });
}

class JobRow extends React.Component {
    render() {
        var job = this.props.job;

        function cancel() {
            return job.Cancel({});
        }

        var remaining = null;
        if (job.ExpectedEndTime > 0) {
            var d = job.ExpectedEndTime/1000 - this.props.now;
            if (d > 0)
                remaining = format_delay (d);
        }

        return (
            <tr>
                <td className="job-description">{make_description(this.props.client, job)}</td>
                <td>{job.ProgressValid && (job.Progress*100).toFixed() + "%"}</td>
                <td>{remaining}</td>
                <td className="job-action">
                    { job.Cancelable? <StorageButton onClick={cancel}>{_("Cancel")}</StorageButton> : null }
                </td>
            </tr>
        );
    }
}

export class JobsPanel extends React.Component {
    render() {
        var client = this.props.client;
        var server_now = new Date().getTime() + client.time_offset;

        function cmp_job(path_a, path_b) {
            return client.jobs[path_a].StartTime - client.jobs[path_b].StartTime;
        }

        function job_is_stable(path) {
            var j = client.jobs[path];

            var age_ms = server_now - j.StartTime/1000;
            if (age_ms >= 2000)
                return true;

            if (j.ExpectedEndTime > 0 && (j.ExpectedEndTime/1000 - server_now) >= 2000)
                return true;

            return false;
        }

        var jobs = [ ];
        var have_reminder = false;
        for (var p in client.jobs) {
            if (job_is_stable(p)) {
                jobs.push(p);
            } else if (!have_reminder) {
                // If there is a unstable job, we have to check again in a bit since being
                // stable or not depends on the current time.
                window.setTimeout(() => { this.setState({}) }, 1000);
                have_reminder = true;
            }
        }

        if (jobs.length === 0)
            return null;

        jobs = jobs.sort(cmp_job);

        return (
            <div className="detail-jobs panel panel-default">
                <div className="panel-heading">{_("Jobs")}</div>
                <table className="table">
                    <tbody>
                        { jobs.map((p) => <JobRow client={client} job={client.jobs[p]} now={server_now}/>) }
                    </tbody>
                </table>
            </div>
        );
    }
}
