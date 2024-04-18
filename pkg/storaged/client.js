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

import inotify_py from "inotify.py";
import mount_users_py from "./mount-users.py";
import nfs_mounts_py from "./nfs/nfs-mounts.py";
import vdo_monitor_py from "./legacy-vdo/vdo-monitor.py";
import stratis2_set_key_py from "./stratis/stratis2-set-key.py";
import stratis3_set_key_py from "./stratis/stratis3-set-key.py";

import { reset_pages } from "./pages.jsx";
import { make_overview_page } from "./overview/overview.jsx";
import { export_mount_point_mapping } from "./anaconda.jsx";

import deep_equal from "deep-equal";

/* STORAGED CLIENT
 */

function debug() {
    if (window.debugging == "all" || window.debugging?.includes("storaged")) // not-covered: debugging
        console.debug.apply(console, arguments); // not-covered: debugging
}

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
    client.blocks_fsys_btrfs = proxies("Filesystem.BTRFS");
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

export async function btrfs_poll() {
    const usage_regex = /used\s+(?<used>\d+)\s+path\s+(?<device>[\w/]+)/;
    if (!client.uuids_btrfs_subvols)
        client.uuids_btrfs_subvols = { };
    if (!client.uuids_btrfs_usage)
        client.uuids_btrfs_usage = { };
    if (!client.uuids_btrfs_default_subvol)
        client.uuids_btrfs_default_subvol = { };
    if (!client.uuids_btrfs_volume)
        return;

    if (!client.superuser.allowed || !client.features.btrfs) {
        return;
    }

    const uuids_subvols = { };
    const uuids_usage = { };
    const btrfs_default_subvol = { };
    for (const uuid of Object.keys(client.uuids_btrfs_volume)) {
        const blocks = client.uuids_btrfs_blocks[uuid];
        if (!blocks)
            continue;

        // In multi device setups MountPoints can be on either of the block devices, so try them all.
        const MountPoints = blocks.map(block => {
            return client.blocks_fsys[block.path];
        }).map(block_fsys => block_fsys.MountPoints).reduce((accum, current) => accum.concat(current));
        const mp = MountPoints[0];
        if (mp) {
            const mount_point = utils.decode_filename(mp);
            try {
                // HACK: UDisks GetSubvolumes method uses `subvolume list -p` which
                // does not show the full subvolume path which we want to show in the UI
                //
                // $ btrfs subvolume list -p /run/butter
                // ID 256 gen 7 parent 5 top level 5 path one
                // ID 257 gen 7 parent 256 top level 256 path two
                // ID 258 gen 7 parent 257 top level 257 path two/three/four
                //
                // $ btrfs subvolume list -ap /run/butter
                // ID 256 gen 7 parent 5 top level 5 path <FS_TREE>/one
                // ID 257 gen 7 parent 256 top level 256 path one/two
                // ID 258 gen 7 parent 257 top level 257 path <FS_TREE>/one/two/three/four
                const output = await cockpit.spawn(["btrfs", "subvolume", "list", "-ap", mount_point], { superuser: "require", err: "message" });
                const subvols = [{ pathname: "/", id: 5, parent: null }];
                for (const line of output.split("\n")) {
                    const m = line.match(/ID (\d+).*parent (\d+).*path (<FS_TREE>\/)?(.*)/);
                    if (m)
                        subvols.push({ pathname: m[4], id: Number(m[1]), parent: Number(m[2]) });
                }
                uuids_subvols[uuid] = subvols;
            } catch (err) {
                console.warn(`unable to obtain subvolumes for mount point ${mount_point}`, err);
            }

            // HACK: Obtain the default subvolume, required for mounts in which do not specify a subvol and subvolid.
            // In the future can be obtained via UDisks, it requires the btrfs partition to be mounted somewhere.
            // https://github.com/storaged-project/udisks/commit/b6966b7076cd837f9d307eef64beedf01bc863ae
            try {
                const output = await cockpit.spawn(["btrfs", "subvolume", "get-default", mount_point], { superuser: "require", err: "message" });
                const id_match = output.match(/ID (\d+).*/);
                if (id_match)
                    btrfs_default_subvol[uuid] = Number(id_match[1]);
            } catch (err) {
                console.warn(`unable to obtain default subvolume for mount point ${mount_point}`, err);
            }

            // HACK: UDisks should expose a better btrfs API with btrfs device information
            // https://github.com/storaged-project/udisks/issues/1232
            // TODO: optimise into just parsing one `btrfs filesystem show`?
            try {
                const usage_output = await cockpit.spawn(["btrfs", "filesystem", "show", "--raw", uuid], { superuser: "require", err: "message" });
                const usages = {};
                for (const line of usage_output.split("\n")) {
                    const match = usage_regex.exec(line);
                    if (match) {
                        const { used, device } = match.groups;
                        usages[device] = used;
                    }
                }
                uuids_usage[uuid] = usages;
            } catch (err) {
                console.warn(`btrfs filesystem show ${uuid}`, err);
            }
        } else {
            uuids_subvols[uuid] = null;
            uuids_usage[uuid] = null;
        }
    }

    if (!deep_equal(client.uuids_btrfs_subvols, uuids_subvols) || !deep_equal(client.uuids_btrfs_usage, uuids_usage) ||
        !deep_equal(client.uuids_btrfs_default_subvol, btrfs_default_subvol)) {
        debug("btrfs_pol new subvols:", uuids_subvols);
        client.uuids_btrfs_subvols = uuids_subvols;
        client.uuids_btrfs_usage = uuids_usage;
        debug("btrfs_pol usage:", uuids_usage);
        client.uuids_btrfs_default_subvol = btrfs_default_subvol;
        debug("btrfs_pol default subvolumes:", btrfs_default_subvol);
        client.update();
    }
}

function btrfs_findmnt_poll() {
    if (!client.btrfs_mounts)
        client.btrfs_mounts = { };

    const update_btrfs_mounts = output => {
        const btrfs_mounts = {};
        try {
            // Extract the data into a { uuid: { subvolid: { subvol, target } } }
            const mounts = JSON.parse(output);
            if ("filesystems" in mounts) {
                for (const fs of mounts.filesystems) {
                    const subvolid_match = fs.options.match(/subvolid=(?<subvolid>\d+)/);
                    const subvol_match = fs.options.match(/subvol=(?<subvol>[\w\\/]+)/);
                    if (!subvolid_match && !subvol_match) {
                        console.warn("findmnt entry without subvol and subvolid", fs);
                        break;
                    }

                    const { subvolid } = subvolid_match.groups;
                    const { subvol } = subvol_match.groups;
                    const subvolume = {
                        pathname: subvol,
                        id: subvolid,
                        mount_points: [fs.target],
                    };

                    if (!(fs.uuid in btrfs_mounts)) {
                        btrfs_mounts[fs.uuid] = { };
                    }

                    // We need to handle multiple mounts, they are listed seperate.
                    if (subvolid in btrfs_mounts[fs.uuid]) {
                        btrfs_mounts[fs.uuid][subvolid].mount_points.push(fs.target);
                    } else {
                        btrfs_mounts[fs.uuid][subvolid] = subvolume;
                    }
                }
            }
        } catch (exc) {
            if (exc.message)
                console.error("unable to parse findmnt JSON output", exc);
        }

        // Update client state
        if (!deep_equal(client.btrfs_mounts, btrfs_mounts)) {
            client.btrfs_mounts = btrfs_mounts;
            debug("btrfs_findmnt_poll mounts:", client.btrfs_mounts);
            client.update();
        }
    };

    const findmnt_poll = () => {
        return cockpit.spawn(["findmnt", "--type", "btrfs", "--mtab", "--poll"], { superuser: "try", err: "message" }).stream(() => {
            cockpit.spawn(["findmnt", "--type", "btrfs", "--mtab", "-o", "UUID,OPTIONS,TARGET", "--json"],
                          { superuser: "try", err: "message" }).then(output => update_btrfs_mounts(output)).catch(err => {
                // When there are no btrfs filesystems left this can fail and thus we need to manually reset the mount info.
                client.btrfs_mounts = {};
                client.update();
                if (err.message) {
                    console.error("findmnt exited with an error", err);
                }
            });
        }).catch(err => {
            console.error("findmnt --poll exited with an error", err);
            throw new Error("findmnt --poll stopped working");
        });
    };

    // This fails when no btrfs filesystem is found with the --mtab option and exits with 1, so that is kinda useless, however without --mtab
    // we don't get a nice flat structure. So we ignore the errors
    cockpit.spawn(["findmnt", "--type", "btrfs", "--mtab", "-o", "UUID,OPTIONS,SOURCE,TARGET", "--json"],
                  { superuser: "try", err: "message" }).then(output => {
        update_btrfs_mounts(output);
        findmnt_poll();
    }).catch(err => {
        // only log error when there is a real issue.
        if (client.superuser.allowed && err.message) {
            console.error(`unable to run findmnt ${err}`);
        }
        findmnt_poll();
    });
}

function btrfs_start_polling() {
    debug("starting polling for btrfs subvolumes");
    window.setInterval(btrfs_poll, 5000);
    client.uuids_btrfs_subvols = { };
    client.uuids_btrfs_usage = { };
    client.uuids_btrfs_default_subvol = { };
    client.btrfs_mounts = { };
    btrfs_poll();
    btrfs_findmnt_poll();
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

    const vgroups_with_dm_pvs = { };

    client.vgroups_pvols = { };
    for (path in client.vgroups) {
        client.vgroups_pvols[path] = [];
    }
    for (path in client.blocks_pvol) {
        pvol = client.blocks_pvol[path];
        if (client.vgroups_pvols[pvol.VolumeGroup] !== undefined) {
            client.vgroups_pvols[pvol.VolumeGroup].push(pvol);
            {
                // HACK - this is needed below to deal with a UDisks2 bug.
                // https://github.com/storaged-project/udisks/pull/1206
                const block = client.blocks[path];
                if (block && utils.decode_filename(block.Device).indexOf("/dev/dm-") == 0)
                    vgroups_with_dm_pvs[pvol.VolumeGroup] = true;
            }
        }
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

    function summarize_stripe(lv_size, segments) {
        const pvs = { };
        let total_size = 0;
        for (const [, size, pv] of segments) {
            if (!pvs[pv])
                pvs[pv] = 0;
            pvs[pv] += size;
            total_size += size;
        }
        if (total_size < lv_size)
            pvs["/"] = lv_size - total_size;
        return pvs;
    }

    client.lvols_stripe_summary = { };
    client.lvols_status = { };
    for (path in client.lvols) {
        const struct = client.lvols[path].Structure;
        const lvol = client.lvols[path];

        // HACK - UDisks2 can't find the PVs of a segment when they
        //        are on a device mapper device.
        //
        // https://github.com/storaged-project/udisks/pull/1206

        if (vgroups_with_dm_pvs[lvol.VolumeGroup])
            continue;

        let summary;
        let status = "";
        if (lvol.Layout != "thin" && struct && struct.segments) {
            summary = summarize_stripe(struct.size.v, struct.segments.v);
            if (summary["/"])
                status = "partial";
        } else if (struct && struct.data && struct.metadata &&
                   (struct.data.v.length == struct.metadata.v.length || struct.metadata.v.length == 0)) {
            summary = [];
            const n_total = struct.data.v.length;
            let n_missing = 0;
            for (let i = 0; i < n_total; i++) {
                const data_lv = struct.data.v[i];
                const metadata_lv = struct.metadata.v[i] || { size: { v: 0 }, segments: { v: [] } };

                if (!data_lv.segments || (metadata_lv && !metadata_lv.segments)) {
                    summary = undefined;
                    break;
                }

                const s = summarize_stripe(data_lv.size.v + metadata_lv.size.v,
                                           data_lv.segments.v.concat(metadata_lv.segments.v));
                if (s["/"])
                    n_missing += 1;

                summary.push(s);
            }
            if (n_missing > 0) {
                status = "partial";
                if (lvol.Layout == "raid1") {
                    if (n_total - n_missing >= 1)
                        status = "degraded";
                }
                if (lvol.Layout == "raid10") {
                    // This is correct for two-way mirroring, which is
                    // the only setup supported by lvm2.
                    if (n_missing > n_total / 2) {
                        // More than half of the PVs are gone -> at
                        // least one mirror has definitely lost both
                        // halves.
                        status = "partial";
                    } else if (n_missing > 1) {
                        // Two or more PVs are lost -> one mirror
                        // might have lost both halves
                        status = "degraded-maybe-partial";
                    } else {
                        // Only one PV is missing -> no mirror has
                        // lost both halves.
                        status = "degraded";
                    }
                }
                if (lvol.Layout == "raid4" || lvol.Layout == "raid5") {
                    if (n_missing <= 1)
                        status = "degraded";
                }
                if (lvol.Layout == "raid6") {
                    if (n_missing <= 2)
                        status = "degraded";
                }
            }
        }
        if (summary) {
            client.lvols_stripe_summary[path] = summary;
            client.lvols_status[path] = status;
        }
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

    client.blocks_stratis_stopped_pool = { };
    client.stratis_stopped_pool_key_description = { };
    client.stratis_stopped_pool_clevis_info = { };
    for (const uuid in client.stratis_manager.StoppedPools) {
        const devs = client.stratis_manager.StoppedPools[uuid].devs.v;
        for (const d of devs) {
            block = client.slashdevs_block[d.devnode];
            if (block)
                client.blocks_stratis_stopped_pool[block.path] = uuid;
        }
        const kinfo = client.stratis_manager.StoppedPools[uuid].key_description;
        if (kinfo &&
            kinfo.t == "(bv)" &&
            kinfo.v[0] &&
            kinfo.v[1].t == "(bs)" &&
            kinfo.v[1].v[0]) {
            client.stratis_stopped_pool_key_description[uuid] = kinfo.v[1].v[1];
        }
        const cinfo = client.stratis_manager.StoppedPools[uuid].clevis_info;
        if (cinfo &&
            cinfo.t == "(bv)" &&
            cinfo.v[0] &&
            cinfo.v[1].t == "(b(ss))" &&
            cinfo.v[1].v[0]) {
            client.stratis_stopped_pool_clevis_info[uuid] = cinfo.v[1].v[1];
        }
    }

    client.stratis_pool_stats = { };
    for (path in client.stratis_pools) {
        const pool = client.stratis_pools[path];
        const filesystems = client.stratis_pool_filesystems[path];

        const fsys_offsets = [];
        let fsys_total_used = 0;
        let fsys_total_size = 0;
        filesystems.forEach(fs => {
            fsys_offsets.push(fsys_total_used);
            fsys_total_used += fs.Used[0] ? Number(fs.Used[1]) : 0;
            fsys_total_size += Number(fs.Size);
        });

        const overhead = pool.TotalPhysicalUsed[0] ? (Number(pool.TotalPhysicalUsed[1]) - fsys_total_used) : 0;
        const pool_total = Number(pool.TotalPhysicalSize) - overhead;
        let pool_free = pool_total - fsys_total_size;

        // leave some margin since the above computation does not seem to
        // be exactly right when snapshots are involved.
        pool_free -= filesystems.length * 1024 * 1024;

        client.stratis_pool_stats[path] = {
            fsys_offsets,
            fsys_total_used,
            fsys_total_size,
            pool_total,
            pool_free,
        };
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

    client.iscsi_sessions_drives = { };
    client.drives_iscsi_session = { };
    for (path in client.drives) {
        const block = client.drives_block[path];
        if (!block)
            continue;
        for (const session_path in client.iscsi_sessions) {
            const session = client.iscsi_sessions[session_path];
            for (i = 0; i < block.Symlinks.length; i++) {
                if (utils.decode_filename(block.Symlinks[i]).includes(session.data.target_name)) {
                    client.drives_iscsi_session[path] = session;
                    if (!client.iscsi_sessions_drives[session_path])
                        client.iscsi_sessions_drives[session_path] = [];
                    client.iscsi_sessions_drives[session_path].push(client.drives[path]);
                }
            }
        }
    }

    client.blocks_available = { };
    for (path in client.blocks) {
        block = client.blocks[path];
        if (utils.is_available_block(client, block))
            client.blocks_available[path] = true;
    }

    client.path_jobs = { };
    function enter_job(job) {
        if (!job.Objects || !job.Objects.length)
            return;
        job.Objects.forEach(p => {
            if (!client.path_jobs[p])
                client.path_jobs[p] = [];
            client.path_jobs[p].push(job);
        });
    }
    for (path in client.jobs) {
        enter_job(client.jobs[path]);
    }

    // UDisks API does not provide a btrfs volume abstraction so we keep track of
    // volume's by uuid in an object. uuid => [org.freedesktop.UDisks2.Filesystem.BTRFS]
    // https://github.com/storaged-project/udisks/issues/1232
    const old_uuids = client.uuids_btrfs_volume;
    let need_poll = false;
    client.uuids_btrfs_volume = { };
    client.uuids_btrfs_blocks = { };
    for (const p in client.blocks_fsys_btrfs) {
        const bfs = client.blocks_fsys_btrfs[p];
        const uuid = bfs.data.uuid;
        const block_fsys = client.blocks_fsys[p];
        if ((block_fsys && block_fsys.MountPoints.length > 0) || !client.uuids_btrfs_volume[uuid]) {
            client.uuids_btrfs_volume[uuid] = bfs;
            if (!old_uuids || !old_uuids[uuid])
                need_poll = true;
        }
        if (!client.uuids_btrfs_blocks[uuid])
            client.uuids_btrfs_blocks[uuid] = [];
        client.uuids_btrfs_blocks[uuid].push(client.blocks[p]);
    }

    if (need_poll) {
        btrfs_poll();
    }
}

client.update = (first_time) => {
    if (first_time)
        client.ready = true;
    if (client.ready) {
        update_indices();
        reset_pages();
        make_overview_page();
        export_mount_point_mapping();
        client.dispatchEvent("changed");
    }
};

function init_model(callback) {
    function pull_time() {
        return cockpit.spawn(["date", "+%s"])
                .then(function (now) {
                    client.time_offset = parseInt(now, 10) * 1000 - new Date().getTime();
                });
    }

    async function enable_udisks_features() {
        if (!client.manager.valid)
            return;

        try {
            await client.manager.EnableModule("btrfs", true);
            client.manager_btrfs = proxy("Manager.BTRFS", "Manager");
            await client.manager_btrfs.wait();
            client.features.btrfs = client.manager_btrfs.valid;
            if (client.features.btrfs)
                btrfs_start_polling();
        } catch (error) {
            console.warn("Can't enable storaged btrfs module", error.toString());
        }

        try {
            await client.manager.EnableModule("iscsi", true);
            client.manager_iscsi = proxy("Manager.ISCSI.Initiator", "Manager");
            await client.manager_iscsi.wait();
            client.features.iscsi = (client.manager_iscsi.valid && client.manager_iscsi.SessionsSupported !== false);
        } catch (error) {
            console.warn("Can't enable storaged iscsi module", error.toString());
        }

        try {
            await client.manager.EnableModule("lvm2", true);
            client.manager_lvm2 = proxy("Manager.LVM2", "Manager");
            await client.manager_lvm2.wait();
            client.features.lvm2 = client.manager_lvm2.valid;
        } catch (error) {
            console.warn("Can't enable storaged lvm2 module", error.toString());
        }
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
        return cockpit.script("type clevis-luks-bind", { err: "ignore" }).then(
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
        return cockpit.script("type mount.nfs", { err: "message", environ: [std_path] }).then(
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
        const info = {};
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
    }

    try {
        client.anaconda = JSON.parse(window.sessionStorage.getItem("cockpit_anaconda"));
        if (client.anaconda)
            console.log("ANACONDA", client.anaconda);
    } catch {
        console.warn("Can't parse cockpit_anaconda configuration as JSON");
        client.anaconda = null;
    }

    pull_time().then(() => {
        read_os_release().then(os_release => {
            client.os_release = os_release;

            enable_features().then(() => {
                query_fsys_info().then((fsys_info) => {
                    client.fsys_info = fsys_info;

                    client.storaged_client.addEventListener('notify', () => client.update());

                    update_indices();
                    btrfs_poll().then(() => {
                        client.update(true);
                        callback();
                    });
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
    const entry = block.Configuration.find(c => c[0] == "fstab" && utils.decode_filename(c[1].dir.v) == target);
    if (entry)
        return cockpit.script('set -e; mkdir -p "$2"; mount "$1" "$2" -o "$3"',
                              [utils.decode_filename(block.Device), target, utils.get_block_mntopts(entry[1])],
                              { superuser: "require", err: "message" });
    else
        return Promise.reject(cockpit.format("Internal error: No fstab entry for $0 and $1",
                                             utils.decode_filename(block.Device),
                                             target));
};

client.unmount_at = (target, users) => {
    return client.stop_mount_users(users).then(() => cockpit.spawn(["umount", target],
                                                                   { superuser: "require", err: "message" }));
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
                        client.update();
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
                    client.update();
                })
                .catch(function () {
                    self.fsys_sizes[path] = [0, 0];
                    client.update();
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
                                 superuser: "require",
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

        return cockpit.spawn(["/bin/sh", "-c", "head -1 $(command -v vdo || echo /dev/null)"],
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
const stratis3_interface_revision = "r5";

function stratis3_start() {
    const stratis = cockpit.dbus("org.storage.stratis3", { superuser: "try" });
    client.stratis_manager = stratis.proxy("org.storage.stratis3.Manager." + stratis3_interface_revision,
                                           "/org/storage/stratis3");

    // The rest of the code expects these to be initialized even if no
    // stratisd is found.
    client.stratis_pools = { };
    client.stratis_blockdevs = { };
    client.stratis_filesystems = { };
    client.stratis_manager.StoppedPools = {};

    return client.stratis_manager.wait()
            .then(() => {
                client.stratis_store_passphrase = (desc, passphrase) => {
                    return python.spawn(stratis3_set_key_py, [desc], { superuser: "require" })
                            .input(passphrase);
                };

                client.stratis_start_pool = (uuid, unlock_method) => {
                    return client.stratis_manager.StartPool(uuid, "uuid", [!!unlock_method, unlock_method || ""]);
                };

                client.stratis_create_pool = (name, devs, key_desc, clevis_info) => {
                    return client.stratis_manager.CreatePool(name,
                                                             devs,
                                                             key_desc ? [true, key_desc] : [false, ""],
                                                             clevis_info ? [true, clevis_info] : [false, ["", ""]]);
                };

                client.stratis_set_overprovisioning = (pool, flag) => {
                    // DBusProxy is smart enough to allow
                    // "pool.Overprovisioning = flag" to just work,
                    // but we want to catch any error ourselves, and
                    // we want to wait for the method call to
                    // complete.
                    return stratis.call(pool.path, "org.freedesktop.DBus.Properties", "Set",
                                        ["org.storage.stratis3.pool." + stratis3_interface_revision,
                                            "Overprovisioning",
                                            cockpit.variant("b", flag)
                                        ]);
                };

                client.stratis_list_keys = () => {
                    return client.stratis_manager.ListKeys();
                };

                client.stratis_create_filesystem = (pool, name, size) => {
                    return pool.CreateFilesystems([[name, size ? [true, size.toString()] : [false, ""]]]);
                };

                client.features.stratis = true;
                client.features.stratis_crypto_binding = true;
                client.features.stratis_encrypted_caches = true;
                client.features.stratis_managed_fsys_sizes = true;
                client.features.stratis_grow_blockdevs = true;
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
    client.stratis_manager.StoppedPools = {};

    return client.stratis_manager.wait()
            .then(() => {
                if (utils.compare_versions(client.stratis_manager.Version, "2.4") < 0)
                    return Promise.reject(new Error("stratisd too old, need at least version 2.4"));

                client.stratis_store_passphrase = (desc, passphrase) => {
                    return python.spawn(stratis2_set_key_py, [desc], { superuser: "require" })
                            .input(passphrase);
                };

                client.stratis_start_pool = (uuid) => {
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
            proxy.StoppedPools = { };
            for (const uuid in values.LockedPoolsWithDevs) {
                const l = values.LockedPoolsWithDevs[uuid];
                proxy.StoppedPools[uuid] = {
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

function try_fields(dict, fields, def) {
    for (let i = 0; i < fields.length; i++)
        if (fields[i] && dict[fields[i]])
            return dict[fields[i]];
    return def;
}

client.get_config = (name, def) => {
    if (cockpit.manifests.storage && cockpit.manifests.storage.config) {
        const val = cockpit.manifests.storage.config[name];
        if (typeof val === 'object' && val !== null)
            return try_fields(val, [client.os_release.PLATFORM_ID, client.os_release.ID], def);
        else
            return val !== undefined ? val : def;
    } else {
        return def;
    }
};

client.in_anaconda_mode = () => !!client.anaconda;

client.strip_mount_point_prefix = (dir) => {
    const mpp = client.anaconda?.mount_point_prefix;

    if (dir && mpp) {
        if (dir.indexOf(mpp) != 0)
            return false;

        dir = dir.substr(mpp.length);
        if (dir == "")
            dir = "/";
    }

    return dir;
};

client.add_mount_point_prefix = (dir) => {
    const mpp = client.anaconda?.mount_point_prefix;
    if (mpp && dir != "") {
        if (dir == "/")
            dir = mpp;
        else
            dir = mpp + dir;
    }
    return dir;
};

client.should_ignore_device = (devname) => {
    return client.anaconda?.available_devices && client.anaconda.available_devices.indexOf(devname) == -1;
};

client.should_ignore_block = (block) => {
    return client.should_ignore_device(utils.decode_filename(block.PreferredDevice));
};

export default client;
