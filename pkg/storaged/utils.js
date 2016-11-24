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
    var service = require("service");

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

    var hostnamed = cockpit.dbus("org.freedesktop.hostname1").proxy();

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
        var seconds = Math.round(d/1000);
        var minutes = Math.floor(seconds / 60);
        var hours = Math.floor(minutes / 60);
        seconds = seconds - minutes*60;
        minutes = minutes - hours*60;

        var s = seconds + " seconds";
        if (minutes > 0)
            s = minutes + " minutes, " + s;
        if (hours > 0)
            s = hours + " hours, " + s;
        return s;
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

        if (parts[0] == hostnamed.StaticHostname)
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

    utils.get_block_link_target = function get_block_link_target(client, path) {
        var is_part, is_crypt, is_lvol;

        while (true) {
            if (client.blocks_part[path] && client.blocks_ptable[client.blocks_part[path].Table]) {
                is_part = true;
                path = client.blocks_part[path].Table;
            } else if (client.blocks_crypto[path] && client.blocks[client.blocks_crypto[path].CryptoBackingDevice]) {
                is_crypt = true;
                path = client.blocks_crypto[path].CryptoBackingDevice;
            } else
                break;
        }

        if (client.blocks_lvm2[path] && client.lvols[client.blocks_lvm2[path].LogicalVolume])
            is_lvol = true;

        function fmt_part(link) {
            // Partitions of logical volumes are shown as just logical volumes.
            if (is_lvol && is_crypt)
                return cockpit.format(_("<span>Encrypted Logical Volume of $0</span>"), link);
            else if (is_part && is_crypt)
                return cockpit.format(_("<span>Encrypted Partition of $0</span>"), link);
            else if (is_lvol)
                return cockpit.format(_("<span>Logical Volume of $0</span>"), link);
            else if (is_part)
                return cockpit.format(_("<span>Partition of $0</span>"), link);
            else if (is_crypt)
                return cockpit.format(_("<span>Encrypted $0</span>"), link);
            else
                return link;
        }

        var block = client.blocks[path];
        if (!block)
            return;

        var type, target, name;
        if (client.mdraids[block.MDRaid]) {
            type = "mdraid";
            target = client.mdraids[block.MDRaid].UUID;
            name = cockpit.format(_("RAID Device $0"), utils.mdraid_name(client.mdraids[block.MDRaid]));
        } else if (client.blocks_lvm2[path] &&
                   client.lvols[client.blocks_lvm2[path].LogicalVolume] &&
                   client.vgroups[client.lvols[client.blocks_lvm2[path].LogicalVolume].VolumeGroup]) {
            type = "vgroup";
            target = client.vgroups[client.lvols[client.blocks_lvm2[path].LogicalVolume].VolumeGroup].Name;
            name = cockpit.format(_("Volume Group $0"), target);
        } else {
            type = "block";
            target = utils.block_name(block).replace(/^\/dev\//, "");
            if (client.drives[block.Drive])
                name = utils.drive_name(client.drives[block.Drive]);
            else
                name = utils.block_name(block);
        }

        return {
            type: type,
            target: target,
            html: fmt_part(mustache.render('<a data-goto-{{type}}="{{target}}">{{name}}</a>',
                                           { type: type, target: target, name: name }))
        };
    };

    utils.get_free_blockdevs = function get_free_blockdevs(client) {
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

            return (!block.HintIgnore &&
                    block.Size > 0 &&
                    !has_fs_label() &&
                    !is_mpath_member() &&
                    !block_ptable &&
                    !(block_part && block_part.IsContainer));
        }

        function make(path) {
            var block = client.blocks[path];
            var link = utils.get_block_link_target(client, path);
            var text = $('<div>').html(link.html).text();

            return {
                path: path,
                Name: utils.block_name(block),
                Description: utils.fmt_size(block.Size) + " " + text
            };
        }

        return Object.keys(client.blocks).filter(is_free).sort(utils.make_block_path_cmp(client)).map(make);
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

    utils.init_arming_zones = function init_arming_zones($top) {
        $top.on('click', 'button.arm-button', function () {
            var was_active = $(this).hasClass('active');
            $(this).toggleClass('active', !was_active);
            $(this).parents('.arming-zone').toggleClass('armed', !was_active);
        });
    };

    utils.reset_arming_zone = function reset_arming_zone($btn) {
        var $zone = $btn.parents('.arming-zone');
        var $arm_btn = $zone.find('.arm-button');
        $arm_btn.removeClass('active');
        $zone.removeClass('armed');
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

    utils.get_usage_alerts = function get_usage_alerts(client, path) {
        var block = client.blocks[path];
        var fsys = client.blocks_fsys[path];
        var pvol = client.blocks_pvol[path];

        var usage =
            utils.flatten(get_children(client, path).map(
                function (p) { return utils.get_usage_alerts (client, p); }));

        if (fsys && fsys.MountPoints.length > 0)
            usage.push({ usage: 'mounted',
                         Message: cockpit.format(_("Device $0 is mounted on $1"),
                                                 utils.block_name(block),
                                                 utils.decode_filename(fsys.MountPoints[0]))
                       });
        if (block && client.mdraids[block.MDRaidMember])
            usage.push({ usage: 'mdraid-member',
                         Message: cockpit.format(_("Device $0 is a member of RAID Array $1"),
                                                 utils.block_name(block),
                                                 utils.mdraid_name(client.mdraids[block.MDRaidMember]))
                       });
        if (pvol && client.vgroups[pvol.VolumeGroup])
            usage.push({ usage: 'pvol',
                         Message: cockpit.format(_("Device $0 is a physical volume of $1"),
                                                 utils.block_name(block),
                                                 client.vgroups[pvol.VolumeGroup].Name)
                       });

        return usage;
    };

    /* jQuery.amend function. This will be removed as we move towards React */

    function sync(output, input, depth) {
        var na, nb, a, b, i;
        var attrs, attr, seen;

        if (depth > 0) {
            if (output.nodeType != input.nodeType ||
                output.nodeName != input.nodeName ||
                (output.nodeType != 1 && output.nodeType != 3)) {
                output.parentNode.replaceChild(input.parentNode.removeChild(input), output);
                return;

            } else if (output.nodeType == 3) {
                if (output.nodeValue != input.nodeValue)
                    output.nodeValue = input.nodeValue;
                return;
            }
        }

        if (output.nodeType == 1) {

            /* Sync attributes */
            if (depth > 0) {
                seen = { };
                attrs = output.attributes;
                for (i = attrs.length - 1; i >= 0; i--)
                    seen[attrs[i].name] = attrs[i].value;
                for (i = input.attributes.length - 1; i >= 0; i--) {
                    attr = input.attributes[i];
                    if (seen[attr.name] !== attr.value)
                        output.setAttribute(attr.name, attr.value);
                    delete seen[attr.name];
                }
                for (i in seen)
                    output.removeAttribute(i);
            }

            /* Sync children */
            na = output.firstChild;
            nb = input.firstChild;
            for(;;) {
                a = na;
                b = nb;
                while (a && a.nodeType != 1 && a.nodeType != 3)
                    a = a.nextSibling;
                while (b && b.nodeType != 1 && b.nodeType != 3)
                    b = b.nextSibling;
                if (!a && !b) {
                    break;
                } else if (!a) {
                    na = null;
                    nb = b.nextSibling;
                    output.appendChild(input.removeChild(b));
                } else if (!b) {
                    na = a.nextSibling;
                    nb = null;
                    output.removeChild(a);
                } else {
                    na = a.nextSibling;
                    nb = b.nextSibling;
                    sync(a, b, (depth || 0) + 1);
                }
            }
        }
    }

    $.fn.amend = function amend(data, options) {
        this.each(function() {
            var el = $("<div>").html(data);
            sync(this, el[0], 0);
        });
        return this;
    };

    /* Prevent flicker due to the marriage of jQuery and React here */
    utils.hide = function hide(selector) {
        var element = document.querySelector("#storage-detail");
        element.setAttribute("hidden", "");
    };

    utils.show_soon = function show_soon(selector, ready) {
        var element = document.querySelector(selector);
        if (!element.hasAttribute("hidden"))
            return;
        var val = element.getAttribute("hidden");
        if (ready) {
            element.removeAttribute("hidden");
            window.clearTimeout(parseInt(val, 10));
        } else if (!val) {
            val = window.setTimeout(function() {
                show_soon(selector, true);
            }, 2000);
            element.setAttribute("hidden", String(val));
        }
    };

    module.exports = utils;
}());
