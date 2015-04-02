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

define([
    "jquery",
    "base1/cockpit",
    "shell/controls",
    "shell/shell",
    "system/server",
    "shell/cockpit-main"
], function($, cockpit, controls, shell, server) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

function fmt_size(bytes)
{
    return cockpit.format_bytes(bytes, 1024);
}

function fmt_size_long(bytes)
{
    var with_unit = cockpit.format_bytes(bytes, 1024);
    /* Translators: Used in "42.5 KB (42399 bytes)" */
    return with_unit + " (" + bytes + " " + C_("format-bytes", "bytes") + ")";
}

function format_temperature(kelvin) {
    var celcius = kelvin - 273.15;
    var fahrenheit = 9.0 * celcius / 5.0 + 32.0;
    return celcius.toFixed(1) + "° C / " + fahrenheit.toFixed(1) + "° F";
}

// Used for escaping things in HTML id attribute values
//
// http://www.w3.org/TR/html5/global-attributes.html#the-id-attribute
function esc_id_attr(str) {
    return shell.esc(str).replace(/ /g, "&#20;").replace(/\x09/g, "&#09;").replace(/\x0a/g, "&#0a;").replace(/\x0c/g, "&#0c;").replace(/\x0d/g, "&#0d;");
}

var _hostnamed = null;
function hostnamed() {
    var client;
    if (!_hostnamed) {
        client = cockpit.dbus("org.freedesktop.hostname1");
        _hostnamed = client.proxy();
    }
    return _hostnamed;
}

var active_targets = [ ];

function job_target_class(target) {
    return 'spinner-' + target.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function prepare_as_target(elt) {
    $(elt).hide();
}

function mark_as_target(elt, target) {
    var i;
    var cl = job_target_class(target);

    elt = $(elt);
    elt.addClass(cl);
    for (i = 0; i < active_targets.length; i++) {
        if (active_targets[i] == cl)
            elt.show();
    }
}

function watch_jobs(client) {
    function update() {
        var objs = client.getObjectsFrom("/com/redhat/Cockpit/Jobs/");
        var job;
        var i, j;

        for (i = 0; i < active_targets.length; i++) {
            $('.' + active_targets[i]).hide();
        }
        active_targets = [ ];

        for (i = 0; i < objs.length; i++) {
            job = objs[i].lookup("com.redhat.Cockpit.Job");
            if (job) {
                for (j = 0; j < job.Targets.length; j++) {
                    var t = job_target_class(job.Targets[j]);
                    active_targets.push(t);
                    $('.' + t).show();
                }
            }
        }
    }

    if (!client._job_watchers) {
        client._job_watchers = 1;
        $(client).on("objectAdded.watch-jobs", update);
        $(client).on("objectRemoved.watch-jobs", update);
        update();
    }
}

function unwatch_jobs(client) {
    client._job_watchers = client._job_watchers - 1;

    if (!client._job_watchers) {
        $(client).off(".watch-jobs");
    }
}

function job_box(client, tbody, domain, descriptions, target_describer) {
    function update() {
        var objs = client.getObjectsFrom("/com/redhat/Cockpit/Jobs/");
        var i, j, t, tdesc;
        var target_desc, desc, progress, remaining, cancel;
        var some_added = false;

        function make_click_handler() {
            return function(event) {
                j.call('Cancel', function (error) {
                    if (error)
                        shell.show_unexpected_error(error);
                });
            };
        }

        tbody.empty();
        for (i = 0; i < objs.length; i++) {
            j = objs[i].lookup("com.redhat.Cockpit.Job");
            if (j && j.Domain == domain) {
                target_desc = "";
                for (t = 0; t < j.Targets.length; t++) {
                    tdesc = target_describer (j.Targets[t]);
                    if (tdesc) {
                        if (target_desc)
                            target_desc += ", ";
                        target_desc += tdesc;
                    }
                }
                desc = cockpit.format(descriptions[j.Operation] || _("Unknown operation on $0"), target_desc);
                if (j.ProgressValid)
                    progress = (j.Progress*100).toFixed() + "%";
                else
                    progress = '';
                if (j.RemainingUSecs)
                    remaining = shell.format_delay(j.RemainingUSecs / 1000);
                else
                    remaining = '';
                if (j.Cancellable) {
                    cancel = $('<button class="btn btn-default">').text(_("Cancel"));
                    cancel.on('click', make_click_handler());
                } else
                    cancel = "";
                tbody.append(
                    $('<tr>').append(
                        $('<td style="width:50%"/>').text(
                            desc),
                        $('<td style="width:15%text-align:right"/>').text(
                            progress),
                        $('<td style="width:15%text-align:right"/>').text(
                            remaining),
                        $('<td style="text-align:right"/>').append(
                            cancel)));
                some_added = true;
            }
        }
        tbody.parents(".panel").toggle(some_added);
    }

    function update_props(event, obj, iface) {
        if (iface._iface_name == "com.redhat.Cockpit.Job")
            update();
    }

    function stop() {
        $(client).off("objectAdded", update);
        $(client).off("objectRemoved", update);
        $(client).off("propertiesChanged", update_props);
    }

    function start() {
        $(client).on("objectAdded", update);
        $(client).on("objectRemoved", update);
        $(client).on("propertiesChanged", update_props);
        update ();
    }

    start();
    return { stop: stop };
}

function get_block_devices_for_drive(drive)
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

function get_block_devices_for_mdraid(mdraid)
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

function find_block_device_for_drive(drive)
{
    var blocks = get_block_devices_for_drive(drive);
    return (blocks.length > 0)? blocks[0] : undefined;
}

function find_block_device_for_mdraid(mdraid)
{
    var blocks = get_block_devices_for_mdraid(mdraid);
    return (blocks.length > 0)? blocks[0] : undefined;
}

function find_logical_volume_block(lv)
{
    var lv_obj = lv.getObject();
    var objs = lv._client.getObjectsFrom("/com/redhat/Cockpit/Storage/block_devices/");
    for (var n = 0; n < objs.length; n++) {
        var obj = objs[n];
        var block = obj.lookup("com.redhat.Cockpit.Storage.Block");
        if (block.LogicalVolume == lv_obj.objectPath)
            return block;
    }
    return null;
}

function mark_as_block_target(elt, block)
{
    mark_as_target(elt, block.getObject().objectPath);
    for (var i = 0; i < block.Partitions.length; i++) {
        var b = block._client.lookup (block.Partitions[i][0],
                                      "com.redhat.Cockpit.Storage.Block");
        if (b)
            mark_as_block_target(elt, b);
    }
    if (block.IdUsage == 'crypto') {
        var cleartext_device = find_cleartext_device(block);
        if (cleartext_device)
            mark_as_block_target(elt, cleartext_device);
    }
}

function storage_job_box(client, elt)
{
    return job_box(client,
                            elt, 'storage',
                            { 'format-mkfs' : _("Creating filesystem on $target"),
                              'format-erase' : _("Erasing $target"),
                              'lvm-vg-empty-device': _("Emptying $target")
                            },
                            function (target) {
                                var block = client.lookup (target,
                                                           "com.redhat.Cockpit.Storage.Block");
                                return block? block.Device : null;
                            });
}

function storage_log_box(elt) {
    var logbox = server.logbox([ "_SYSTEMD_UNIT=udisks2.service", "+",
                                 "_SYSTEMD_UNIT=dm-event.service", "+",
                                 "_SYSTEMD_UNIT=smartd.service", "+",
                                 "COCKPIT_DOMAIN=storage" ], 10);
    elt.empty().append(logbox);
    return logbox;
}

function highlight_error(container) {
    $(container).addClass("has-error");
}

function hide_error(container) {
    $(container).removeClass("has-error");
}

function highlight_error_message(id, message) {
    $(id).text(message);
    $(id).css("visibility", "visible");
}

function hide_error_message(id) {
    $(id).css("visibility", "hidden");
}

function format_fsys_usage(used, total) {
    var text = "";
    var units = 1024;
    var parts = cockpit.format_bytes(total, units, true);
    text = " / " + parts.join(" ");
    units = parts[1];

    parts = cockpit.format_bytes(used, units, true);
    return parts[0] + text;
}

function update_storage_privileged() {
    controls.update_privileged_ui(
        shell.default_permission, ".storage-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to manage storage"),
            cockpit.user.name)
    );
}

$(shell.default_permission).on("changed", update_storage_privileged);


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
            PageCreateRaid.client = self.client;
            $('#create-raid-dialog').modal('show');
        });
        $("#storage_create_volume_group").on('click', function() {
            PageCreateVolumeGroup.client = self.client;
            $('#create-volume-group-dialog').modal('show');
        });
    },

    enter: function() {
        var self = this;

        /* TODO: This code needs to be migrated away from the old dbus */
        this.client = shell.dbus(null);
        watch_jobs(this.client);

        this._drives = $("#storage_drives");
        this._raids = $("#storage_raids");
        this._vgs = $("#storage_vgs");
        this._other_devices = $("#storage_other_devices");
        this._mounts = $("#storage_mounts");

        this._coldplug();

        $(this.client).on("objectAdded.storage", $.proxy(this._onObjectAdded, this));
        $(this.client).on("objectRemoved.storage", $.proxy(this._onObjectRemoved, this));
        $(this.client).on("propertiesChanged.storage", $.proxy(this._onPropertiesChanged, this));

        this.job_box = storage_job_box(this.client, $('#storage-jobs'));

        this.log_box = storage_log_box($('#storage-log'));

        var blues = [ "#006bb4",
                      "#008ff0",
                      "#2daaff",
                      "#69c2ff",
                      "#a5daff",
                      "#e1f3ff",
                      "#00243c",
                      "#004778"
                    ];

        function is_interesting_blockdev(dev) {
            return dev && self.blockdevs[dev];
        }

        function highlight_blockdev_row(event, id) {
            $('#storage tr').removeClass('highlight');
            if (id) {
                $('#storage tr[data-blockdev~="' + shell.esc(id) + '"]').addClass('highlight');
            }
        }

        function render_samples(event, timestamp, samples) {
            // TODO - handle multipath devices
            for (var id in samples) {
                var row = $('#storage tr[data-blockdev="' + shell.esc(id) + '"]');
                if (row.length > 0) {
                    row.find('span.reading').text(
                        "R: " + cockpit.format_bytes_per_sec(samples[id][0]));
                    row.find('span.writing').text(
                        "W: " + cockpit.format_bytes_per_sec(samples[id][1]));
                }
            }
        }

        this.monitor = this.client.get("/com/redhat/Cockpit/BlockdevMonitor",
                                       "com.redhat.Cockpit.MultiResourceMonitor");
        $(this.monitor).on('NewSample.storage', render_samples);

        this.rx_plot = shell.setup_multi_plot('#storage-reading-graph', this.monitor, 0, blues.concat(blues),
                                                is_interesting_blockdev);
        $(this.rx_plot).on('update-total', function (event, total) {
            $('#storage-reading-text').text(cockpit.format_bytes_per_sec(total));
        });
        $(this.rx_plot).on('highlight', highlight_blockdev_row);

        this.tx_plot = shell.setup_multi_plot('#storage-writing-graph', this.monitor, 1, blues.concat(blues),
                                                is_interesting_blockdev);
        $(this.tx_plot).on('update-total', function (event, total) {
            $('#storage-writing-text').text(cockpit.format_bytes_per_sec(total));
        });
        $(this.tx_plot).on('highlight', highlight_blockdev_row);

        function render_mount_samples(event, timestamp, samples) {
            for (var id in samples) {
                var used = samples[id][0];
                var total = samples[id][1];
                var row = self.mount_bar_rows[id];
                if (row) {
                    row.attr("value", used + "/" + total);
                    row.toggleClass("bar-row-danger", used > 0.95 * total);
                }
                var text= self.mount_texts[id];
                if (text)
                    text.text(format_fsys_usage(samples[id][0], samples[id][1]));
            }
        }

        this.mount_monitor = this.client.get("/com/redhat/Cockpit/MountMonitor",
                                             "com.redhat.Cockpit.MultiResourceMonitor");
        $(this.mount_monitor).on('NewSample.storage', render_mount_samples);

        function update_requirements() {
            var manager = self.client.lookup("/com/redhat/Cockpit/Storage/Manager",
                                             "com.redhat.Cockpit.Storage.Manager");

            if (!manager || !manager.HaveUDisks || !manager.HaveStoraged) {
                $('#storage').children().hide();
                $("#storage-not-supported").show();
            }
        }
        if (this.client.state == "ready")
            update_requirements();
        else
            $(this.client).on("state-change", update_requirements);
    },

    show: function() {
        this.rx_plot.start();
        this.tx_plot.start();
    },

    leave: function() {
        this.rx_plot.destroy();
        this.tx_plot.destroy();

        $(this.client).off(".storage");
        $(this.monitor).off(".storage");
        $(this.mount_monitor).off(".storage");
        this.job_box.stop();
        if (this.log_box)
            this.log_box.stop();
        this.log_box = null;
        unwatch_jobs(this.client);
        this.client.release();
        this.client = null;
    },

    _onObjectAdded: function (event, obj) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Storage/") !== 0)
            return;
        this._delayed_coldplug();
    },

    _onObjectRemoved: function (event, obj) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Storage/") !== 0)
            return;
        this._delayed_coldplug();
    },

    _onPropertiesChanged: function (event, obj, iface) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Storage/") !== 0)
            return;
        this._delayed_coldplug();
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
        this._mounts.empty();

        this.blockdevs = { };
        this.mount_bar_rows = { };
        this.mount_texts = { };

        var objs = this.client.getObjectsFrom("/com/redhat/Cockpit/Storage/");
        for (var n = 0; n < objs.length; n++) {
            this._add(objs[n]);
        }

        $(this.monitor).trigger('notify:Consumers');
    },

    _delayed_coldplug: function() {
        var self = this;
        if (!self._coldplug_pending) {
            self._coldplug_pending = true;
            window.setTimeout(function () {
                self._coldplug_pending = false;
                if (self.client)
                    self._coldplug();
            }, 0);
        }
    },

    _monitor_block: function(block) {
        if (!block)
            return "";

        var blockdev = block.Device;
        if (blockdev.indexOf("/dev/") === 0)
            blockdev = blockdev.substr(5);
        this.blockdevs[blockdev] = true;
        return blockdev;
    },

    _add: function(obj) {
        if (obj.lookup("com.redhat.Cockpit.Storage.Drive"))
            this._addDrive(obj);
        else if (obj.lookup("com.redhat.Cockpit.Storage.MDRaid"))
            this._addRaid(obj);
        else if (obj.lookup("com.redhat.Cockpit.Storage.VolumeGroup"))
            this._addVG(obj);
        else if (obj.lookup("com.redhat.Cockpit.Storage.Block")) {
            this._addOtherDevice(obj);
            this._addMount(obj);
        }
    },

    _addDrive: function(obj) {
        var drive = obj.lookup("com.redhat.Cockpit.Storage.Drive");
        var id = esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var sort_key = drive.SortKey;
        var n;

        var blockdev = this._monitor_block(find_block_device_for_drive(drive));

        var size_str = fmt_size(drive.Size);
        var desc;
        if (drive.Classification == "hdd") {
            desc = size_str + " " + C_("storage", "Hard Disk");
        } else if (drive.Classification == "ssd") {
            desc = size_str + " " + C_("storage", "Solid-State Disk");
        } else if (drive.Classification == "removable") {
            if (drive.Size === 0)
                desc = C_("storage", "Removable Drive");
            else
                desc = size_str + " " + C_("storage", "Removable Drive");
        } else if (drive.Classification == "optical") {
            desc = C_("storage", "Optical Drive");
        } else {
            if (drive.Size === 0)
                desc = C_("storage", "Drive");
            else
                desc = size_str + " " + C_("storage", "Drive");
        }

        var tr =
            $('<tr>', { id: "storage-drive-" + id,
                        Sort: sort_key,
                        "data-blockdev": blockdev
                      }).
            click(function () {
                cockpit.location.go("storage-detail", { type: "drive", id: id });
            }).
            append(
                $('<td style="width: 48px">').append(
                    $('<img>', { src: "images/storage-disk.png" })),
                $('<td class="row">').append(
                    $('<span class="col-md-12">').text(drive.Name),
                    $('<br>'),
                    $('<span class="col-md-12 col-lg-5 storage-disk-size">').text(desc),
                    $('<span class="col-md-12 col-lg-7">').append(
                        $('<span class="reading">').text(""),
                        $('<span style="display:inline-block;width:1em">'),
                        $('<span class="writing">').text(""))),
                $('<td style="width:28px">').append(
                    $('<div>', { id: "storage-spinner-" + id,
                                 "class": "spinner"
                               })));

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

        (this._drives[0]).insertBefore(tr[0], insert_before);
        this._drives.closest('.panel').show();

        prepare_as_target($('#storage-spinner-' + id));
        var blocks = get_block_devices_for_drive(drive);
        for (n = 0; n < blocks.length; n++)
            mark_as_block_target($('#storage-spinner-' + id), blocks[n]);
    },

    _addRaid: function(obj) {
        var raid = obj.lookup("com.redhat.Cockpit.Storage.MDRaid");

        var id = esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var desc = raid_get_desc(raid);
        var sort_key = desc;
        var n;

        var tr =
            $('<tr>', { id: "storage-raid-" + id,
                        Sort: sort_key
                      }).
            click(function () {
                cockpit.location.go("storage-detail", { type: "mdraid", id: id });
            }).
            append(
                $('<td class="row">').append(
                    $('<span class="col-xs-3 col-xs-push-9 raid-size">').text(fmt_size(raid.Size)),
                    $('<span class="col-xs-9 col-xs-pull-3">').text(raid_get_desc(raid))),
                $('<td style="width:28px">').append(
                    $('<div>', { id: "storage-spinner-" + id,
                                 "class": "spinner"
                               })));

        // Insert sorted
        var children = this._raids[0].childNodes;
        var insert_before = null;
        var child, child_sort_key;
        for (n = 0; n < children.length; n++) {
            child = children[n];
            child_sort_key = child.getAttribute("sort");
            if (child_sort_key.localeCompare(sort_key) > 0) {
                insert_before = child;
                break;
            }
        }

        (this._raids[0]).insertBefore(tr[0], insert_before);
        this._raids.closest('.panel').show();

        prepare_as_target($('#storage-spinner-' + id));
        var blocks = get_block_devices_for_mdraid(raid);
        for (n = 0; n < blocks.length; n++)
            mark_as_block_target($('#storage-spinner-' + id), blocks[n]);
    },

    _addVG: function(obj) {
        var vg = obj.lookup("com.redhat.Cockpit.Storage.VolumeGroup");

        var id = esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var sort_key = vg.Name;
        var n;

        var tr =
            $('<tr>', { id: "storage-vg-" + id,
                        Sort: sort_key
                      }).
            click(function () {
                cockpit.location.go("storage-detail", { type: "vg", id: id });
            }).
            append(
                $('<td class="row">').append(
                    $('<span class="col-xs-3 col-xs-push-9 vg-size">').text(fmt_size(vg.Size)),
                    $('<span class="col-xs-9 col-xs-pull-3">').text(vg.Name)),
                $('<td style="width:28px">').append(
                    $('<div>', { id: "storage-spinner-" + id,
                                 "class": "spinner"
                               })));

        // Insert sorted
        var children = this._vgs[0].childNodes;
        var insert_before = null;
        var child, child_sort_key;
        for (n = 0; n < children.length; n++) {
            child = children[n];
            child_sort_key = child.getAttribute("sort");
            if (child_sort_key.localeCompare(sort_key) > 0) {
                insert_before = child;
                break;
            }
        }

        (this._vgs[0]).insertBefore(tr[0], insert_before);
        this._vgs.closest('.panel').show();

        prepare_as_target($('#storage-spinner-' + id));
    },

    _addOtherDevice: function(obj) {
        var block = obj.lookup("com.redhat.Cockpit.Storage.Block");

        // Ignore partitions, block devices part of a drive, unlocked
        // cleartext devices, RAIDs, logical volumes, and devices that
        // we are told to ignore.
        if (block.PartitionNumber !== 0 ||
            block.Drive != "/" ||
            block.CryptoBackingDevice != "/" ||
            block.MDRaid != "/" ||
            block.LogicalVolume != "/" ||
            block.HintIgnore)
            return;

        var blockdev = this._monitor_block(block);

        var id = esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var sort_key = block.DeviceNumber;

        var tr =
            $('<tr>', { id: "storage-block-" + id,
                        Sort: sort_key,
                        "data-blockdev": blockdev
                      }).
            click(function () {
                cockpit.location.go("storage-detail", { type: "block", id: id });
            }).
            append(
                $('<td>').append(
                    $('<span>').text(block.Device),
                    $('<br>'),
                    $('<span>').text(fmt_size(block.Size) + " " + C_("storage", "Block Device")),
                    $('<br>'),
                    $('<span class="reading">').text(""),
                    $('<span style="display:inline-block;width:2em">'),
                    $('<span class="writing">').text("")),
                $('<td style="width:28px">').append(
                    $('<div>', { id: "storage-spinner-" + id,
                                 "class": "spinner"
                               })));

        // Insert sorted
        var children = this._other_devices[0].childNodes;
        var insert_before = null;
        var child, child_sort_key;

        for (var n = 0; n < children.length; n++) {
            child = children[n];
            child_sort_key = child.getAttribute("sort");
            if (parseInt(child_sort_key, 10) > sort_key) {
                insert_before = child;
                break;
            }
        }

        (this._other_devices[0]).insertBefore(tr[0], insert_before);
        this._other_devices.closest('.panel').show();

        prepare_as_target($('#storage-spinner-' + id));
        mark_as_block_target($('#storage-spinner-' + id), block);
    },

    _addMount: function(obj) {
        var block = obj.lookup("com.redhat.Cockpit.Storage.Block");

        if (block.IdUsage != "filesystem" || block.HintIgnore)
            return;

        var id = esc_id_attr(obj.objectPath.substr(obj.objectPath.lastIndexOf("/") + 1));
        var sort_key = id; // for now

        var bar_row = null;
        var text = $('<td style="text-align:right">');

        if (block.MountedAt && block.MountedAt.length > 0) {
            bar_row = controls.BarRow();
            for (var i = 0; i < block.MountedAt.length; i++) {
                this.mount_bar_rows[block.MountedAt[i]] = bar_row;
                this.mount_texts[block.MountedAt[i]] = text;
            }
        } else
            text.text(cockpit.format_bytes(block.Size, 1024));

        var tr =
            $('<tr>', { Sort: sort_key }).
            click(function () {
                block_go(block);
            }).
            append(
                $('<td>').text(block.IdLabel || block.Device),
                $('<td>').text(block.MountedAt || "-"),
                $('<td>').append(bar_row),
                text);

        // Insert sorted
        var children = this._mounts[0].childNodes;
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

        (this._mounts[0]).insertBefore(tr[0], insert_before);
    }
};

function PageStorage() {
    this._init();
}

shell.pages.push(new PageStorage());

// ----------------------------------------------------------------------------------------------------

function lvol_get_desc(lv)
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
    return cockpit.format("$type \"$name\"", { type: type, name: shell.esc(lv.Name) });
}

function block_get_desc(block, partition_label, cleartext_device)
{
    var ret, lv;

    if (block.IdUsage == "filesystem") {
        ret = $('<span>').text(
            cockpit.format(C_("storage-id-desc", "$0 File System"), block.IdType));
    } else if (block.IdUsage == "raid") {
        if (block.IdType == "linux_raid_member") {
            ret = $('<span>').text(C_("storage-id-desc", "Linux MD-RAID Component"));
        } else if (block.IdType == "LVM2_member") {
            ret = $('<span>').text(C_("storage-id-desc", "LVM2 Physical Volume"));
        } else {
            ret = $('<span>').text(C_("storage-id-desc", "RAID Member"));
        }
        if (block.PvGroup != "/") {
            var vg = block._client.get(block.PvGroup, "com.redhat.Cockpit.Storage.VolumeGroup");
            ret.append(
                " of ",
                $('<a>').
                    text(vg.Name).
                    click(function () {
                        cockpit.location.go('storage-detail', { type: 'vg', id: vg.Name });
                    }));
        } else if (block.MDRaidMember != "/") {
            var id = block.MDRaidMember.substr(block.MDRaidMember.lastIndexOf("/") + 1);
            var raid = block._client.get(block.MDRaidMember, "com.redhat.Cockpit.Storage.MDRaid");
            ret.append(
                " of ",
                $('<a>').
                    text(raid_get_desc(raid)).
                    click(function () {
                        cockpit.location.go('storage-detail', { type: 'mdraid', id: id });
                    }));
        }

    } else if (block.IdUsage == "crypto") {
        if (block.IdType == "crypto_LUKS") {
            ret = $('<span>').text(C_("storage-id-desc", "LUKS Encrypted"));
        } else {
            ret = $('<span>').text(C_("storage-id-desc", "Encrypted"));
        }
    } else if (block.IdUsage == "other") {
        if (block.IdType == "swap") {
            ret = $('<span>').text(C_("storage-id-desc", "Swap Space"));
        } else {
            ret = $('<span>').text(C_("storage-id-desc", "Other Data"));
        }
    } else {
        ret = $('<span>').text(C_("storage-id-desc", "Unrecognized Data"));
    }

    if (block.PartitionNumber > 0) {
        ret = $('<span>').append(
            cockpit.format(_("$size $partition"), { size: fmt_size(block.Size),
                                                    partition: partition_label }),
            " (", ret, ")");
    }

    if (block.LogicalVolume != "/") {
        lv = block._client.lookup(block.LogicalVolume,
                                  "com.redhat.Cockpit.Storage.LogicalVolume");
        ret = $('<span>').append(
            cockpit.format(_("$size $partition"), { size: fmt_size(block.Size),
                                                    partition: lvol_get_desc(lv) }),
            " (", ret, ")");
    }

    ret.append(
        $('<br/>'),
        shell.esc(block.Device));

    if (block.IdUsage == "filesystem") {
        ret.append(", ");
        if (block.MountedAt.length > 0)
            ret.append(cockpit.format(_("mounted on $0"), shell.esc(block.MountedAt[0])));
        else
            ret.append(_("not mounted"));
    } else if (block.IdUsage == "crypto") {
        ret.append(", ");
        if (cleartext_device)
            ret.append(_("unlocked"));
        else
            ret.append(_("locked"));
    }

    return ret;
}

function block_get_short_desc(block)
{
    if (block.PartitionNumber > 0)
        return "Partition";
    else if (block.LogicalVolume != "/") {
        var lv = block._client.lookup(block.LogicalVolume,
                                      "com.redhat.Cockpit.Storage.LogicalVolume");
        return lvol_get_desc(lv);
    } else if (block.Drive != "/") {
        var drive = block._client.lookup(block.Drive,
                                         "com.redhat.Cockpit.Storage.Drive");
        return drive? shell.esc(drive.Name) : block.Device;
    } else
        return "Block Device";
}

function block_go(block)
{
    var id, lv, vg, path;

    while (true) {
        if (block.PartitionTable && block.PartitionTable != "/")
            block = block._client.get(block.PartitionTable, "com.redhat.Cockpit.Storage.Block");
        else if (block.CryptoBackingDevice && block.CryptoBackingDevice != "/")
            block = block._client.get(block.CryptoBackingDevice, "com.redhat.Cockpit.Storage.Block");
        else
            break;
    }

    if (block.Drive != "/") {
        id = block.Drive.substr(block.Drive.lastIndexOf("/") + 1);
        cockpit.location.go("storage-detail", { type: "drive", id: id });
    } else if (block.MDRaid != "/") {
        id = block.MDRaid.substr(block.MDRaid.lastIndexOf("/") + 1);
        cockpit.location.go("storage-detail", { type: "mdraid", id: id });
    } else if (block.LogicalVolume != "/") {
        lv = block._client.get(block.LogicalVolume,
                               "com.redhat.Cockpit.Storage.LogicalVolume");
        if (lv.VolumeGroup != "/") {
            vg = lv._client.get(lv.VolumeGroup,
                                "com.redhat.Cockpit.Storage.VolumeGroup");
            cockpit.location.go("storage-detail", { type: "vg", id: vg.Name });
        }
    } else {
        path = block.getObject().objectPath;
        id = path.substr(path.lastIndexOf("/") + 1);
        cockpit.location.go("storage-detail", { type: "block", id: id });
    }
}

function block_get_link_desc(block) {
    var is_part = false;
    var is_crypt = false;
    var link = null;

    while (true) {
        if (block.PartitionTable && block.PartitionTable != "/") {
            block = block._client.get(block.PartitionTable, "com.redhat.Cockpit.Storage.Block");
            is_part = true;
        } else if (block.CryptoBackingDevice && block.CryptoBackingDevice != "/") {
            block = block._client.get(block.CryptoBackingDevice, "com.redhat.Cockpit.Storage.Block");
            is_crypt = true;
        } else
            break;
    }

    if (block.Drive != "/") {
        var drive = block._client.get(block.Drive,
                                         "com.redhat.Cockpit.Storage.Drive");
        link = $('<a>').
            text(drive.Name || block.Device).
            click(function () {
                var id = block.Drive.substr(block.Drive.lastIndexOf("/") + 1);
                cockpit.location.go("storage-detail", { type: "drive", id: id });
            });
    } else if (block.MDRaid != "/") {
        var raid = block._client.get(block.MDRaid,
                                     "com.redhat.Cockpit.Storage.MDRaid");
        link = $('<span>').append(
            _("RAID Device"),
            " ",
            $('<a>').
                text(raid_get_desc(raid)).
                click(function () {
                    var id = block.MDRaid.substr(block.MDRaid.lastIndexOf("/") + 1);
                    cockpit.location.go("storage-detail", { type: "mdraid", id: id });
                }));
    } else if (block.LogicalVolume != "/") {
        var lv = block._client.get(block.LogicalVolume,
                                   "com.redhat.Cockpit.Storage.LogicalVolume");
        if (lv.VolumeGroup != "/") {
            var vg = lv._client.get(lv.VolumeGroup,
                                    "com.redhat.Cockpit.Storage.VolumeGroup");
            link = $('<span>').append(
                lvol_get_desc(lv),
                " of ",
                $('<a>').
                    text(vg.Name).
                    click(function () {
                        cockpit.location.go("storage-detail", { type: "vg", id: vg.Name });
                    }));
        } else {
            link = $('<span>').text(lvol_get_desc(lv));
        }
    } else {
        link = $('<a>').
            text(block.Device).
            click(function () {
                var path = block.getObject().objectPath;
                var id = path.substr(path.lastIndexOf("/") + 1);
                cockpit.location.go("storage-detail", { type: "block", id: id });
            });
    }

    var res = link;

    if (is_part)
        res = $('<span>').append(_("Partition of "), res);
    if (is_crypt)
        res = $('<span>').append(res, _(", encrypted"));
    return res;

}

function find_cleartext_device(block)
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

function raid_get_desc(raid)
{
    if (!raid.Name)
        return "";

    var parts = raid.Name.split(":");

    if (parts.length != 2)
        return raid.Name;

    if (parts[0] == hostnamed().StaticHostname)
        return parts[1];
    else
        return cockpit.format(_("$name (from $host)"),
                 { name: parts[1],
                   host: parts[0]
                 });
}

function get_free_block_devices(client, filter)
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

        if (b && !b.HintIgnore && b.Size > 0 && !has_fs_label(b) && !b.PartitionTableType && !is_extended_partition(b) &&
            !(filter && filter(b)))
            result.push(b);
    }
    return result;
}

PageStorageDetail.prototype = {
    _init: function() {
        this.id = "storage-detail";
        this.section_id = "storage";
        this.watched_objects = [ ];
    },

    getTitle: function() {
        return C_("page-title", "Storage");
    },

    get_page_title: function() {
        var ret;
        if (this._drive) {
            if (this._drive.Vendor && this._drive.Vendor.length > 0)
                ret = this._drive.Vendor + " " + this._drive.Model;
            else
                ret = this._drive.Model;
        } else if (this._mdraid) {
            ret = raid_get_desc(this._mdraid);
        } else if (this._vg) {
            ret = this._vg.Name;
        } else
            ret = this._block.Device;
        return ret || "?";
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
        if (this.log_box)
            this.log_box.stop();
        this.log_box = null;
        this.stop_vg_polling();
        unwatch_jobs(this.client);
        $(this.client).off(".storage-details");
        this.client.release();
        this.client = null;
    },

    setup: function() {
        var self = this;

        self.raid_action_btn =
            shell.action_btn(function (op) { self.action(op); },
                                [ { title: _("Start"),           action: 'start' },
                                  { title: _("Stop"),            action: 'stop' },
                                  { title: _("Format"),          action: 'format' },
                                  { title: _("Start Scrubbing"), action: 'start-scrub' },
                                  { title: _("Stop Scrubbing"),  action: 'stop-scrub' },
                                  { title: _("Delete"),          action: 'delete' }
                                ]);
        $('#raid_action_btn').html(self.raid_action_btn, "storage-privileged");
        $('#raid-disks-add').on('click', $.proxy(this, "raid_disk_add"));

        function change_bitmap(val) {
            self._mdraid.call("SetBitmapLocation", val? "internal" : "none", function (error, result) {
                if (error) {
                    self._update();
                    shell.show_unexpected_error(error);
                }
            });
        }

        this.bitmap_onoff = controls.OnOff(false,
                                          change_bitmap,
                                          undefined,
                                          null, "storage-privileged");

        $("#raid_detail_bitmap").append(this.bitmap_onoff);

        $("#drive_format").on('click', function () {
            self.action('format');
        });

        var btn = shell.action_btn(function (op) { self.volume_group_action(op); },
                                      [ { title: _("Rename"), action: 'rename',
                                          is_default: true },
                                        { title: _("Delete"), action: 'delete' }
                                      ], "storage-privileged");
        $('#vg_action_btn').html(btn);
        $("#vg-pv-add").on('click', $.proxy(this, "add_physical_volume"));

        $("#block_format").on('click', function () {
            self.action('format');
        });
    },

    enter: function() {
        var me = this;
        var type = shell.get_page_param("type");
        var id = shell.get_page_param("id");

        /* TODO: This code needs to be migrated away from old dbus */
        this.client = shell.dbus(null);
        watch_jobs(this.client);

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

        this.job_box = storage_job_box(this.client, $('#storage-detail-jobs'));
        this.log_box = storage_log_box($('#storage-detail-log'));

        this._update();

        $("#storage-detail-title").text(this.get_page_title());

        $(this.client).on("objectAdded.storage-details", $.proxy(this._update, this));
        $(this.client).on("objectRemoved.storage-details", $.proxy(this._update, this));
        $(this.client).on("propertiesChanged.storage-details", $.proxy(this._onPropertiesChanged, this));
        update_storage_privileged();
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

        $('#storage-detail .breadcrumb .active').text(this.get_page_title());
    },

    _updateBlock: function() {
        var val;

        var block = this._block;
        this.watch_object(block);
        this._updateContent(block);

        val = shell.esc(block.Device);
        $("#block_detail_device").html(val);
        val = block.Size > 0 ? fmt_size_long(block.Size) : C_("storage", "No Media Inserted");
        $("#block_detail_capacity").html(val);
        update_storage_privileged();
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
                [ { title: _("Delete"),             action: "delete" }
                ];

            var is_filesystem         = (target.IdUsage == 'filesystem');
            var is_filesystem_mounted = (target.MountedAt && target.MountedAt.length !== 0);
            var is_crypto             = (target.IdUsage == 'crypto');
            var is_lvol               = (target._iface_name == "com.redhat.Cockpit.Storage.LogicalVolume" ||
                                         target.LogicalVolume != "/");
            var is_lvol_pool          = (target.Type == "pool");
            var is_lvol_active        = (target._iface_name == "com.redhat.Cockpit.Storage.Block" ||
                                         target.Active);
            var is_formattable        = (target._iface_name == "com.redhat.Cockpit.Storage.Block" &&
                                         !target.ReadOnly);

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
                btn = shell.action_btn(function (op) { me.block_action (target, op); },
                                         action_spec, "storage-privileged");
                shell.action_btn_select(btn, default_op);

                shell.action_btn_enable(btn, 'mount',              !is_filesystem_mounted);
                shell.action_btn_enable(btn, 'unmount',            is_filesystem_mounted);
                shell.action_btn_enable(btn, 'lock',               !is_crypto_locked);
                shell.action_btn_enable(btn, 'unlock',             is_crypto_locked);
                shell.action_btn_enable(btn, 'activate',           !is_lvol_active);
                shell.action_btn_enable(btn, 'deactivate',         is_lvol_active);
            }

            return btn;
        }

        function create_simple_btn (title, func) {
            return $('<button>', { 'class': 'btn btn-default storage-privileged',
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
                tr.append($('<td>', { 'style': 'float:right' }).append(button));
            tr.append(
                $('<td>', { 'style': 'float:right' }).append(
                    $('<div>', { 'id': 'entry-spinner-' +id,
                                 'class': 'spinner'
                               })));
            list.append(
                $('<li>', { 'class': 'list-group-item' }).append(
                    $('<table>', { 'style': 'width:100%'
                                 }).append(tr)));

            prepare_as_target('#entry-spinner-' + id);
            return id;
        }

        function append_non_partitioned_block (level, block, part_desc) {
            var id, name, desc, btn;
            var cleartext_device;

            if (block.IdUsage == 'crypto')
                cleartext_device = find_cleartext_device(block);

            btn = create_block_action_btn (block, !cleartext_device, !!part_desc);

            if (block.IdLabel.length > 0)
                name = shell.esc(block.IdLabel);
            else if (!btn)
                name = null;
            else
                name = "—";
            desc = block_get_desc(block, part_desc, cleartext_device);

            id = append_entry (level, name, desc, btn);

            mark_as_target('#entry-spinner-' + id, block.getObject().objectPath);

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
                var enable_dos_extended = false;
                if (start + size - real_start >= 1024*1024) {
                    if (is_dos_partitioned) {
                        if (level > device_level) {
                            desc = cockpit.format(_("$0 Free Space for Logical Partitions"),
                                                  fmt_size(size));
                        } else {
                            desc = cockpit.format(_("$0 Free Space for Primary Partitions"),
                                                  fmt_size(size));
                            enable_dos_extended = true;
                        }
                    } else {
                        desc = cockpit.format(_("$0 Free Space"), fmt_size(size));
                    }

                    append_entry (level, null, desc,
                                  create_simple_btn (_("Create Partition"),
                                                     $.proxy(me, "create_partition", block, start, size,
                                                             enable_dos_extended)));
                }
            }

            function append_extended_partition (level, block, start, size) {
                var desc = cockpit.format(_("$0 Extended Partition"), fmt_size(size));
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
                    desc = cockpit.format(_("$size $desc"),
                             { desc: lvol_get_desc(lv),
                               size: fmt_size(block.Size) });
                    desc += "<br/>" + shell.esc(block.Device);
                    btn = create_block_action_btn (block, false, false);
                    id = append_entry (level, null, desc, btn);
                    append_partitions (level+1, block);
                } else
                    append_non_partitioned_block (level, block, null);
            }

            function append_logical_volume (level, lv) {
                var block, desc, btn, id, ratio;
                var lv_obj, objs, i, llv;

                if (lv.Type == "pool") {
                    ratio = Math.max(lv.DataAllocatedRatio, lv.MetadataAllocatedRatio);
                    desc = cockpit.format(_("$size $desc<br/>${percent}% full"),
                             { size: fmt_size(lv.Size),
                               desc: lvol_get_desc(lv),
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

                        desc = cockpit.format(_("$size $desc<br/>($state)"),
                                 { size: fmt_size(lv.Size),
                                   desc: lvol_get_desc(lv),
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
                desc = cockpit.format(_("$0 Free Space for Logical Volumes"), fmt_size(vg.FreeSize));
                var btn = shell.action_btn(function (op) { me.volume_group_action (op); },
                                              [ { title: _("Create Plain Logical Volume"),
                                                  action: 'create-plain', is_default: true
                                                },
                                                { title: _("Create RAID Logical Volume"),
                                                  action: 'create-raid'
                                                },
                                                { title: _("Create Pool for Thin Logical Volumes"),
                                                  action: 'create-thin-pool'
                                                }
                                              ], "storage-privileged");
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
        var blocks = get_block_devices_for_drive(drive);
        var block = (blocks.length > 0)? blocks[0] : undefined;

        this.watch_object (drive);
        this.watch_object (block);
        this._updateContent(block);

        if (drive.Vendor && drive.Vendor.length > 0)
            val = shell.esc(drive.Vendor) + " " + shell.esc(drive.Model);
        else
            val = shell.esc(drive.Model);
        $("#disk_detail_model").html(val);
        val = drive.Revision ? shell.esc(drive.Revision) : "—";
        $("#disk_detail_firmware_version").html(val);
        val = drive.Serial ? shell.esc(drive.Serial) : "—";
        $("#disk_detail_serial_number").html(val);
        val = drive.WWN ? shell.esc(drive.WWN) : "—";
        $("#disk_detail_world_wide_name").html(val);
        val = drive.Size > 0 ? fmt_size_long(drive.Size) : C_("disk-drive", "No Media Inserted");
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
            val += " (" + format_temperature(drive.Temperature) + ")";
        }
        $("#disk_detail_assessment").html(val);

        val = "";
        for (var n = 0; n < blocks.length; n++) {
            var b = blocks[n];
            if (n > 0) {
                val += " ";
            }
            val += shell.esc(b.Device);
        }
        $("#disk_detail_device_file").html(val);

        if (drive.Classification === "optical")
            $('#drive_format').hide();
        else
            $('#drive_format').show();
        update_storage_privileged();
    },

    _updateMDRaid: function() {
        function format_level(str) {
            return { "raid0": _("RAID 0"),
                     "raid1": _("RAID 1"),
                     "raid4": _("RAID 4"),
                     "raid5": _("RAID 5"),
                     "raid6": _("RAID 6"),
                     "raid10": _("RAID 10")
                   }[str] || cockpit.format(_("RAID ($level)"), str);
        }

        var raid = this._mdraid;
        var block = find_block_device_for_mdraid(raid);

        this.watch_object (raid);
        this.watch_object (block);
        this._updateContent (block);

        if (block)
            $("#raid_detail_device").html(shell.esc(block.Device));
        else
            $("#raid_detail_device").html("--");

        var val = raid.Size > 0 ? fmt_size_long(raid.Size) : "--";
        $("#raid_detail_capacity").html(val);
        $("#raid_detail_name").text(raid_get_desc(raid));
        $("#raid_detail_uuid").html(shell.esc(raid.UUID));

        var level = format_level(raid.Level);
        if (raid.NumDevices > 0)
            level += ", " + cockpit.format(_("$0 Disks"), raid.NumDevices);
        if (raid.ChunkSize > 0)
            level += ", " + cockpit.format(_("%0 Chunk Size"), fmt_size(raid.ChunkSize));
        $("#raid_detail_level").html(shell.esc(level));

        var state, action_state = "", is_running;
        var action, percent, rate, remaining;
        var degraded = null;

        var loc = raid.BitmapLocation;
        if (loc) {
            this.bitmap_onoff.set(loc != "none");
            $("#raid_detail_bitmap_row").show();
        } else {
            $("#raid_detail_bitmap_row").hide();
        }

        is_running = !!block;

        if (raid.Degraded > 0) {
            degraded = ('<span style="color:red">' + _("ARRAY IS DEGRADED") + '</span> -- ' +
                        cockpit.format(_("%0 disks are missing"), raid.Degraded));
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
                if (raid.SyncRate > 0) {
                    action_state = cockpit.format(_("$action, ${percent}% complete at $rate"),
                                    { action: action, percent: percent,
                                      rate: fmt_size(raid.SyncRate) + "/s" });
                } else {
                    action_state = cockpit.format(_("$action, ${percent}% complete"),
                                    { action: action, percent: percent });
                }
                state = state + "<br/>" + action_state;
                if (raid.SyncRemainingTime > 0) {
                    remaining = cockpit.format(_("$0 remaining"),
                                               shell.format_delay(raid.SyncRemainingTime / 1000));
                    state = state + "<br/>" + remaining;
                }
            }
        }
        $("#raid_detail_state").html(state);

        shell.action_btn_select(this.raid_action_btn, is_running? 'stop' : 'start');
        shell.action_btn_enable(this.raid_action_btn, 'stop', is_running);
        shell.action_btn_enable(this.raid_action_btn, 'start', !is_running);

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
                return cockpit.format(_("Unknown ($0)"), state);
        }

        $('#raid-disks-add').css('visibility', raid.Level === "raid0" ? 'hidden' : 'visible');

        var disks = $("#raid-disks");
        var info = this._mdraid.ActiveDevices || [];
        var i, j, slot, drive, states, state_html, num_errors;

        disks.empty();
        for (i = 0; i < info.length; i++) {
            slot = info[i][1];
            block = this.client.lookup (info[i][0], "com.redhat.Cockpit.Storage.Block");
            states = info[i][2];
            num_errors = info[i][3];

            if (!block)
                continue;

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
                               cockpit.format(_("$0 Read Errors"), num_errors) +
                               '</span>');
            }

            disks.append(
                $('<li class="list-group-item">').append(
                    $('<table style="width:100%">').append(
                        $('<tr>').append(
                            $('<td style="width:20px;text-align:center">').text((slot < 0)? "--" : slot),
                            $('<td>').append(
                                block_get_link_desc(block)),
                            $('<td style="width:100px;text-align:right">').html(state_html),
                            $('<td style="text-align:right">').append(
                                $('<button>', { 'class': 'btn btn-default storage-privileged',
                                                'on': { 'click': $.proxy(this, "raid_disk_remove", block) }
                                              }).text(_("Remove")).css('visibility', raid.Level === "raid0" ? 'hidden' : 'visible'))))));
        }
        update_storage_privileged();
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

        val = vg.Size > 0 ? fmt_size_long(vg.Size) : "--";
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
            return a.DeviceNumber - b.DeviceNumber;
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

            pvs_list.append(
                $('<li class="list-group-item">').append(
                    $('<table style="width:100%">').append(
                        $('<tr>').append(
                            $('<td>').append(block_get_link_desc(block),
                                             $('<br>'),
                                             cockpit.format(_("$size, $free free"),
                                               { size: fmt_size(block.PvSize),
                                                 free: fmt_size(block.PvFreeSize)
                                               })),
                            $('<td style="text-align:right">').html(
                                shell.action_btn(physical_action_func (block),
                                                   physical_action_spec, "storage-privileged"))))));
        }

        this._updateContent (vg);
        update_storage_privileged();
    },

    action: function(op) {
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
        this.action(this.raid_op);
    },

    start: function() {
        this._mdraid.call("Start", function (error, result) {
            if (error)
                shell.show_unexpected_error(error);
        });
    },

    stop: function() {
        this._mdraid.call("Stop", function (error, result) {
            if (error)
                shell.show_unexpected_error(error);
        });
    },

    delete_raid: function() {
        var self = this;
        var location = cockpit.location;

        shell.confirm(cockpit.format(_("Please confirm deletion of $0"), raid_get_desc(this._mdraid)),
                        _("Deleting a RAID Device will erase all data on it."),
                        _("Delete")).
            done(function () {
                self._mdraid.call("Delete", function (error, result) {
                    if (error)
                        shell.show_unexpected_error(error);
                    else
                        location.go("storage");
                });
            });
    },

    start_scrub: function() {
        this._mdraid.call("RequestSyncAction", "repair", function (error, result) {
            if (error)
                shell.show_unexpected_error(error);
        });
    },

    stop_scrub: function() {
        this._mdraid.call("RequestSyncAction", "idle", function (error, result) {
            if (error)
                shell.show_unexpected_error(error);
        });
    },

    format_disk: function (block) {
        PageFormatDisk.block = null;
        if (this._drive)
            PageFormatDisk.block = find_block_device_for_drive(this._drive);
        else if (this._mdraid)
            PageFormatDisk.block = find_block_device_for_mdraid(this._mdraid);
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
        shell.confirm(cockpit.format(_("Please confirm deletion of $0"), block.Device),
                        _("Deleting a partition will delete all data in it."),
                        _("Delete")).
            done(function () {
                block.call('DeletePartition',
                           function (error) {
                               if (error)
                                   shell.show_unexpected_error(error);
                           });
            });
    },

    create_partition: function (block, start, size, enable_dos_extended) {
        PageFormat.block = block;
        PageFormat.mode = 'create-partition';
        PageFormat.start = start;
        PageFormat.size = size;
        PageFormat.enable_dos_extended = enable_dos_extended;
        $('#storage_format_dialog').modal('show');
    },

    mount: function(block) {
        block.call('Mount',
                   function (error) {
                       if (error)
                           shell.show_unexpected_error(error);
                   });
    },

    unmount: function(block) {
        block.call('Unmount',
                   function (error) {
                       if (error)
                           shell.show_unexpected_error(error);
                   });
    },

    lock: function(block) {
        block.call('Lock',
                   function (error) {
                       if (error)
                           shell.show_unexpected_error(error);
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
        this._mdraid.call('RemoveDevices', [ block.getObject().objectPath ],
                          function (error) {
                              if (error)
                                  shell.show_unexpected_error(error);
                          });
    },

    raid_disk_add: function() {
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
        var self = this;
        var location = cockpit.location;

        shell.confirm(cockpit.format(_("Please confirm deletion of $0"), self._vg.Name),
                        _("Deleting a volume group will erase all data on it."),
                        _("Delete")).
            done(function() {
                self._vg.call("Delete", function (error, result) {
                    if (error)
                        shell.show_unexpected_error(error);
                    else
                        location.go("storage");
                });
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
        if (block.PvFreeSize != block.PvSize) {
            shell.show_error_dialog("Error", "Volume is in use.");
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
            shell.show_error_dialog("Error", "Can't remove the last physical volume.");
            return;
        }

        this._vg.call('RemoveDevice', block.getObject().objectPath,
                      function (error) {
                          if (error)
                              shell.show_unexpected_error (error);
                      });
    },

    empty_physical_volume: function(block) {
        var used = block.PvSize - block.PvFreeSize;
        if (used === 0) {
            shell.show_error_dialog("Dude", "Volume is already empty.");
            return;
        }

        if (used > this._vg.FreeSize) {
            shell.show_error_dialog("Error", "Not enough free space.");
            return;
        }

        this._vg.call('EmptyDevice', block.getObject().objectPath,
                      function (error) {
                          if (error)
                              shell.show_unexpected_error(error);
                      });
    },

    add_physical_volume: function() {
        PageVGDiskAdd.volume_group = this._vg;
        $('#vg_disk_add_dialog').modal('show');
    },

    create_plain_volume: function (volume_group) {
        PageCreatePlainVolume.volume_group = volume_group;
        $('#storage_create_plain_volume_dialog').modal('show');
    },

    create_thin_pool: function (volume_group) {
        PageCreateThinPool.volume_group = volume_group;
        $('#storage_create_thin_pool_dialog').modal('show');
    },

    create_thin_volume: function (pool) {
        PageCreateThinVolume.pool = pool;
        $('#storage_create_thin_volume_dialog').modal('show');
    },

    create_raid_volume: function (volume_group) {
        shell.show_error_dialog("Sorry", "Not yet.");
    },

    create_snapshot: function (origin) {
        if (origin.Origin != "/") {
            shell.show_error_dialog("Error", "Can't take a snapshot of a snapshot.");
            return;
        }

        PageCreateSnapshot.origin = origin;
        $('#storage_create_snapshot_dialog').modal('show');
    },

    delete_logical_volume: function(lv) {
        var self = this;
        shell.confirm(cockpit.format(_("Please confirm deletion of $0"), self._vg.Name + "/" + lv.Name),
                        _("Deleting a logical volume will erase all data in it."),
                        _("Delete")).
            done(function () {
                lv.call('Delete', function (error, result) {
                    if (error)
                        shell.show_unexpected_error(error);
                });
            });
    },

    resize_logical_volume: function(lv) {
        PageResizeVolume.volume = lv;
        $('#storage_resize_volume_dialog').modal('show');
    },

    rename_volume_group: function() {
        PageRenameGroup.group = this._vg;
        $('#storage_rename_group_dialog').modal('show');
    },

    rename_logical_volume: function(lv) {
        PageRenameVolume.volume = lv;
        $('#storage_rename_volume_dialog').modal('show');
    },

    activate_logical_volume: function(lv) {
        lv.call('Activate', function (error, result) {
            if (error)
                shell.show_unexpected_error(error);
        });
    },

    deactivate_logical_volume: function(lv) {
        lv.call('Deactivate', function (error, result) {
            if (error)
                shell.show_unexpected_error(error);
        });
    }
};

function PageStorageDetail() {
    this._init();
}

shell.pages.push(new PageStorageDetail());

PageCreateRaid.prototype = {
    _init: function() {
        this.id = "create-raid-dialog";
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
        this.blocks = fill_free_devices_list(this.client, 'create-raid-drives', null);

        $('#create-raid-drives input').on('change', $.proxy(this, "update"));
        $('#create-raid-name').val("");
        $('#create-raid-level').selectpicker("val", "raid5");
        $('#create-raid-chunk').selectpicker("val", "512");
        $('#accounts-create-locked').prop('checked', false);
        this.update();
    },

    update: function() {
        var me = this;
        var n_disks, disk_size, raid_size, level, n_disks_needed;
        var n, b, i;

        var blocks = get_selected_devices_objpath($('#create-raid-drives'), me.blocks);

        n_disks = blocks.length;
        disk_size = Infinity;
        for (i = 0; i < blocks.length; i++) {
            b = this.client.lookup (blocks[i], 'com.redhat.Cockpit.Storage.Block');
            if (b.Size < disk_size)
                disk_size = b.Size;
        }

        $('#create-raid-chunk').parents('tr').toggle($('#create-raid-level').val() !== "raid1");

        switch ($('#create-raid-level').val()) {
        case "raid0":
            n_disks_needed = 2;
            raid_size = disk_size * n_disks;
            break;
        case "raid1":
            n_disks_needed = 2;
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
            $("#create-raid-summary-drives").text(cockpit.format(_("$n disks of $size each"),
                                                    { n: n_disks,
                                                      size: fmt_size(disk_size)
                                                    }));
            $("#create-raid-summary-size").text(fmt_size(raid_size));
            $("#create-raid-create").prop('disabled', false);
        } else {
            $("#create-raid-summary-drives").text(cockpit.format(_("$0 more disks needed"),
                                                                 n_disks_needed - n_disks));
            $("#create-raid-summary-size").text("--");
            $("#create-raid-create").prop('disabled', true);
        }
    },

    create: function() {
        var me = this;
        var level = $('#create-raid-level').val();
        var chunk = level === "raid1" ? 0 : $('#create-raid-chunk').val();
        var name = $('#create-raid-name').val();
        var blocks = get_selected_devices_objpath($('#create-raid-drives'), me.blocks);

        var manager = this.client.lookup("/com/redhat/Cockpit/Storage/Manager",
                                         "com.redhat.Cockpit.Storage.Manager");
        manager.call ("MDRaidCreate", blocks, level, name, chunk * 1024,
                      function (error) {
                          $('#create-raid-dialog').modal('hide');
                          if (error)
                              shell.show_unexpected_error(error);
                      });
    }
};

function PageCreateRaid() {
    this._init();
}

shell.dialogs.push(new PageCreateRaid());

function fill_free_devices_list(client, id, filter)
{
    var blocks;
    var element = $('#' + id);

    blocks = get_free_block_devices(client, filter);
    blocks.sort(function (a, b) {
        return a.DeviceNumber - b.DeviceNumber;
    });

    var list = $('<ul/>', { 'class': 'list-group available-disks-group' });

    for (var n = 0; n < blocks.length; n++) {
        var block = blocks[n];
        var desc = cockpit.format("$size $desc $dev",
                     { size: fmt_size(block.Size),
                       desc: block_get_short_desc(block),
                       dev: block.Device
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

function get_selected_devices_objpath(element, blocks)
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

    show: function() {
        if (this.blocks.length > 0) {
            $('#create-vg-name').prop('disabled', false);
            $('#create-vg-name').focus();
        } else {
            $('#create-vg-name').prop('disabled', true);
        }
    },

    leave: function() {
    },

    setup: function() {
        $("#create-vg-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
        var disk_count = -1;

        this.client = PageCreateVolumeGroup.client;
        this.blocks = fill_free_devices_list(this.client, 'create-vg-drives', null);
        $("#disks-not-found .close").on('click', function() { $('#disks-not-found').hide(); });
        $('#create-vg-name').on('input', change_disk_count);
        $('#create-vg-name').on('input change focus', check_vg_condition);
        $('#create-vg-drives [type = "checkbox"]').on('change', change_checkbox_count);
        $('#create-vg-drives [type = "checkbox"]').on('click change', check_vg_condition);
        $('#create-vg-name').val("");
        $('#create-vg-create').prop('disabled', true);
        $('#create-vg-drives').prop('checked', false);
        control_warning(this.blocks);

        function check_vg_condition() {
            hide_error_message('#create-vg-error');

            if (check_vg_input()) {
                if (check_checked_box()) {
                    $('#create-vg-create').prop('disabled', false);
                    hide_error_message('#create-vg-error');
                } else {
                    if (disk_count === -1)
                        return;

                    $('#create-vg-create').prop('disabled', true);
                    highlight_error_message('#create-vg-error',
                                            _("At least one disk needed."));
                }
            } else {
                $('#create-vg-create').prop('disabled', true);
            }
        }

        function change_disk_count() {
            if (disk_count === 0)
                disk_count = -1;
        }

        function check_vg_input() {

            function check_input(input, exclusive_pattern) {
                var match_array = input.match(exclusive_pattern);

                if (match_array) {
                    var last_subarray = match_array[match_array.length - 1];

                    return last_subarray[last_subarray.length - 1];
                } else {
                    return null;
                }
            }

            var addr = $('#create-vg-name').val();

            if (addr === "") {
                hide_error('#creat-vg-name-cell');
                hide_error_message('#create-vg-error');
                return false;
            } else if (addr.length > 127) {
                highlight_error('#creat-vg-name-cell');
                highlight_error_message('#create-vg-error',
                                        _("Name length cannot exceed 127 characters."));
                return false;
            } else {
                var pattern = new RegExp("[^a-zA-Z0-9+._-]+", "g");
                var match = check_input(addr, pattern);

                if (!match) {
                    hide_error('#creat-vg-name-cell');
                    hide_error_message('#create-vg-error');
                    return true;
                } else {
                    highlight_error('#creat-vg-name-cell');

                    if (match.search(/\s+/) === -1)
                        highlight_error_message('#create-vg-error',
                                                _("Name cannot contain '" + match + "'."));
                    else
                        highlight_error_message('#create-vg-error',
                                                _("Name cannot contain whitespace."));
                    return false;
                }
            }
        }

        function count_checked_box(selector) {
            var group = $(selector);
            var count = 0;

            for (var i = 0; i < group.length; i++) {
                if (group[i].checked)
                    count++;
            }
            return count;
        }

        function change_checkbox_count() {
            disk_count = count_checked_box();
        }

        function check_checked_box() {
            var count = count_checked_box('#create-vg-drives [type = "checkbox"]');

            if (count > 0)
                return true;
            else
                return false;
        }

        function control_warning(blocks) {
            if (blocks.length > 0) {
                $("#disks-not-found span.alert-message").text("");
                $("#disks-not-found").hide();
            } else {
                $("#disks-not-found span.alert-message").text(_("No available disks"));
                $("#disks-not-found").show();
            }
        }
    },

    create: function() {
        var me = this;
        var name = $('#create-vg-name').val();

        if (name.trim() === "") {
            highlight_error('#creat-vg-name-cell');
            highlight_error_message('#create-vg-error',
                                    _("Name cannot contain whitespace."));
            return;
        }

        var blocks = get_selected_devices_objpath($('#create-vg-drives'), me.blocks);
        var manager = me.client.lookup("/com/redhat/Cockpit/Storage/Manager",
                                       "com.redhat.Cockpit.Storage.Manager");
        manager.call ("VolumeGroupCreate", name, blocks,
                      function (error) {
                          $('#create-volume-group-dialog').modal('hide');
                          if (error)
                              shell.show_unexpected_error(error);
                      });
    }
};

function PageCreateVolumeGroup() {
    this._init();
}

shell.dialogs.push(new PageCreateVolumeGroup());

PageFormatDisk.prototype = {
    _init: function() {
        this.id = "storage_format_disk_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#format-disk-format").on('click', $.proxy(this, "format"));
    },

    enter: function() {
        $("#format-disk-title").text(cockpit.format(_("Format Disk $0"), PageFormatDisk.block.Device));
        $("#format-disk-type").selectpicker('val', "gpt");
        $("#format-disk-erase").selectpicker('val', "no");
    },

    format: function() {
        PageFormatDisk.block.call ('Format',
                                   $("#format-disk-type").val(),
                                   $("#format-disk-erase").val(),
                                   "", "", "", "", "", "",
                                   function (error) {
                                       $("#storage_format_disk_dialog").modal('hide');
                                       if (error)
                                           shell.show_unexpected_error(error);
                                   });
    }
};

function PageFormatDisk() {
    this._init();
}

shell.dialogs.push(new PageFormatDisk());

PageFormat.prototype = {
    _init: function() {
        this.id = "storage_format_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#format-format").on('click', $.proxy(this, "format"));
        $("#format-type").on('change', $.proxy(this, "update"));
        $("#format-custom").on('keyup change', $.proxy(this, "update"));
        $("#format-passphrase").on('keyup change', $.proxy(this, "update"));
        $("#format-passphrase-2").on('keyup change', $.proxy(this, "update"));
        $("#format-mounting").on('change', $.proxy(this, "update"));
        $("#format-mount-point").on('keyup change', $.proxy(this, "update"));
    },

    enter: function() {
        $("#format-size-row").toggle(PageFormat.mode == "create-partition");

        function enable_dos_extended(flag) {
            $('#format-type option[value="dos-extended"]').toggle(flag);
            $('#format-type').selectpicker('refresh');
        }

        if (PageFormat.mode == 'format') {
            $("#format-title").text(cockpit.format(_("Format $0"), PageFormat.block.Device));
            $("#format-warning").text(_("Formatting a storage device will erase all data on it."));
            $("#format-format").text(_("Format"));
            $("#format-format").addClass("btn-danger").removeClass("btn-primary");
            $("#format-mounting").selectpicker('val', PageFormat.block.MountPoint? "custom" : "default");
            $("#format-mount-point").val(PageFormat.block.MountPoint);
            $("#format-mount-options").val(PageFormat.block.MountOptions);
            enable_dos_extended(false);
        } else {
            $("#format-title").text(cockpit.format(_("Create Partition on $0"), PageFormat.block.Device));
            $("#format-warning").text("");
            $("#format-format").text(_("Create partition"));
            $("#format-format").addClass("btn-primary").removeClass("btn-danger");
            $("#format-mounting").selectpicker('val', "default");
            $("#format-mount-point").val("");
            $("#format-mount-options").val("");
            enable_dos_extended(PageFormat.enable_dos_extended);
        }
        $("#format-size").val("");
        $("#format-erase").selectpicker('val', "no");
        $("#format-type").selectpicker('val', "xfs");
        $("#format-name").val("");
        $("#format-custom").val("");
        $("#format-crpyto-options").val("");
        $("#format-passphrase").val("");
        $("#format-passphrase-2").val("");
        $("#format-store-passphrase").prop('checked', false);

        this.update();
    },

    update: function() {
        var type = $("#format-type").val();
        var isFS = (type != "empty" && type != "dos-extended");
        var isLuks = (type == "luks+xfs" || type == "luks+ext4");
        var isDefaultMount = !isFS || $("#format-mounting").val() == "default";

        $("#format-custom-row").toggle(type == "custom");
        $("#format-name-row").toggle(isFS);
        $("#format-passphrase-row, #format-passphrase-row-2, #format-store-passphrase-row, #format-crypto-options-row").toggle(isLuks);
        $("#format-mounting-row").toggle(isFS);
        $("#format-mount-point-row, #format-mount-options-row").toggle(!isDefaultMount);
        if ((type == "custom" && !$("#format-custom").val()) ||
            (isLuks &&
             (!$("#format-passphrase").val() ||
              $("#format-passphrase").val() != $("#format-passphrase-2").val())) ||
            (!isDefaultMount &&
             !$("#format-mount-point").val())) {
            $("#format-format").prop('disabled', true);
        } else {
            $("#format-format").prop('disabled', false);
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
        var isFS = (type != "empty" && type != "dos-extended");
        var isDefaultMount = !isFS || $("#format-mounting").val() == "default";
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
        var mount_point = "";
        var mount_options = "";
        if (!isDefaultMount) {
            mount_point = $("#format-mount-point").val();
            mount_options = $("#format-mount-options").val();
        }
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
                                          shell.show_unexpected_error(error);
                                  });
        else
            PageFormat.block.call('Format',
                                  type, erase, label, passphrase,
                                  mount_point, mount_options,
                                  stored_passphrase, crypto_options,
                                  function (error) {
                                      $("#storage_format_dialog").modal('hide');
                                      if (error)
                                          shell.show_unexpected_error(error);
                                  });
    }
};

function PageFormat() {
    this._init();
}

shell.dialogs.push(new PageFormat());

PageCreatePlainVolume.prototype = {
    _init: function() {
        this.id = "storage_create_plain_volume_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-pvol-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
        $("#create-pvol-name").val("");
        $("#create-pvol-size").val("");
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
                                                        shell.show_unexpected_error(error);
                                                });
    }

};

function PageCreatePlainVolume() {
    this._init();
}

shell.dialogs.push(new PageCreatePlainVolume());

PageCreateThinPool.prototype = {
    _init: function() {
        this.id = "storage_create_thin_pool_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-tpool-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
        $("#create-tpool-name").val("");
        $("#create-tpool-size").val("");
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
                                                     shell.show_unexpected_error(error);
                                             });
    }

};

function PageCreateThinPool() {
    this._init();
}

shell.dialogs.push(new PageCreateThinPool());

PageCreateThinVolume.prototype = {
    _init: function() {
        this.id = "storage_create_thin_volume_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-tvol-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
        $("#create-tvol-name").val("");
        $("#create-tvol-size").val("");
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
                        shell.show_unexpected_error(error);
                });
    }

};

function PageCreateThinVolume() {
    this._init();
}

shell.dialogs.push(new PageCreateThinVolume());

PageCreateSnapshot.prototype = {
    _init: function() {
        this.id = "storage_create_snapshot_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#create-svol-create").on('click', $.proxy(this, "create"));
    },

    enter: function() {
        $("#create-svol-name").val("");
        $("#create-svol-size").val("");
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
                                               shell.show_unexpected_error(error);
                                       });
    }

};

function PageCreateSnapshot() {
    this._init();
}

shell.dialogs.push(new PageCreateSnapshot());

PageResizeVolume.prototype = {
    _init: function() {
        this.id = "storage_resize_volume_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#resize-lvol-resize").on('click', $.proxy(this, "resize"));
    },

    enter: function() {
        var block = find_logical_volume_block(PageResizeVolume.volume);
        $("#resize-lvol-size").val((PageResizeVolume.volume.Size / (1024*1024)).toFixed(0));
        $("#resize-lvol-resize-fsys").prop('checked', block && block.IdUsage == "filesystem");
        $("#resize-lvol-resize-fsys").parents('tr').toggle(PageResizeVolume.volume.Type == "block");
    },

    resize: function() {
        var size = $("#resize-lvol-size").val();
        var resize_fsys = $("#resize-lvol-resize-fsys").prop('checked');

        size = size * 1024*1024;

        PageResizeVolume.volume.call('Resize', size, { 'resize_fsys': resize_fsys },
                                     function (error) {
                                         $("#storage_resize_volume_dialog").modal('hide');
                                         if (error)
                                             shell.show_unexpected_error(error);
                                     });
    }

};

function PageResizeVolume() {
    this._init();
}

shell.dialogs.push(new PageResizeVolume());

PageRenameVolume.prototype = {
    _init: function() {
        this.id = "storage_rename_volume_dialog";
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
                                             shell.show_unexpected_error(error);
                                     });
    }

};

function PageRenameVolume() {
    this._init();
}

shell.dialogs.push(new PageRenameVolume());

PageRenameGroup.prototype = {
    _init: function() {
        this.id = "storage_rename_group_dialog";
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
                                       if (error)
                                           shell.show_unexpected_error(error);
                                       else
                                           cockpit.location.go("storage-detail", { type: "vg", id: name });
                                   });
    }

};

function PageRenameGroup() {
    this._init();
}

shell.dialogs.push(new PageRenameGroup());

PageFilesystemOptions.prototype = {
    _init: function() {
        this.id = "filesystem_options_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#fsysopts-apply").on('click', $.proxy(this, "apply"));
        $("#fsysopts-mounting").on('change', $.proxy(this, "update"));
        $("#fsysopts-mount-point").on('change keyup', $.proxy(this, "update"));
    },

    enter: function() {
        $("#fsysopts-name").val(PageFilesystemOptions.block.IdLabel);
        $("#fsysopts-mounting").selectpicker('val', PageFilesystemOptions.block.MountPoint? "custom" : "default");
        $("#fsysopts-mount-point").val(PageFilesystemOptions.block.MountPoint);
        $("#fsysopts-mount-options").val(PageFilesystemOptions.block.MountOptions);
        this.update();
    },

    update: function() {
        var isDefaultMount = $("#fsysopts-mounting").val() == "default";
        $("#fsysopts-mount-point-row, #fsysopts-mount-options-row").toggle(!isDefaultMount);
        $("#fsysopts-apply").prop('disabled', !isDefaultMount && !$("#fsysopts-mount-point").val());
    },

    apply:  function() {
        var name = $("#fsysopts-name").val();
        var isDefaultMount = $("#fsysopts-mounting").val() == "default";
        var mount_point = "";
        var mount_options = "";
        if (!isDefaultMount) {
            mount_point = $("#fsysopts-mount-point").val();
            mount_options = $("#fsysopts-mount-options").val();
        }

        PageFilesystemOptions.block.call('SetFilesystemOptions',
                                         name, mount_point, mount_options,
                                         function (error) {
                                             $("#filesystem_options_dialog").modal('hide');
                                             if (error)
                                                 shell.show_unexpected_error(error);
                                         });
    }
};

function PageFilesystemOptions() {
    this._init();
}

shell.dialogs.push(new PageFilesystemOptions());

PageCryptoOptions.prototype = {
    _init: function() {
        this.id = "crypto_options_dialog";
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
                                             shell.show_unexpected_error(error);
                                     });
    }
};

function PageCryptoOptions() {
    this._init();
}

shell.dialogs.push(new PageCryptoOptions());

PageUnlock.prototype = {
    _init: function() {
        this.id = "storage_unlock_dialog";
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
                                      shell.unexpected_error(error);
                              });
    }
};

function PageUnlock() {
    this._init();
}

shell.dialogs.push(new PageUnlock());

PageRaidDiskAdd.prototype = {
    _init: function() {
        this.id = "raid_disk_add_dialog";
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

        this.blocks = fill_free_devices_list(PageRaidDiskAdd.mdraid._client,
                                             'raid-disk-add-drives', is_us);
        $('#raid-disk-add-drives input').on('change', $.proxy(this, "update"));
        this.update();
    },

    update: function() {
        var n_disks = get_selected_devices_objpath($('#raid-disk-add-drives'), this.blocks).length;
        $("#raid-disk-add-add").prop('disabled', n_disks === 0);
    },

    add: function() {
        var me = this;
        var blocks = get_selected_devices_objpath($('#raid-disk-add-drives'), this.blocks);
        PageRaidDiskAdd.mdraid.call('AddDevices', blocks,
                                    function (error) {
                                        $("#raid_disk_add_dialog").modal('hide');
                                        if (error)
                                            shell.show_unexpected_error(error);
                                    });
    }
};

function PageRaidDiskAdd() {
    this._init();
}

shell.dialogs.push(new PageRaidDiskAdd());

PageVGDiskAdd.prototype = {
    _init: function() {
        this.id = "vg_disk_add_dialog";
    },

    show: function() {
    },

    leave: function() {
    },

    setup: function() {
        $("#vg-disk-add-add").on('click', $.proxy(this, "add"));
        $("#vg-disks-not-found .close").on('click', function() { $('#vg-disks-not-found').toggleClass('hide', true); });
    },

    enter: function() {
        function is_ours(b) {
            var lv = b._client.lookup(b.LogicalVolume,
                                      "com.redhat.Cockpit.Storage.LogicalVolume");
            return lv && lv.VolumeGroup == PageVGDiskAdd.volume_group.getObject().objectPath;
        }

        this.blocks = fill_free_devices_list(PageVGDiskAdd.volume_group._client,
                                             'vg-disk-add-drives', is_ours);
        var show = this.blocks.length > 0;
        var msg = show ? "" : _("No available disks");
        $("#vg-disks-not-found span.alert-message").text(msg);
        $("#vg-disks-not-found").toggleClass('hide', show);

        $('#vg-disk-add-drives input').on('change', $.proxy(this, "update"));
        this.update();
    },

    update: function() {
        var n_disks = get_selected_devices_objpath($('#vg-disk-add-drives'), this.blocks).length;
        $("#vg-disk-add-add").prop('disabled', n_disks === 0);
    },

    add: function() {
        var me = this;
        var blocks = get_selected_devices_objpath($('#vg-disk-add-drives'), this.blocks);

        function add_them(i) {
            if (i < blocks.length)
                PageVGDiskAdd.volume_group.call('AddDevice', blocks[i],
                                                function (error) {
                                                    if (error) {
                                                        $("#vg_disk_add_dialog").modal('hide');
                                                        shell.show_unexpected_error(error);
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

shell.dialogs.push(new PageVGDiskAdd());

});
