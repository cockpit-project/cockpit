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

    var cockpit = require("cockpit");

    var mustache = require("mustache");
    var service = require("service");
    var moment = require("moment");

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    /* UTILITIES
     */

    var utils = { };

    utils.compare_versions = function compare_versions(a, b) {
        function to_ints(str) {
            return str.split(".").map(function (s) { return s ? parseInt(s, 10) : 0; });
        }

        var a_ints = to_ints(a);
        var b_ints = to_ints(b);
        var len = Math.min(a_ints.length, b_ints.length);
        var i;

        for (i = 0; i < len; i++) {
            if (a_ints[i] == b_ints[i])
                continue;
            return a_ints[i] - b_ints[i];
        }

        return a_ints.length - b_ints.length;
    };

    utils.hostnamed = cockpit.dbus("org.freedesktop.hostname1").proxy();

    utils.array_find = function array_find(array, pred) {
        for (var i = 0; i < array.length; i++)
            if (pred(array[i]))
                return array[i];
        return undefined;
    };

    utils.flatten = function flatten(array_of_arrays) {
        if (array_of_arrays.length > 0)
            return Array.prototype.concat.apply([], array_of_arrays);
        else
            return [ ];
    };

    utils.decode_filename = function decode_filename(encoded) {
        return cockpit.utf8_decoder().decode(cockpit.base64_decode(encoded).slice(0,-1));
    };

    utils.encode_filename = function encode_filename(decoded) {
        return cockpit.base64_encode(cockpit.utf8_encoder().encode(decoded).concat([0]));
    };

    utils.fmt_size = function fmt_size(bytes) {
        return cockpit.format_bytes(bytes, 1024);
    };

    utils.fmt_size_long = function fmt_size_long(bytes) {
        var with_binary_unit = cockpit.format_bytes(bytes, 1024);
        var with_decimal_unit = cockpit.format_bytes(bytes, 1000);
        /* Translators: Used in "..." */
        return with_binary_unit + ", " + with_decimal_unit + ", " + bytes + " " + C_("format-bytes", "bytes");
    };

    utils.fmt_rate = function fmt_rate(bytes_per_sec) {
        return cockpit.format_bytes_per_sec(bytes_per_sec, 1024);
    };

    utils.format_temperature = function format_temperature(kelvin) {
        var celcius = kelvin - 273.15;
        var fahrenheit = 9.0 * celcius / 5.0 + 32.0;
        return celcius.toFixed(1) + "° C / " + fahrenheit.toFixed(1) + "° F";
    };

    utils.format_fsys_usage = function format_fsys_usage(used, total) {
        var text = "";
        var units = 1024;
        var parts = cockpit.format_bytes(total, units, true);
        text = " / " + parts.join(" ");
        units = parts[1];

        parts = cockpit.format_bytes(used, units, true);
        return parts[0] + text;
    };

    utils.format_delay = function format_delay(d) {
        return moment.duration(d).humanize();
    };

    utils.format_size_and_text = function format_size_and_text(size, text) {
        return cockpit.format(_("${size} ${desc}"), { size: utils.fmt_size(size), desc: text});
    };

    utils.validate_lvm2_name = function validate_lvm2_name(name) {
        if (name === "")
            return _("Name cannot be empty.");
        if (name.length > 127)
            return _("Name cannot be longer than 127 characters.");
        var m = name.match(/[^a-zA-Z0-9+._-]/);
        if (m) {
            if (m[0].search(/\s+/) === -1)
                return cockpit.format(_("Name cannot contain the character '$0'."), m[0]);
            else
                    return cockpit.format(_("Name cannot contain whitespace."), m[0]);
        }
    };

    utils.block_name = function block_name(block) {
        return utils.decode_filename(block.PreferredDevice);
    };

    utils.mdraid_name = function mdraid_name(mdraid) {
        if (!mdraid.Name)
            return "";

        var parts = mdraid.Name.split(":");

        if (parts.length != 2)
            return mdraid.Name;

        /* if we call hostnamed too early, before the dbus.proxy() promise is fulfilled,
         * it will not be valid yet; it's too inconvenient to make this
         * function asynchronous, so just don't show the host name in this case */
        if (utils.hostnamed.StaticHostname === undefined || parts[0] == utils.hostnamed.StaticHostname)
            return parts[1];
        else
            return cockpit.format(_("$name (from $host)"),
                                  { name: parts[1],
                                    host: parts[0]
                                  });
    };

    utils.lvol_name = function lvol_name(lvol) {
        var type;
        if (lvol.Type == "pool")
            type = _("Pool for Thin Logical Volumes");
        else if (lvol.ThinPool != "/")
            type =_("Thin Logical Volume");
        else if (lvol.Origin != "/")
            type = _("Logical Volume (Snapshot)");
        else
            type = _("Logical Volume");
        return mustache.render('{{Type}} "{{Name}}"', { Type: type, Name: lvol.Name });
    };

    utils.drive_name = function drive_name(drive) {
        var name_parts = [ ];
        if (drive.Vendor)
            name_parts.push(drive.Vendor);
        if (drive.Model)
            name_parts.push(drive.Model);

        var name = name_parts.join(" ");
        if (drive.Serial)
            name += " (" + drive.Serial + ")";
        else if (drive.WWN)
            name += " (" + drive.WWN + ")";

        return name;
    };

    utils.get_block_link_parts = function get_block_link_parts(client, path) {
        var is_part, is_crypt, is_lvol;

        while (true) {
            if (client.blocks_part[path] && client.blocks_ptable[client.blocks_part[path].Table]) {
                is_part = true;
                path = client.blocks_part[path].Table;
            } else if (client.blocks[path] && client.blocks[client.blocks[path].CryptoBackingDevice]) {
                is_crypt = true;
                path = client.blocks[path].CryptoBackingDevice;
            } else
                break;
        }

        if (client.blocks_lvm2[path] && client.lvols[client.blocks_lvm2[path].LogicalVolume])
            is_lvol = true;

        var block = client.blocks[path];
        if (!block)
            return;

        var location, link;
        if (client.mdraids[block.MDRaid]) {
            location = [ "mdraid", client.mdraids[block.MDRaid].UUID ];
            link = cockpit.format(_("RAID Device $0"), utils.mdraid_name(client.mdraids[block.MDRaid]));
        } else if (client.blocks_lvm2[path] &&
                   client.lvols[client.blocks_lvm2[path].LogicalVolume] &&
                   client.vgroups[client.lvols[client.blocks_lvm2[path].LogicalVolume].VolumeGroup]) {
            var target = client.vgroups[client.lvols[client.blocks_lvm2[path].LogicalVolume].VolumeGroup].Name;
            location = [ "vg", target ];
            link = cockpit.format(_("Volume Group $0"), target);
        } else {
            var vdo = client.vdo_overlay.find_by_block(block);
            if (vdo) {
                location = [ "vdo", vdo.name ];
                link = cockpit.format(_("VDO Device $0"), vdo.name);
            } else {
                location = [ utils.block_name(block).replace(/^\/dev\//, "") ];
                if (client.drives[block.Drive])
                    link = utils.drive_name(client.drives[block.Drive]);
                else
                    link = utils.block_name(block);
            }
        }

        // Partitions of logical volumes are shown as just logical volumes.
        var format;
        if (is_lvol && is_crypt)
            format = _("Encrypted Logical Volume of $0");
        else if (is_part && is_crypt)
            format = _("Encrypted Partition of $0");
        else if (is_lvol)
            format = _("Logical Volume of $0");
        else if (is_part)
            format = _("Partition of $0");
        else if (is_crypt)
            format = _("Encrypted $0");
        else
            format = "$0";

        return {
            location: location,
            format: format,
            link: link
        };
    };

    utils.go_to_block = function (client, path) {
        var parts = utils.get_block_link_parts(client, path);
        cockpit.location.go(parts.location);
    };

    utils.get_partitions = function get_partitions(client, block) {
        var partitions = client.blocks_partitions[block.path];

        function process_level(level, container_start, container_size) {
            var n;
            var last_end = container_start;
            var total_end = container_start + container_size;
            var block, start, size, is_container, is_contained;

            var result = [ ];

            function append_free_space(start, size) {
                // There is a lot of rounding and aligning going on in
                // the storage stack.  All of udisks2, libblockdev,
                // and libparted seem to contribute their own ideas of
                // where a partition really should start.
                //
                // The start of partitions are aggressively rounded
                // up, sometimes twice, but the end is not aligned in
                // the same way.  This means that a few megabytes of
                // free space will show up between partitions.
                //
                // We hide these small free spaces because they are
                // unexpected and can't be used for anything anyway.
                //
                // "Small" is anything less than 3 MiB, which seems to
                // work okay.  (The worst case is probably creating
                // the first logical partition inside a extended
                // partition with udisks+libblockdev.  It leads to a 2
                // MiB gap.)

                if (size >= 3*1024*1024) {
                    result.push({ type: 'free', start: start, size: size });
                }
            }

            for (n = 0; n < partitions.length; n++) {
                block = client.blocks[partitions[n].path];
                start = partitions[n].Offset;
                size = partitions[n].Size;
                is_container = partitions[n].IsContainer;
                is_contained = partitions[n].IsContained;

                if (block === null)
                    continue;

                if (level === 0 && is_contained)
                    continue;

                if (level == 1 && !is_contained)
                    continue;

                if (start < container_start || start+size > container_start+container_size)
                    continue;

                append_free_space(last_end, start - last_end);
                if (is_container) {
                    result.push({ type: 'container', block: block, size: size,
                                  partitions: process_level(level+1, start, size) });
                } else {
                    result.push({ type: 'block', block: block });
                }
                last_end = start + size;
            }

            append_free_space(last_end, total_end - last_end);

            return result;
        }

        return process_level(0, 0, block.Size);
    };

    utils.get_available_spaces = function get_available_spaces(client) {
        function is_free(path) {
            var block = client.blocks[path];
            var block_ptable = client.blocks_ptable[path];
            var block_part = client.blocks_part[path];
            var block_pvol = client.blocks_pvol[path];

            function has_fs_label() {
                if (!block.IdUsage)
                    return false;
                // Devices with a LVM2_member label need to actually be
                // associated with a volume group.
                if (block.IdType == 'LVM2_member' && (!block_pvol || !client.vgroups[block_pvol.VolumeGroup]))
                    return false;
                return true;
            }

            function is_mpath_member() {
                if (!client.drives[block.Drive])
                    return false;
                if (!client.drives_block[block.Drive]) {
                    // Broken multipath drive
                    return true;
                }
                var members = client.drives_multipath_blocks[block.Drive];
                for (var i = 0; i < members.length; i++) {
                    if (members[i] == block)
                        return true;
                }
                return false;
            }

            function is_vdo_backing_dev() {
                return !!client.vdo_overlay.find_by_backing_block(block);
            }

            return (!block.HintIgnore &&
                    block.Size > 0 &&
                    !has_fs_label() &&
                    !is_mpath_member() &&
                    !is_vdo_backing_dev() &&
                    !block_ptable &&
                    !(block_part && block_part.IsContainer));
        }

        function make(path) {
            var block = client.blocks[path];
            var parts = utils.get_block_link_parts(client, path);
            var text = cockpit.format(parts.format, parts.link);
            return { type: 'block', block: block, size: block.Size, desc: text };
        }

        var spaces = Object.keys(client.blocks).filter(is_free).sort(utils.make_block_path_cmp(client)).map(make);

        function add_free_spaces(block) {
            var parts = utils.get_partitions(client, block);
            var i, p, link_parts, text;
            for (i in parts) {
                p = parts[i];
                if (p.type == 'free') {
                    link_parts = utils.get_block_link_parts(client, block.path);
                    text = cockpit.format(link_parts.format, link_parts.link);
                    spaces.push({ type: 'free', block: block, start: p.start, size: p.size,
                                  desc: cockpit.format(_("unpartitioned space on $0"), text) });
                }
            }
        }

        for (var p in client.blocks_ptable)
            add_free_spaces(client.blocks[p]);

        return spaces;
    };

    utils.available_space_to_option = function available_space_to_option(spc) {
        return {
            value: spc,
            Title: utils.format_size_and_text(spc.size, spc.desc),
            Label: utils.block_name(spc.block)
        };
    };

    utils.prepare_available_spaces = function prepare_available_spaces(client, spcs) {
        function prepare(spc) {
            if (spc.type == 'block')
                return cockpit.resolve(spc.block.path);
            else if (spc.type == 'free') {
                var block_ptable = client.blocks_ptable[spc.block.path];
                return block_ptable.CreatePartition(spc.start, spc.size, "", "", { });
            }
        }
        return cockpit.all(spcs.map(prepare));
    };

    /* Comparison function for sorting lists of block devices.

       We sort by major:minor numbers to get the expected order when
       there are more than 10 devices of a kind.  For example, if you
       have 20 loopback devices named loop0 to loop19, sorting them
       alphabetically would put them in the wrong order

           loop0, loop1, loop10, loop11, ..., loop2, ...

       Sorting by major:minor is an easy way to do the right thing.
    */

    utils.block_cmp = function block_cmp(a, b) {
        return a.DeviceNumber - b.DeviceNumber;
    };

    utils.make_block_path_cmp = function(client) {
        return function(path_a, path_b) {
            return utils.block_cmp(client.blocks[path_a], client.blocks[path_b]);
        };
    };

    var multipathd_service;

    utils.get_multipathd_service = function() {
        if (!multipathd_service)
            multipathd_service = service.proxy("multipathd");
        return multipathd_service;
    };

    utils.get_parent = function(client, path) {
        if (client.blocks_part[path] && client.blocks[client.blocks_part[path].Table])
            return client.blocks_part[path].Table;
        if (client.blocks[path] && client.blocks[client.blocks[path].CryptoBackingDevice])
            return client.blocks[path].CryptoBackingDevice;
        if (client.blocks[path] && client.drives[client.blocks[path].Drive])
            return client.blocks[path].Drive;
        if (client.blocks[path] && client.mdraids[client.blocks[path].MDRaid])
            return client.blocks[path].MDRaid;
        if (client.blocks_lvm2[path] && client.lvols[client.blocks_lvm2[path].LogicalVolume])
            return client.blocks_lvm2[path].LogicalVolume;
        if (client.lvols[path] && client.vgroups[client.lvols[path].VolumeGroup])
            return client.lvols[path].VolumeGroup;
    };

    function get_children(client, path) {
        var children = [ ];

        if (client.blocks_cleartext[path]) {
            children.push(client.blocks_cleartext[path].path);
        }

        if (client.blocks_ptable[path]) {
            client.blocks_partitions[path].forEach(function (part) {
                if (!part.IsContainer)
                    children.push(part.path);
            });
        }

        if (client.blocks_part[path] && client.blocks_part[path].IsContainer) {
            var ptable_path = client.blocks_part[path].Table;
            client.blocks_partitions[ptable_path].forEach(function (part) {
                if (part.IsContained)
                    children.push(part.path);
            });
        }

        if (client.vgroups[path]) {
            client.vgroups_lvols[path].forEach(function (lvol) {
                if (client.lvols_block[lvol.path])
                    children.push(client.lvols_block[lvol.path].path);
            });
        }

        return children;
    }

    utils.get_active_usage = function get_active_usage(client, path) {

        function get_usage(path) {
            var block = client.blocks[path];
            var fsys = client.blocks_fsys[path];
            var mdraid = block && client.mdraids[block.MDRaidMember];
            var pvol = client.blocks_pvol[path];
            var vgroup = pvol && client.vgroups[pvol.VolumeGroup];
            var vdo = block && client.vdo_overlay.find_by_backing_block(block);

            var usage = utils.flatten(get_children(client, path).map(get_usage));

            if (fsys && fsys.MountPoints.length > 0)
                usage.push({ usage: 'mounted',
                             block: block,
                             fsys: fsys
                           });

            if (mdraid)
                usage.push({ usage: 'mdraid-member',
                             block: block,
                             mdraid: mdraid
                           });

            if (vgroup)
                usage.push({ usage: 'pvol',
                             block: block,
                             pvol: pvol,
                             vgroup: vgroup
                           });

            if (vdo)
                usage.push({ usage: 'vdo-backing',
                             block: block,
                             vdo: vdo
                           });

            return usage;
        }

        // Prepare the result for Mustache

        var usage = get_usage(path);

        var res = {
            raw: usage,
            Teardown: {
                Mounts: [ ],
                MDRaidMembers: [ ],
                PhysicalVolumes: [ ]
            },
            Blocking: {
                Mounts: [ ],
                MDRaidMembers: [ ],
                PhysicalVolumes: [ ],
                VDOs: [ ]
            }
        };

        usage.forEach(function (use) {
            var entry, active_state;

            if (use.usage == 'mounted') {
                res.Teardown.Mounts.push({
                    Name: utils.block_name(use.block),
                    MountPoint: utils.decode_filename(use.fsys.MountPoints[0])
                });
            } else if (use.usage == 'mdraid-member') {
                entry = {
                    Name: utils.block_name(use.block),
                    MDRaid: utils.mdraid_name(use.mdraid)
                };
                active_state = utils.array_find(use.mdraid.ActiveDevices, function (as) {
                    return as[0] == use.block.path;
                });
                if (active_state && active_state[1] < 0)
                    res.Teardown.MDRaidMembers.push(entry);
                else
                    res.Blocking.MDRaidMembers.push(entry);
            } else if (use.usage == 'pvol') {
                entry = {
                    Name: utils.block_name(use.block),
                    VGroup: use.vgroup.Name
                };
                if (use.pvol.FreeSize == use.pvol.Size) {
                    res.Teardown.PhysicalVolumes.push(entry);
                } else {
                    res.Blocking.PhysicalVolumes.push(entry);
                }
            } else if (use.usage == 'vdo-backing') {
                entry = {
                    Name: utils.block_name(use.block),
                    VDO: use.vdo.name
                };
                res.Blocking.VDOs.push(entry);
            }
        });

        res.Teardown.HasMounts = res.Teardown.Mounts.length > 0;
        res.Teardown.HasMDRaidMembers = res.Teardown.MDRaidMembers.length > 0;
        res.Teardown.HasPhysicalVolumes = res.Teardown.PhysicalVolumes.length > 0;

        if (!res.Teardown.HasMounts && !res.Teardown.HasMDRaidMembers && !res.Teardown.HasPhysicalVolumes)
            res.Teardown = null;

        res.Blocking.HasMounts = res.Blocking.Mounts.length > 0;
        res.Blocking.HasMDRaidMembers = res.Blocking.MDRaidMembers.length > 0;
        res.Blocking.HasPhysicalVolumes = res.Blocking.PhysicalVolumes.length > 0;
        res.Blocking.HasVDOs = res.Blocking.VDOs.length > 0;

        if (!res.Blocking.HasMounts && !res.Blocking.HasMDRaidMembers && !res.Blocking.HasPhysicalVolumes &&
            !res.Blocking.HasVDOs)
            res.Blocking = null;

        return res;
    };

    utils.teardown_active_usage = function teardown_active_usage(client, usage) {

        // The code below is complicated by the fact that the last
        // physical volume of a volume group can not be removed
        // directly (even if it is completely empty).  We want to
        // remove the whole volume group instead in this case.
        //
        // However, we might be removing the last two (or more)
        // physical volumes here, and it is easiest to catch this
        // condition upfront by reshuffling the data structures.

        function unmount(mounteds) {
            return cockpit.all(mounteds.map(function (m) {
                if (m.fsys.MountPoints.length > 0)
                    return m.fsys.Unmount({});
                else
                    return cockpit.resolve();
            }));
        }

        function mdraid_remove(members) {
            return cockpit.all(members.map(function (m) {
                return m.mdraid.RemoveDevice(m.block.path, { wipe: { t: 'b', v: true } });
            }));
        }

        function pvol_remove(pvols) {
            var by_vgroup = { }, p;
            pvols.forEach(function (p) {
                if (!by_vgroup[p.vgroup.path])
                    by_vgroup[p.vgroup.path] = [ ];
                by_vgroup[p.vgroup.path].push(p.block);
            });

            function handle_vg(p) {
                var vg = client.vgroups[p];
                var pvs = by_vgroup[p];
                // If we would remove all physical volumes of a volume
                // group, remove the whole volume group instead.
                if (pvs.length == client.vgroups_pvols[p].length) {
                    return vg.Delete({ 'tear-down': { t: 'b', v: true }
                                     });
                } else {
                    return cockpit.all(pvs.map(function (pv) {
                        return vg.RemoveDevice(pv.path, true, {});
                    }));
                }
            }

            for (p in by_vgroup)
                handle_vg(p);
        }

        return cockpit.all([ unmount(usage.raw.filter(function(use) { return use.usage == "mounted"; })),
                             mdraid_remove(usage.raw.filter(function(use) { return use.usage == "mdraid-member"; })),
                             pvol_remove(usage.raw.filter(function(use) { return use.usage == "pvol"; }))
                           ]);
    };

    module.exports = utils;
}());
