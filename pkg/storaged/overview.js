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
    var plot = require("plot");
    var journal = require("journal");

    var utils = require("./utils");
    var dialog = require("./dialog");
    var permissions = require("./permissions");

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    /* OVERVIEW PAGE
     */


    function init_overview(client, jobs) {
        var read_series, write_series;

        $('#vgroups').toggle(client.features.lvm2);
        $('#iscsi-sessions').toggle(client.features.iscsi);

        var mdraids_tmpl = $("#mdraids-tmpl").html();
        mustache.parse(mdraids_tmpl);

        function render_mdraids() {
            function cmp_mdraid(path_a, path_b) {
                // TODO - ignore host part
                return client.mdraids[path_a].Name.localeCompare(client.mdraids[path_b].Name);
            }

            function make_mdraid(path) {
                var mdraid = client.mdraids[path];

                return {
                    path: path,
                    UUID: mdraid.UUID,
                    Size: utils.fmt_size(mdraid.Size),
                    Name: utils.mdraid_name(mdraid)
                };
            }

            var m = Object.keys(client.mdraids).sort(cmp_mdraid).map(make_mdraid);
            $('#mdraids').amend(mustache.render(mdraids_tmpl,
                                                { MDRaids: m,
                                                  HasMDRaids: m.length > 0
                                                }));
            permissions.update();
            jobs.update('#mdraids');
        }

        $(client).on('changed', render_mdraids);

        var vgroups_tmpl = $("#vgroups-tmpl").html();
        mustache.parse(vgroups_tmpl);

        function render_vgroups() {
            function cmp_vgroup(path_a, path_b) {
                return client.vgroups[path_a].Name.localeCompare(client.vgroups[path_b].Name);
            }

            function make_vgroup(path) {
                var vgroup = client.vgroups[path];

                return {
                    path: path,
                    Size: utils.fmt_size(vgroup.Size),
                    Name: vgroup.Name
                };
            }

            var v = Object.keys(client.vgroups).sort(cmp_vgroup).map(make_vgroup);
            $('#vgroups').amend(mustache.render(vgroups_tmpl,
                                                { VGroups: v,
                                                  HasVGroups: v.length > 0
                                                }));
            permissions.update();
            jobs.update('#vgroups');
        }

        $(client).on('changed', render_vgroups);

        var iscsi_sessions_tmpl = $("#iscsi-sessions-tmpl").html();
        mustache.parse(iscsi_sessions_tmpl);

        function render_iscsi_sessions() {
            function cmp_session(a, b) {
                return a.Name.localeCompare(b.Name);
            }

            function make_session(path) {
                var session = client.iscsi_sessions[path];
                return {
                    path: path,
                    Name: session.data["target_name"] || "",
                    Tpgt: session.data["tpgt"],
                    Address: session.data["persistent_address"],
                    Port: session.data["persistent_port"]
                };
            }

            var s = Object.keys(client.iscsi_sessions).map(make_session).sort(cmp_session);
            $('#iscsi-sessions').amend(mustache.render(iscsi_sessions_tmpl,
                                                       { Sessions: s,
                                                         HasSessions: s.length > 0
                                                       }));
            permissions.update();
        }

        $(client).on('changed', render_iscsi_sessions);

        var drives_tmpl = $("#drives-tmpl").html();
        mustache.parse(drives_tmpl);

        var cur_highlight;

        function render_drives() {
            function cmp_drive(path_a, path_b) {
                return client.drives[path_a].SortKey.localeCompare(client.drives[path_b].SortKey);
            }

            function classify_drive(drive) {
                if (drive.MediaRemovable || drive.Media) {
                    for (var i = 0; i < drive.MediaCompatibility.length; i++)
                        if (drive.MediaCompatibility[i].indexOf("optical") === 0)
                            return "optical";
                    return "removable";
                }

                return (drive.RotationRate === 0)? "ssd" : "hdd";
            }

            function make_drive(path) {
                var drive = client.drives[path];
                var block = client.drives_block[path];

                if (!block) {
                    // A drive without a primary block device might be
                    // a unconfigured multipath device.  Try to hobble
                    // along here by arbitrarily picking one of the
                    // multipath devices.
                    block = client.drives_multipath_blocks[path][0];
                }

                if (!block)
                    return;

                var dev = utils.decode_filename(block.Device).replace(/^\/dev\//, "");
                var io = client.blockdev_io.data[dev];

                var name = utils.drive_name(drive);
                var classification = classify_drive(drive);
                var size_str = utils.fmt_size(drive.Size);
                var desc;
                if (classification == "hdd") {
                    desc = size_str + " " + C_("storage", "Hard Disk");
                } else if (classification == "ssd") {
                    desc = size_str + " " + C_("storage", "Solid-State Disk");
                } else if (classification == "removable") {
                    if (drive.Size === 0)
                        desc = C_("storage", "Removable Drive");
                    else
                        desc = size_str + " " + C_("storage", "Removable Drive");
                } else if (classification == "optical") {
                    desc = C_("storage", "Optical Drive");
                } else {
                    if (drive.Size === 0)
                        desc = C_("storage", "Drive");
                    else
                        desc = size_str + " " + C_("storage", "Drive");
                }

                return {
                    path: path,
                    dev: dev,
                    Name: name,
                    Classification: classification,
                    Description: desc,
                    ReadRate: io && utils.fmt_rate(io[0]),
                    WriteRate: io && utils.fmt_rate(io[1]),
                    Highlight: dev == cur_highlight
                };
            }

            var d = Object.keys(client.drives).sort(cmp_drive).map(make_drive);
            $('#drives').amend(mustache.render(drives_tmpl,
                                               { Drives: d,
                                                 HasDrives: d.length > 0
                                               }));
            permissions.update();
            jobs.update('#drives');

            for (var p in d) {
                if (d[p] && d[p].dev) {
                    read_series.add_instance(d[p].dev);
                    write_series.add_instance(d[p].dev);
                }
            }
        }

        $(client).on('changed', render_drives);
        $(client.blockdev_io).on('changed', render_drives);

        var others_tmpl = $("#others-tmpl").html();
        mustache.parse(others_tmpl);

        function render_others() {
            function is_other(path) {
                var block = client.blocks[path];
                var block_part = client.blocks_part[path];
                var block_lvm2 = client.blocks_lvm2[path];

                return ((!block_part || block_part.Table == "/") &&
                        block.Drive == "/" &&
                        block.CryptoBackingDevice == "/" &&
                        block.MDRaid == "/" &&
                        (!block_lvm2 || block_lvm2.LogicalVolume == "/") &&
                        !block.HintIgnore &&
                        block.Size > 0);
            }

            function make_other(path) {
                var block = client.blocks[path];
                var name = utils.block_name(block);

                return {
                    path: path,
                    dev: name.replace(/^\/dev\//, ""),
                    Name: name,
                    Description: cockpit.format(_("$0 Block Device"), utils.fmt_size(block.Size))
                };
            }

            var o = Object.keys(client.blocks).filter(is_other).sort(utils.make_block_path_cmp(client)).map(make_other);
            $('#others').amend(mustache.render(others_tmpl,
                                               { Others: o,
                                                 HasOthers: o.length > 0
                                               }));
            permissions.update();
        }

        $(client).on('changed', render_others);

        var mounts_tmpl = $("#mounts-tmpl").html();
        mustache.parse(mounts_tmpl);

        function render_mounts() {
            function is_mount(path) {
                var block = client.blocks[path];
                var fsys = client.blocks_fsys[path];
                return fsys && block.IdUsage == "filesystem" && block.IdType != "mpath_member" && !block.HintIgnore;
            }

            function cmp_mount(path_a, path_b) {
                return client.blocks[path_a].IdLabel.localeCompare(client.blocks[path_b]).IdLabel;
            }

            function make_mount(path) {
                var block = client.blocks[path];
                var fsys = client.blocks_fsys[path];
                var mount_points = fsys.MountPoints.map(utils.decode_filename);
                var fsys_size;
                for (var i = 0; i < mount_points.length && !fsys_size; i++)
                    fsys_size = client.fsys_sizes.data[mount_points[i]];

                return {
                    LinkTarget: utils.get_block_link_target(client, path),
                    Name: block.IdLabel || utils.block_name(block),
                    DeviceSize: utils.fmt_size(block.Size),
                    UsageText: fsys_size? utils.format_fsys_usage(fsys_size[0], fsys_size[1]) : null,
                    UsagePercent: fsys_size? fsys_size[0] / fsys_size[1] * 100 : null,
                    UsageCritical: fsys_size && fsys_size[0] > 0.95 * fsys_size[1],
                    MountPoints: fsys.MountPoints.map(utils.decode_filename),
                    IsMounted: fsys.MountPoints.length > 0
                };
            }

            var m = Object.keys(client.blocks).filter(is_mount).sort(cmp_mount).map(make_mount);
            $('#mounts').amend(mustache.render(mounts_tmpl,
                                               { Mounts: m,
                                                 HasMounts: m.length > 0
                                               }));

            /* Apply these styles */
            $('#mounts [data-width]').each(function() {
                $(this).css("width", $(this).attr("data-width"));
            });

            permissions.update();
            jobs.update('#mounts');
        }

        $(client).on('changed', render_mounts);
        $(client.fsys_sizes).on('changed', render_mounts);

        var nfs_mounts_tmpl = $("#nfs-mounts-tmpl").html();
        mustache.parse(nfs_mounts_tmpl);

        var nfs_users_tmpl = $("#nfs-users-tmpl").html();
        mustache.parse(nfs_users_tmpl);

        function render_nfs_mounts() {

            function make_nfs_mount(entry, index) {
                var fsys_size;
                if (entry.mounted)
                    fsys_size = client.nfs.get_fsys_size(entry);

                return {
                    Server: entry.fields[0].split(":")[0],
                    RemoteDir: entry.fields[0].split(":")[1],
                    UsageText: fsys_size? utils.format_fsys_usage(fsys_size[0], fsys_size[1]) : null,
                    UsagePercent: fsys_size? fsys_size[0] / fsys_size[1] * 100 : null,
                    UsageCritical: fsys_size && fsys_size[0] > 0.95 * fsys_size[1],
                    MountPoint: entry.fields[1],
                    IsMounted: entry.mounted,
                    CanEdit: entry.fstab,
                    action_arg: index
                };
            }

            var m = client.nfs.entries.map(make_nfs_mount);

            var is_armed = $('#nfs-mounts .nfs-arm-button').hasClass('active');
            $('#nfs-mounts').amend(mustache.render(nfs_mounts_tmpl,
                                                   { armed: is_armed,
                                                     Mounts: m,
                                                     HasMounts: m.length > 0
                                                   }));

            /* Apply these styles */
            $('#nfs-mounts [data-width]').each(function() {
                $(this).css("width", $(this).attr("data-width"));
            });
        }

        $('#storage').on('click', '#nfs-mounts .nfs-arm-button', function (event) {
            $(this).toggleClass('active');
            render_nfs_mounts();
        });

        function nfs_disarm() {
            $('#nfs-mounts .nfs-arm-button').removeClass('active');
            render_nfs_mounts();
        }

        function checked(error_title, promise) {
            promise.fail(function (error, output) {
                $('#error-popup-title').text(error_title);
                $('#error-popup-message').text(error.toString());
                $('#error-popup').modal('show');
            });
        }

        $('#storage').on('click', '[data-action="mount-mount"]', function () {
            var arg = $(this).attr('data-arg');
            var entry = client.nfs.entries[arg];
            checked("Could not mount the filesystem",
                    client.nfs.mount_entry(entry));
            nfs_disarm();
            return false;
        });

        function nfs_busy_dialog(dialog_title,
                                 entry, error,
                                 action_title, action) {

            function show(users) {
                if (users.length === 0) {
                    $('#error-popup-title').text(dialog_title);
                    $('#error-popup-message').text(error.toString());
                    $('#error-popup').modal('show');
                } else {
                    dialog.open({ Title: dialog_title,
                                  Teardown: {
                                      HasUnits: true,
                                      Units: users.map(function (u) { return { Unit: u.unit, Name: u.desc }; })
                                  },
                                  Fields: [ ],
                                  Action: users? {
                                      DangerButton: true,
                                      Title: action_title,
                                      action: function () {
                                          return action(users);
                                      }
                                  } : null
                                });
                }
            }

            client.nfs.entry_users(entry)
                .done(function (users) {
                    show(users);
                })
                .fail(function (error) {
                    show([ ]);
                });
        }

        $('#storage').on('click', '[data-action="mount-unmount"]', function () {
            var arg = $(this).attr('data-arg');
            var entry = client.nfs.entries[arg];
            client.nfs.unmount_entry(entry)
                .fail(function (error) {
                    nfs_busy_dialog(_("Unable to unmount filesystem"),
                                    entry, error,
                                    _("Stop and unmount"),
                                    function (users) {
                                        return client.nfs.stop_and_unmount_entry(users, entry);
                                    });
                });
            nfs_disarm();
            return false;
        });

        function nfs_fstab_dialog(entry) {

            var server_to_check;
            var server_check_deferred;

            function remote_choices(vals) {
                if (vals.server == server_to_check)
                    return false;

                server_to_check = vals.server;
                if (server_check_deferred)
                    server_check_deferred.resolve(false);

                var this_deferred = cockpit.defer();
                server_check_deferred = this_deferred;

                cockpit.spawn([ "showmount", "-e", "--no-headers", server_to_check ], { err: "message" })
                        .done(function (output) {
                            if (this_deferred == server_check_deferred) {
                                var dirs = [ ];
                                output.split("\n").forEach(function (line) {
                                    var d = line.split(" ")[0];
                                    if (d)
                                        dirs.push(d);
                                });
                                this_deferred.resolve(dirs);
                                server_check_deferred = null;
                            } else {
                                this_deferred.resolve(false);
                            }
                        }).
                        fail(function (error) {
                            console.warn(error);
                            this_deferred.resolve([ ]);
                        });

                return this_deferred.promise();
            }

            function show(busy) {
                dialog.open({ Title: entry? _("NFS Mount") : _("New NFS Mount"),
                              Alerts: busy? [ { Message: _("This NFS mount is in use and only its options can be changed.") } ] : null,
                              Fields: [
                                  { TextInput: "server",
                                    Title: _("Server Address"),
                                    Value: entry? entry.fields[0].split(":")[0] : "",
                                    validate: function (val) {
                                        if (val === "")
                                            return _("Server cannot be empty.");
                                    },
                                    disabled: busy
                                  },
                                  { ComboBox: "remote",
                                    Title: _("Path on Server"),
                                    Value: entry? entry.fields[0].split(":")[1] : "",
                                    Choices: remote_choices,
                                    validate: function (val) {
                                        if (val === "")
                                            return _("Path on server cannot be empty.");
                                        if (val[0] !== "/")
                                            return _("Path on server must start with \"/\".");
                                    },
                                    disabled: busy
                                  },
                                  { TextInput: "dir",
                                    Title: _("Local Mount Point"),
                                    Value: entry? entry.fields[1] : "",
                                    validate: function (val) {
                                        if (val === "")
                                            return _("Mount point cannot be empty.");
                                        if (val[0] !== "/")
                                            return _("Mount point must start with \"/\".");
                                    },
                                    disabled: busy
                                  },
                                  { TextInput: "opts",
                                    Title: _("Mount Options"),
                                    Value: entry? entry.fields[3] : "defaults",
                                    validate: function (val) {
                                        if (val === "")
                                            return _("Options cannot be empty.");
                                    }
                                  }
                              ],
                              Action: {
                                  Title: entry? _("Apply") : _("Add"),
                                  action: function (vals) {
                                      var fields = [ vals.server + ":" + vals.remote,
                                                     vals.dir,
                                                     entry? entry.fields[2]: "nfs",
                                                     vals.opts ];

                                      if (entry)
                                          return client.nfs.update_entry(entry, fields);
                                      else
                                          return client.nfs.add_entry(fields);
                                  }
                              }
                            });
            }

            if (entry) {
                client.nfs.entry_users(entry)
                    .done(function (users) {
                        show(users.length > 0);
                    })
                    .fail(function () {
                        show(false);
                    });
            } else
                show(false);
        }

        $('#storage').on('click', '[data-action="mount-edit"]', function () {
            var arg = $(this).attr('data-arg');
            var entry = client.nfs.entries[arg];
            if (entry)
                nfs_fstab_dialog(entry);
            nfs_disarm();
            return false;
        });

        $('#storage').on('click', '[data-action="mount-add"]', function () {
            nfs_fstab_dialog(null);
            return false;
        });

        $('#storage').on('click', '[data-action="mount-remove"]', function () {
            var arg = $(this).attr('data-arg');
            var entry = client.nfs.entries[arg];
            client.nfs.remove_entry(entry)
                .fail(function (error) {
                    nfs_busy_dialog(_("Unable to remove mount"),
                                    entry, error,
                                    _("Stop and remove"),
                                    function (users) {
                                        return client.nfs.stop_and_remove_entry(users, entry);
                                    });
                });
            nfs_disarm();
            return false;
        });

        $(client.nfs).on('changed', render_nfs_mounts);

        function render_jobs() {
            $('#jobs').amend(jobs.render());
            permissions.update();
        }

        $(client).on('changed', render_jobs);

        function make_plot_setup(unit) {
            return function plot_setup(flot) {
                var axes = flot.getAxes();
                if (axes.yaxis.datamax < 100000)
                    axes.yaxis.options.max = 100000;
                else
                    axes.yaxis.options.max = null;
                axes.yaxis.options.min = 0;

                $(unit).text(plot.bytes_per_sec_tick_unit(axes.yaxis));
            };
        }

        function highlight_drive(event, dev) {
            cur_highlight = dev;
            render_drives();
        }

        var read_plot_data = {
            direct: "disk.dev.read_bytes",
            internal: "block.device.read",
            units: "bytes",
            derive: "rate",
            threshold: 1000
        };

        var read_plot_options = plot.plot_simple_template();
        $.extend(read_plot_options.yaxis, { ticks: plot.memory_ticks,
                                            tickFormatter: plot.format_bytes_per_sec_tick_no_unit
                                          });
        $.extend(read_plot_options.grid,  { hoverable: true,
                                            autoHighlight: false
                                          });
        read_plot_options.setup_hook = make_plot_setup("#storage-reading-unit");
        var read_plot = plot.plot($("#storage-reading-graph"), 300);
        read_plot.set_options(read_plot_options);
        read_series = read_plot.add_metrics_stacked_instances_series(read_plot_data, { });
        read_plot.start_walking();
        $(read_series).on('hover', highlight_drive);

        var write_plot_data = {
            direct: "disk.dev.write_bytes",
            internal: "block.device.written",
            units: "bytes",
            derive: "rate",
            threshold: 1000
        };

        var write_plot_options = plot.plot_simple_template();
        $.extend(write_plot_options.yaxis, { ticks: plot.memory_ticks,
                                             tickFormatter: plot.format_bytes_per_sec_tick_no_unit
                                           });
        $.extend(write_plot_options.grid,  { hoverable: true,
                                             autoHighlight: false
                                           });
        write_plot_options.setup_hook = make_plot_setup("#storage-writing-unit");
        var write_plot = plot.plot($("#storage-writing-graph"), 300);
        write_plot.set_options(write_plot_options);
        write_series = write_plot.add_metrics_stacked_instances_series(write_plot_data, { });
        write_plot.start_walking();
        $(write_series).on('hover', highlight_drive);

        $(window).on('resize', function () {
            read_plot.resize();
            write_plot.resize();
        });

        var plot_controls = plot.setup_plot_controls($('#storage'), $('#storage-graph-toolbar'));
        plot_controls.reset([ read_plot, write_plot ]);

        render_mdraids();
        render_vgroups();
        render_iscsi_sessions();
        render_drives();
        render_others();
        render_mounts();
        render_nfs_mounts();
        render_jobs();

        $('#storage-log').append(
            journal.logbox([ "_SYSTEMD_UNIT=storaged.service", "+",
                            "_SYSTEMD_UNIT=udisks2.service", "+",
                            "_SYSTEMD_UNIT=dm-event.service", "+",
                            "_SYSTEMD_UNIT=smartd.service", "+",
                            "_SYSTEMD_UNIT=multipathd.service"
                          ],
                          10));

        $('#create-mdraid').on('click', function () {
            dialog.open({ Title: _("Create RAID Device"),
                          Fields: [
                              { TextInput: "name",
                                Title: _("Name"),
                              },
                              { SelectOne: "level",
                                Title: _("RAID Level"),
                                Options: [
                                    { value: "raid0",  Title: _("RAID 0 (Stripe)") },
                                    { value: "raid1",  Title: _("RAID 1 (Mirror)") },
                                    { value: "raid4",  Title: _("RAID 4 (Dedicated Parity)") },
                                    { value: "raid5",  Title: _("RAID 5 (Distributed Parity)"), selected: true },
                                    { value: "raid6",  Title: _("RAID 6 (Double Distributed Parity)") },
                                    { value: "raid10", Title: _("RAID 10 (Stripe of Mirrors)") }
                                ]
                              },
                              { SelectOne: "chunk",
                                Title: _("Chunk Size"),
                                Options: [
                                    { value: "4", Title: _("4 KiB") },
                                    { value: "8", Title: _("8 KiB") },
                                    { value: "16", Title: _("16 KiB") },
                                    { value: "32", Title: _("32 KiB") },
                                    { value: "64", Title: _("64 KiB") },
                                    { value: "128", Title: _("128 KiB") },
                                    { value: "512", Title: _("512 KiB"), selected: true },
                                    { value: "1024", Title: _("1 MiB") },
                                    { value: "2048", Title: _("2 MiB") }
                                ],
                                visible: function (vals) {
                                    return vals.level != "raid1";
                                }
                              },
                              { SelectMany: "disks",
                                Title: _("Disks"),
                                Options: utils.get_available_spaces(client).map(utils.available_space_to_option),
                                EmptyWarning: _("No disks are available."),
                                validate: function (disks, vals) {
                                    var disks_needed = vals.level == "raid6"? 4 : 2;
                                    if (disks.length < disks_needed)
                                        return cockpit.format(_("At least $0 disks are needed."),
                                                              disks_needed);
                                }
                              }
                          ],
                          Action: {
                              Title: _("Create"),
                              action: function (vals) {
                                  return utils.prepare_available_spaces(client, vals.disks).then(function () {
                                      var paths = Array.prototype.slice.call(arguments);
                                      return client.manager.MDRaidCreate(paths, vals.level,
                                                                         vals.name, (vals.chunk || 0) * 1024,
                                                                         { });
                                  });
                              }
                          }
                        });
        });

        $('#create-volume-group').on('click', function () {
            function find_vgroup(name) {
                for (var p in client.vgroups) {
                    if (client.vgroups[p].Name == name)
                        return client.vgroups[p];
                }
                return null;
            }

            var name;
            for (var i = 0; i < 1000; i++) {
                name = "vgroup" + i.toFixed();
                if (!find_vgroup(name))
                    break;
            }

            dialog.open({ Title: _("Create Volume Group"),
                          Fields: [
                              { TextInput: "name",
                                Title: _("Name"),
                                Value: name,
                                validate: utils.validate_lvm2_name
                              },
                              { SelectMany: "disks",
                                Title: _("Disks"),
                                Options: utils.get_available_spaces(client).map(utils.available_space_to_option),
                                EmptyWarning: _("No disks are available."),
                                validate: function (disks) {
                                    if (disks.length === 0)
                                        return _("At least one disk is needed.");
                                }
                              }
                          ],
                          Action: {
                              Title: _("Create"),
                              action: function (vals, dialog) {
                                  return utils.prepare_available_spaces(client, vals.disks).then(function () {
                                      var paths = Array.prototype.slice.call(arguments);
                                      return client.manager_lvm2.VolumeGroupCreate(vals.name, paths, { });
                                  });
                              }
                          }
                        });
        });

        function iscsi_discover() {
            dialog.open({ Title: _("Add iSCSI Portal"),
                          Fields: [
                              { TextInput: "address",
                                Title: _("Server Address"),
                                validate: function (val) {
                                    if (val === "")
                                        return _("Server address cannot be empty.");
                                }
                              },
                              { TextInput: "username",
                                Title: _("Username")

                              },
                              { PassInput: "password",
                                Title: _("Password")
                              }
                          ],
                          Action: {
                              Title: _("Next"),
                              action: function (vals, dialog) {
                                  var dfd = $.Deferred();

                                  var options = { };
                                  if (vals.username || vals.password) {
                                      options.username = { t: 's', v: vals.username };
                                      options.password = { t: 's', v: vals.password };
                                  }

                                  var cancelled = false;
                                  client.manager_iscsi.call('DiscoverSendTargets',
                                                            [ vals.address,
                                                              0,
                                                              options
                                                            ]).
                                      done(function (results) {
                                          if (!cancelled) {
                                              dfd.resolve();
                                              iscsi_add(vals, results[0]);
                                          }
                                      }).
                                      fail(function (error) {
                                          if (!cancelled)
                                              dfd.reject(error);
                                      });

                                  var promise = dfd.promise();
                                  promise.cancel = function () {
                                      cancelled = true;
                                      dfd.reject();
                                  };
                                  return promise;
                              },
                              failure_filter: function (vals, err) {
                                  if (!err)
                                      return err;

                                  // HACK - https://github.com/storaged-project/storaged/issues/26
                                  if (err.message.indexOf("initiator failed authorization") != -1)
                                      return [ { field: "username",
                                                 message: null,
                                               },
                                               { field: "password",
                                                 message: _("Invalid username or password"),
                                               }
                                             ];
                                  else if (err.message.indexOf("cannot resolve host name") != -1)
                                      return { field: "address",
                                               message: _("Unknown host name")
                                             };
                                  else if (err.message.indexOf("connection login retries") != -1)
                                      return { field: "address",
                                               message: _("Unable to reach server")
                                             };
                                  else
                                      return err;
                              }
                          }
                        });
        }

        function iscsi_login(target, cred_vals) {
            var options = {
                'node.startup': { t: 's', v: "automatic" }
            };
            if (cred_vals.username || cred_vals.password) {
                options.username = { t: 's', v: cred_vals.username };
                options.password = { t: 's', v: cred_vals.password };
            }
            return client.manager_iscsi.call('Login',
                                             [ target[0],
                                               target[1],
                                               target[2],
                                               target[3],
                                               target[4],
                                               options
                                             ]);
        }

        function iscsi_add(discover_vals, nodes) {
            var target_rows = nodes.map(function (n) {
                return { Columns: [ n[0], n[2], n[3] ],
                         value: n
                       };
            });
            dialog.open({ Title: cockpit.format(_("Available targets on $0"),
                                                discover_vals.address),
                          Fields: [
                              { SelectRow: "target",
                                Title: _("Targets"),
                                Headers: [ _("Name"), _("Address"),_("Port") ],
                                Rows: target_rows
                              }
                          ],
                          Action: {
                              Title: _("Add"),
                              action: function (vals) {
                                  return iscsi_login(vals.target, discover_vals);
                              },
                              failure_filter: function (vals, err) {
                                  // HACK - https://github.com/storaged-project/storaged/issues/26
                                  if (err.message.indexOf("authorization") != -1)
                                      iscsi_add_with_creds(discover_vals, vals);
                                  else
                                      return err;
                              }
                          }
                        });
        }

        function iscsi_add_with_creds(discover_vals, login_vals) {
            dialog.open({ Title: _("Authentication required"),
                          Fields: [
                              { TextInput: "username",
                                Title: _("Username"),
                                Value: discover_vals.username
                              },
                              { PassInput: "password",
                                Title: _("Password"),
                                Value: discover_vals.password
                              }
                          ],
                          Action: {
                              Title: _("Add"),
                              action: function (vals) {
                                  return iscsi_login(login_vals.target, vals);
                              },
                              failure_filter: function (vals, err) {
                                  // HACK - https://github.com/storaged-project/storaged/issues/26
                                  if (err.message.indexOf("authorization") != -1)
                                      return [ { field: "username",
                                                 message: null,
                                               },
                                               { field: "password",
                                                 message: _("Invalid username or password"),
                                               }
                                             ];
                                  else
                                      return err;
                              }
                          }
                        });
        }

        function iscsi_remove(path) {
            var session = client.iscsi_sessions[path];
            if (!session)
                return;

            var options = {
                'node.startup': { t: 's', v: "manual" }
            };

            session.Logout(options).
                fail(function (error) {
                    $('#error-popup-title').text(_("Error"));
                    $('#error-popup-message').text(error.toString());
                    $('#error-popup').modal('show');
                });
        }

        function iscsi_change_name() {
            client.manager_iscsi.call('GetInitiatorName').
                done(function (results) {
                    var name = results[0];
                    dialog.open({ Title: _("Change iSCSI Initiator Name"),
                                  Fields: [
                                      { TextInput: "name",
                                        Title: _("Name"),
                                        Value: name
                                      }
                                  ],
                                  Action: {
                                      Title: _("Change"),
                                      action: function (vals) {
                                          return client.manager_iscsi.call('SetInitiatorName',
                                                                           [ vals.name,
                                                                             { }
                                                                           ]);
                                      }
                                  }
                                });
                });
        }

        $('#storage').on('click', '[data-action="add-iscsi-portal"]', function () {
            iscsi_discover();
        });

        $('#storage').on('click', '[data-action="edit-iscsi"]', function () {
            iscsi_change_name();
        });

        $('#storage').on('click', '[data-iscsi-session-remove]', function () {
            utils.reset_arming_zone($(this));
            iscsi_remove($(this).attr('data-iscsi-session-remove'));
        });

        function hide() {
            $('#storage').hide();
        }

        function show() {
            $('#storage').show();
            read_plot.resize();
            write_plot.resize();
        }

        return {
            show: show,
            hide: hide
        };
    }

    module.exports = {
        init: init_overview
    };
}());
