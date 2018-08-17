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

    var $ = require('jquery');
    var cockpit = require('cockpit');
    var PK = require('packagekit.es6');

    var utils = require('./utils');

    var python = require("python.jsx");
    var inotify_py = require("raw!inotify.py");
    var nfs_mounts_py = require("raw!./nfs-mounts.py");
    var vdo_monitor_py = require("raw!./vdo-monitor.py");

    /* STORAGED CLIENT
     */

    /* HACK: https://github.com/storaged-project/storaged/pull/68 */
    var hacks = { };
    if (cockpit.manifests["storage"] && cockpit.manifests["storage"]["hacks"])
        hacks = cockpit.manifests["storage"]["hacks"];

    var client = { };

    cockpit.event_target(client);

    /* Metrics
     */

    function instance_sampler(metrics, source) {
        var instances;
        var self = {
            data: { },
            close: close
        };

        cockpit.event_target(self);

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
                self.dispatchEvent('changed');
        }

        var channel = cockpit.channel({ payload: "metrics1",
                                        source: source || "internal",
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

    var STORAGED_SERVICE;
    var STORAGED_OPATH_PFX;
    var STORAGED_IFACE_PFX;

    client.time_offset = undefined;  /* Number of milliseconds that the server is ahead of us. */
    client.features = undefined;

    client.storaged_client = undefined;

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

    client.call = function call(path, iface, method, args, options) {
        return client.storaged_client.call(path, STORAGED_IFACE_PFX + "." + iface, method, args, options);
    };

    function init_proxies () {
        client.storaged_client.watch({ path_namespace: STORAGED_OPATH_PFX });

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
        client.jobs = proxies("Job");
    }

    /* Monitors
     */

    client.fsys_sizes = instance_sampler([ { name: "mount.used" },
                                           { name: "mount.total" }
                                         ]);

    client.swap_sizes = instance_sampler([ { name: "swapdev.length" },
                                           { name: "swapdev.free" },
                                         ], "direct");

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
        var path, block, mdraid, vgroup, pvol, lvol, part, i;

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
            client.vgroups_lvols[path].sort(function (a, b) { return a.Name.localeCompare(b.Name) });
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
            client.lvols_pool_members[path].sort(function (a, b) { return a.Name.localeCompare(b.Name) });
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
            client.blocks_partitions[path].sort(function (a, b) { return a.Offset - b.Offset });
        }

        client.path_jobs = { };
        function enter_job(job) {
            if (!job.Objects || !job.Objects.length)
                return;
            job.Objects.forEach(function (path) {
                client.path_jobs[path] = job;
                var parent = utils.get_parent(client, path);
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

    function init_model(callback) {

        function wait_all(objects, callback) {
            var obj = objects.pop();
            if (obj) {
                obj.wait(function () {
                    wait_all(objects, callback);
                });
            } else {
                callback();
            }
        }

        function pull_time() {
            return cockpit.spawn(["date", "+%s"])
                .then(function (now) {
                    client.time_offset = parseInt(now, 10) * 1000 - new Date().getTime();
                });
        }

        function enable_udisks_features() {
            if (!client.manager.valid)
                return cockpit.resolve();
            if (!client.manager.EnableModules)
                return cockpit.resolve();
            return client.manager.EnableModules(true).then(
                function() {
                    var defer = cockpit.defer();
                    client.manager_lvm2 = proxy("Manager.LVM2", "Manager");
                    client.manager_iscsi = proxy("Manager.ISCSI.Initiator", "Manager");
                    wait_all([ client.manager_lvm2, client.manager_iscsi],
                            function () {
                                client.features.lvm2 = client.manager_lvm2.valid;
                                client.features.iscsi = (hacks.with_storaged_iscsi_sessions != "no" &&
                                                         client.manager_iscsi.valid &&
                                                         client.manager_iscsi.SessionsSupported !== false);
                                defer.resolve();
                            });
                    return defer.promise;
                }, function(error) {
                    console.warn("Can't enable storaged modules", error.toString());
                    return cockpit.resolve();
                });
        }

        function enable_vdo_features() {
            return client.vdo_overlay.start()
                .then(function (success) {
                    client.features.vdo = success;
                    return cockpit.resolve();
                })
                .fail(function () {
                    return cockpit.resolve();
                });
        }

        function enable_clevis_features() {
            return cockpit.spawn([ "which", "clevis-luks-bind" ], { err: "ignore" }).then(
                function () {
                    client.features.clevis = true;
                    return cockpit.resolve();
                },
                function () {
                    return cockpit.resolve();
                });
        }

        function enable_nfs_features() {
            return cockpit.spawn([ "which", "mount.nfs" ], { err: "ignore" }).then(
                function () {
                    client.features.nfs = true;
                    client.nfs.start();
                    return cockpit.resolve();
                },
                function () {
                    return cockpit.resolve();
                });
        }

        function enable_pk_features() {
            return PK.detect().then(function (available) { client.features.packagekit = available });
        }

        function enable_features() {
            client.features = { };
            return (enable_udisks_features()
                    .then(enable_vdo_features)
                    .then(enable_clevis_features)
                    .then(enable_nfs_features)
                    .then(enable_pk_features));
        }

        function query_fsys_info() {
            var info = {
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
                return cockpit.all(client.manager.SupportedFilesystems.map(function (fs) {
                    return client.manager.CanFormat(fs).then(
                        function (canformat_result) {
                            info[fs] = {
                                can_format: canformat_result[0],
                                can_shrink: false,
                                can_grow: false
                            };
                            return client.manager.CanResize(fs).then(
                                function (canresize_result) {
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
                                },
                                function () {
                                    // ignore unsupported filesystems
                                });
                        });
                })).then(function () {
                    return info;
                });
            } else {
                return cockpit.resolve(info);
            }
        }

        wait_all([ client.manager,
                   client.mdraids, client.vgroups, client.drives,
                   client.blocks, client.blocks_ptable, client.blocks_lvm2, client.blocks_fsys
                 ], function () {
            pull_time().then(function() {
                enable_features().then(function() {
                    query_fsys_info().then(function(fsys_info) {
                        client.fsys_info = fsys_info;
                        callback();
                    });
                });

                $(client.storaged_client).on('notify', function () {
                    update_indices();
                    client.dispatchEvent("changed");
                });
                update_indices();
            });
        });
    }

    client.older_than = function older_than(version) {
        return utils.compare_versions(this.manager.Version, version) < 0;
    };

    /* NFS mounts
     */

    function nfs_mounts() {
        var self = {
            entries: [ ],
            fsys_sizes: { },

            start: start,

            get_fsys_size: get_fsys_size,
            entry_users: entry_users,

            update_entry: update_entry,
            add_entry: add_entry,
            remove_entry: remove_entry,

            mount_entry: mount_entry,
            unmount_entry: unmount_entry,
            stop_and_unmount_entry: stop_and_unmount_entry,
            stop_and_remove_entry: stop_and_remove_entry,

            find_entry: find_entry
        };

        function spawn_nfs_mounts(args) {
            return python.spawn([ inotify_py, nfs_mounts_py ], args, { superuser: "try", err: "message" });
        }

        function start() {
            var buf = "";
            spawn_nfs_mounts([ "monitor" ])
                .stream(function (output) {
                    var lines;

                    buf += output;
                    lines = buf.split("\n");
                    buf = lines[lines.length-1];
                    if (lines.length >= 2) {
                        self.entries = JSON.parse(lines[lines.length-2]);
                        self.fsys_sizes = { };
                        client.dispatchEvent('changed');
                    }
                }).
                fail(function (error) {
                    if (error != "closed") {
                        console.warn(error);
                    }
                });
        }

        function get_fsys_size(entry) {
            var path = entry.fields[1];
            if (self.fsys_sizes[path])
                return self.fsys_sizes[path];

            if (self.fsys_sizes[path] === false)
                return null;

            self.fsys_sizes[path] = false;
            cockpit.spawn([ "stat", "-f", "-c", "[ %S, %f, %b ]", path ], { err: "message" })
                .done(function (output) {
                    var data = JSON.parse(output);
                    self.fsys_sizes[path] = [ (data[2]-data[1])*data[0], data[2]*data[0] ];
                    client.dispatchEvent('changed');
                })
                .fail(function () {
                    self.fsys_sizes[path] = [ 0, 0 ];
                    client.dispatchEvent('changed');
                });

            return null;
        }

        function update_entry(entry, new_fields) {
            return spawn_nfs_mounts([ "update", JSON.stringify(entry), JSON.stringify(new_fields) ]);
        }

        function add_entry(fields) {
            return spawn_nfs_mounts([ "add", JSON.stringify(fields) ]);
        }

        function remove_entry(entry) {
            return spawn_nfs_mounts([ "remove", JSON.stringify(entry) ]);
        }

        function mount_entry(entry) {
            return spawn_nfs_mounts([ "mount", JSON.stringify(entry) ]);
        }

        function unmount_entry(entry) {
            return spawn_nfs_mounts([ "unmount", JSON.stringify(entry) ]);
        }

        function stop_and_unmount_entry(users, entry) {
            var units = users.map(function (u) { return u.unit });
            return spawn_nfs_mounts([ "stop-and-unmount", JSON.stringify(units), JSON.stringify(entry) ]);
        }

        function stop_and_remove_entry(users, entry) {
            var units = users.map(function (u) { return u.unit });
            return spawn_nfs_mounts([ "stop-and-remove", JSON.stringify(units), JSON.stringify(entry) ]);
        }

        function entry_users(entry) {
            return spawn_nfs_mounts([ "users", JSON.stringify(entry) ]).then(JSON.parse);
        }

        function find_entry(remote, local) {
            for (var i = 0; i < self.entries.length; i++) {
                if (self.entries[i].fields[0] == remote && self.entries[i].fields[1] == local)
                    return self.entries[i];
            }
        }

        return self;
    }

    client.nfs = nfs_mounts();

    /* VDO */

    function vdo_overlay() {
        var self = {
            start: start,

            volumes: [ ],

            by_name: { },
            by_dev: { },
            by_backing_dev: { },

            find_by_block: find_by_block,
            find_by_backing_block: find_by_backing_block,

            create: create
        };

        function cmd(args) {
            return cockpit.spawn([ "vdo" ].concat(args),
                                 { superuser: true,
                                   err: "message"
                                 });
        }

        function update(data) {
            self.by_name = { };
            self.by_dev = { };
            self.by_backing_dev = { };

            self.volumes = data.map(function (vol, index) {
                var name = vol.name;

                function volcmd(args) {
                    return cmd(args.concat([ "--name", name ]));
                }

                var v = { name: name,
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
                              return volcmd([ val? "enableCompression" : "disableCompression" ]);
                          },

                          set_deduplication: function(val) {
                              return volcmd([ val? "enableDeduplication" : "disableDeduplication" ]);
                          },

                          set_activate: function(val) {
                              return volcmd([ val? "activate" : "deactivate" ]);
                          },

                          start: function() {
                              return volcmd([ "start" ]);
                          },

                          stop: function() {
                              return volcmd([ "stop" ]);
                          },

                          remove: function() {
                              return volcmd([ "remove" ]);
                          },

                          force_remove: function() {
                              return volcmd([ "remove", "--force" ]);
                          },

                          grow_physical: function() {
                              return volcmd([ "growPhysical" ]);
                          },

                          grow_logical: function(lsize) {
                              return volcmd([ "growLogical", "--vdoLogicalSize", lsize + "B" ]);
                          }
                        };

                self.by_name[v.name] = v;
                self.by_dev[v.dev] = v;
                self.by_backing_dev[v.backing_dev] = v;

                return v;
            });

            // We trigger a change on the client right away and not
            // just on the vdo_overlay since this data is used all
            // over the place...

            client.dispatchEvent("changed");
        }

        function start() {
            var buf = "";

            return cockpit.spawn([ "/bin/sh", "-c", "head -1 $(which vdo || echo /dev/null)" ],
                                 { err: "ignore" })
                .then(function (shebang) {
                    if (shebang != "") {
                        self.python = shebang.replace(/#! */, "").trim("\n");
                        cockpit.spawn([ self.python, "--", "-" ], { superuser: "try", err: "message" })
                            .input(inotify_py + vdo_monitor_py)
                            .stream(function (output) {
                                var lines;

                                buf += output;
                                lines = buf.split("\n");
                                buf = lines[lines.length-1];
                                if (lines.length >= 2) {
                                    self.entries = JSON.parse(lines[lines.length-2]);
                                    self.fsys_sizes = { };
                                    $(self).triggerHandler('changed');
                                    update(JSON.parse(lines[lines.length-2]));
                                }
                            }).
                            fail(function (error) {
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
            var i;
            for (i = 0; i < array.length; i++) {
                var val = func(array[i]);
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
            var args = [ "create", "--name", options.name,
                         "--device", utils.decode_filename(options.block.PreferredDevice) ];
            if (options.logical_size !== undefined)
                args.push("--vdoLogicalSize", options.logical_size + "B");
            if (options.index_mem !== undefined)
                args.push("--indexMem", options.index_mem / (1024*1024*1024));
            if (options.compression !== undefined)
                args.push("--compression", options.compression? "enabled" : "disabled");
            if (options.deduplication !== undefined)
                args.push("--deduplication", options.deduplication? "enabled" : "disabled");
            if (options.emulate_512 !== undefined)
                args.push("--emulate512", options.emulate_512? "enabled" : "disabled");
            return cmd(args);
        }

        return self;
    }

    client.vdo_overlay = vdo_overlay();

    function init_manager() {
        /* Storaged 2.6 and later uses the UDisks2 API names, but try the
         * older storaged API first as a fallback.
         */

        var storaged_service = "org.storaged.Storaged";
        var storaged_opath_pfx = "/org/storaged/Storaged";
        var storaged_iface_pfx = "org.storaged.Storaged";

        var storaged = cockpit.dbus(storaged_service);
        var storaged_manager = storaged.proxy(storaged_iface_pfx + ".Manager",
                storaged_opath_pfx + "/Manager", { watch: true });

        function fallback_udisks() {
            STORAGED_SERVICE = "org.freedesktop.UDisks2";
            STORAGED_OPATH_PFX = "/org/freedesktop/UDisks2";
            STORAGED_IFACE_PFX = "org.freedesktop.UDisks2";

            var udisks = cockpit.dbus(STORAGED_SERVICE);
            var udisks_manager = udisks.proxy(STORAGED_IFACE_PFX + ".Manager",
                    STORAGED_OPATH_PFX + "/Manager", { watch: true });

            return udisks_manager.wait().then(function () {
                return udisks_manager;
            });
        }

        return storaged_manager.wait().then(function() {
            if (storaged_manager.valid) {
                console.log("Using older 'storaged' API: " + storaged_service);
                STORAGED_SERVICE = storaged_service;
                STORAGED_OPATH_PFX = storaged_opath_pfx;
                STORAGED_IFACE_PFX = storaged_iface_pfx;
                return storaged_manager;
            } else {
                return fallback_udisks();
            }
        }, fallback_udisks);
    }

    client.init = function init_storaged(callback) {
        init_manager().then(function(manager) {
            client.storaged_client = manager.client;
            client.manager = manager;

            // The first storaged version with the UDisks2 API names was 2.6
            client.is_old_udisks2 = (STORAGED_SERVICE == "org.freedesktop.UDisks2" && client.older_than("2.6"));
            if (client.is_old_udisks2)
                console.log("Using older 'udisks2' implementation: " + manager.Version);

            init_proxies();
            init_model(callback);
        }, function() {
            client.features = false;
            callback();
        });
    };

    module.exports = client;
}());
