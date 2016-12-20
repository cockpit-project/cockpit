/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var mustache = require("mustache");

    var utils = require("./utils");

    var _ = cockpit.gettext;

    /* JOBS
     */

    function init_jobs(client) {

        var jobs_tmpl = $("#jobs-tmpl").html();
        mustache.parse(jobs_tmpl);

        /* As a special service, we try to also show UDisks2 jobs.
         * (But only if storaged itself isn't behind
         * org.freedesktop.UDisks2, of course.)  As a shortcut, we
         * assume that we can blindly transform a UDisks2 object path
         * into a Storaged object path for the same object.
         */

        function udisks_path_to_storaged_path(upath) {
            if (client.udisks_client)
                return upath.replace("/org/freedesktop/UDisks2/", "/org/storaged/Storaged/");
            else
                return upath;
        }

        function update_job_spinners(parent) {
            var path;

            $(parent).find('[data-job-object]').css('visibility', 'hidden');

            function get_parent(path) {
                if (client.blocks_part[path] && client.blocks[client.blocks_part[path].Table])
                    return client.blocks_part[path].Table;
                if (client.blocks_crypto[path] && client.blocks[client.blocks_crypto[path].CryptoBackingDevice])
                    return client.blocks_crypto[path].CryptoBackingDevice;
                if (client.blocks[path] && client.drives[client.blocks[path].Drive])
                    return client.blocks[path].Drive;
                if (client.blocks[path] && client.mdraids[client.blocks[path].MDRaid])
                    return client.blocks[path].MDRaid;
                if (client.blocks_lvm2[path] && client.lvols[client.blocks_lvm2[path].LogicalVolume])
                    return client.blocks_lvm2[path].LogicalVolume;
                if (client.lvols[path] && client.vgroups[client.lvols[path].VolumeGroup])
                    return client.lvols[path].VolumeGroup;
            }

            function show_spinners_for_path(path) {
                $(parent).find('[data-job-object="' + path + '"]').css('visibility', 'visible');
            }

            function show_spinners_for_object(path) {
                show_spinners_for_path(path);
                var parent = get_parent(path);
                if (parent)
                    show_spinners_for_object(parent);
            }

            function show_spinners_for_objects(paths) {
                for (var i = 0; i < paths.length; i++)
                    show_spinners_for_object(paths[i]);
            }

            for (path in client.storaged_jobs)
                show_spinners_for_objects(client.storaged_jobs[path].Objects);

            for (path in client.udisks_jobs) {
                show_spinners_for_objects(client.udisks_jobs[path].Objects.map(udisks_path_to_storaged_path));
            }
        }

        $(client.storaged_jobs).on('added removed changed', function () {
            update_job_spinners('body');
        });

        $(client.udisks_jobs).on('added removed changed', function () {
            update_job_spinners('body');
        });

        function render_jobs_panel() {

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
                'swapspace-start':             _("Starting swapspace $target"),
                'swapspace-stop':              _("Stopping swapspace $target"),
                'filesystem-mount':            _("Mounting $target"),
                'filesystem-unmount':          _("Unmounting $target"),
                'filesystem-modify':           _("Modifying $target"),
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

            var server_now = new Date().getTime() + client.time_offset;

            function make_description(job) {
                var fmt = descriptions[job.Operation];
                if (!fmt)
                    fmt = _("Operation '$operation' on $target");

                var target =
                    job.Objects.map(function (p) {
                        var path = udisks_path_to_storaged_path(p);
                        if (client.blocks[path])
                            return utils.block_name(client.blocks[path]);
                        else if (client.mdraids[path])
                            return utils.mdraid_name(client.mdraids[path]);
                        else if (client.vgroups[path])
                            return client.vgroups[path].Name;
                        else if (client.lvols[path])
                            return utils.lvol_name(client.lvols[path]);
                        else
                            return _("unknown target");
                    }).join(", ");

                return cockpit.format(fmt, { operation: job.Operation, target: target });
            }

            function job(path) {
                return client.storaged_jobs[path] || client.udisks_jobs[path];
            }

            function cmp_job(a, b) {
                return job(a).StartTime - job(b).StartTime;
            }

            function job_is_stable(path) {
                var j = job(path);

                var age_ms = server_now - j.StartTime/1000;
                if (age_ms >= 2000)
                    return true;

                if (j.ExpectedEndTime > 0 && (j.ExpectedEndTime/1000 - server_now) >= 2000)
                    return true;

                return false;
            }

            function make_job(path) {
                var j = job(path);

                var remaining = null;
                if (j.ExpectedEndTime > 0) {
                    var d = j.ExpectedEndTime/1000 - server_now;
                    if (d > 0)
                        remaining = utils.format_delay (d);
                }

                return {
                    path: path,
                    Description: make_description(j),
                    Progress: j.ProgressValid && (j.Progress*100).toFixed() + "%",
                    RemainingTime: remaining,
                    Cancelable: j.Cancelable
                };
            }

            var js = (Object.keys(client.storaged_jobs).concat(Object.keys(client.udisks_jobs)).
                      filter(job_is_stable).
                      sort(cmp_job).
                      map(make_job));

            return mustache.render(jobs_tmpl,
                                   { Jobs: js,
                                     HasJobs: js.length > 0
                                   });
        }

        return {
            update:  update_job_spinners,
            render:  render_jobs_panel
        };

    }

    module.exports = {
        init: init_jobs
    };

}());
