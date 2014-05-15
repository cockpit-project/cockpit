/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

function cockpit_fmt_size(bytes)
{
    return cockpit_format_bytes_pow2(bytes);
}

function cockpit_fmt_size_long(bytes)
{
    return cockpit_format_bytes_long(bytes);
}

function cockpit_get_block_devices_for_drive (drive)
{
    var drive_obj = drive.getObject();
    var ret = [];

    var objs = drive._client.getObjectsFrom("/com/redhat/Cockpit/Storage/block_devices/");
    for (var n = 0; n < objs.length; n++) {
        var obj = objs[n];
        var block = obj.lookup("com.redhat.Cockpit.Storage.Block");
        if (block.PartitionNumber === 0 && block.Drive == drive_obj.objectPath) {
            ret.push(block);
        }
    }
    // TODO: Sort and ensure multipathpath objects come first...
    return ret;
}

function cockpit_get_block_devices_for_mdraid(mdraid)
{
    var mdraid_obj = mdraid.getObject();
    var ret = [];

    var objs = mdraid._client.getObjectsFrom("/com/redhat/Cockpit/Storage/block_devices/");
    for (var n = 0; n < objs.length; n++) {
        var obj = objs[n];
        var block = obj.lookup("com.redhat.Cockpit.Storage.Block");
        if (block.PartitionNumber === 0 && block.MDRaid == mdraid_obj.objectPath) {
            ret.push(block);
        }
    }
    // TODO: Sort and ensure multipathpath objects come first...
    return ret;
}

function cockpit_find_block_device_for_drive(drive)
{
    var blocks = cockpit_get_block_devices_for_drive(drive);
    return (blocks.length > 0)? blocks[0] : undefined;
}

function cockpit_find_block_device_for_mdraid(mdraid)
{
    var blocks = cockpit_get_block_devices_for_mdraid(mdraid);
    return (blocks.length > 0)? blocks[0] : undefined;
}

function cockpit_mark_as_block_target (elt, block)
{
    cockpit_mark_as_target (elt, block.getObject().objectPath);
    for (var i = 0; i < block.Partitions.length; i++) {
        var b = block._client.lookup (block.Partitions[i][0],
                                      "com.redhat.Cockpit.Storage.Block");
        if (b)
            cockpit_mark_as_block_target (elt, b);
    }
    if (block.IdUsage == 'crypto') {
        var cleartext_device = cockpit_find_cleartext_device (block);
        if (cleartext_device)
            cockpit_mark_as_block_target (elt, cleartext_device);
    }
}

function cockpit_storage_job_box (client, elt)
{
    return cockpit_job_box (client,
                            elt, 'storage', 'cockpit-storage-admin',
                            { 'format-mkfs' : _("Creating filesystem on %{target}"),
                              'format-erase' : _("Erasing %{target}"),
                              'lvm-vg-empty-device': _("Emptying %{target}")
                            },
                            function (target) {
                                var block = client.lookup (target,
                                                           "com.redhat.Cockpit.Storage.Block");
                                return block? block.Device : null;
                            });
}

function cockpit_storage_log_box (client, elt)
{
    return cockpit_simple_logbox (client,
                                  elt, [ [ "_SYSTEMD_UNIT=udisks2.service" ],
                                         [ "_SYSTEMD_UNIT=dm-event.service" ],
                                         [ "COCKPIT_DOMAIN=storage" ]
                                       ], 5);
}

PageStorage.prototype = {
    _init: function() {
        this.id = "storage";
    },

    getTitle: function() {
        return C_("page-title", "Storage");
    },

    setup: function() {
        var self = this;

        $("#storage_create_raid").on('click', function() {
            if (!cockpit_check_role ('cockpit-storage-admin', self.client))
                return;
            PageCreateRaid.client = self.client;
            $('#create-raid-dialog').modal('show');
        });
        $("#storage_create_volume_group").on('click', function() {
            if (!cockpit_check_role ('cockpit-storage-admin', self.client))
                return;
            PageCreateVolumeGroup.client = self.client;
            $('#create-volume-group-dialog').modal('show');
        });
    },

    enter: function() {
        var self = this;

        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address, { protocol: 'dbus-json1' });
        cockpit_watch_jobs(this.client);

        this._drives = $("#storage_drives");
        this._raids = $("#storage_raids");
        this._vgs = $("#storage_vgs");
        this._other_devices = $("#storage_other_devices");

        this._coldplug();

        $(this.client).on("objectAdded.storage", $.proxy(this._onObjectAdded, this));
        $(this.client).on("objectRemoved.storage", $.proxy(this._onObjectRemoved, this));
        $(this.client).on("propertiesChanged.storage", $.proxy(this._onPropertiesChanged, this));

        this.job_box = cockpit_storage_job_box (this.client, $('#storage-jobs'));
        this.log_box = cockpit_storage_log_box (this.client, $('#storage-log'));
    },

    show: function() {
    },

    leave: function() {
        $(this.client).off(".storage");
        this.job_box.stop();
        this.log_box.stop();
        cockpit_unwatch_jobs(this.client);
        this.client.release();
        this.client = null;
    },

    _onObjectAdded: function (event, obj) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Storage/") !== 0)
            return;
        //cockpit_debug("object added " + obj.objectPath);
        this._add(obj);
    },

    _onObjectRemoved: function (event, obj) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Storage/") !== 0)
            return;
        //cockpit_debug("object removed " + obj.objectPath);
        this._remove(obj);
    },

    _onPropertiesChanged: function (event, obj, iface) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Storage/") !== 0)
            return;
        //cockpit_debug("object changed " + obj.objectPath);
        this._remove(obj);
        this._add(obj);
    },

    _coldplug: function() {
        this._drives.empty();
        this._drives.closest('.panel').hide();
        this._raids.empty();
        this._raids.closest('.panel').hide();
        this._vgs.empty();
        this._vgs.closest('.panel').hide();
        this._other_devices.empty();
        this._other_devices.closest('.panel').hide();

        var objs = this.client.getObjectsFrom("/com/redhat/Cockpit/Storage/");
        for (var n = 0; n < objs.length; n++) {
            this._add(objs[n]);
        }
    },

    _add: function(obj) {
        if (obj.lookup("com.redhat.Cockpit.Storage.Drive"))
            this._addDrive(obj);
        else if (obj.lookup("com.redhat.Cockpit.Storage.MDRaid"))
            this._addRaid(obj);
        else if (obj.lookup("com.redhat.Cockpit.Storage.VolumeGroup"))
            this._addVG(obj);
        else if (obj.lookup("com.redhat.Cockpit.Storage.Block"))
            this._addOtherDevice(obj);
    },

    _remove: function(obj) {
        var id = cockpit_esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var elem;
        if (obj.lookup("com.redhat.Cockpit.Storage.Drive"))
            elem = $("#storage-drive-" + id);
        else if (obj.lookup("com.redhat.Cockpit.Storage.MDRaid"))
            elem = $("#storage-raid-" + id);
        else if (obj.lookup("com.redhat.Cockpit.Storage.VolumeGroup"))
            elem = $("#storage-vg-" + id);
        else
            elem = $("#storage-block-" + id);
        elem.remove();
    },

    _addDrive: function(obj) {
        var drive = obj.lookup("com.redhat.Cockpit.Storage.Drive");
        var id = cockpit_esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var sort_key = cockpit_esc(drive.SortKey);
        var n;

        var device_string = "";
        var blocks = cockpit_get_block_devices_for_drive(drive);
        var block;

        for (n = 0; n < blocks.length; n++) {
            block = blocks[n];
            if (n > 0) {
                device_string += " ";
            }
            device_string += block.Device;
        }

        var html = "<tr id=\"storage-drive-" + id + "\" sort=\"" + sort_key + "\"";
        html += " onclick=\"" + cockpit_esc(cockpit_go_down_cmd("storage-detail", { type: 'drive', id: id })) + "\">";

        html += "<td>";
        html += cockpit_esc(drive.Name);
        html += "</td>";
        html += "<td>";

        var size_str = cockpit_fmt_size(drive.Size);
        var val;
        if (drive.Classification == "hdd") {
            val = size_str + " " + C_("storage", "Hard Disk");
        } else if (drive.Classification == "ssd") {
            val = size_str + " " + C_("storage", "Solid-State Disk");
        } else if (drive.Classification == "removable") {
            if (drive.Size === 0)
                val = C_("storage", "Removable Drive");
            else
                val = size_str + " " + C_("storage", "Removable Drive");
        } else if (drive.Classification == "optical") {
            val = C_("storage", "Optical Drive");
        } else {
            if (drive.Size === 0)
                val = C_("storage", "Drive");
            else
                val = size_str + " " + C_("storage", "Drive");
        }
        html += val;
        html += "</td>";
        html += '<td style="width:20px"><img id="storage-spinner-' +id+ '" src="images/small-spinner.gif"/></td>';
        html += "</tr>";

        // TODO: should show warning icon etc. if disk is failing

        // Insert sorted
        var children = this._drives[0].childNodes;
        var insert_before = null;
        var child, child_sort_key;

        for (n = 0; n < children.length; n++) {
            child = children[n];
            child_sort_key = child.getAttribute("sort");
            if (child_sort_key > sort_key) {
                insert_before = child;
                break;
            }
        }

        (this._drives[0]).insertBefore(($(html))[0], insert_before);
        this._drives.closest('.panel').show();

        cockpit_prepare_as_target ($('#storage-spinner-' + id));
        for (n = 0; n < blocks.length; n++)
            cockpit_mark_as_block_target ($('#storage-spinner-' + id), blocks[n]);
    },

    _addRaid: function(obj) {
        var raid = obj.lookup("com.redhat.Cockpit.Storage.MDRaid");

        var id = cockpit_esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var sort_key = id; // for now
        var n;

        var html = "<tr id=\"storage-raid-" + id + "\" sort=\"" + sort_key + "\"";
        html += " onclick=\"" + cockpit_esc(cockpit_go_down_cmd("storage-detail", { type: 'mdraid', id: id })) + "\">";

        html += "<td>";
        html += cockpit_esc(cockpit_raid_get_desc(raid));
        html += "</td>";
        html += "<td>";

        if (raid.Size > 0) {
            var size_str = cockpit_fmt_size(raid.Size);
            html += size_str + " " + C_("storage", "RAID Array");
        } else
            html += C_("storage", "RAID Array");
        html += "</td>";
        html += '<td style="width:20px"><img id="storage-spinner-' +id+ '" src="images/small-spinner.gif"/></td>';
        html += "</tr>";

        // Insert sorted
        var children = this._raids[0].childNodes;
        var insert_before = null;
        var child, child_sort_key;
        for (n = 0; n < children.length; n++) {
            child = children[n];
            child_sort_key = child.getAttribute("sort");
            if (child_sort_key > sort_key) {
                insert_before = child;
                break;
            }
        }

        (this._raids[0]).insertBefore(($(html))[0], insert_before);
        this._raids.closest('.panel').show();

        cockpit_prepare_as_target ($('#storage-spinner-' + id));
        var blocks = cockpit_get_block_devices_for_mdraid (raid);
        for (n = 0; n < blocks.length; n++)
            cockpit_mark_as_block_target ($('#storage-spinner-' + id), blocks[n]);
    },

    _addVG: function(obj) {
        var vg = obj.lookup("com.redhat.Cockpit.Storage.VolumeGroup");

        var id = cockpit_esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var sort_key = id; // for now
        var n;

        var html = "<tr id=\"storage-vg-" + id + "\" sort=\"" + sort_key + "\"";
        html += " onclick=\"" + cockpit_esc(cockpit_go_down_cmd("storage-detail", { type: 'vg', id: id })) + "\">";

        html += "<td>";
        html += cockpit_esc(vg.Name);
        html += "</td>";
        html += "<td>";

        if (vg.Size > 0) {
            var size_str = cockpit_fmt_size(vg.Size);
            html += size_str + " " + C_("storage", "Volume Group");
        } else
            html += C_("storage", "Volume Group");
        html += "</td>";
        html += '<td style="width:20px"><img id="storage-spinner-' +id+ '" src="images/small-spinner.gif"/></td>';
        html += "</tr>";

        // Insert sorted
        var children = this._vgs[0].childNodes;
        var insert_before = null;
        var child, child_sort_key;
        for (n = 0; n < children.length; n++) {
            child = children[n];
            child_sort_key = child.getAttribute("sort");
            if (child_sort_key > sort_key) {
                insert_before = child;
                break;
            }
        }

        (this._vgs[0]).insertBefore(($(html))[0], insert_before);
        this._vgs.closest('.panel').show();

        cockpit_prepare_as_target ($('#storage-spinner-' + id));
    },

    _addOtherDevice: function(obj) {
        var block = obj.lookup("com.redhat.Cockpit.Storage.Block");

        // Ignore partitions, block devices part of a drive, unlocked
        // cleartext devices, RAIDs, and logical volumes.
        if (block.PartitionNumber !== 0 ||
            block.Drive != "/" ||
            block.CryptoBackingDevice != "/" ||
            block.MDRaid != "/" ||
            block.LogicalVolume != "/")
            return;

        var id = cockpit_esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var sort_key = id; // for now

        var html = "<tr id=\"storage-block-" + id + "\" sort=\"" + sort_key + "\"";
        html += " onclick=\"" + cockpit_esc(cockpit_go_down_cmd("storage-detail", { type: 'block', id: id })) + "\">";

        html += "<td>";
        html += cockpit_esc(block.Device);
        html += "</td>";
        html += "<td>";

        var size_str = cockpit_fmt_size(block.Size);
        var val = size_str + " " + C_("storage", "Block Device");
        html += val;
        html += "</td>";
        html += '<td style="width:20px"><img id="storage-spinner-' +id+ '" src="images/small-spinner.gif"/></td>';
        html += "</tr>";

        // Insert sorted
        var children = this._other_devices[0].childNodes;
        var insert_before = null;
        var child, child_sort_key;

        for (var n = 0; n < children.length; n++) {
            child = children[n];
            child_sort_key = child.getAttribute("sort");
            if (child_sort_key > sort_key) {
                insert_before = child;
                break;
            }
        }

        (this._other_devices[0]).insertBefore(($(html))[0], insert_before);
        this._other_devices.closest('.panel').show();

        cockpit_prepare_as_target ($('#storage-spinner-' + id));
        cockpit_mark_as_block_target ($('#storage-spinner-' + id), block);
    }
};

function PageStorage() {
    this._init();
}

cockpit_pages.push(new PageStorage());

// ----------------------------------------------------------------------------------------------------

function cockpit_lvol_get_desc(lv)
{
    var type;
    if (lv.Type == "pool")
        type = _("Pool for Thin Logical Volumes");
    else if (lv.ThinPool != "/")
        type =_("Thin Logical Volume");
    else if (lv.Origin != "/")
        type = _("Logical Volume (Snapshot)");
    else
        type = _("Logical Volume");
    return F("%{type} \"%{name}\"", { type: type, name: cockpit_esc(lv.Name) });
}

function cockpit_block_get_desc(block, partition_label, cleartext_device)
{
    var ret, lv;

    if (block.IdUsage == "filesystem") {
        ret = F(C_("storage-id-desc", "%{type} File System"), { type: cockpit_esc(block.IdType) });
     } else if (block.IdUsage == "raid") {
        if (block.IdType == "linux_raid_member") {
            ret = C_("storage-id-desc", "Linux MD-RAID Component");
        } else if (block.IdType == "LVM2_member") {
            ret = C_("storage-id-desc", "LVM2 Physical Volume");
        } else {
            ret = C_("storage-id-desc", "RAID Member");
        }
    } else if (block.IdUsage == "crypto") {
        if (block.IdType == "crypto_LUKS") {
            ret = C_("storage-id-desc", "LUKS Encrypted");
        } else {
            ret = C_("storage-id-desc", "Encrypted");
        }
    } else if (block.IdUsage == "other") {
        if (block.IdType == "swap") {
            ret = C_("storage-id-desc", "Swap Space");
        } else {
            ret = C_("storage-id-desc", "Other Data");
        }
    } else {
        ret = C_("storage-id-desc", "Unrecognized Data");
    }

    if (block.PartitionNumber > 0)
        ret = F(_("%{size} %{partition} (%{content})"),
                { size: cockpit_fmt_size(block.Size),
                  partition: partition_label,
                  content: ret
                });

    if (block.LogicalVolume != "/") {
        lv = block._client.lookup(block.LogicalVolume,
                                  "com.redhat.Cockpit.Storage.LogicalVolume");
        ret = F(_("%{size} %{partition} (%{content})"),
                { size: cockpit_fmt_size(block.Size),
                  partition: cockpit_lvol_get_desc(lv),
                  content: ret
                });
    }

    ret += "<br/>";

    ret += cockpit_esc(block.Device);

    if (block.IdUsage == "filesystem") {
        ret += ", ";
        if (block.MountedAt.length > 0)
            ret += F(_("mounted on %{mountpoint}"),
                     { mountpoint: cockpit_esc(block.MountedAt[0])
                     });
        else
            ret += _("not mounted");
    } else if (block.IdUsage == "crypto") {
        ret += ", ";
        if (cleartext_device)
            ret += _("unlocked");
        else
            ret += _("locked");
    }

    return ret;
}

function cockpit_block_get_short_desc(block)
{
    if (block.PartitionNumber > 0)
        return "Partition";
    else if (block.LogicalVolume != "/") {
        var lv = block._client.lookup(block.LogicalVolume,
                                      "com.redhat.Cockpit.Storage.LogicalVolume");
        return cockpit_lvol_get_desc(lv);
    } else if (block.Drive != "/") {
        var drive = block._client.lookup(block.Drive,
                                         "com.redhat.Cockpit.Storage.Drive");
        return drive? cockpit_esc(drive.Name) : block.Device;
    } else
        return "Block Device";
}

function cockpit_find_cleartext_device(block)
{
    var objpath = block.getObject().objectPath;

    var objs = block._client.getObjectsFrom("/com/redhat/Cockpit/Storage/block_devices/");
    for (var n = 0; n < objs.length; n++) {
        var o = objs[n];
        var b = o.lookup("com.redhat.Cockpit.Storage.Block");

        if (b && b.CryptoBackingDevice == objpath)
            return b;
    }
    return null;
}

function cockpit_raid_get_desc(raid)
{
    var parts = raid.Name.split(":");

    if (parts.length != 2)
        return raid.Name;

    var manager = raid._client.lookup("/com/redhat/Cockpit/Manager",
                                      "com.redhat.Cockpit.Manager");

    if (manager && parts[0] == manager.Hostname)
        return cockpit_esc(parts[1]);
    else
        return F(_("%{name} (on %{host})"),
                 { name: cockpit_esc(parts[1]),
                   host: cockpit_esc(parts[0])
                 });
}

function cockpit_get_free_block_devices(client, filter)
{
    function is_extended_partition(b)
    {
        var b_objpath = b.getObject().objectPath;
        var part_block, table;
        var i;

        if (b.PartitionTable)
            part_block = client.lookup(b.PartitionTable,
                                       "com.redhat.Cockpit.Storage.Block");
        if (part_block)
            table = part_block.Partitions;
        if (table) {
            for (i = 0; i < table.length; i++) {
                if (table[i][0] == b_objpath)
                    return table[i][3] == 'x';
            }
        }
        return false;
    }

    function has_fs_label(b)
    {
        // Devices with a LVM2_member label need to actually be
        // associated with a volume group.
        return b.IdUsage !== '' && (b.IdType != 'LVM2_member' || b.PvGroup != '/');
    }

    var result = [ ];
    var objs = client.getObjectsFrom("/com/redhat/Cockpit/Storage/block_devices/");
    for (var n = 0; n < objs.length; n++) {
        var o = objs[n];
        var b = o.lookup("com.redhat.Cockpit.Storage.Block");

        if (b && b.Size > 0 && !has_fs_label(b) && !b.PartitionTableType && !is_extended_partition(b) &&
            !(filter && filter(b)))
            result.push(b);
    }
    return result;
}

PageStorageDetail.prototype = {
    _init: function() {
        this.id = "storage-detail";
        this.watched_objects = [ ];
    },

    getTitle: function() {
        var ret;
        if (this._drive) {
            if (this._drive.Vendor && this._drive.Vendor.length > 0)
                ret = this._drive.Vendor + " " + this._drive.Model;
            else
                ret = this._drive.Model;
        } else if (this._mdraid) {
            ret = cockpit_raid_get_desc(this._mdraid);
        } else if (this._vg) {
            ret = this._vg.Name;
        } else
            ret = this._block.Device;
        return ret;
    },

    show: function() {
    },

    /* We are watching a set of objects, and this set can change.
     * Therefore, we reconstruct the set of watched objects with every
     * run of _update.
     */

    watch_object: function(obj) {
        if (obj) {
            this.watched_objects.push(obj);
            $(obj).on('notify.storage-details', $.proxy(this, "_update"));
        }
    },

    unwatch_all_objects: function() {
        for (var i = 0; i < this.watched_objects.length; i++)
            $(this.watched_objects[i]).off('.storage-details');
        this.watched_objects = [ ];
    },

    leave: function() {
        this.unwatch_all_objects();
        this.job_box.stop();
        this.log_box.stop();
        this.stop_vg_polling();
        cockpit_unwatch_jobs(this.client);
        $(this.client).off(".storage-details");
        this.client.release();
        this.client = null;
    },

    setup: function() {
        var self = this;

        self.raid_action_btn =
            cockpit_action_btn (function (op) { self.action(op); },
                                [ { title: _("Start"),           action: 'start' },
                                  { title: _("Stop"),            action: 'stop' },
                                  { title: _("Format"),          action: 'format' },
                                  { title: _("Start Scrubbing"), action: 'start-scrub' },
                                  { title: _("Stop Scrubbing"),  action: 'stop-scrub' },
                                  { title: _("Delete"),          action: 'delete',
                                    danger: true
                                  }
                                ]);
        $('#raid_action_btn').html(self.raid_action_btn);
        $('#raid-disks-add').on('click', $.proxy(this, "raid_disk_add"));

        $("#raid_detail_bitmap_enable").on('click', $.proxy (this, "bitmap_enable"));
        $("#raid_detail_bitmap_disable").on('click', $.proxy (this, "bitmap_disable"));

        $("#drive_format").on('click', function () {
            self.action('format');
        });

        var btn = cockpit_action_btn (function (op) { self.volume_group_action(op); },
                                      [ { title: _("Rename"), action: 'rename',
                                          is_default: true },
                                        { title: _("Delete"), action: 'delete',
                                          danger: true }
                                      ]);
        $('#vg_action_btn').html(btn);
        $("#vg-pv-add").on('click', $.proxy(this, "add_physical_volume"));
    },

    enter: function() {
        var me = this;
        var type = cockpit_get_page_param("type");
        var id = cockpit_get_page_param("id");

        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address, { protocol: 'dbus-json1' });
        cockpit_watch_jobs(this.client);

        this._drive = null;
        this._mdraid = null;
        this._vg = null;
        this._block = null;

        $("#disk_detail_list").hide();
        $("#raid_detail_list").hide();
        $("#vg_detail_list").hide();
        $("#block_detail_list").hide();
        if (type == "drive") {
            this._drive = this.client.get("/com/redhat/Cockpit/Storage/drives/" + id,
                                          "com.redhat.Cockpit.Storage.Drive");
            $("#disk_detail_list").show();
        } else if (type == "mdraid") {
            this._mdraid = this.client.get("/com/redhat/Cockpit/Storage/raids/" + id,
                                           "com.redhat.Cockpit.Storage.MDRaid");
            $("#raid_detail_list").show();
        } else if (type == "vg") {
            this._vg = this.client.get("/com/redhat/Cockpit/Storage/lvm/" + id,
                                       "com.redhat.Cockpit.Storage.VolumeGroup");
            $("#vg_detail_list").show();
        } else {
            this._block = this.client.get("/com/redhat/Cockpit/Storage/block_devices/" + id,
                                          "com.redhat.Cockpit.Storage.Block");
            $("#block_detail_list").show();
        }

        this.job_box = cockpit_storage_job_box (this.client, $('#storage-detail-jobs'));
        this.log_box = cockpit_storage_log_box (this.client, $('#storage-detail-log'));

        this._update();

        $("#storage-detail-title").text(this.getTitle());

        $(this.client).on("objectAdded.storage-details", $.proxy(this._update, this));
        $(this.client).on("objectRemoved.storage-details", $.proxy(this._update, this));
        $(this.client).on("propertiesChanged.storage-details", $.proxy(this._onPropertiesChanged, this));
    },

    _onPropertiesChanged: function(event, obj, iface)
    {
        // We also need to react to changes to objects that we don't
        // know about yet, such as a device becoming a physical volume
        // for our volume group.  See #157.

        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Storage/") !== 0)
            return;

        this._update();
    },

    _update: function() {
        this.unwatch_all_objects();

        if (this._drive)
            this._updateDrive();
        else if (this._mdraid)
            this._updateMDRaid();
        else if (this._vg)
            this._updateVG();
        else if (this._block)
            this._updateBlock();
    },

    _updateBlock: function() {
        var val;

        var block = this._block;
        this.watch_object(block);
        this._updateContent(block);

        val = cockpit_esc(block.Device);
        $("#block_detail_device").html(val);
        val = block.Size > 0 ? cockpit_fmt_size_long(block.Size) : C_("storage", "No Media Inserted");
        $("#block_detail_capacity").html(val);
    },

    _updateContent: function (block_or_vg) {
        var me = this;

        var id = 0;

        function block_action_func (target) {
            return function (op) {
                me.block_action(target, op);
            };
        }

        function create_block_action_btn (target, is_crypto_locked, is_partition) {
            var btn;

            var filesystem_action_spec =
                [ { title: _("Mount"),              action: "mount" },
                  { title: _("Unmount"),            action: "unmount" },
                  { title: _("Filesystem Options"), action: "fsys-options" }
                ];

            var crypto_action_spec =
                [ { title: _("Lock"),               action: "lock" },
                  { title: _("Unlock"),             action: "unlock" },
                  { title: _("Encryption Options"), action: "crypto-options" }
                ];

            var lvol_action_spec =
                [ { title: _("Resize"),             action: "resize" },
                  { title: _("Rename"),             action: "rename" }
                ];

            var lvol_block_action_spec =
                [ { title: _("Create Snapshot"),    action: "create-snapshot" },
                  { title: _("Activate"),           action: "activate" },
                  { title: _("Deactivate"),         action: "deactivate" }
                ];

            var lvol_pool_action_spec =
                [ { title: _("Create Thin Volume"), action: "create-thin-volume" }
                ];

            var format_action_spec =
                [ { title: _("Format"),             action: "format" }
                ];

            var delete_action_spec =
                [ { title: _("Delete"),             action: "delete", danger: true }
                ];

            var is_filesystem         = (target.IdUsage == 'filesystem');
            var is_filesystem_mounted = (target.MountedAt && target.MountedAt.length !== 0);
            var is_crypto             = (target.IdUsage == 'crypto');
            var is_lvol               = (target._iface_name == "com.redhat.Cockpit.Storage.LogicalVolume" ||
                                         target.LogicalVolume != "/");
            var is_lvol_pool          = (target.Type == "pool");
            var is_lvol_active        = (target._iface_name == "com.redhat.Cockpit.Storage.Block" ||
                                         target.Active);
            var is_formattable        = (target._iface_name == "com.redhat.Cockpit.Storage.Block");

            var default_op = null;
            var action_spec = [ ];

            if (is_filesystem) {
                action_spec = action_spec.concat(filesystem_action_spec);
                default_op = is_filesystem_mounted? 'unmount' : 'mount';
            } else if (is_crypto) {
                action_spec = action_spec.concat(crypto_action_spec);
                default_op = is_crypto_locked? 'unlock' : 'lock';
            }

            if (is_formattable) {
                action_spec = action_spec.concat(format_action_spec);
                if (!default_op)
                    default_op = 'format';
            }

            if (is_lvol) {
                action_spec = action_spec.concat(lvol_action_spec);
                if (is_lvol_pool) {
                    action_spec = action_spec.concat(lvol_pool_action_spec);
                    default_op = 'create-thin-volume';
                } else {
                    action_spec = action_spec.concat(lvol_block_action_spec);
                    if (!default_op)
                        default_op = is_lvol_active? 'deactivate' : 'activate';
                }
            }

            if (is_partition || is_lvol) {
                action_spec = action_spec.concat(delete_action_spec);
                if (!default_op)
                    default_op = 'delete';
            }

            if (action_spec.length > 0) {
                btn = cockpit_action_btn (function (op) { me.block_action (target, op); },
                                          action_spec);
                cockpit_action_btn_select (btn, default_op);

                cockpit_action_btn_enable (btn, 'mount',              !is_filesystem_mounted);
                cockpit_action_btn_enable (btn, 'unmount',            is_filesystem_mounted);
                cockpit_action_btn_enable (btn, 'lock',               !is_crypto_locked);
                cockpit_action_btn_enable (btn, 'unlock',             is_crypto_locked);
                cockpit_action_btn_enable (btn, 'activate',           !is_lvol_active);
                cockpit_action_btn_enable (btn, 'deactivate',         is_lvol_active);
            }

            return btn;
        }

        function create_simple_btn (title, func) {
            return $('<button>', { 'class': 'btn btn-default',
                                   'on': { 'click': func }
                                 }).text(title);
        }

        function append_entry (level, name, desc, button) {
            id += 1;

            // XXX
            if (button === true)
                button = null;

            var tr = $('<tr>');
            if (level > 0)
                tr.append($('<td>', { 'Width': 30*level }));
            tr.append($('<td>', { 'style': 'width:50%' }).html(desc));
            if (name)
                tr.append($('<td>', { 'style': 'text-align:left' }).html(name));
            if (button)
                tr.append($('<td>', { 'style': 'text-align:right' }).append(button));
            tr.append(
                $('<td>', { 'style': 'width:20px' }).append(
                    $('<img>', { 'id': 'entry-spinner-' +id,
                                 'src': 'images/small-spinner.gif'
                               })));
            list.append(
                $('<li>', { 'class': 'list-group-item' }).append(
                    $('<table>', { 'style': 'width:100%'
                                 }).append(tr)));

            cockpit_prepare_as_target ('#entry-spinner-' + id);
            return id;
        }

        function append_non_partitioned_block (level, block, part_desc) {
            var id, name, desc, btn;
            var cleartext_device;

            if (block.IdUsage == 'crypto')
                cleartext_device = cockpit_find_cleartext_device (block);

            if (block.IdLabel.length > 0)
                name = cockpit_esc(block.IdLabel);
            else
                name = "—";
            desc = cockpit_block_get_desc(block, part_desc, cleartext_device);

            id = append_entry (level, name, desc,
                               create_block_action_btn (block, !cleartext_device, !!part_desc));

            cockpit_mark_as_target ('#entry-spinner-' + id, block.getObject().objectPath);

            me.watch_object(block);

            if (cleartext_device)
                append_device (level+1, cleartext_device);
        }

        function append_partitions (level, block) {
            var device_level = level;

            var is_dos_partitioned = (block.PartitionTableType == 'dos');
            var wanted = block.Partitions.sort(function (a,b) { return a[1] - b[1]; });

            function append_free_space (level, start, size) {
                var desc;

                // UDisks rounds the start up to the next MiB, so let's do
                // the same and see whether there is anything left that is
                // worth showing.  (UDisks really uses the formula below,
                // and will really 'round' start == 1 MiB to 2 MiB, for example.)

                var real_start = (Math.floor(start / (1024*1024)) + 1) * 1024*1024;
                if (start + size - real_start >= 1024*1024) {
                    if (is_dos_partitioned) {
                        if (level > device_level)
                            desc = F(_("%{size} Free Space for Logical Partitions"),
                                     { size: cockpit_fmt_size (size) });
                        else
                            desc = F(_("%{size} Free Space for Primary Partitions"),
                                     { size: cockpit_fmt_size (size) });
                    } else
                        desc = F(_("%{size} Free Space"),
                                 { size: cockpit_fmt_size (size) });

                    append_entry (level, null, desc,
                                  create_simple_btn (_("Create Partition"),
                                                     $.proxy(me, "create_partition", block, start, size)));
                }
            }

            function append_extended_partition (level, block, start, size) {
                var desc = F(_("%{size} Extended Partition"), { size: cockpit_fmt_size (size) });
                var btn = create_block_action_btn (block, false, true);
                append_entry (level, null, desc, btn);
                me.watch_object(block);
                process_level (level + 1, start, size);
            }

            function process_level (level, container_start, container_size) {
                var n;
                var last_end = container_start;
                var total_end = container_start + container_size;
                var block, start, size, type, part_desc;

                for (n = 0; n < wanted.length; n++) {
                    block = me.client.lookup(wanted[n][0], "com.redhat.Cockpit.Storage.Block");
                    start = wanted[n][1];
                    size = wanted[n][2];
                    type = wanted[n][3];

                    if (block === null)
                        continue;

                    if (level === device_level && type == 'l')
                        continue;

                    if (level == device_level+1 && type != 'l')
                        continue;

                    if (start < container_start || start+size > container_start+container_size)
                        continue;

                    append_free_space(level, last_end, start - last_end);
                    if (type == 'x')
                        append_extended_partition(level, block, start, size);
                    else {
                        if (is_dos_partitioned) {
                            if (level > device_level)
                                part_desc = _("Logical Partition");
                            else
                                part_desc = _("Primary Partition");
                        } else
                            part_desc = _("Partition");
                        append_non_partitioned_block (level, block, part_desc);
                    }
                    last_end = start + size;
                }

                append_free_space(level, last_end, total_end - last_end);
            }

            process_level (device_level, 0, block.Size);
        }

        function append_device (level, block, desc) {
            var is_partitioned = !!block.PartitionTableType;

            if (block.PartitionTableType)
                append_partitions (level, block);
            else
                append_non_partitioned_block (level, block, null);
        }

        function append_volume_group (level, vg) {
            var i, id, lvs, objs, block, lv, vg_obj, desc;

            function append_logical_volume_block (level, block, lv) {
                var btn, id, desc;
                if (block.PartitionTableType) {
                    desc = F(_("%{size} %{desc}"),
                             { desc: cockpit_lvol_get_desc(lv),
                               size: cockpit_fmt_size (block.Size) });
                    desc += "<br/>" + cockpit_esc(block.Device);
                    btn = create_block_action_btn (block, false, false);
                    id = append_entry (level, null, desc, btn);
                    append_partitions (level+1, block);
                } else
                    append_non_partitioned_block (level, block, null);
            }

            function find_logical_volume_block (lv) {
                var lv_obj = lv.getObject();
                var objs = me.client.getObjectsFrom("/com/redhat/Cockpit/Storage/block_devices/");
                for (var n = 0; n < objs.length; n++) {
                    var obj = objs[n];
                    var block = obj.lookup("com.redhat.Cockpit.Storage.Block");
                    if (block.LogicalVolume == lv_obj.objectPath)
                        return block;
                }
                return null;
            }

            function append_logical_volume (level, lv) {
                var block, desc, btn, id, ratio;
                var lv_obj, objs, i, llv;

                if (lv.Type == "pool") {
                    ratio = Math.max(lv.DataAllocatedRatio, lv.MetadataAllocatedRatio);
                    desc = F(_("%{size} %{desc}<br/>%{percent}% full"),
                             { size: cockpit_fmt_size (lv.Size),
                               desc: cockpit_lvol_get_desc(lv),
                               percent: (ratio*100).toFixed(0)
                             });
                    btn = create_block_action_btn (lv, false, false);
                    id = append_entry (level, null, desc, btn);

                    lv_obj = lv.getObject();
                    objs = me.client.getObjectsFrom(lv.VolumeGroup);
                    objs.sort(function (a,b) { return a.objectPath.localeCompare(b.objectPath); });
                    for (i = 0; i < objs.length; i++) {
                        llv = objs[i].lookup("com.redhat.Cockpit.Storage.LogicalVolume");
                        if (llv && llv.ThinPool == lv_obj.objectPath) {
                            append_logical_volume (level+1, llv);
                        }
                    }
                } else {
                    block = find_logical_volume_block (lv);
                    if (block)
                        append_logical_volume_block (level, block, lv);
                    else {
                        // If we can't find the block for a active
                        // volume, UDisks2 is probably misbehaving,
                        // and we show it as "unsupported".

                        desc = F(_("%{size} %{desc}<br/>(%{state})"),
                                 { size: cockpit_fmt_size (lv.Size),
                                   desc: cockpit_lvol_get_desc(lv),
                                   state: lv.Active? _("active, but unsupported") : _("inactive")
                                 });
                        btn = create_block_action_btn (lv, false, false);
                        id = append_entry (level, null, desc, btn);
                    }
                }
            }

            lvs = [ ];
            vg_obj = vg.getObject();
            objs = me.client.getObjectsFrom(vg_obj.objectPath);
            objs.sort(function (a,b) { return a.objectPath.localeCompare(b.objectPath); });
            for (i = 0; i < objs.length; i++) {
                lv = objs[i].lookup("com.redhat.Cockpit.Storage.LogicalVolume");
                if (lv && lv.VolumeGroup == vg_obj.objectPath && lv.ThinPool == "/") {
                    append_logical_volume (level, lv);
                }
            }
            if (vg.FreeSize > 0) {
                desc = F(_("%{size} Free Space for Logical Volumes"),
                         { size: cockpit_fmt_size (vg.FreeSize) });
                var btn = cockpit_action_btn (function (op) { me.volume_group_action (op); },
                                              [ { title: _("Create Plain Logical Volume"),
                                                  action: 'create-plain', is_default: true
                                                },
                                                { title: _("Create RAID Logical Volume"),
                                                  action: 'create-raid'
                                                },
                                                { title: _("Create Pool for Thin Logical Volumes"),
                                                  action: 'create-thin-pool'
                                                }
                                              ]);
                id = append_entry (level, null, desc, btn);
            }
        }

        if (!block_or_vg) {
            $("#storage_detail_content").hide();
            return;
        }

        $("#storage_detail_content").show();

        var list = $("#storage_detail_partition_list");
        list.empty();
        if (block_or_vg._iface_name == "com.redhat.Cockpit.Storage.Block") {
            $('#storage_detail_content_title').text(_("Content"));
            append_device (0, block_or_vg);
        } else if (block_or_vg._iface_name == "com.redhat.Cockpit.Storage.VolumeGroup") {
            $('#storage_detail_content_title').text(_("Logical Volumes"));
            append_volume_group (0, block_or_vg);
        }
    },

    _updateDrive: function() {
        var val;

        var drive = this._drive;
        var blocks = cockpit_get_block_devices_for_drive (drive);
        var block = (blocks.length > 0)? blocks[0] : undefined;

        this.watch_object (drive);
        this.watch_object (block);
        this._updateContent(block);

        if (drive.Vendor && drive.Vendor.length > 0)
            val = cockpit_esc(drive.Vendor) + " " + cockpit_esc(drive.Model);
        else
            val = cockpit_esc(drive.Model);
        $("#disk_detail_model").html(val);
        val = drive.Revision ? cockpit_esc(drive.Revision) : "—";
        $("#disk_detail_firmware_version").html(val);
        val = drive.Serial ? cockpit_esc(drive.Serial) : "—";
        $("#disk_detail_serial_number").html(val);
        val = drive.WWN ? cockpit_esc(drive.WWN) : "—";
        $("#disk_detail_world_wide_name").html(val);
        val = drive.Size > 0 ? cockpit_fmt_size_long(drive.Size) : C_("disk-drive", "No Media Inserted");
        $("#disk_detail_capacity").html(val);
        if (drive.FailingValid) {
            if (drive.Failing) {
                val = "<div class=\"cockpit-disk-failing\">" + C_("disk-drive", "DISK IS FAILING") + "</div>";
            } else {
                val = C_("disk-drive", "Disk is OK");
            }
        } else {
            val = "—";
        }
        if (drive.Temperature > 0) {
            val += " (" + cockpit_format_temperature(drive.Temperature) + ")";
        }
        $("#disk_detail_assessment").html(val);

        val = "";
        for (var n = 0; n < blocks.length; n++) {
            var b = blocks[n];
            if (n > 0) {
                val += " ";
            }
            val += cockpit_esc(b.Device);
        }
        $("#disk_detail_device_file").html(val);
    },

    _updateMDRaid: function() {
        function format_level(str) {
            return { "raid0": _("RAID 0"),
                     "raid1": _("RAID 1"),
                     "raid4": _("RAID 4"),
                     "raid5": _("RAID 5"),
                     "raid6": _("RAID 6"),
                     "raid10": _("RAID 10")
                   }[str] || F(_("RAID (%{level})"), str);
        }

        var raid = this._mdraid;
        var block = cockpit_find_block_device_for_mdraid (raid);

        this.watch_object (raid);
        this.watch_object (block);
        this._updateContent (block);

        if (block)
            $("#raid_detail_device").html(cockpit_esc(block.Device));
        else
            $("#raid_detail_device").html("--");

        var val = raid.Size > 0 ? cockpit_fmt_size_long(raid.Size) : "--";
        $("#raid_detail_capacity").html(val);
        $("#raid_detail_name").html(cockpit_raid_get_desc(raid));
        $("#raid_detail_uuid").html(cockpit_esc(raid.UUID));

        var level = format_level(raid.Level);
        if (raid.NumDevices > 0)
            level += ", " + F(_("%{n} Disks"), { n: raid.NumDevices });
        if (raid.ChunkSize > 0)
            level += ", " + F(_("%{n} Chunk Size"), { n: cockpit_fmt_size(raid.ChunkSize) });
        $("#raid_detail_level").html(cockpit_esc(level));

        var state, action_state = "", is_running;
        var action, percent, rate, remaining;
        var degraded = null;

        var loc = raid.BitmapLocation;
        if (loc) {
            $("#raid_detail_bitmap").text(loc == "none"? _("Off") : _("On"));
            $("#raid_detail_bitmap_row").show();
        } else {
            $("#raid_detail_bitmap_row").hide();
        }

        is_running = !!block;

        if (raid.Degraded > 0) {
            degraded = ('<span style="color:red">' + _("ARRAY IS DEGRADED") + '</span> -- ' +
                        F(_("%{n} disks are missing"), { n: raid.Degraded }));
        }
        if (!raid.SyncAction) {
            if (block) {
                state = _("Running");
            } else {
                state = _("Not running");
            }
        } else {
            if (degraded)
                state = degraded;
            else
                state = _("Running");
            action = { "idle" : "",
                       "check" : _("Data Scrubbing"),
                       "repair" : _("Data Scrubbing and Repair"),
                       "resync" : _("Resyncing"),
                       "recover" : _("Recovering "),
                       "frozen" : _("Frozen")
                     }[raid.SyncAction] || raid.SyncAction;
            if (action && action != "idle") {
                percent = Math.round(raid.SyncCompleted * 100).toString();
                if (raid.SyncRate > 0)
                    action_state = F(_("%{action}, %{percent}% complete at %{rate}"),
                                    { action: action, percent: percent,
                                      rate: cockpit_fmt_size (raid.SyncRate) + "/s" });
                else
                    action_state = F(_("%{action}, %{percent}% complete"),
                                    { action: action, percent: percent });
                state = state + "<br/>" + action_state;
                if (raid.SyncRemainingTime > 0) {
                    remaining = F(_("%{remaining} remaining"),
                                  { remaining: cockpit_format_delay (raid.SyncRemainingTime / 1000) });
                    state = state + "<br/>" + remaining;
                }
            }
        }
        $("#raid_detail_state").html(state);

        cockpit_action_btn_select (this.raid_action_btn, is_running? 'stop' : 'start');
        cockpit_action_btn_enable (this.raid_action_btn, 'stop', is_running);
        cockpit_action_btn_enable (this.raid_action_btn, 'start', !is_running);

        $("#raid-disks").closest('.panel').toggle(is_running);

        function render_state(slot, state)
        {
            if (state == 'faulty')
                return '<span style="color:red">' + _("FAILED") + '</span>';
            else if (state == 'in_sync')
                return _("In Sync");
            else if (state == 'spare')
                return slot < 0? _("Spare") : _("Recovering");
            else if (state == 'write_mostly')
                return _("Write-mostly");
            else if (state == 'blocked')
                return _("Blocked");
            else
                return F(_("Unknown (%{state})"), { state: state });
        }

        var disks = $("#raid-disks");
        var info = this._mdraid.ActiveDevices;
        var i, j, slot, drive, states, state_html, num_errors;

        disks.empty();
        for (i = 0; i < info.length; i++) {
            slot = info[i][1];
            block = this.client.lookup (info[i][0],
                                        "com.redhat.Cockpit.Storage.Block");
            drive = block && this.client.lookup (block.Drive,
                                                 "com.redhat.Cockpit.Storage.Drive");
            states = info[i][2];
            num_errors = info[i][3];

            state_html = "";
            for (j = 0; j < states.length; j++) {
                if (j > 0)
                    state_html += '<br/>';
                state_html += render_state(slot, states[j]);
            }
            if (num_errors > 0) {
                if (states.length > 0)
                    state_html += '<br/>';
                state_html += ('<span style="color:red">' +
                               F(_("%{n} Read Errors"), { n: num_errors } ) +
                               '</span>');
            }

            disks.append(
                $('<li class="list-group-item">').append(
                    $('<table style="width:100%">').append(
                        $('<tr>').append(
                            $('<td style="width:20px;text-align:center">').text((slot < 0)? "--" : slot),
                            $('<td>').text(drive? drive.Name : block.Device),
                            $('<td style="width:100px;text-align:right">').html(state_html),
                            $('<td style="text-align:right">').append(
                                $('<button>', { 'class': 'btn btn-default',
                                                'on': { 'click': $.proxy(this, "raid_disk_remove", block) }
                                              }).text(_("Remove")))))));
        }
    },

    _updateVG: function() {
        var me = this;
        var vg = this._vg;
        var vg_obj = vg.getObject ();
        var i, val, block, drive, objs, pvs_list, pvs, lvs_list, lvs, desc;

        this.watch_object (vg);

        if (vg.NeedsPolling)
            this.start_vg_polling();
        else
            this.stop_vg_polling();

        val = vg.Size > 0 ? cockpit_fmt_size_long(vg.Size) : "--";
        $("#vg_detail_capacity").html(val);
        $("#vg_detail_name").text(vg.Name);
        $("#vg_detail_uuid").text(vg.UUID);

        pvs_list = $("#vg-physical-volumes");
        pvs = [ ];
        objs = this.client.getObjectsFrom("/com/redhat/Cockpit/Storage/block_devices/");
        for (i = 0; i < objs.length; i++) {
            block = objs[i].lookup("com.redhat.Cockpit.Storage.Block");
            if (block && block.PvGroup == vg_obj.objectPath) {
                pvs.push (block);
            }
        }

        pvs.sort(function (a, b) {
            var desc_a = cockpit_block_get_short_desc (a);
            var desc_b = cockpit_block_get_short_desc (b);
            return desc_a.localeCompare(desc_b);
        });

        function physical_action_func (block) {
            return function (op) { me.physical_volume_action (block, op); };
        }

        var physical_action_spec =
            [ { title: _("Remove"), action: 'remove', is_default: true },
              { title: _("Empty"),  action: 'empty' }
            ];

        pvs_list.empty();
        for (i = 0; i < pvs.length; i++) {
            block = pvs[i];
            drive = (block &&
                     block.PartitionNumber === 0 &&
                     this.client.lookup (block.Drive,
                                         "com.redhat.Cockpit.Storage.Drive"));

            desc = "";
            desc += cockpit_block_get_short_desc(block);
            desc += "<br/>" + F(_("%{size}, %{free} free"),
                                { size: cockpit_fmt_size (block.PvSize),
                                  free: cockpit_fmt_size (block.PvFreeSize)
                                });
            pvs_list.append(
                $('<li class="list-group-item">').append(
                    $('<table style="width:100%">').append(
                        $('<tr>').append(
                            $('<td>').html(desc),
                            $('<td style="text-align:right">').html(
                                cockpit_action_btn(physical_action_func (block),
                                                   physical_action_spec))))));
        }

        this._updateContent (vg);
    },

    action: function(op) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        if (op == 'format')
            this.format_disk();
        else if (op == 'delete')
            this.delete_raid();
        else if (op == 'start')
            this.start();
        else if (op == 'stop')
            this.stop();
        else if (op == 'start-scrub')
            this.start_scrub();
        else if (op == 'stop-scrub')
            this.stop_scrub();
        else
            console.log ("Unknown op %s", op);
    },

    block_action: function(target, op) {

        function is_lv(block_or_lv)
        {
            return (block_or_lv._iface_name == "com.redhat.Cockpit.Storage.LogicalVolume" ||
                    block_or_lv.LogicalVolume != "/");
        }

        function get_lv(block_or_lv)
        {
            if (block_or_lv._iface_name == "com.redhat.Cockpit.Storage.LogicalVolume")
                return block_or_lv;
            else
                return block_or_lv._client.lookup (block_or_lv.LogicalVolume,
                                                   "com.redhat.Cockpit.Storage.LogicalVolume");
        }

        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        if (op == 'format')
            this.format(target);
        else if (op == 'delete') {
            if (is_lv(target)) {
                this.delete_logical_volume(get_lv(target));
            } else
                this.delete_partition(target);
        } else if (op == 'mount')
            this.mount(target);
        else if (op == 'unmount')
            this.unmount(target);
        else if (op == 'lock')
            this.lock(target);
        else if (op == 'unlock')
            this.unlock(target);
        else if (op == 'fsys-options')
            this.fsys_options(target);
        else if (op == 'crypto-options')
            this.crypto_options(target);
        else if (op == 'resize')
            this.resize_logical_volume(get_lv(target));
        else if (op == 'rename')
            this.rename_logical_volume(get_lv(target));
        else if (op == 'activate')
            this.activate_logical_volume(get_lv(target));
        else if (op == 'deactivate')
            this.deactivate_logical_volume(get_lv(target));
        else if (op == 'create-thin-volume')
            this.create_thin_volume(get_lv(target));
        else if (op == 'create-snapshot')
            this.create_snapshot(get_lv(target));
        else
            console.log ("Unknown block op %s", op);
    },

    raid_action: function() {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        this.action(this.raid_op);
    },

    start: function() {
        this._mdraid.call("Start", function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    stop: function() {
        this._mdraid.call("Stop", function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    delete_raid: function() {
        this._mdraid.call("Delete", function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
            else
                cockpit_go_up();
        });
    },

    start_scrub: function() {
        this._mdraid.call("RequestSyncAction", "repair", function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    stop_scrub: function() {
        this._mdraid.call("RequestSyncAction", "idle", function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    bitmap_enable: function() {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        this._mdraid.call("SetBitmapLocation", "internal", function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    bitmap_disable: function() {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        this._mdraid.call("SetBitmapLocation", "none", function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    format_disk: function (block) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageFormatDisk.block = null;
        if (this._drive)
            PageFormatDisk.block = cockpit_find_block_device_for_drive (this._drive);
        else if (this._mdraid)
            PageFormatDisk.block = cockpit_find_block_device_for_mdraid (this._mdraid);
        else if (this._block)
            PageFormatDisk.block = this._block;

        if (PageFormatDisk.block)
            $('#storage_format_disk_dialog').modal('show');
    },

    format: function(block) {
        PageFormat.mode = 'format';
        PageFormat.block = block;
        $('#storage_format_dialog').modal('show');
    },

    delete_partition: function(block) {
        block.call('DeletePartition',
                   function (error) {
                       if (error)
                           cockpit_show_unexpected_error (error);
                   });
    },

    create_partition: function (block, start, size) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageFormat.block = block;
        PageFormat.mode = 'create-partition';
        PageFormat.start = start;
        PageFormat.size = size;
        $('#storage_format_dialog').modal('show');
    },

    mount: function(block) {
        block.call('Mount',
                   function (error) {
                       if (error)
                           cockpit_show_unexpected_error (error);
                   });
    },

    unmount: function(block) {
        block.call('Unmount',
                   function (error) {
                       if (error)
                           cockpit_show_unexpected_error (error);
                   });
    },

    lock: function(block) {
        block.call('Lock',
                   function (error) {
                       if (error)
                           cockpit_show_unexpected_error (error);
                   });
    },

    unlock: function(block) {
        PageUnlock.block = block;
        $('#storage_unlock_dialog').modal('show');
    },

    fsys_options: function(block) {
        PageFilesystemOptions.block = block;
        $('#filesystem_options_dialog').modal('show');
    },

    crypto_options: function(block) {
        PageCryptoOptions.block = block;
        $('#crypto_options_dialog').modal('show');
    },

    raid_disk_remove: function(block) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        this._mdraid.call('RemoveDevices', [ block.getObject().objectPath ],
                          function (error) {
                              if (error)
                                  cockpit_show_unexpected_error (error);
                          });
    },

    raid_disk_add: function() {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageRaidDiskAdd.mdraid = this._mdraid;
        $('#raid_disk_add_dialog').modal('show');
    },

    start_vg_polling: function() {
        var me = this;

        function poll() {
            if (me._vg)
                me._vg.call('Poll', function (error) { if (error) console.log(error.message); });
        }

        if (!this.vg_polling_id) {
            poll();
            this.vg_polling_id = window.setInterval (poll, 5000);
        }
    },

    stop_vg_polling: function() {
        if (this.vg_polling_id) {
            window.clearInterval (this.vg_polling_id);
            this.vg_polling_id = null;
        }
    },

    volume_group_action: function(op) {
        if (op == 'delete')
            this.delete_volume_group();
        else if (op == 'rename')
            this.rename_volume_group();
        else if (op == 'create-plain')
            this.create_plain_volume(this._vg);
        else if (op == 'create-thin-pool')
            this.create_thin_pool(this._vg);
        else if (op == 'create-raid')
            this.create_raid_volume(this._vg);
        else
            console.log("Unknown volume group op %s", op);
    },

    delete_volume_group: function() {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        this._vg.call("Delete", function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
            else
                cockpit_go_up ();
        });
    },

    physical_volume_action: function(target, op) {
        if (op == 'remove')
            this.remove_physical_volume(target);
        else if (op == 'empty')
            this.empty_physical_volume(target);
        else
            console.log("Unknown physical volume action %s", op);
    },

    remove_physical_volume: function(block) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        if (block.PvFreeSize != block.PvSize) {
            cockpit_show_error_dialog ("Error", "Volume is in use.");
            return;
        }

        var n = 0;
        var objs = this.client.getObjectsFrom("/com/redhat/Cockpit/Storage/block_devices/");
        for (var i = 0; i < objs.length; i++) {
            var b = objs[i].lookup("com.redhat.Cockpit.Storage.Block");
            if (b && b.PvGroup == this._vg.getObject().objectPath) {
                n += 1;
            }
        }

        if (n == 1) {
            cockpit_show_error_dialog ("Error", "Can't remove the last physical volume.");
            return;
        }

        this._vg.call('RemoveDevice', block.getObject().objectPath,
                      function (error) {
                          if (error)
                              cockpit_show_unexpected_error (error);
                      });
    },

    empty_physical_volume: function(block) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        var used = block.PvSize - block.PvFreeSize;
        if (used === 0) {
            cockpit_show_error_dialog ("Dude", "Volume is already empty.");
            return;
        }

        if (used > this._vg.FreeSize) {
            cockpit_show_error_dialog ("Error", "Not enough free space.");
            return;
        }

        this._vg.call('EmptyDevice', block.getObject().objectPath,
                      function (error) {
                          if (error)
                              cockpit_show_unexpected_error (error);
                      });
    },

    add_physical_volume: function() {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageVGDiskAdd.volume_group = this._vg;
        $('#vg_disk_add_dialog').modal('show');
    },

    create_plain_volume: function (volume_group) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageCreatePlainVolume.volume_group = volume_group;
        $('#storage_create_plain_volume_dialog').modal('show');
    },

    create_thin_pool: function (volume_group) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageCreateThinPool.volume_group = volume_group;
        $('#storage_create_thin_pool_dialog').modal('show');
    },

    create_thin_volume: function (pool) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageCreateThinVolume.pool = pool;
        $('#storage_create_thin_volume_dialog').modal('show');
    },

    create_raid_volume: function (volume_group) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        cockpit_show_error_dialog ("Sorry", "Not yet.");
    },

    create_snapshot: function (origin) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        if (origin.Origin != "/") {
            cockpit_show_error_dialog ("Error", "Can't take a snapshot of a snapshot.");
            return;
        }

        PageCreateSnapshot.origin = origin;
        $('#storage_create_snapshot_dialog').modal('show');
    },

    delete_logical_volume: function(lv) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        lv.call('Delete', function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    resize_logical_volume: function(lv) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageResizeVolume.volume = lv;
        $('#storage_resize_volume_dialog').modal('show');
    },

    rename_volume_group: function() {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageRenameGroup.group = this._vg;
        $('#storage_rename_group_dialog').modal('show');
    },

    rename_logical_volume: function(lv) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        PageRenameVolume.volume = lv;
        $('#storage_rename_volume_dialog').modal('show');
    },

    activate_logical_volume: function(lv) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        lv.call('Activate', function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    deactivate_logical_volume: function(lv) {
        if (!cockpit_check_role ('cockpit-storage-admin', this.client))
            return;

        lv.call('Deactivate', function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    }
};

function PageStorageDetail() {
    this._init();
}

cockpit_pages.push(new PageStorageDetail());

PageCreateRaid.prototype = {
    _init: function() {
        this.id = "create-raid-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Create RAID Array");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-raid-create").on('click', $.proxy(this, "create"));
        $('#create-raid-level').on('change', $.proxy(this, "update"));
    },

    enter: function() {
        this.client = PageCreateRaid.client;
        this.blocks = cockpit_fill_free_devices_list (this.client,
                                                      'create-raid-drives', null);

        $('#create-raid-drives input').on('change', $.proxy(this, "update"));
        this.update();
    },

    update: function() {
        var me = this;
        var n_disks, disk_size, raid_size, level, n_disks_needed;
        var n, b, i;

        var blocks = cockpit_get_selected_devices_objpath ($('#create-raid-drives'), me.blocks);

        n_disks = blocks.length;
        disk_size = Infinity;
        for (i = 0; i < blocks.length; i++) {
            b = this.client.lookup (blocks[i], 'com.redhat.Cockpit.Storage.Block');
            if (b.Size < disk_size)
                disk_size = b.Size;
        }

        switch ($('#create-raid-level').val()) {
        case "raid0":
            n_disks_needed = 2;
            raid_size = disk_size * n_disks;
            break;
        case "raid1":
            n_disks_needed = 2;
            // XXX - disable chunk size
            raid_size = disk_size;
            break;
        case "raid4":
            n_disks_needed = 2; // sic
            raid_size = disk_size * (n_disks-1);
            break;
        case "raid5":
            n_disks_needed = 2; // sic
            raid_size = disk_size * (n_disks-1);
            break;
        case "raid6":
            n_disks_needed = 4;
            raid_size = disk_size * (n_disks-2);
            break;
        case "raid10":
            n_disks_needed = 2;
            // The constants below stems from the fact that the default for
            // RAID-10 creation is "n2", e.g. two near copies.
            var num_far_copies = 1;
            var num_near_copies = 2;
            raid_size  = disk_size / num_far_copies;
            raid_size *= n_disks;
            raid_size /= num_near_copies;
            break;
        default:
            console.log("Unexpected RAID level %s", $('#create-raid-level').val());
            n_disks_needed = 0;
            raid_size = 0;
            break;
        }

        if (n_disks >= n_disks_needed) {
            $("#create-raid-summary-drives").text(F(_("%{n} disks of %{size} each"),
                                                    { n: n_disks,
                                                      size: cockpit_fmt_size (disk_size)
                                                    }));
            $("#create-raid-summary-size").text(cockpit_fmt_size (raid_size));
            $("#create-raid-create").prop('disable', false);
        } else {
            $("#create-raid-summary-drives").text(F(_("%{n} more disks needed"),
                                                    { n: n_disks_needed - n_disks }));
            $("#create-raid-summary-size").text("--");
            $("#create-raid-create").prop('disable', true);
        }
    },

    create: function() {
        var me = this;
        var level = $('#create-raid-level').val();
        var chunk = $('#create-raid-chunk').val();
        var name = $('#create-raid-name').val();
        var blocks = cockpit_get_selected_devices_objpath ($('#create-raid-drives'), me.blocks);

        var manager = this.client.lookup("/com/redhat/Cockpit/Storage/Manager",
                                         "com.redhat.Cockpit.Storage.Manager");
        manager.call ("MDRaidCreate", blocks, level, name, chunk * 1024,
                      function (error) {
                          $('#create-raid-dialog').modal('hide');
                          if (error)
                              cockpit_show_unexpected_error (error);
                      });
    }
};

function PageCreateRaid() {
    this._init();
}

cockpit_pages.push(new PageCreateRaid());

function cockpit_fill_free_devices_list(client, id, filter)
{
    var blocks;
    var element = $('#' + id);

    blocks = cockpit_get_free_block_devices(client, filter);
    blocks.sort(function (a, b) {
        var desc_a = cockpit_block_get_short_desc (a);
        var desc_b = cockpit_block_get_short_desc (b);
        return desc_a.localeCompare(desc_b);
    });

    var list = $('<ul/>', { 'class': 'list-group' });

    for (var n = 0; n < blocks.length; n++) {
        var block = blocks[n];
        var desc = F("%{size} %{desc} %{dev}",
                     { size: cockpit_fmt_size(block.Size),
                       desc: cockpit_block_get_short_desc(block),
                       dev: cockpit_esc(block.Device)
                     });
        var id_n = id + '-' + n;

        list.append(
            $('<li>', { 'class': 'list-group-item' }).append(
                $('<div>', { 'class': 'checkbox',
                             'style': 'margin:0px'
                           }).append(
                    $('<input/>', { type: "checkbox",
                                    name: id_n,
                                    id: id_n,
                                    'data-index': n
                                  }),
                    $('<label/>', { "for": id_n }).text(
                        desc))));
    }

    element.html(list);

    return blocks;
}

function cockpit_get_selected_devices_objpath(element, blocks)
{
    var selected = [ ];
    element.find('input').each(function (i, e) {
        if (e.checked) {
            var n = $(e).attr('data-index');
            selected.push (blocks[n].getObject().objectPath);
        }
    });
    return selected;
}

PageCreateVolumeGroup.prototype = {
    _init: function() {
        this.id = "create-volume-group-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Create Volume Group");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-vg-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
        this.client = PageCreateVolumeGroup.client;
        this.blocks = cockpit_fill_free_devices_list (this.client,
                                                      'create-vg-drives', null);
    },

    create: function() {
        var me = this;
        var name = $('#create-vg-name').val();

        var blocks = cockpit_get_selected_devices_objpath ($('#create-vg-drives'), me.blocks);
        var manager = this.client.lookup("/com/redhat/Cockpit/Storage/Manager",
                                         "com.redhat.Cockpit.Storage.Manager");
        manager.call ("VolumeGroupCreate", name, blocks,
                      function (error) {
                          $('#create-volume-group-dialog').modal('hide');
                          if (error)
                              cockpit_show_unexpected_error (error);
                      });
    }
};

function PageCreateVolumeGroup() {
    this._init();
}

cockpit_pages.push(new PageCreateVolumeGroup());

PageFormatDisk.prototype = {
    _init: function() {
        this.id = "storage_format_disk_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Format Disk");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#format-disk-format").on('click', $.proxy(this, "format"));
    },

    enter: function() {
    },

    format: function() {
        PageFormatDisk.block.call ('Format',
                                   $("#format-disk-type").val(),
                                   $("#format-disk-erase").val(),
                                   "", "", "", "", "", "",
                                   function (error) {
                                       $("#storage_format_disk_dialog").modal('hide');
                                       if (error)
                                           cockpit_show_unexpected_error (error);
                                   });
    }
};

function PageFormatDisk() {
    this._init();
}

cockpit_pages.push(new PageFormatDisk());

PageFormat.prototype = {
    _init: function() {
        this.id = "storage_format_dialog";
    },

    getTitle: function() {
        if (PageFormat.mode == 'create-partition')
            return C_("page-title", "Create Partition");
        else
            return C_("page-title", "Format");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#format-format").on('click', $.proxy(this, "format"));
        $("#format-type").on('change', $.proxy(this, "update"));
        $("#format-custom").on('keyup', $.proxy(this, "update"));
        $("#format-passphrase").on('keyup', $.proxy(this, "update"));
        $("#format-passphrase-2").on('keyup', $.proxy(this, "update"));
    },

    enter: function() {
        $("#format-title").text(this.getTitle());
        $("#format-size-row").toggle(PageFormat.mode == "create-partition");

        if (PageFormat.mode == 'format') {
            $("#format-mount-point").val(PageFormat.block.MountPoint);
            $("#format-mount-options").val(PageFormat.block.MountOptions);
        } else {
            $("#format-mount-point").val("");
            $("#format-mount-options").val("");
        }
        $("#format-crpyto-options").val("");
        $("#format-passphrase").val("");
        $("#format-passphrase-2").val("");
        $("#format-store-passphrase").prop('checked', false);

        this.update();
    },

    update: function() {
        var type = $("#format-type").val();
        var isLuks = (type == "luks+xfs" || type == "luks+ext4");
        $("#format-custom-row").toggle(type == "custom");
        $("#format-passphrase-row, #format-passphrase-row-2, #format-store-passphrase-row, #format-crypto-options-row").toggle(isLuks);
        if ((type == "custom" && !$("#format-custom").val()) ||
            (isLuks &&
             (!$("#format-passphrase").val() ||
              $("#format-passphrase").val() != $("#format-passphrase-2").val()))) {
            $("#format-format").prop('disable', true);
        } else {
            $("#format-format").prop('disable', false);
        }
    },

    format: function() {
        var size = $("#format-size").val();
        if (!size)
            size = PageFormat.size;
        else
            size = size * 1024*1024;
        var type = $("#format-type").val();
        var isLuks = (type == "luks+xfs" || type == "luks+ext4");
        if (type == 'custom')
            type = $("#format-custom").val();
        var erase = $("#format-erase").val();
        var label = $("#format-name").val();
        var passphrase = "";
        var stored_passphrase = "";
        if (isLuks) {
            passphrase = $("#format-passphrase").val();
            if (type == "luks+ext4")
                type = "ext4";
            else if (type == "luks+xfs")
                type = "xfs";
            else
                throw new Error("Unhandled filesystem type " + type);
            if ($("#format-store-passphrase").prop('checked'))
                stored_passphrase = passphrase;
        }
        var mount_point = $("#format-mount-point").val();
        var mount_options = $("#format-mount-options").val();
        var crypto_options = $("#format-crypto-options").val();

        if (PageFormat.mode == 'create-partition')
            PageFormat.block.call('CreatePartition',
                                  PageFormat.start, size,
                                  type, erase, label, passphrase,
                                  mount_point, mount_options,
                                  stored_passphrase, crypto_options,
                                  function (error) {
                                      $("#storage_format_dialog").modal('hide');
                                      if (error)
                                          cockpit_show_unexpected_error (error);
                                  });
        else
            PageFormat.block.call('Format',
                                  type, erase, label, passphrase,
                                  mount_point, mount_options,
                                  stored_passphrase, crypto_options,
                                  function (error) {
                                      $("#storage_format_dialog").modal('hide');
                                      if (error)
                                          cockpit_show_unexpected_error (error);
                                  });
    }
};

function PageFormat() {
    this._init();
}

cockpit_pages.push(new PageFormat());

PageCreatePlainVolume.prototype = {
    _init: function() {
        this.id = "storage_create_plain_volume_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Create Logical Volume");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-pvol-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
    },

    create: function() {
        var size = $("#create-pvol-size").val();
        var name = $("#create-pvol-name").val();
        size = size * 1024*1024;

        PageCreatePlainVolume.volume_group.call('CreatePlainVolume',
                                                name, size,
                                                function (error) {
                                                    $("#storage_create_plain_volume_dialog").modal('hide');
                                                    if (error)
                                                        cockpit_show_unexpected_error (error);
                                                });
    }

};

function PageCreatePlainVolume() {
    this._init();
}

cockpit_pages.push(new PageCreatePlainVolume());

PageCreateThinPool.prototype = {
    _init: function() {
        this.id = "storage_create_thin_pool_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Create Pool for Thin Volumes");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-tpool-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
    },

    create: function() {
        var size = $("#create-tpool-size").val();
        var name = $("#create-tpool-name").val();
        size = size * 1024*1024;

        PageCreateThinPool.volume_group.call('CreateThinPoolVolume',
                                             name, size,
                                             function (error) {
                                                 $("#storage_create_thin_pool_dialog").modal('hide');
                                                 if (error)
                                                     cockpit_show_unexpected_error (error);
                                             });
    }

};

function PageCreateThinPool() {
    this._init();
}

cockpit_pages.push(new PageCreateThinPool());

PageCreateThinVolume.prototype = {
    _init: function() {
        this.id = "storage_create_thin_volume_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Create Thin Logical Volume");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-tvol-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
    },

    create: function() {
        var size = $("#create-tvol-size").val();
        var name = $("#create-tvol-name").val();
        size = size * 1024*1024;

        var vg = PageCreateThinVolume.pool._client.lookup (PageCreateThinVolume.pool.VolumeGroup,
                                                           "com.redhat.Cockpit.Storage.VolumeGroup");

        vg.call('CreateThinVolume',
                name, size,
                PageCreateThinVolume.pool.getObject().objectPath,
                function (error) {
                    $("#storage_create_thin_volume_dialog").modal('hide');
                    if (error)
                        cockpit_show_unexpected_error (error);
                });
    }

};

function PageCreateThinVolume() {
    this._init();
}

cockpit_pages.push(new PageCreateThinVolume());

PageCreateSnapshot.prototype = {
    _init: function() {
        this.id = "storage_create_snapshot_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Create Snapshot");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-svol-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
        $("#create-svol-size-row").toggle(PageCreateSnapshot.origin.ThinPool == "/");
    },

    create: function() {
        var name = $("#create-svol-name").val();
        var size = $("#create-svol-size").val();
        size = size * 1024*1024;

        if (PageCreateSnapshot.origin.ThinPool != "/")
            size = 0;

        PageCreateSnapshot.origin.call('CreateSnapshot',
                                       name, size,
                                       function (error) {
                                           $("#storage_create_snapshot_dialog").modal('hide');
                                           if (error)
                                               cockpit_show_unexpected_error (error);
                                       });
    }

};

function PageCreateSnapshot() {
    this._init();
}

cockpit_pages.push(new PageCreateSnapshot());

PageResizeVolume.prototype = {
    _init: function() {
        this.id = "storage_resize_volume_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Resize Logical Volume");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#resize-lvol-resize").on('click', $.proxy(this, "resize"));
    },

    enter: function() {
        $("#resize-lvol-size").val((PageResizeVolume.volume.Size / (1024*1024)).toFixed(0));
    },

    resize: function() {
        var size = $("#resize-lvol-size").val();
        size = size * 1024*1024;

        PageResizeVolume.volume.call('Resize', size,
                                     function (error) {
                                         $("#storage_resize_volume_dialog").modal('hide');
                                         if (error)
                                             cockpit_show_unexpected_error (error);
                                     });
    }

};

function PageResizeVolume() {
    this._init();
}

cockpit_pages.push(new PageResizeVolume());

PageRenameVolume.prototype = {
    _init: function() {
        this.id = "storage_rename_volume_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Rename Logical Volume");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#rename-lvol-rename").on('click', $.proxy(this, "rename"));
    },

    enter: function() {
        $("#rename-lvol-name").val(PageRenameVolume.volume.Name);
    },

    rename: function() {
        var name = $("#rename-lvol-name").val();

        PageRenameVolume.volume.call('Rename',
                                     name,
                                     function (error) {
                                         $("#storage_rename_volume_dialog").modal('hide');
                                         if (error)
                                             cockpit_show_unexpected_error (error);
                                     });
    }

};

function PageRenameVolume() {
    this._init();
}

cockpit_pages.push(new PageRenameVolume());

PageRenameGroup.prototype = {
    _init: function() {
        this.id = "storage_rename_group_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Rename Volume Group");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#rename-vg-rename").on('click', $.proxy(this, "rename"));
    },

    enter: function() {
        $("#rename-vg-name").val(PageRenameGroup.group.Name);
    },

    rename: function() {
        var name = $("#rename-vg-name").val();

        PageRenameGroup.group.call('Rename',
                                   name,
                                   function (error) {
                                       $("#storage_rename_group_dialog").modal('hide');
                                       cockpit_go_up ();
                                       if (error)
                                           cockpit_show_unexpected_error (error);
                                   });
    }

};

function PageRenameGroup() {
    this._init();
}

cockpit_pages.push(new PageRenameGroup());

PageFilesystemOptions.prototype = {
    _init: function() {
        this.id = "filesystem_options_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Filesystem Options");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#fsysopts-apply").on('click', $.proxy(this, "apply"));
    },

    enter: function() {
        $("#fsysopts-name").val(PageFilesystemOptions.block.IdLabel);
        $("#fsysopts-mount-point").val(PageFilesystemOptions.block.MountPoint);
        $("#fsysopts-mount-options").val(PageFilesystemOptions.block.MountOptions);
    },

    apply:  function() {
        var name = $("#fsysopts-name").val();
        var mount_point = $("#fsysopts-mount-point").val();
        var mount_options = $("#fsysopts-mount-options").val();

        PageFilesystemOptions.block.call('SetFilesystemOptions',
                                         name, mount_point, mount_options,
                                         function (error) {
                                             $("#filesystem_options_dialog").modal('hide');
                                             if (error)
                                                 cockpit_show_unexpected_error (error);
                                         });
    }
};

function PageFilesystemOptions() {
    this._init();
}

cockpit_pages.push(new PageFilesystemOptions());

PageCryptoOptions.prototype = {
    _init: function() {
        this.id = "crypto_options_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Encryption Options");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#crypto-options-apply").on('click', $.proxy(this, "apply"));
    },

    enter: function() {
        $("#crypto-options-passphrase").val("");
        $("#crypto-options-options").val(PageCryptoOptions.block.CryptoOptions);
        PageCryptoOptions.block.call('GetCryptoPassphrase',
                                     function (error, result) {
                                         if (result)
                                             $("#crypto-options-passphrase").val(result);
                                     });
    },

    apply:  function() {
        var passphrase = $("#crypto-options-passphrase").val();
        var options = $("#crypto-options-options").val();

        PageCryptoOptions.block.call('SetCryptoOptions',
                                     passphrase, options,
                                     function (error) {
                                         $("#crypto_options_dialog").modal('hide');
                                         if (error)
                                             cockpit_show_unexpected_error (error);
                                     });
    }
};

function PageCryptoOptions() {
    this._init();
}

cockpit_pages.push(new PageCryptoOptions());

PageUnlock.prototype = {
    _init: function() {
        this.id = "storage_unlock_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Unlock");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#unlock-unlock").on('click', $.proxy(this, "unlock"));
    },

    enter: function() {
        $("#unlock-passphrase").val("");
    },

    unlock:  function() {
        var passphrase = $("#unlock-passphrase").val();

        PageUnlock.block.call('Unlock',
                              passphrase,
                              function (error) {
                                  $("#storage_unlock_dialog").modal('hide');
                                  if (error)
                                      cockpit_show_unexpected_error (error);
                              });
    }
};

function PageUnlock() {
    this._init();
}

cockpit_pages.push(new PageUnlock());

PageRaidDiskAdd.prototype = {
    _init: function() {
        this.id = "raid_disk_add_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Add Disks");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#raid-disk-add-add").on('click', $.proxy(this, "add"));
    },

    enter: function() {
        function is_us(b) {
            var r = b._client.lookup(b.MDRaid,
                                     "com.redhat.Cockpit.Storage.MDRaid");
            return b.MDRaid == PageRaidDiskAdd.mdraid.getObject().objectPath;
        }

        this.blocks = cockpit_fill_free_devices_list (PageRaidDiskAdd.mdraid._client,
                                                      'raid-disk-add-drives', is_us);
        $('#raid-disk-add-drives input').on('change', $.proxy(this, "update"));
        this.update();
    },

    update: function() {
        var n_disks = cockpit_get_selected_devices_objpath ($('#raid-disk-add-drives'), this.blocks).length;
        $("#raid-disk-add-add").prop('disable', n_disks === 0);
    },

    add: function() {
        var me = this;
        var blocks = cockpit_get_selected_devices_objpath ($('#raid-disk-add-drives'), this.blocks);
        PageRaidDiskAdd.mdraid.call('AddDevices', blocks,
                                    function (error) {
                                        $("#raid_disk_add_dialog").modal('hide');
                                        if (error)
                                            cockpit_show_unexpected_error (error);
                                    });
    }
};

function PageRaidDiskAdd() {
    this._init();
}

cockpit_pages.push(new PageRaidDiskAdd());

PageVGDiskAdd.prototype = {
    _init: function() {
        this.id = "vg_disk_add_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Add Disks");
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#vg-disk-add-add").on('click', $.proxy(this, "add"));
    },

    enter: function() {
        function is_ours(b) {
            var lv = b._client.lookup(b.LogicalVolume,
                                      "com.redhat.Cockpit.Storage.LogicalVolume");
            return lv && lv.VolumeGroup == PageVGDiskAdd.volume_group.getObject().objectPath;
        }

        this.blocks = cockpit_fill_free_devices_list (PageVGDiskAdd.volume_group._client,
                                                      'vg-disk-add-drives', is_ours);
        $('#vg-disk-add-drives input').on('change', $.proxy(this, "update"));
        this.update();
    },

    update: function() {
        var n_disks = cockpit_get_selected_devices_objpath ($('#vg-disk-add-drives'), this.blocks).length;
        $("#vg-disk-add-add").prop('disable', n_disks === 0);
    },

    add: function() {
        var me = this;
        var blocks = cockpit_get_selected_devices_objpath ($('#vg-disk-add-drives'), this.blocks);

        function add_them(i) {
            if (i < blocks.length)
                PageVGDiskAdd.volume_group.call('AddDevice', blocks[i],
                                                function (error) {
                                                    if (error) {
                                                        $("#vg_disk_add_dialog").modal('hide');
                                                        cockpit_show_unexpected_error (error);
                                                    } else {
                                                        add_them(i+1);
                                                    }
                                                });
            else
                $("#vg_disk_add_dialog").modal('hide');
        }

        add_them(0);
    }
};

function PageVGDiskAdd() {
    this._init();
}

cockpit_pages.push(new PageVGDiskAdd());
