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
    "base1/mustache",
    "system/server",
    "shell/shell",
    "storage/utils",
    "storage/dialog",
    "storage/permissions",
    "shell/plot"
], function($, cockpit, mustache, server, shell, utils, dialog, permissions) {
    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    /* OVERVIEW PAGE
     */

    function init_overview(client, jobs) {

        function update_features() {
            $('#vgroups').toggle(client.features.lvm2);
        }

        $(client.features).on("changed", update_features);
        update_features();

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
                    ReadRate: io && cockpit.format_bytes_per_sec(io[0]),
                    WriteRate: io && cockpit.format_bytes_per_sec(io[1]),
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
                        !block.HintIgnore);
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
            permissions.update();
            jobs.update('#mounts');
        }

        $(client).on('changed', render_mounts);
        $(client.fsys_sizes).on('changed', render_mounts);

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

                $(unit).text(shell.bytes_per_sec_tick_unit(axes.yaxis));
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

        var read_plot_options = shell.plot_simple_template();
        $.extend(read_plot_options.yaxis, { ticks: shell.memory_ticks,
                                            tickFormatter: shell.format_bytes_per_sec_tick_no_unit
                                          });
        $.extend(read_plot_options.grid,  { hoverable: true,
                                            autoHighlight: false
                                          });
        read_plot_options.setup_hook = make_plot_setup("#storage-reading-unit");
        var read_plot = shell.plot($("#storage-reading-graph"), 300);
        read_plot.set_options(read_plot_options);
        var read_series = read_plot.add_metrics_stacked_instances_series(read_plot_data, { });
        read_plot.start_walking();
        $(read_series).on('hover', highlight_drive);

        var write_plot_data = {
            direct: "disk.dev.write_bytes",
            internal: "block.device.written",
            units: "bytes",
            derive: "rate",
            threshold: 1000
        };

        var write_plot_options = shell.plot_simple_template();
        $.extend(write_plot_options.yaxis, { ticks: shell.memory_ticks,
                                             tickFormatter: shell.format_bytes_per_sec_tick_no_unit
                                           });
        $.extend(write_plot_options.grid,  { hoverable: true,
                                             autoHighlight: false
                                           });
        write_plot_options.setup_hook = make_plot_setup("#storage-writing-unit");
        var write_plot = shell.plot($("#storage-writing-graph"), 300);
        write_plot.set_options(write_plot_options);
        var write_series = write_plot.add_metrics_stacked_instances_series(write_plot_data, { });
        write_plot.start_walking();
        $(write_series).on('hover', highlight_drive);

        $(window).on('resize', function () {
            read_plot.resize();
            write_plot.resize();
        });

        var plot_controls = shell.setup_plot_controls($('#storage'), $('#storage-graph-toolbar'));
        plot_controls.reset([ read_plot, write_plot ]);

        render_mdraids();
        render_vgroups();
        render_drives();
        render_others();
        render_mounts();
        render_jobs();

        $('#storage-log').append(
            server.logbox([ "_SYSTEMD_UNIT=storaged.service", "+",
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
                                    { value: "raid10", Title: _("AID 10 (Stripe of Mirrors)") }
                                ]
                              },
                              { SelectOne: "chunk",
                                Title: _("Chunk Size"),
                                Options: [
                                    { value: "4", Title: _("4 KB") },
                                    { value: "8", Title: _("8 KB") },
                                    { value: "16", Title: _("16 KB") },
                                    { value: "32", Title: _("32 KB") },
                                    { value: "64", Title: _("64 KB") },
                                    { value: "128", Title: _("128 KB") },
                                    { value: "512", Title: _("512 KB"), selected: true },
                                    { value: "1024", Title: _("1 MB") },
                                    { value: "2048", Title: _("2 MB") }
                                ]
                              },
                              { SelectMany: "disks",
                                Title: _("Disks"),
                                Options: utils.get_free_blockdevs(client).map(function (b) {
                                    return { value: b.path, Title: b.Name + " " + b.Description };
                                }),
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
                                  return client.manager.MDRaidCreate(vals.disks, vals.level,
                                                                     vals.name, vals.chunk * 1024,
                                                                     { });
                              }
                          }
                        });
        });

        $('#create-volume-group').on('click', function () {
            dialog.open({ Title: _("Create Volume Group"),
                          Fields: [
                              { TextInput: "name",
                                Title: _("Name"),
                                validate: utils.validate_lvm2_name
                              },
                              { SelectMany: "disks",
                                Title: _("Disks"),
                                Options: utils.get_free_blockdevs(client).map(function (b) {
                                    return { value: b.path, Title: b.Name + " " + b.Description };
                                }),
                                validate: function (disks) {
                                    if (disks.length === 0)
                                        return _("At least one disk is needed.");
                                }
                              }
                          ],
                          Action: {
                              Title: _("Create"),
                              action: function (vals, dialog) {
                                  return client.manager_lvm2.VolumeGroupCreate(vals.name, vals.disks, { });
                              }
                          }
                        });
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

    return {
        init: init_overview
    };
});
