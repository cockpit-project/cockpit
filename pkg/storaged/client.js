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

import cockpit from 'cockpit';
import * as PK from 'packagekit.js';
import { superuser } from 'superuser';

import * as utils from './utils.js';

import * as python from "python.js";
import { read_os_release } from "os-release.js";

import { find_warnings } from "./warnings.jsx";

import inotify_py from "raw-loader!inotify.py";
import mount_users_py from "raw-loader!./mount-users.py";
import nfs_mounts_py from "raw-loader!./nfs-mounts.py";
import vdo_monitor_py from "raw-loader!./vdo-monitor.py";
import stratis2_set_key_py from "raw-loader!./stratis2-set-key.py";
import stratis3_set_key_py from "raw-loader!./stratis3-set-key.py";

/* STORAGED CLIENT
 */

const client = {
    busy: 0
};

cockpit.event_target(client);

client.run = (func) => {
    const prom = func();
    if (prom) {
        client.busy += 1;
        return prom.finally(() => {
            client.busy -= 1;
            client.dispatchEvent("changed");
        });
    }
};

/* Superuser
 */

client.superuser = superuser;
client.superuser.reload_page_on_change();
client.superuser.addEventListener("changed", () => client.dispatchEvent("changed"));

/* Metrics
 */

function instance_sampler(metrics, source) {
    let instances;
    const self = {
        data: { },
        close
    };

    cockpit.event_target(self);

    function handle_meta(msg) {
        self.data = { };
        instances = [];
        for (let m = 0; m < msg.metrics.length; m++) {
            instances[m] = msg.metrics[m].instances;
            for (let i = 0; i < instances[m].length; i++)
                self.data[instances[m][i]] = [];
        }
        if (Object.keys(self.data).length > 100) {
            close();
            self.data = { };
        }
    }

    function handle_data(msg) {
        let changed = false;
        for (let s = 0; s < msg.length; s++) {
            const metrics = msg[s];
            for (let m = 0; m < metrics.length; m++) {
                const inst = metrics[m];
                for (let i = 0; i < inst.length; i++) {
                    if (inst[i] !== null && inst[i] != self.data[instances[m][i]][m]) {
                        changed = true;
                        self.data[instances[m][i]][m] = inst[i];
                    }
                }
            }
        }
        if (changed)
            self.dispatchEvent('changed');
    }

    const channel = cockpit.channel({
        payload: "metrics1",
        source: source || "internal",
        metrics
    });
    channel.addEventListener("closed", function (event, error) {
        console.log("closed", error);
    });
    channel.addEventListener("message", function (event, message) {
        const msg = JSON.parse(message);
        if (msg.length)
            handle_data(msg);
        else
            handle_meta(msg);
    });

    function close() {
        channel.close();
    }

    return self;
}

/* D-Bus proxies
 */

client.time_offset = undefined; /* Number of milliseconds that the server is ahead of us. */
client.features = undefined;

client.storaged_client = undefined;

function proxy(iface, path) {
    return client.storaged_client.proxy("org.freedesktop.UDisks2." + iface,
                                        "/org/freedesktop/UDisks2/" + path,
                                        { watch: true });
}

function proxies(iface) {
    /* We create the proxies here with 'watch' set to false and
     * establish a general watch for all of them.  This is more
     * efficient since it reduces the number of D-Bus calls done
     * by the cache.
     */
    return client.storaged_client.proxies("org.freedesktop.UDisks2." + iface,
                                          "/org/freedesktop/UDisks2",
                                          { watch: false });
}

client.call = function call(path, iface, method, args, options) {
    return client.storaged_client.call(path, "org.freedesktop.UDisks2." + iface, method, args, options);
};

function init_proxies () {
    client.mdraids = proxies("MDRaid");
    client.vgroups = proxies("VolumeGroup");
    client.lvols = proxies("LogicalVolume");
    client.drives = proxies("Drive");
    client.drives_ata = proxies("Drive.Ata");
    client.blocks = proxies("Block");
    client.blocks_ptable = proxies("PartitionTable");
    client.blocks_part = proxies("Partition");
    client.blocks_lvm2 = proxies("Block.LVM2");
    client.blocks_pvol = proxies("PhysicalVolume");
    client.blocks_fsys = proxies("Filesystem");
    client.blocks_crypto = proxies("Encrypted");
    client.blocks_swap = proxies("Swapspace");
    client.iscsi_sessions = proxies("ISCSI.Session");
    client.vdo_vols = proxies("VDOVolume");
    client.jobs = proxies("Job");

    return client.storaged_client.watch({ path_namespace: "/org/freedesktop/UDisks2" });
}

/* Monitors
 */

client.fsys_sizes = instance_sampler([{ name: "mount.used" },
    { name: "mount.total" }
]);

client.swap_sizes = instance_sampler([{ name: "swapdev.length" },
    { name: "swapdev.free" },
], "direct");

/* Derived indices.
 */

function is_multipath_master(block) {
    // The master has "mpath" in its device mapper UUID.  In the
    // future, storaged will hopefully provide this information
    // directly.
    if (block.Symlinks && block.Symlinks.length) {
        for (let i = 0; i < block.Symlinks.length; i++)
            if (utils.decode_filename(block.Symlinks[i]).indexOf("/dev/disk/by-id/dm-uuid-mpath-") === 0)
                return true;
    }
    return false;
}

function update_indices() {
    let path, block, mdraid, vgroup, pvol, lvol, pool, blockdev, fsys, part, i;

    client.broken_multipath_present = false;
    client.drives_multipath_blocks = { };
    client.drives_block = { };
    for (path in client.drives) {
        client.drives_multipath_blocks[path] = [];
    }
    for (path in client.blocks) {
        block = client.blocks[path];
        if (!client.blocks_part[path] && client.drives_multipath_blocks[block.Drive] !== undefined) {
            if (is_multipath_master(block))
                client.drives_block[block.Drive] = block;
            else
                client.drives_multipath_blocks[block.Drive].push(block);
        }
    }
    for (path in client.drives_multipath_blocks) {
        /* If there is no multipath master and only a single
         * member, then this is actually a normal singlepath
         * device.
         */

        if (!client.drives_block[path] && client.drives_multipath_blocks[path].length == 1) {
            client.drives_block[path] = client.drives_multipath_blocks[path][0];
            client.drives_multipath_blocks[path] = [];
        } else {
            client.drives_multipath_blocks[path].sort(utils.block_cmp);
            if (!client.drives_block[path])
                client.broken_multipath_present = true;
        }
    }

    client.mdraids_block = { };
    for (path in client.blocks) {
        block = client.blocks[path];
        if (block.MDRaid != "/")
            client.mdraids_block[block.MDRaid] = block;
    }

    client.mdraids_members = { };
    for (path in client.mdraids) {
        client.mdraids_members[path] = [];
    }
    for (path in client.blocks) {
        block = client.blocks[path];
        if (client.mdraids_members[block.MDRaidMember] !== undefined)
            client.mdraids_members[block.MDRaidMember].push(block);
    }
    for (path in client.mdraids_members) {
        client.mdraids_members[path].sort(utils.block_cmp);
    }

    client.slashdevs_block = { };
    function enter_slashdev(block, enc) {
        client.slashdevs_block[utils.decode_filename(enc)] = block;
    }
    for (path in client.blocks) {
        block = client.blocks[path];
        enter_slashdev(block, block.Device);
        enter_slashdev(block, block.PreferredDevice);
        for (i = 0; i < block.Symlinks.length; i++)
            enter_slashdev(block, block.Symlinks[i]);
    }

    client.uuids_mdraid = { };
    for (path in client.mdraids) {
        mdraid = client.mdraids[path];
        client.uuids_mdraid[mdraid.UUID] = mdraid;
    }

    client.vgnames_vgroup = { };
    for (path in client.vgroups) {
        vgroup = client.vgroups[path];
        client.vgnames_vgroup[vgroup.Name] = vgroup;
    }

    client.vgroups_pvols = { };
    for (path in client.vgroups) {
        client.vgroups_pvols[path] = [];
    }
    for (path in client.blocks_pvol) {
        pvol = client.blocks_pvol[path];
        if (client.vgroups_pvols[pvol.VolumeGroup] !== undefined)
            client.vgroups_pvols[pvol.VolumeGroup].push(pvol);
    }
    function cmp_pvols(a, b) {
        return utils.block_cmp(client.blocks[a.path], client.blocks[b.path]);
    }
    for (path in client.vgroups_pvols) {
        client.vgroups_pvols[path].sort(cmp_pvols);
    }

    client.vgroups_lvols = { };
    for (path in client.vgroups) {
        client.vgroups_lvols[path] = [];
    }
    for (path in client.lvols) {
        lvol = client.lvols[path];
        if (client.vgroups_lvols[lvol.VolumeGroup] !== undefined)
            client.vgroups_lvols[lvol.VolumeGroup].push(lvol);
    }
    for (path in client.vgroups_lvols) {
        client.vgroups_lvols[path].sort(function (a, b) { return a.Name.localeCompare(b.Name) });
    }

    client.lvols_block = { };
    for (path in client.blocks_lvm2) {
        client.lvols_block[client.blocks_lvm2[path].LogicalVolume] = client.blocks[path];
    }

    client.lvols_pool_members = { };
    for (path in client.lvols) {
        if (client.lvols[path].Type == "pool")
            client.lvols_pool_members[path] = [];
    }
    for (path in client.lvols) {
        lvol = client.lvols[path];
        if (client.lvols_pool_members[lvol.ThinPool] !== undefined)
            client.lvols_pool_members[lvol.ThinPool].push(lvol);
    }
    for (path in client.lvols_pool_members) {
        client.lvols_pool_members[path].sort(function (a, b) { return a.Name.localeCompare(b.Name) });
    }

    client.stratis_poolnames_pool = { };
    for (path in client.stratis_pools) {
        pool = client.stratis_pools[path];
        client.stratis_poolnames_pool[pool.Name] = pool;
    }

    client.stratis_pooluuids_pool = { };
    for (path in client.stratis_pools) {
        pool = client.stratis_pools[path];
        client.stratis_pooluuids_pool[pool.Uuid] = pool;
    }

    client.stratis_pool_blockdevs = { };
    for (path in client.stratis_pools) {
        client.stratis_pool_blockdevs[path] = [];
    }
    for (path in client.stratis_blockdevs) {
        blockdev = client.stratis_blockdevs[path];
        if (client.stratis_pools[blockdev.Pool] !== undefined)
            client.stratis_pool_blockdevs[blockdev.Pool].push(blockdev);
    }

    client.stratis_pool_filesystems = { };
    for (path in client.stratis_pools) {
        client.stratis_pool_filesystems[path] = [];
    }
    for (path in client.stratis_filesystems) {
        fsys = client.stratis_filesystems[path];
        if (client.stratis_pools[fsys.Pool] !== undefined)
            client.stratis_pool_filesystems[fsys.Pool].push(fsys);
    }

    client.blocks_stratis_fsys = { };
    for (path in client.stratis_filesystems) {
        fsys = client.stratis_filesystems[path];
        block = client.slashdevs_block[fsys.Devnode];
        if (block)
            client.blocks_stratis_fsys[block.path] = fsys;
    }

    client.blocks_stratis_blockdev = { };
    for (path in client.stratis_blockdevs) {
        block = client.slashdevs_block[client.stratis_blockdevs[path].PhysicalPath];
        if (block)
            client.blocks_stratis_blockdev[block.path] = client.stratis_blockdevs[path];
    }

    client.blocks_stratis_locked_pool = { };
    for (const uuid in client.stratis_manager.LockedPools) {
        const devs = client.stratis_manager.LockedPools[uuid].devs.v;
        for (const d of devs) {
            block = client.slashdevs_block[d.devnode];
            if (block)
                client.blocks_stratis_locked_pool[block.path] = uuid;
        }
    }

    client.blocks_cleartext = { };
    for (path in client.blocks) {
        block = client.blocks[path];
        if (block.CryptoBackingDevice != "/")
            client.blocks_cleartext[block.CryptoBackingDevice] = block;
    }

    client.blocks_partitions = { };
    for (path in client.blocks_ptable) {
        client.blocks_partitions[path] = [];
    }
    for (path in client.blocks_part) {
        part = client.blocks_part[path];
        if (client.blocks_partitions[part.Table] !== undefined)
            client.blocks_partitions[part.Table].push(part);
    }
    for (path in client.blocks_partitions) {
        client.blocks_partitions[path].sort(function (a, b) { return a.Offset - b.Offset });
    }

    client.path_jobs = { };
    function enter_job(job) {
        if (!job.Objects || !job.Objects.length)
            return;
        job.Objects.forEach(function (path) {
            client.path_jobs[path] = job;
            let parent = utils.get_parent(client, path);
            while (parent) {
                path = parent;
                parent = utils.get_parent(client, path);
            }
            client.path_jobs[path] = job;
        });
    }
    for (path in client.jobs) {
        enter_job(client.jobs[path]);
    }
}

client.update = () => {
    update_indices();
    client.path_warnings = find_warnings(client);
    client.dispatchEvent("changed");
};

function init_model(callback) {
    function pull_time() {
        return cockpit.spawn(["date", "+%s"])
                .then(function (now) {
                    client.time_offset = parseInt(now, 10) * 1000 - new Date().getTime();
                });
    }

    function enable_udisks_features() {
        if (!client.manager.valid)
            return Promise.resolve();
        if (!client.manager.EnableModules)
            return Promise.resolve();
        return client.manager.EnableModules(true).then(
            function() {
                client.manager_lvm2 = proxy("Manager.LVM2", "Manager");
                client.manager_iscsi = proxy("Manager.ISCSI.Initiator", "Manager");
                return Promise.allSettled([client.manager_lvm2.wait(), client.manager_iscsi.wait()])
                        .then(() => {
                            client.features.lvm2 = client.manager_lvm2.valid;
                            client.features.iscsi = (client.manager_iscsi.valid &&
                                                            client.manager_iscsi.SessionsSupported !== false);
                        });
            }, function(error) {
                console.warn("Can't enable storaged modules", error.toString());
                return Promise.resolve();
            });
    }

    function enable_lvm_create_vdo_feature() {
        return cockpit.spawn(["vdoformat", "--version"], { err: "ignore" })
                .then(() => { client.features.lvm_create_vdo = true; return Promise.resolve() })
                .catch(() => Promise.resolve());
    }

    function enable_legacy_vdo_features() {
        return client.legacy_vdo_overlay.start().then(
            function (success) {
                // hack here
                client.features.legacy_vdo = success;
                return Promise.resolve();
            },
            function () {
                return Promise.resolve();
            });
    }

    function enable_clevis_features() {
        return cockpit.spawn(["which", "clevis-luks-bind"], { err: "ignore" }).then(
            function () {
                client.features.clevis = true;
                return Promise.resolve();
            },
            function () {
                return Promise.resolve();
            });
    }

    function enable_nfs_features() {
        // mount.nfs might be in */sbin but that isn't always in
        // $PATH, such as when connecting from CentOS to another
        // machine via SSH as non-root.
        const std_path = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
        return cockpit.spawn(["which", "mount.nfs"], { err: "message", environ: [std_path] }).then(
            function () {
                client.features.nfs = true;
                client.nfs.start();
                return Promise.resolve();
            },
            function () {
                return Promise.resolve();
            });
    }

    function enable_pk_features() {
        return PK.detect().then(function (available) { client.features.packagekit = available });
    }

    function enable_stratis_feature() {
        return client.stratis_start().catch(error => {
            if (error.problem != "not-found")
                console.warn("Failed to start Stratis support", error);
            return Promise.resolve();
        });
    }

    function enable_features() {
        client.features = { };
        return (enable_udisks_features()
                .then(enable_clevis_features)
                .then(enable_nfs_features)
                .then(enable_pk_features)
                .then(enable_stratis_feature)
                .then(enable_lvm_create_vdo_feature)
                .then(enable_legacy_vdo_features));
    }

    function query_fsys_info() {
        const info = {
            xfs: {
                can_format: true,
                can_shrink: false,
                can_grow: true,
                grow_needs_unmount: false
            },

            ext4: {
                can_format: true,
                can_shrink: true,
                shrink_needs_unmount: true,
                can_grow: true,
                grow_needs_unmount: false
            },
        };

        if (client.manager.SupportedFilesystems && client.manager.CanResize) {
            return Promise.all(client.manager.SupportedFilesystems.map(fs =>
                client.manager.CanFormat(fs).then(canformat_result => {
                    info[fs] = {
                        can_format: canformat_result[0],
                        can_shrink: false,
                        can_grow: false
                    };
                    return client.manager.CanResize(fs)
                            .then(canresize_result => {
                                // We assume that all filesystems support
                                // offline shrinking/growing if they
                                // support shrinking or growing at all.
                                // The actual resizing utility will
                                // temporarily mount the fs if necessary,
                                if (canresize_result[0]) {
                                    info[fs].can_shrink = !!(canresize_result[1] & 2);
                                    info[fs].shrink_needs_unmount = !(canresize_result[1] & 8);
                                    info[fs].can_grow = !!(canresize_result[1] & 4);
                                    info[fs].grow_needs_unmount = !(canresize_result[1] & 16);
                                }
                            })
                            // ignore unsupported filesystems
                            .catch(() => {});
                }))
            ).then(() => info);
        } else {
            return Promise.resolve(info);
        }
    }

    pull_time().then(() => {
        read_os_release().then(os_release => {
            client.os_release = os_release;

            enable_features().then(() => {
                query_fsys_info().then((fsys_info) => {
                    client.fsys_info = fsys_info;

                    client.storaged_client.addEventListener('notify', () => client.update());

                    client.update();
                    callback();
                });
            });
        });
    });
}

client.older_than = function older_than(version) {
    return utils.compare_versions(this.manager.Version, version) < 0;
};

/* Mount users
 */

client.find_mount_users = (target, is_mounted) => {
    if (is_mounted === undefined || is_mounted)
        return python.spawn(mount_users_py, ["users", target], { superuser: "try", err: "message" }).then(JSON.parse);
    else
        return Promise.resolve([]);
};

client.stop_mount_users = (users) => {
    if (users && users.length > 0) {
        return python.spawn(mount_users_py, ["stop", JSON.stringify(users)],
                            { superuser: "try", err: "message" });
    } else
        return Promise.resolve();
};

/* Direct mounting and unmounting
 *
 * We don't use UDisks2 for most of our mounting and unmounting in
 * order to get better control over which entry from fstab is
 * selected.  Once UDisks2 allows that control, we can switch back to
 * it.
 *
 * But note that these functions still require an fstab entry.
 */

client.mount_at = (block, target) => {
    const entry = utils.array_find(block.Configuration,
                                   c => c[0] == "fstab" && utils.decode_filename(c[1].dir.v) == target);
    if (entry)
        return cockpit.script('set -e; mkdir -p "$2"; mount "$1" "$2" -o "$3"',
                              [utils.decode_filename(block.Device), target, utils.decode_filename(entry[1].opts.v)],
                              { superuser: true, err: "message" });
    else
        return Promise.reject(cockpit.format("Internal error: No fstab entry for $0 and $1",
                                             utils.decode_filename(block.Device),
                                             target));
};

client.unmount_at = (target, users) => {
    return client.stop_mount_users(users).then(() => cockpit.spawn(["umount", target],
                                                                   { superuser: true, err: "message" }));
};

/* NFS mounts
 */

function nfs_mounts() {
    const self = {
        entries: [],
        fsys_sizes: { },

        start,

        get_fsys_size,
        entry_users,

        update_entry,
        add_entry,
        remove_entry,

        mount_entry,
        unmount_entry,
        stop_and_unmount_entry,
        stop_and_remove_entry,

        find_entry
    };

    function spawn_nfs_mounts(args) {
        return python.spawn([inotify_py, nfs_mounts_py], args, { superuser: "try", err: "message" });
    }

    function start() {
        let buf = "";
        spawn_nfs_mounts(["monitor"])
                .stream(function (output) {
                    buf += output;
                    const lines = buf.split("\n");
                    buf = lines[lines.length - 1];
                    if (lines.length >= 2) {
                        self.entries = JSON.parse(lines[lines.length - 2]);
                        self.fsys_sizes = { };
                        client.dispatchEvent('changed');
                    }
                })
                .catch(function (error) {
                    if (error != "closed") {
                        console.warn(error);
                    }
                });
    }

    function get_fsys_size(entry) {
        const path = entry.fields[1];
        if (self.fsys_sizes[path])
            return self.fsys_sizes[path];

        if (self.fsys_sizes[path] === false)
            return null;

        self.fsys_sizes[path] = false;
        cockpit.spawn(["stat", "-f", "-c", "[ %S, %f, %b ]", path], { err: "message" })
                .then(function (output) {
                    const data = JSON.parse(output);
                    self.fsys_sizes[path] = [(data[2] - data[1]) * data[0], data[2] * data[0]];
                    client.dispatchEvent('changed');
                })
                .catch(function () {
                    self.fsys_sizes[path] = [0, 0];
                    client.dispatchEvent('changed');
                });

        return null;
    }

    function update_entry(entry, new_fields) {
        return spawn_nfs_mounts(["update", JSON.stringify(entry), JSON.stringify(new_fields)]);
    }

    function add_entry(fields) {
        return spawn_nfs_mounts(["add", JSON.stringify(fields)]);
    }

    function remove_entry(entry) {
        return spawn_nfs_mounts(["remove", JSON.stringify(entry)]);
    }

    function mount_entry(entry) {
        return spawn_nfs_mounts(["mount", JSON.stringify(entry)]);
    }

    function unmount_entry(entry) {
        return spawn_nfs_mounts(["unmount", JSON.stringify(entry)]);
    }

    function stop_and_unmount_entry(users, entry) {
        return client.stop_mount_users(users).then(() => unmount_entry(entry));
    }

    function stop_and_remove_entry(users, entry) {
        return client.stop_mount_users(users).then(() => remove_entry(entry));
    }

    function entry_users(entry) {
        return client.find_mount_users(entry.fields[1], entry.mounted);
    }

    function find_entry(remote, local) {
        for (let i = 0; i < self.entries.length; i++) {
            if (self.entries[i].fields[0] == remote && self.entries[i].fields[1] == local)
                return self.entries[i];
        }
    }

    return self;
}

client.nfs = nfs_mounts();

/* Legacy VDO CLI (RHEL 8), unsupported; newer versions use VDO through LVM API */

function legacy_vdo_overlay() {
    const self = {
        start,

        volumes: [],

        by_name: { },
        by_dev: { },
        by_backing_dev: { },

        find_by_block,
        find_by_backing_block,

        create
    };

    function cmd(args) {
        return cockpit.spawn(["vdo"].concat(args),
                             {
                                 superuser: true,
                                 err: "message"
                             });
    }

    function update(data) {
        self.by_name = { };
        self.by_dev = { };
        self.by_backing_dev = { };

        self.volumes = data.map(function (vol, index) {
            const name = vol.name;

            function volcmd(args) {
                return cmd(args.concat(["--name", name]));
            }

            const v = {
                name,
                broken: vol.broken,
                dev: "/dev/mapper/" + name,
                backing_dev: vol.device,
                logical_size: vol.logical_size,
                physical_size: vol.physical_size,
                index_mem: vol.index_mem,
                compression: vol.compression,
                deduplication: vol.deduplication,
                activated: vol.activated,

                set_compression: function(val) {
                    return volcmd([val ? "enableCompression" : "disableCompression"]);
                },

                set_deduplication: function(val) {
                    return volcmd([val ? "enableDeduplication" : "disableDeduplication"]);
                },

                set_activate: function(val) {
                    return volcmd([val ? "activate" : "deactivate"]);
                },

                start: function() {
                    return volcmd(["start"]);
                },

                stop: function() {
                    return volcmd(["stop"]);
                },

                remove: function() {
                    return volcmd(["remove"]);
                },

                force_remove: function() {
                    return volcmd(["remove", "--force"]);
                },

                grow_physical: function() {
                    return volcmd(["growPhysical"]);
                },

                grow_logical: function(lsize) {
                    return volcmd(["growLogical", "--vdoLogicalSize", lsize + "B"]);
                }
            };

            self.by_name[v.name] = v;
            self.by_dev[v.dev] = v;
            self.by_backing_dev[v.backing_dev] = v;

            return v;
        });

        client.update();
    }

    function start() {
        let buf = "";

        return cockpit.spawn(["/bin/sh", "-c", "head -1 $(which vdo || echo /dev/null)"],
                             { err: "ignore" })
                .then(function (shebang) {
                    if (shebang != "") {
                        self.python = shebang.replace(/#! */, "").trim("\n");
                        cockpit.spawn([self.python, "--", "-"], { superuser: "try", err: "message" })
                                .input(inotify_py + vdo_monitor_py)
                                .stream(function (output) {
                                    buf += output;
                                    const lines = buf.split("\n");
                                    buf = lines[lines.length - 1];
                                    if (lines.length >= 2) {
                                        update(JSON.parse(lines[lines.length - 2]));
                                    }
                                })
                                .catch(function (error) {
                                    if (error != "closed") {
                                        console.warn(error);
                                    }
                                });
                        return true;
                    } else {
                        return false;
                    }
                });
    }

    function some(array, func) {
        let i;
        for (i = 0; i < array.length; i++) {
            const val = func(array[i]);
            if (val)
                return val;
        }
        return null;
    }

    function find_by_block(block) {
        function check(encoded) { return self.by_dev[utils.decode_filename(encoded)] }
        return check(block.Device) || some(block.Symlinks, check);
    }

    function find_by_backing_block(block) {
        function check(encoded) { return self.by_backing_dev[utils.decode_filename(encoded)] }
        return check(block.Device) || some(block.Symlinks, check);
    }

    function create(options) {
        const args = ["create", "--name", options.name,
            "--device", utils.decode_filename(options.block.PreferredDevice)];
        if (options.logical_size !== undefined)
            args.push("--vdoLogicalSize", options.logical_size + "B");
        if (options.index_mem !== undefined)
            args.push("--indexMem", options.index_mem / (1024 * 1024 * 1024));
        if (options.compression !== undefined)
            args.push("--compression", options.compression ? "enabled" : "disabled");
        if (options.deduplication !== undefined)
            args.push("--deduplication", options.deduplication ? "enabled" : "disabled");
        if (options.emulate_512 !== undefined)
            args.push("--emulate512", options.emulate_512 ? "enabled" : "disabled");
        return cmd(args);
    }

    return self;
}

client.legacy_vdo_overlay = legacy_vdo_overlay();

/* Stratis */

client.stratis_start = () => {
    return stratis2_start()
            .catch(error => {
                if (error.problem == "not-found")
                    return stratis3_start();
                return Promise.reject(error);
            });
};

// We need to use the same revision for all interfaces, mixing them is
// not allowed.  If we need to bump it, it should be bumped here for all
// of them at the same time.
//
const stratis3_interface_revision = "r0";

function stratis3_start() {
    const stratis = cockpit.dbus("org.storage.stratis3", { superuser: "try" });
    client.stratis_manager = stratis.proxy("org.storage.stratis3.Manager." + stratis3_interface_revision,
                                           "/org/storage/stratis3");

    // The rest of the code expects these to be initialized even if no
    // stratisd is found.
    client.stratis_pools = { };
    client.stratis_blockdevs = { };
    client.stratis_filesystems = { };
    client.stratis_manager.LockedPools = {};

    return client.stratis_manager.wait()
            .then(() => {
                client.stratis_store_passphrase = (desc, passphrase) => {
                    return python.spawn(stratis3_set_key_py, [desc], { superuser: true })
                            .input(passphrase);
                };

                client.stratis_unlock_pool = (uuid) => {
                    return client.stratis_manager.UnlockPool(uuid, "keyring");
                };

                client.stratis_create_pool = (name, devs, key_desc) => {
                    return client.stratis_manager.CreatePool(name, [false, 0],
                                                             devs,
                                                             key_desc ? [true, key_desc] : [false, ""],
                                                             [false, ["", ""]]);
                };

                client.stratis_list_keys = () => {
                    return client.stratis_manager.ListKeys();
                };

                client.stratis_create_filesystem = (pool, name) => {
                    return pool.CreateFilesystems([[name, [false, ""]]]);
                };

                client.features.stratis = true;
                client.stratis_pools = client.stratis_manager.client.proxies("org.storage.stratis3.pool." +
                                                                             stratis3_interface_revision,
                                                                             "/org/storage/stratis3",
                                                                             { watch: false });
                client.stratis_blockdevs = client.stratis_manager.client.proxies("org.storage.stratis3.blockdev." +
                                                                                 stratis3_interface_revision,
                                                                                 "/org/storage/stratis3",
                                                                                 { watch: false });
                client.stratis_filesystems = client.stratis_manager.client.proxies("org.storage.stratis3.filesystem." +
                                                                                   stratis3_interface_revision,
                                                                                   "/org/storage/stratis3",
                                                                                   { watch: false });

                return stratis.watch({ path_namespace: "/org/storage/stratis3" }).then(() => {
                    client.stratis_manager.client.addEventListener('notify', (event, data) => {
                        client.update();
                    });
                });
            });
}

function stratis2_start() {
    const stratis = cockpit.dbus("org.storage.stratis2", { superuser: "try" });
    client.stratis_manager = stratis.proxy("org.storage.stratis2.Manager.r1",
                                           "/org/storage/stratis2");

    // The rest of the code expects these to be initialized even if no
    // stratisd is found.
    client.stratis_pools = { };
    client.stratis_blockdevs = { };
    client.stratis_filesystems = { };
    client.stratis_manager.LockedPools = {};

    return client.stratis_manager.wait()
            .then(() => {
                if (utils.compare_versions(client.stratis_manager.Version, "2.4") < 0)
                    return Promise.reject(new Error("stratisd too old, need at least version 2.4"));

                client.stratis_store_passphrase = (desc, passphrase) => {
                    return python.spawn(stratis2_set_key_py, [desc], { superuser: true })
                            .input(passphrase);
                };

                client.stratis_unlock_pool = (uuid) => {
                    return client.stratis_manager.UnlockPool(uuid);
                };

                client.stratis_create_pool = (name, devs, key_desc) => {
                    return client.stratis_manager.CreatePool(name, [false, 0],
                                                             devs,
                                                             key_desc ? [true, key_desc] : [false, ""]);
                };

                client.stratis_create_filesystem = (pool, name) => {
                    return pool.CreateFilesystems([name]);
                };

                client.stratis_list_keys = () => {
                    return client.stratis_manager.client.call(client.stratis_manager.path,
                                                              "org.storage.stratis2.FetchProperties.r2",
                                                              "GetProperties", [["KeyList"]])
                            .then(([result]) => {
                                if (result.KeyList && result.KeyList[0])
                                    return result.KeyList[1].v;
                                else
                                    return [];
                            });
                };

                client.features.stratis = true;
                client.stratis_pools = client.stratis_manager.client.proxies("org.storage.stratis2.pool.r1",
                                                                             "/org/storage/stratis2",
                                                                             { watch: false });
                client.stratis_blockdevs = client.stratis_manager.client.proxies("org.storage.stratis2.blockdev.r2",
                                                                                 "/org/storage/stratis2",
                                                                                 { watch: false });
                client.stratis_filesystems = client.stratis_manager.client.proxies("org.storage.stratis2.filesystem",
                                                                                   "/org/storage/stratis2",
                                                                                   { watch: false });

                return stratis.watch({ path_namespace: "/org/storage/stratis2" }).then(() => {
                    client.stratis_manager.client.addEventListener('notify', (event, data) => {
                        client.update();
                        stratis2_fixup_pool_notifications(data);
                    });

                    // We need to explicitly retrieve the values of
                    // the "FetchProperties".  We do this whenever a
                    // new object appears, when something happens that
                    // might have changed them (for example when a
                    // filesystem has been added to a pool we fetch
                    // the properties of the pool), and also every 30
                    // seconds, just to be safe.
                    //
                    // See https://github.com/stratis-storage/stratisd/issues/2148

                    client.stratis_pools.addEventListener('added', (event, proxy) => {
                        stratis2_fetch_pool_properties(proxy);
                        // A entry might have disappeared from LockedPoolsWithDevs
                        stratis2_fetch_manager_properties(client.stratis_manager);
                    });

                    client.stratis_blockdevs.addEventListener('added', (event, proxy) => {
                        stratis2_fetch_pool_properties_by_path(proxy.Pool);
                        stratis2_fetch_blockdev_properties(proxy);
                    });

                    client.stratis_blockdevs.addEventListener('removed', (event, proxy) => {
                        stratis2_fetch_pool_properties_by_path(proxy.Pool);
                    });

                    client.stratis_filesystems.addEventListener('added', (event, proxy) => {
                        stratis2_fetch_filesystem_properties(proxy);
                        stratis2_fetch_pool_properties_by_path(proxy.Pool);
                    });

                    client.stratis_filesystems.addEventListener('removed', (event, proxy) => {
                        stratis2_fetch_pool_properties_by_path(proxy.Pool);
                    });

                    stratis2_start_polling();
                    return true;
                });
            })
            .catch(err => {
                if (err.problem == "not-found")
                    err.message = "The name org.storage.stratis2 can not be activated on D-Bus.";
                return Promise.reject(err);
            });
}

function stratis2_fetch_properties(proxy, props) {
    const stratis = client.stratis_manager.client;

    return stratis.call(proxy.path, "org.storage.stratis2.FetchProperties.r4", "GetProperties", [props])
            .then(([result]) => {
                const values = { };
                for (const p of props) {
                    if (result[p] && result[p][0])
                        values[p] = result[p][1].v;
                }
                return values;
            })
            .catch(error => {
                console.warn("Failed to fetch properties:", proxy.path, props, error);
                return { };
            });
}

function stratis2_fetch_manager_properties(proxy) {
    stratis2_fetch_properties(proxy, ["LockedPoolsWithDevs"]).then(values => {
        if (values.LockedPoolsWithDevs) {
            proxy.LockedPools = { };
            for (const uuid in values.LockedPoolsWithDevs) {
                const l = values.LockedPoolsWithDevs[uuid];
                proxy.LockedPools[uuid] = {
                    devs: l.devs,
                    key_description: { t: "(bv)", v: [true, l.key_description] },
                };
            }
            client.update();
        }
    });
}

function stratis2_fetch_pool_properties(proxy) {
    if (!proxy.TotalPhysicalUsed)
        proxy.TotalPhysicalUsed = [false, ""];
    if (!proxy.KeyDescription)
        proxy.KeyDescription = [false, ""];
    stratis2_fetch_properties(proxy, ["TotalPhysicalSize", "TotalPhysicalUsed", "KeyDescription"]).then(values => {
        if (values.TotalPhysicalSize)
            proxy.TotalPhysicalSize = values.TotalPhysicalSize;
        if (values.TotalPhysicalUsed)
            proxy.TotalPhysicalUsed = [true, values.TotalPhysicalUsed];
        if (values.KeyDescription)
            proxy.KeyDescription = [true, values.KeyDescription];
        client.update();
    });
}

function stratis2_fetch_pool_properties_by_path(path) {
    const pool = client.stratis_pools[path];
    if (pool)
        stratis2_fetch_pool_properties(pool);
}

function stratis2_fetch_filesystem_properties(proxy) {
    if (!proxy.Used)
        proxy.Used = [false, ""];
    stratis2_fetch_properties(proxy, ["Used"]).then(values => {
        if (values.Used)
            proxy.Used = [true, values.Used];
    });
}

function stratis2_fetch_blockdev_properties(proxy) {
    stratis2_fetch_properties(proxy, ["TotalPhysicalSize"]).then(values => {
        if (values.TotalPhysicalSize)
            proxy.TotalPhysicalSize = values.TotalPhysicalSize;
        client.update();
    });
}

function stratis2_poll() {
    stratis2_fetch_manager_properties(client.stratis_manager);

    for (const path in client.stratis_pools)
        stratis2_fetch_pool_properties(client.stratis_pools[path]);

    for (const path in client.stratis_filesystems)
        stratis2_fetch_filesystem_properties(client.stratis_filesystems[path]);

    for (const path in client.stratis_blockdevs)
        stratis2_fetch_blockdev_properties(client.stratis_blockdevs[path]);
}

function stratis2_start_polling() {
    stratis2_poll();
    window.setInterval(stratis2_poll, 30000);
}

function stratis2_fixup_pool_notifications(data) {
    const fixup_data = { };
    let have_fixup = false;

    // When renaming a pool, stratisd 2.4.2 sends out notifications
    // with wrong interface names and forgets about notifications for
    // Devnode properties.
    //
    // https://github.com/stratis-storage/stratisd/issues/2731

    for (const path in data) {
        if (client.stratis_pools[path]) {
            for (const iface in data[path]) {
                if (iface == "org.storage.stratis2.filesystem") {
                    const props = data[path][iface];
                    if (props && props.Name) {
                        // The pool at 'path' got renamed.
                        fixup_data[path] = { "org.storage.stratis2.pool.r1": { Name: props.Name } };
                        for (const fsys of client.stratis_pool_filesystems[path]) {
                            fixup_data[fsys.path] = {
                                "org.storage.stratis2.filesystem": {
                                    Devnode: "/dev/stratis/" + props.Name + "/" + fsys.Name
                                }
                            };
                        }
                        have_fixup = true;
                    }
                }
            }
        }
    }

    if (have_fixup) {
        const stratis = client.stratis_manager.client;
        stratis.notify(fixup_data);
    }
}

function init_client(manager, callback) {
    if (client.manager)
        return;

    client.storaged_client = manager.client;
    client.manager = manager;

    init_proxies().then(() => init_model(callback));
}

client.init = function init_storaged(callback) {
    const udisks = cockpit.dbus("org.freedesktop.UDisks2", { superuser: "try" });
    const udisks_manager = udisks.proxy("org.freedesktop.UDisks2.Manager",
                                        "/org/freedesktop/UDisks2/Manager", { watch: true });

    udisks_manager.wait().then(() => init_client(udisks_manager, callback))
            .catch(ex => {
                console.warn("client.init(): udisks manager proxy failed:", JSON.stringify(ex));
                client.features = false;
                callback();
            });

    udisks_manager.addEventListener("changed", () => init_client(udisks_manager, callback));
};

client.wait_for = function wait_for(cond) {
    return new Promise(resolve => {
        function check() {
            const res = cond();
            if (res) {
                client.removeEventListener("changed", check);
                resolve(res);
            }
        }

        client.addEventListener("changed", check);
        check();
    });
};

client.get_config = (name, def) => {
    if (cockpit.manifests.storage && cockpit.manifests.storage.config) {
        let val = cockpit.manifests.storage.config[name];
        if (typeof val === 'object' && val !== null)
            val = val[client.os_release.ID];
        return val !== undefined ? val : def;
    } else {
        return def;
    }
};

export default client;
