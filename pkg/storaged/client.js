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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';
import * as PK from 'packagekit';
import { superuser } from 'superuser';
import { get_manifest_config_matchlist } from 'utils';

import * as utils from './utils.js';

import * as python from "python.js";
import { read_os_release } from "os-release.js";

import inotify_py from "inotify.py";
import mount_users_py from "./mount-users.py";
import nfs_mounts_py from "./nfs/nfs-mounts.py";
import vdo_monitor_py from "./legacy-vdo/vdo-monitor.py";
import stratis3_set_key_py from "./stratis/stratis3-set-key.py";

import { reset_pages } from "./pages.jsx";
import { make_overview_page } from "./overview/overview.jsx";
import { export_mount_point_mapping } from "./anaconda.jsx";

import { dequal } from 'dequal/lite';

import btrfs_tool_py from "./btrfs/btrfs-tool.py";

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

client.run = async (func) => {
    if (client.in_anaconda_mode())
        await btrfs_stop_monitoring();
    const prom = func() || Promise.resolve();
    client.busy += 1;
    await prom.finally(() => {
        client.busy -= 1;
        btrfs_start_monitor();
        client.dispatchEvent("changed");
    });
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
    client.nvme_controller = proxies("NVMe.Controller");

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
                    const ro = fs.options.split(",").indexOf("ro") >= 0;

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
                        rw_mount_points: ro ? [] : [fs.target],
                    };

                    if (!(fs.uuid in btrfs_mounts)) {
                        btrfs_mounts[fs.uuid] = { };
                    }

                    // We need to handle multiple mounts, they are listed separate.
                    if (subvolid in btrfs_mounts[fs.uuid]) {
                        btrfs_mounts[fs.uuid][subvolid].mount_points.push(fs.target);
                        if (!ro)
                            btrfs_mounts[fs.uuid][subvolid].rw_mount_points.push(fs.target);
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
        if (!dequal(client.btrfs_mounts, btrfs_mounts)) {
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

function btrfs_update(data) {
    if (!client.uuids_btrfs_subvols)
        client.uuids_btrfs_subvols = { };
    if (!client.uuids_btrfs_usage)
        client.uuids_btrfs_usage = { };
    if (!client.uuids_btrfs_default_subvol)
        client.uuids_btrfs_default_subvol = { };

    const uuids_subvols = { };
    const uuids_usage = { };
    const default_subvol = { };

    for (const uuid in data) {
        if (data[uuid].error) {
            console.warn("Error polling btrfs", uuid, data[uuid].error);
        } else {
            if (data[uuid].subvolumes) {
                uuids_subvols[uuid] = [{ pathname: "/", id: 5, parent: null }].concat(data[uuid].subvolumes);
            }
            if (data[uuid].usages) {
                uuids_usage[uuid] = data[uuid].usages;
            }
            if (data[uuid].default_subvolume) {
                default_subvol[uuid] = data[uuid].default_subvolume;
            }
        }
    }

    if (!dequal(client.uuids_btrfs_subvols, uuids_subvols) || !dequal(client.uuids_btrfs_usage, uuids_usage) ||
        !dequal(client.uuids_btrfs_default_subvol, default_subvol)) {
        debug("btrfs_pol new subvols:", uuids_subvols);
        client.uuids_btrfs_subvols = uuids_subvols;
        client.uuids_btrfs_usage = uuids_usage;
        debug("btrfs_pol usage:", uuids_usage);
        client.uuids_btrfs_default_subvol = default_subvol;
        debug("btrfs_pol default subvolumes:", default_subvol);
        client.update();
    }
}

export async function btrfs_tool(args) {
    return await python.spawn(btrfs_tool_py, args, { superuser: "require" });
}

function btrfs_poll_options() {
    if (client.in_anaconda_mode())
        return ["--mount"];
    else
        return [];
}

export async function btrfs_poll() {
    if (!client.superuser.allowed || !client.features.btrfs) {
        return;
    }

    const data = JSON.parse(await btrfs_tool(["poll", ...btrfs_poll_options()]));
    btrfs_update(data);
}

let btrfs_monitor_channel = null;

function btrfs_start_monitor() {
    if (!client.superuser.allowed || !client.features.btrfs) {
        return;
    }

    if (btrfs_monitor_channel)
        return;

    const channel = python.spawn(btrfs_tool_py, ["monitor", ...btrfs_poll_options()], { superuser: "require" });
    let buf = "";

    channel.stream(output => {
        buf += output;
        const lines = buf.split("\n");
        buf = lines[lines.length - 1];
        if (lines.length >= 2) {
            const data = JSON.parse(lines[lines.length - 2]);
            btrfs_update(data);
        }
    });

    channel.catch(err => {
        throw new Error(err.toString());
    });

    btrfs_monitor_channel = channel;
}

function btrfs_stop_monitoring() {
    if (btrfs_monitor_channel) {
        const res = btrfs_monitor_channel.then(() => {
            btrfs_monitor_channel = null;
        });
        btrfs_monitor_channel.close();
        return res;
    } else {
        return Promise.resolve();
    }
}

function btrfs_start_polling() {
    debug("starting polling for btrfs subvolumes");
    client.uuids_btrfs_subvols = { };
    client.uuids_btrfs_usage = { };
    client.uuids_btrfs_default_subvol = { };
    client.btrfs_mounts = { };
    btrfs_findmnt_poll();
    btrfs_start_monitor();
}

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

function is_toplevel_drive(block) {
    // We consider all Block objects that point to the same Drive
    // objects to be multipath members for a single actual device.
    //
    // However, objects for partitions point to the same Drive object
    // as the object for the partition table. We have to ignore them.

    if (client.blocks_part[block.path])
        return false;

    // Also, eMMCs have special partition-like sub-devices that point
    // to the main Drive. We identify them by their name, just like
    // UDisks2.

    if (utils.decode_filename(block.Device).match(/\/dev\/mmcblk[0-9]boot[0-9]$/))
        return false;

    return true;
}

function update_indices() {
    let path;
    let block;
    let mdraid;
    let vgroup;
    let pvol;
    let lvol;
    let pool;
    let blockdev;
    let fsys;
    let part;
    let i;

    client.broken_multipath_present = false;
    client.drives_multipath_blocks = { };
    client.drives_block = { };
    for (path in client.drives) {
        client.drives_multipath_blocks[path] = [];
    }
    for (path in client.blocks) {
        block = client.blocks[path];
        if (client.drives_multipath_blocks[block.Drive] !== undefined && is_toplevel_drive(block)) {
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

        // HACK - UDisks2 befopre 2.11 can't find the PVs of a segment
        //        when they are on a device mapper device.
        //
        // https://github.com/storaged-project/udisks/pull/1206

        if (!client.at_least("2.11") && vgroups_with_dm_pvs[lvol.VolumeGroup])
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
        if (!uuid)
            continue;
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

let lvm2_poll_timer = null;

function update_lvm2_polling(for_visibility) {
    const need_polling = !cockpit.hidden && !!Object.values(client.vgroups).find(vg => vg.NeedsPolling);

    function poll() {
        for (const path in client.vgroups) {
            const vg = client.vgroups[path];
            if (vg.NeedsPolling) {
                vg.Poll();
            }
        }
    }

    if (need_polling && lvm2_poll_timer == null) {
        lvm2_poll_timer = window.setInterval(poll, 2000);
        if (for_visibility)
            poll();
    } else if (!need_polling && lvm2_poll_timer) {
        window.clearInterval(lvm2_poll_timer);
        lvm2_poll_timer = null;
    }
}

client.update = (first_time) => {
    if (first_time)
        client.ready = true;
    if (client.ready) {
        update_indices();
        update_lvm2_polling(false);
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
        if (client.in_anaconda_mode()) {
            client.features.packagekit = false;
            return Promise.resolve();
        }
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
                    cockpit.addEventListener("visibilitychange", () => update_lvm2_polling(true));
                    btrfs_poll().then(() => {
                        client.update(true);
                        callback();
                    });
                });
            });
        });
    });
}

client.younger_than = function younger_than(version) {
    return utils.compare_versions(this.manager.Version, version) < 0;
};

client.at_least = function at_least(version) {
    return utils.compare_versions(this.manager.Version, version) >= 0;
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
    return stratis3_start();
};

// We need to use the same revision for all interfaces, mixing them is
// not allowed.  If we need to bump it, it should be bumped here for all
// of them at the same time.
//
const stratis3_interface_revision = "r6";

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

                client.stratis_set_property = (proxy, prop, sig, value) => {
                    // DBusProxy is smart enough to allow "proxy.Prop
                    // = value" to just work, but we want to catch any
                    // error ourselves, and we want to wait for the
                    // method call to complete.
                    return stratis.call(proxy.path, "org.freedesktop.DBus.Properties", "Set",
                                        [proxy.iface, prop, cockpit.variant(sig, value)]);
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

                // HACK - give us a sneak preview of the "r8"
                // manager. It is used to start V2 pools.
                client.stratis_manager_r8 = stratis.proxy(
                    "org.storage.stratis3.Manager.r8",
                    "/org/storage/stratis3");

                return stratis.watch({ path_namespace: "/org/storage/stratis3" }).then(() => {
                    client.stratis_manager.client.addEventListener('notify', (event, data) => {
                        client.update();
                    });
                });
            });
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

client.get_config = (name, def) =>
    get_manifest_config_matchlist("storage", name, def, [client.os_release.PLATFORM_ID, client.os_release.ID]);

client.in_anaconda_mode = () => !!client.anaconda;

client.strip_mount_point_prefix = (dir) => {
    const mpp = client.anaconda?.mount_point_prefix;

    if (dir && mpp) {
        if (dir.indexOf(mpp) != 0)
            return false;

        dir = dir.substring(mpp.length);
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
