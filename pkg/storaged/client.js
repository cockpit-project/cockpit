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

define([
    "jquery",
    "base1/cockpit",
    "storage/utils"
], function($, cockpit, utils) {

    /* STORAGED CLIENT
     */

    var client = { };

    /* Metrics
     */

    function instance_sampler(metrics) {
        var instances;
        var self = {
            data: { },
            close: close
        };

        function handle_meta(msg) {
            self.data = { };
            instances = [ ];
            for (var m = 0; m < msg.metrics.length; m++) {
                instances[m] = msg.metrics[m].instances;
                for (var i = 0; i < instances[m].length; i++)
                    self.data[instances[m][i]] = [ ];
            }
        }

        function handle_data(msg) {
            var changed = false;
            for (var s = 0; s < msg.length; s++) {
                var metrics = msg[s];
                for (var m = 0; m < metrics.length; m++) {
                    var inst = metrics[m];
                    for (var i = 0; i < inst.length; i++) {
                        if (inst[i] !== null) {
                            changed = true;
                            self.data[instances[m][i]][m] = inst[i];
                        }
                    }
                }
            }
            if (changed)
                $(self).triggerHandler('changed');
        }

        var channel = cockpit.channel({ payload: "metrics1",
                                        source: "internal",
                                        metrics: metrics
                                      });
        $(channel).on("closed", function (event, error) {
            console.log("closed", error);
        });
        $(channel).on("message", function (event, message) {
            var msg = JSON.parse(message);
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

    var STORAGED_SERVICE =   "org.storaged.Storaged";
    var STORAGED_OPATH_PFX = "/org/storaged/Storaged";
    var STORAGED_IFACE_PFX = "org.storaged.Storaged";

    /* This might happen eventually.
     */
    if (false) {
       STORAGED_SERVICE =   "org.freedesktop.UDisks2";
       STORAGED_OPATH_PFX = "/org/freedesktop/UDisks2";
       STORAGED_IFACE_PFX = "org.freedesktop.UDisks2";
    }

    client.time_offset = undefined;  /* Number of milliseconds that the server is ahead of us. */
    client.features = undefined;

    client.storaged_client = cockpit.dbus(STORAGED_SERVICE);

    function proxy(iface, path) {
        return client.storaged_client.proxy(STORAGED_IFACE_PFX + "." + iface,
                                            STORAGED_OPATH_PFX + "/" + path,
                                            { watch: true });
    }

    function proxies(iface) {
        /* We create the proxies here with 'watch' set to false and
         * establish a general watch for all of them.  This is more
         * efficient since it reduces the number of D-Bus calls done
         * by the cache.
         */
        return client.storaged_client.proxies(STORAGED_IFACE_PFX + "." + iface,
                                              STORAGED_OPATH_PFX,
                                              { watch: false });
    }

    client.storaged_client.watch({ path_namespace: STORAGED_OPATH_PFX });

    client.manager = proxy("Manager", "Manager");
    client.manager_lvm2 = proxy("Manager.LVM2", "Manager");
    client.manager_iscsi = proxy("Manager.ISCSI.Initiator", "Manager");

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
    client.iscsi_sessions = proxies("ISCSI.Session");
    client.storaged_jobs = proxies("Job");

    if (STORAGED_SERVICE != "org.freedesktop.UDisks2") {
        client.udisks_client = cockpit.dbus("org.freedesktop.UDisks2");
        client.udisks_jobs = client.udisks_client.proxies("org.freedesktop.UDisks2.Job",
                                                          "/org/freedesktop/UDisks2");
    } else {
        client.udisks_client = null;
        client.udisks_jobs = { };
    }

    /* Monitors
     */

    client.fsys_sizes = instance_sampler([ { name: "mount.used" },
                                           { name: "mount.total" }
                                         ]);

    client.blockdev_io = instance_sampler([ { name: "block.device.read", derive: "rate" },
                                            { name: "block.device.written", derive: "rate" }
                                          ]);

    /* Derived indices.
     */

    function is_multipath_master(block) {
        // The master has "mpath" in its device mapper UUID.  In the
        // future, storaged will hopefully provide this information
        // directly.
        if (block.Symlinks && block.Symlinks.length) {
            for (var i = 0; i < block.Symlinks.length; i++)
                if (utils.decode_filename(block.Symlinks[i]).indexOf("/dev/disk/by-id/dm-uuid-mpath-") === 0)
                    return true;
        }
        return false;
    }

    function update_indices() {
        var path, block, dev, mdraid, vgroup, pvol, lvol, part, i;

        client.broken_multipath_present = false;
        client.drives_multipath_blocks = { };
        client.drives_block = { };
        for (path in client.drives) {
            client.drives_multipath_blocks[path] = [ ];
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
                client.drives_multipath_blocks[path] = [ ];
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
            client.mdraids_members[path] = [ ];
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
            client.slashdevs_block[utils.decode_filename(enc).replace(/^\/dev\//, "")] = block;
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
            client.vgroups_pvols[path] = [ ];
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
            client.vgroups_lvols[path] = [ ];
        }
        for (path in client.lvols) {
            lvol = client.lvols[path];
            if (client.vgroups_lvols[lvol.VolumeGroup] !== undefined)
                client.vgroups_lvols[lvol.VolumeGroup].push(lvol);
        }
        for (path in client.vgroups_lvols) {
            client.vgroups_lvols[path].sort(function (a, b) { return a.Name.localeCompare(b.Name); });
        }

        client.lvols_block = { };
        for (path in client.blocks_lvm2) {
            client.lvols_block[client.blocks_lvm2[path].LogicalVolume] = client.blocks[path];
        }

        client.lvols_pool_members = { };
        for (path in client.lvols) {
            if (client.lvols[path].Type == "pool")
                client.lvols_pool_members[path] = [ ];
        }
        for (path in client.lvols) {
            lvol = client.lvols[path];
            if (client.lvols_pool_members[lvol.ThinPool] !== undefined)
                client.lvols_pool_members[lvol.ThinPool].push(lvol);
        }
        for (path in client.lvols_pool_members) {
            client.lvols_pool_members[path].sort(function (a, b) { return a.Name.localeCompare(b.Name); });
        }

        client.blocks_cleartext = { };
        for (path in client.blocks) {
            block = client.blocks[path];
            if (block.CryptoBackingDevice != "/")
                client.blocks_cleartext[block.CryptoBackingDevice] = block;
        }

        client.blocks_partitions = { };
        for (path in client.blocks_ptable) {
            client.blocks_partitions[path] = [ ];
        }
        for (path in client.blocks_part) {
            part = client.blocks_part[path];
            if (client.blocks_partitions[part.Table] !== undefined)
                client.blocks_partitions[part.Table].push(part);
        }
        for (path in client.blocks_partitions) {
            client.blocks_partitions[path].sort(function (a, b) { return a.Offset - b.Offset; });
        }
    }

    function init_model(callback) {

        function wait_all(objects, callback) {
            var obj = objects.pop();
            if (obj) {
                obj.wait(function () {
                    wait_all(objects, callback);
                });
            } else
                callback();
        }

        wait_all([ client.manager,
                   client.mdraids, client.vgroups, client.drives,
                   client.blocks, client.blocks_ptable, client.blocks_lvm2, client.blocks_fsys
                 ],
                 function () {
                     if (!client.manager.valid) {
                         client.features = false;
                         callback();
                     } else {
                         client.features = { lvm2: client.manager_lvm2.valid,
                                             iscsi: client.manager_iscsi.valid
                                           };

                         // Additional interfaces like the LVM2
                         // manager might appear asynchronously some
                         // time after the modules are loaded, so we
                         // have to watch them and react dynamically.

                         $(client.manager_lvm2).on("changed", function () {
                             client.features.lvm2 = client.manager_lvm2.valid;
                             $(client.features).triggerHandler("changed");
                         });

                         $(client.manager_iscsi).on("changed", function () {
                             client.features.iscsi = client.manager_iscsi.valid;
                             $(client.features).triggerHandler("changed");
                         });

                         cockpit.spawn(["date", "+%s"])
                             .done(function (now) {
                                 client.time_offset = parseInt(now)*1000 - new Date().getTime();
                             })
                             .always(function () {
                                 client.manager.EnableModules(true)
                                     .fail(function (error) {
                                         console.warn("Can't enable storaged modules", error.toString());
                                     });
                                 $(client.storaged_client).on('notify', function () {
                                     update_indices();
                                     $(client).triggerHandler('changed');
                                 });
                                 $(client.udisks_jobs).on('added removed changed', function () {
                                     $(client).triggerHandler('changed');
                                 });
                                 update_indices();
                                 callback();
                             });
                     }
                 });
    }

    client.init = init_model;

    return client;
});
