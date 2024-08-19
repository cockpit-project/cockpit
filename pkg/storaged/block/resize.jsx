/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import React from "react";
import cockpit from "cockpit";
import client from "../client.js";

import {
    block_name, get_active_usage, teardown_active_usage,
    undo_temporary_teardown, is_mounted_synch, get_partitions
} from "../utils.js";
import {
    existing_passphrase_fields, init_existing_passphrase,
    request_passphrase_on_error_handler
} from "../crypto/keyslots.jsx";
import {
    dialog_open, SizeSlider, BlockingMessage, TeardownMessage, SelectSpaces,
    init_teardown_usage
} from "../dialog.jsx";
import { std_reply } from "../stratis/utils.jsx";
import { pvs_to_spaces } from "../lvm2/utils.jsx";

const _ = cockpit.gettext;

export function check_unused_space(path) {
    const block = client.blocks[path];
    const lvm2 = client.blocks_lvm2[path];
    const lvol = lvm2 && client.lvols[lvm2.LogicalVolume];
    const part = client.blocks_part[path];

    let size, min_change;

    if (lvol) {
        size = lvol.Size;
        min_change = client.vgroups[lvol.VolumeGroup].ExtentSize;
    } else if (part) {
        size = part.Size;
        min_change = 1024 * 1024;
    } else {
        return null;
    }

    if (size != block.Size) {
        // Let's ignore inconsistent lvol,part/block combinations.
        // These happen during a resize and the inconsistency will
        // eventually go away.
        return null;
    }

    let content_path = null;
    let crypto_overhead = 0;

    const crypto = client.blocks_crypto[block.path];
    const cleartext = client.blocks_cleartext[block.path];
    if (crypto) {
        if (crypto.MetadataSize !== undefined && cleartext) {
            content_path = cleartext.path;
            crypto_overhead = crypto.MetadataSize;
        }
    } else {
        content_path = path;
    }

    const fsys = client.blocks_fsys[content_path];
    const content_block = client.blocks[content_path];
    const vdo = content_block ? client.legacy_vdo_overlay.find_by_backing_block(content_block) : null;
    const stratis_bdev = client.blocks_stratis_blockdev[content_path];

    if (fsys && fsys.Size && (size - fsys.Size - crypto_overhead) > min_change && fsys.Resize) {
        return {
            volume_size: size - crypto_overhead,
            content_size: fsys.Size
        };
    }

    if (vdo && (size - vdo.physical_size - crypto_overhead) > min_change) {
        return {
            volume_size: size - crypto_overhead,
            content_size: vdo.physical_size
        };
    }

    if (stratis_bdev && (size - Number(stratis_bdev.TotalPhysicalSize) - crypto_overhead) > min_change) {
        return {
            volume_size: size - crypto_overhead,
            content_size: Number(stratis_bdev.TotalPhysicalSize)
        };
    }

    return null;
}

function lvol_or_part_and_fsys_resize(client, lvol_or_part, size, offline, passphrase, pvs) {
    let fsys;
    let crypto_overhead;
    let vdo;
    let stratis_bdev;
    let orig_size;
    let block;

    if (lvol_or_part.iface == "org.freedesktop.UDisks2.LogicalVolume") {
        orig_size = lvol_or_part.Size;
        block = client.lvols_block[lvol_or_part.path];
        if (!block)
            return lvol_or_part.Resize(size, { });
    } else {
        orig_size = lvol_or_part.Size;
        block = client.blocks[lvol_or_part.path];
    }

    const crypto = client.blocks_crypto[block.path];
    if (crypto) {
        const cleartext = client.blocks_cleartext[block.path];
        if (!cleartext)
            return;
        fsys = client.blocks_fsys[cleartext.path];
        vdo = client.legacy_vdo_overlay.find_by_backing_block(cleartext);
        stratis_bdev = client.blocks_stratis_blockdev[cleartext.path];
        crypto_overhead = crypto.MetadataSize;
    } else {
        fsys = client.blocks_fsys[block.path];
        vdo = client.legacy_vdo_overlay.find_by_backing_block(block);
        stratis_bdev = client.blocks_stratis_blockdev[block.path];
        crypto_overhead = 0;
    }

    function fsys_resize() {
        if (fsys) {
            // When growing a filesystem, always grow it to fill its
            // block device. This is always the right thing to do in
            // Cockpit.
            //
            const resize_size = (size > orig_size) ? 0 : size - crypto_overhead;

            // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1934567
            //
            // block_fsys.MountedAt might be out of synch with reality
            // here if resizing the crypto card accidentally
            // triggered an unmount.  Thus, we check synchronously
            // whether or not we should be doing a offline resize or
            // not.
            //
            // Another option for us would be to just mount the
            // filesystem back if that's what we expect, to undo the
            // bug mentioned above. But let's be a bit more passive
            // here and hope the bug gets fixed eventually.
            return (is_mounted_synch(client.blocks[fsys.path])
                    .then(is_mounted => {
                        // When doing an offline resize, we need to first repair the filesystem.
                        if (!is_mounted) {
                            return (fsys.Repair({ })
                                    .then(() => fsys.Resize(resize_size, { })));
                        } else {
                            return fsys.Resize(resize_size, { });
                        }
                    }));
        } else if (vdo) {
            if (size - crypto_overhead > vdo.physical_size)
                return vdo.grow_physical();
            else if (size - crypto_overhead < vdo.physical_size)
                return Promise.reject(_("VDO backing devices can not be made smaller"));
            else
                return Promise.resolve();
        } else if (stratis_bdev) {
            const delta = size - crypto_overhead - Number(stratis_bdev.TotalPhysicalSize);
            if (delta > 0) {
                const pool = client.stratis_pools[stratis_bdev.Pool];
                return pool.GrowPhysicalDevice(stratis_bdev.Uuid).then(std_reply);
            } else if (delta < 0)
                // This shouldn't happen. But if it does, continuing is harmful, so we throw an error.
                return Promise.reject(_("Stratis blockdevs can not be made smaller")); // not-covered: safety check
            else
                return Promise.resolve();
        } else if (client.blocks_available[block.path]) {
            // Growing or shrinking unformatted data, nothing to do
            return Promise.resolve();
        } else if (size < orig_size) {
            // This shouldn't happen. But if it does, continuing is harmful, so we throw an error.
            return Promise.reject(_("Unrecognized data can not be made smaller here.")); // not-covered: safety check
        } else {
            // Growing unrecognized content, nothing to do.
            return Promise.resolve();
        }
    }

    function crypto_resize() {
        // When growing a LUKS device, always grow it to fill its
        // block device. This is always the right thing to do in
        // Cockpit.
        //
        const resize_size = (size > orig_size) ? 0 : size - crypto_overhead;

        if (crypto) {
            const opts = { };
            if (passphrase)
                opts.passphrase = { t: "s", v: passphrase };
            return crypto.Resize(resize_size, opts);
        } else {
            return Promise.resolve();
        }
    }

    function lvol_or_part_resize() {
        if (size != orig_size) {
            // Both LogicalVolume and Partition have a Resize method
            // with the same signature, so this will work on both.
            return lvol_or_part.Resize(size, { pvs: pvs ? { t: 'ao', v: pvs } : undefined });
        } else
            return Promise.resolve();
    }

    if (size < orig_size) {
        return fsys_resize().then(crypto_resize)
                .then(lvol_or_part_resize);
    } else if (size >= orig_size) {
        return lvol_or_part_resize().then(crypto_resize)
                .then(fsys_resize);
    }
}

export function get_resize_info(client, block, to_fit) {
    let info, shrink_excuse, grow_excuse;

    if (block) {
        if (block.IdUsage == 'crypto' && client.blocks_crypto[block.path]) {
            const cleartext = client.blocks_cleartext[block.path];

            if (!cleartext) {
                info = { };
                shrink_excuse = grow_excuse = _("Unlock before resizing");
            } else {
                return get_resize_info(client, cleartext, to_fit);
            }
        } else if (block.IdUsage == 'filesystem') {
            info = client.fsys_info && client.fsys_info[block.IdType];

            if (!info) {
                info = { };
                shrink_excuse = grow_excuse = cockpit.format(_("$0 can not be resized here"),
                                                             block.IdType);
            } else {
                if (!info.can_shrink && !info.can_grow) {
                    shrink_excuse = grow_excuse = cockpit.format(_("$0 can not be resized"),
                                                                 block.IdType);
                } else {
                    if (!info.can_shrink)
                        shrink_excuse = cockpit.format(_("$0 can not be made smaller"),
                                                       block.IdType);
                    if (!info.can_grow)
                        grow_excuse = cockpit.format(_("$0 can not be made larger"),
                                                     block.IdType);
                }
            }
        } else if (client.blocks_stratis_blockdev[block.path]) {
            info = {
                can_shrink: false,
                can_grow: true,
                grow_needs_unmount: false
            };
            shrink_excuse = _("Stratis blockdevs can not be made smaller");
        } else if (block.IdUsage == 'raid') {
            info = { };
            shrink_excuse = grow_excuse = _("Physical volumes can not be resized here");
        } else if (client.legacy_vdo_overlay.find_by_backing_block(block)) {
            info = {
                can_shrink: false,
                can_grow: true,
                grow_needs_unmount: false
            };
            shrink_excuse = _("VDO backing devices can not be made smaller");
        } else if (client.blocks_swap[block.path]) {
            info = {
                can_shrink: false,
                can_grow: false,
            };
            shrink_excuse = grow_excuse = _("Swap can not be resized here");
        } else if (client.blocks_available[block.path]) {
            info = {
                can_shrink: true,
                can_grow: true,
                shrink_needs_unmount: false,
                grow_needs_unmount: false,
            };
        } else {
            info = {
                can_shrink: false,
                can_grow: true,
                grow_needs_unmount: true
            };
            shrink_excuse = _("Unrecognized data can not be made smaller here");
        }
        if (to_fit) {
            // Shrink to fit doesn't need to resize the content
            shrink_excuse = null;
        }
    } else {
        info = { };
        shrink_excuse = grow_excuse = _("Activate before resizing");
    }

    return { info, shrink_excuse, grow_excuse };
}

export function free_space_after_part(client, part) {
    const parts = get_partitions(client, client.blocks[part.Table]);

    function find_it(parts) {
        for (const p of parts) {
            if (p.type == "free" && p.start == part.Offset + part.Size)
                return p.size;
            if (p.type == "container") {
                const s = find_it(p.partitions);
                if (s)
                    return s;
            }
        }
        return false;
    }

    return find_it(parts) || 0;
}

export function grow_dialog(client, lvol_or_part, info, to_fit) {
    let title, block, name, orig_size, max_size, allow_infinite, round_size;
    let has_subvols, subvols, pvs_as_spaces, initial_pvs;

    function compute_max_size(spaces) {
        const layout = lvol_or_part.Layout;
        const pvs = spaces.map(s => s.pvol);
        const n_pvs = pvs.length;
        const sum = pvs.reduce((sum, pv) => sum + pv.FreeSize, 0);
        const min = Math.min.apply(null, pvs.map(pv => pv.FreeSize));

        if (!has_subvols) {
            return sum;
        } else if (layout == "raid0") {
            return n_pvs * min;
        } else if (layout == "raid1") {
            return min;
        } else if (layout == "raid10") {
            return (n_pvs / 2) * min;
        } else if ((layout == "raid4" || layout == "raid5")) {
            return (n_pvs - 1) * min;
        } else if (layout == "raid6") {
            return (n_pvs - 2) * min;
        } else
            return 0; // not-covered: internal error
    }

    if (lvol_or_part.iface == "org.freedesktop.UDisks2.LogicalVolume") {
        const vgroup = client.vgroups[lvol_or_part.VolumeGroup];
        const pool = client.lvols[lvol_or_part.ThinPool];

        pvs_as_spaces = pvs_to_spaces(client, client.vgroups_pvols[vgroup.path].filter(pvol => pvol.FreeSize > 0));
        subvols = client.lvols_stripe_summary[lvol_or_part.path];
        has_subvols = subvols && (lvol_or_part.Layout == "mirror" || lvol_or_part.Layout.indexOf("raid") == 0);

        if (!has_subvols)
            initial_pvs = pvs_as_spaces;
        else {
            initial_pvs = [];

            // Step 1: Find the spaces that are already used for a
            // subvolume.  If a subvolume uses more than one, prefer the
            // one with more available space.
            for (const sv of subvols) {
                let sel = null;
                for (const p in sv) {
                    for (const spc of pvs_as_spaces)
                        if (spc.block.path == p && (!sel || sel.size < spc.size))
                            sel = spc;
                }
                if (sel)
                    initial_pvs.push(sel);
            }

            // Step 2: Select missing one randomly.
            for (const pv of pvs_as_spaces) {
                if (initial_pvs.indexOf(pv) == -1 && initial_pvs.length < subvols.length)
                    initial_pvs.push(pv);
            }
        }

        title = _("Grow logical volume");
        block = client.lvols_block[lvol_or_part.path];
        name = lvol_or_part.Name;
        orig_size = lvol_or_part.Size;
        max_size = pool ? pool.Size * 3 : lvol_or_part.Size + compute_max_size(initial_pvs);
        allow_infinite = !!pool;
        round_size = vgroup.ExtentSize;
    } else {
        has_subvols = false;
        title = _("Grow partition");
        block = client.blocks[lvol_or_part.path];
        name = block_name(block);
        orig_size = lvol_or_part.Size;
        max_size = lvol_or_part.Size + free_space_after_part(client, lvol_or_part);
        allow_infinite = false;
        round_size = 1024 * 1024;
    }

    const usage = get_active_usage(client,
                                   block && info.grow_needs_unmount ? block.path : null,
                                   _("grow"), null,
                                   true);

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    let grow_size;
    const size_fields = [];
    if (!to_fit) {
        if ((has_subvols || lvol_or_part.Layout == "linear") && pvs_as_spaces.length > 1)
            size_fields.push(
                SelectSpaces("pvs", _("Physical Volumes"),
                             {
                                 spaces: pvs_as_spaces,
                                 value: initial_pvs,
                                 min_selected: subvols.length,
                                 validate: val => {
                                     if (has_subvols && subvols.length != val.length)
                                         return cockpit.format(_("Exactly $0 physical volumes must be selected"),
                                                               subvols.length);
                                 }
                             }));
        size_fields.push(
            SizeSlider("size", _("Size"),
                       {
                           value: orig_size,
                           min: orig_size,
                           max: max_size,
                           allow_infinite,
                           round: round_size,
                       }));
    } else {
        grow_size = block.Size;
    }

    let recovered_passphrase;
    let passphrase_fields = [];
    if (block && block.IdType == "crypto_LUKS" && block.IdVersion == 2)
        passphrase_fields = existing_passphrase_fields(_("Resizing an encrypted filesystem requires unlocking the disk. Please provide a current disk passphrase."));

    function prepare_pvs(pvs) {
        if (!pvs)
            return pvs;

        pvs = pvs.map(spc => spc.block.path);

        if (!has_subvols)
            return pvs;

        const subvol_pvs = [];

        // Step 1: Find PVs that are already used by a subvolume
        subvols.forEach((sv, idx) => {
            subvol_pvs[idx] = null;
            for (const pv in sv) {
                if (pvs.indexOf(pv) >= 0 && subvol_pvs.indexOf(pv) == -1) {
                    subvol_pvs[idx] = pv;
                    break;
                }
            }
        });

        // Step 2: Use the rest for the leftover subvolumes
        subvols.forEach((sv, idx) => {
            if (!subvol_pvs[idx]) {
                for (const pv of pvs) {
                    if (subvol_pvs.indexOf(pv) == -1) {
                        subvol_pvs[idx] = pv;
                        break;
                    }
                }
            }
        });

        return subvol_pvs;
    }

    if (!usage.Teardown && size_fields.length + passphrase_fields.length === 0) {
        return lvol_or_part_and_fsys_resize(client, lvol_or_part, grow_size, info.grow_needs_unmount,
                                            null, prepare_pvs(initial_pvs));
    }

    const dlg = dialog_open({
        Title: title,
        Teardown: TeardownMessage(usage),
        Body: has_subvols && <div><p>{cockpit.format(_("Exactly $0 physical volumes need to be selected, one for each stripe of the logical volume."), subvols.length)}</p><br /></div>,
        Fields: size_fields.concat(passphrase_fields),
        update: (dlg, vals, trigger) => {
            if (vals.pvs) {
                const max = lvol_or_part.Size + compute_max_size(vals.pvs);
                if (vals.size > max)
                    dlg.set_values({ size: max });
                dlg.set_options("size", { max });
            }
        },
        Action: {
            Title: _("Grow"),
            disable_on_error: usage.Teardown,
            action: function (vals) {
                return teardown_active_usage(client, usage)
                        .then(function () {
                            return (lvol_or_part_and_fsys_resize(client, lvol_or_part,
                                                                 to_fit ? grow_size : vals.size,
                                                                 info.grow_needs_unmount,
                                                                 vals.passphrase || recovered_passphrase,
                                                                 prepare_pvs(vals.pvs))
                                    .then(() => undo_temporary_teardown(client, usage))
                                    .catch(request_passphrase_on_error_handler(dlg, vals, recovered_passphrase, block)));
                        });
            }
        },
        Inits: [
            init_teardown_usage(client, usage),
            passphrase_fields.length
                ? init_existing_passphrase(block, false, pp => { recovered_passphrase = pp })
                : null
        ]
    });
}

export function shrink_dialog(client, lvol_or_part, info, to_fit) {
    let title, block, name, orig_size, round_size;

    if (lvol_or_part.iface == "org.freedesktop.UDisks2.LogicalVolume") {
        const vgroup = client.vgroups[lvol_or_part.VolumeGroup];

        title = _("Shrink logical volume");
        block = client.lvols_block[lvol_or_part.path];
        name = lvol_or_part.Name;
        orig_size = lvol_or_part.Size;
        round_size = vgroup.ExtentSize;
    } else {
        title = _("Shrink partition");
        block = client.blocks[lvol_or_part.path];
        name = block_name(block);
        orig_size = lvol_or_part.Size;
        round_size = 1024 * 1024;
    }

    const usage = get_active_usage(client,
                                   block && !to_fit && info.shrink_needs_unmount ? block.path : null,
                                   _("shrink"), null,
                                   true);

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    let shrink_size;
    let size_fields = [];
    if (!to_fit) {
        size_fields = [
            SizeSlider("size", _("Size"),
                       {
                           value: orig_size,
                           max: orig_size,
                           round: round_size,
                       })
        ];
    } else {
        const crypto = client.blocks_crypto[block.path];
        const cleartext = client.blocks_cleartext[block.path];
        let content_path = null;
        let crypto_overhead = 0;

        if (crypto) {
            if (crypto.MetadataSize !== undefined && cleartext) {
                content_path = cleartext.path;
                crypto_overhead = crypto.MetadataSize;
            }
        } else {
            content_path = block.path;
        }

        const fsys = client.blocks_fsys[content_path];
        if (fsys)
            shrink_size = fsys.Size + crypto_overhead;

        const vdo = client.legacy_vdo_overlay.find_by_backing_block(client.blocks[content_path]);
        if (vdo)
            shrink_size = vdo.physical_size + crypto_overhead;

        const stratis_bdev = client.blocks_stratis_blockdev[content_path];
        if (stratis_bdev)
            shrink_size = Number(stratis_bdev.TotalPhysicalSize) + crypto_overhead;

        if (shrink_size === undefined) {
            console.warn("Couldn't determine size to shrink to."); // not-covered: safety check
            return; // not-covered: safety check
        }
    }

    let recovered_passphrase;
    let passphrase_fields = [];
    if (block && block.IdType == "crypto_LUKS" && block.IdVersion == 2)
        passphrase_fields = existing_passphrase_fields(_("Resizing an encrypted filesystem requires unlocking the disk. Please provide a current disk passphrase."));

    if (usage.length == 0 && size_fields.length + passphrase_fields.length === 0) {
        return lvol_or_part_and_fsys_resize(client, lvol_or_part, shrink_size, false, null);
    }

    const dlg = dialog_open({
        Title: title,
        Teardown: TeardownMessage(usage),
        Fields: size_fields.concat(passphrase_fields),
        Action: {
            Title: _("Shrink"),
            disable_on_error: usage.Teardown,
            action: function (vals) {
                return teardown_active_usage(client, usage)
                        .then(function () {
                            return (lvol_or_part_and_fsys_resize(client, lvol_or_part,
                                                                 to_fit ? shrink_size : vals.size,
                                                                 to_fit ? false : info.shrink_needs_unmount,
                                                                 vals.passphrase || recovered_passphrase)
                                    .then(() => undo_temporary_teardown(client, usage))
                                    .catch(request_passphrase_on_error_handler(dlg, vals, recovered_passphrase, block)));
                        });
            }
        },
        Inits: [
            init_teardown_usage(client, usage),
            passphrase_fields.length
                ? init_existing_passphrase(block, false, pp => { recovered_passphrase = pp })
                : null
        ]
    });
}
