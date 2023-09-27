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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import {
    get_active_usage, teardown_active_usage,
    is_mounted_synch
} from "./utils.js";
import {
    existing_passphrase_fields, init_existing_passphrase,
    request_passphrase_on_error_handler
} from "./crypto-keyslots.jsx";
import {
    dialog_open, SizeSlider, BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "./dialog.jsx";
import { std_reply } from "./stratis-utils.js";

const _ = cockpit.gettext;

export function lvol_and_fsys_resize(client, lvol, size, offline, passphrase) {
    let fsys;
    let crypto_overhead;
    let vdo;
    let stratis_bdev;
    const orig_size = lvol.Size;

    const block = client.lvols_block[lvol.path];
    if (!block)
        return lvol.Resize(size, { });

    const crypto = client.blocks_crypto[block.path];
    if (crypto) {
        const cleartext = client.blocks_cleartext[block.path];
        if (!cleartext)
            return;
        fsys = client.blocks_fsys[cleartext.path];
        vdo = client.legacy_vdo_overlay.find_by_backing_block(cleartext);
        stratis_bdev = client.blocks_stratis_blockdev[cleartext.path];
        if (crypto.MetadataSize !== undefined)
            crypto_overhead = crypto.MetadataSize;
        else
            crypto_overhead = block.Size - cleartext.Size;
    } else {
        fsys = client.blocks_fsys[block.path];
        vdo = client.legacy_vdo_overlay.find_by_backing_block(block);
        stratis_bdev = client.blocks_stratis_blockdev[block.path];
        crypto_overhead = 0;
    }

    function fsys_resize() {
        if (fsys) {
            // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1934567
            //
            // block_fsys.MountedAt might be out of synch with reality
            // here if resizing the crypto container accidentally
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
                                    .then(function () { return fsys.Resize(size - crypto_overhead, { }) }));
                        } else {
                            return fsys.Resize(size - crypto_overhead, { });
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
                return Promise.reject(_("Stratis blockdevs can not be made smaller"));
            else
                return Promise.resolve();
        } else if (size < orig_size) {
            // This shouldn't happen.  But if it does, continuing is harmful, so we throw an error.
            return Promise.reject(_("Unrecognized data can not be made smaller here."));
        } else {
            // Growing unrecognized content, nothing to do.
            return Promise.resolve();
        }
    }

    function crypto_resize() {
        if (crypto) {
            const opts = { };
            if (passphrase)
                opts.passphrase = { t: "s", v: passphrase };
            return crypto.Resize(size - crypto_overhead, opts);
        } else {
            return Promise.resolve();
        }
    }

    function lvm_resize() {
        if (size != lvol.Size)
            return lvol.Resize(size, { });
        else
            return Promise.resolve();
    }

    if (fsys && !fsys.Resize) {
        // Fallback for old versions of UDisks.  This doesn't handle encrypted volumes.
        if (size != orig_size) {
            return lvol.Resize(size, { resize_fsys: { t: 'b', v: true } });
        }
    } else {
        if (size < orig_size) {
            return fsys_resize().then(crypto_resize)
                    .then(lvm_resize);
        } else if (size >= orig_size) {
            return lvm_resize().then(crypto_resize)
                    .then(fsys_resize);
        }
    }
}

export function get_resize_info(client, block, to_fit) {
    let info, shrink_excuse, grow_excuse;

    if (block) {
        if (block.IdUsage == 'crypto' && client.blocks_crypto[block.path]) {
            const encrypted = client.blocks_crypto[block.path];
            const cleartext = client.blocks_cleartext[block.path];

            if (!encrypted.Resize) {
                info = { };
                shrink_excuse = grow_excuse = _("Encrypted volumes can not be resized here.");
            } else if (!cleartext) {
                info = { };
                shrink_excuse = grow_excuse = _("Encrypted volumes need to be unlocked before they can be resized.");
            } else {
                return get_resize_info(client, cleartext, to_fit);
            }
        } else if (block.IdUsage == 'filesystem') {
            info = client.fsys_info && client.fsys_info[block.IdType];

            if (!info) {
                info = { };
                shrink_excuse = grow_excuse = cockpit.format(_("$0 filesystems can not be resized here."),
                                                             block.IdType);
            } else {
                if (!info.can_shrink)
                    shrink_excuse = cockpit.format(_("$0 filesystems can not be made smaller."),
                                                   block.IdType);
                if (!info.can_grow)
                    grow_excuse = cockpit.format(_("$0 filesystems can not be made larger."),
                                                 block.IdType);
            }
        } else if (client.blocks_stratis_blockdev[block.path] && client.features.stratis_grow_blockdevs) {
            info = {
                can_shrink: false,
                can_grow: true,
                grow_needs_unmount: false
            };
            shrink_excuse = _("Stratis blockdevs can not be made smaller");
        } else if (block.IdUsage == 'raid') {
            info = { };
            shrink_excuse = grow_excuse = _("Physical volumes can not be resized here.");
        } else if (client.legacy_vdo_overlay.find_by_backing_block(block)) {
            info = {
                can_shrink: false,
                can_grow: true,
                grow_needs_unmount: false
            };
            shrink_excuse = _("VDO backing devices can not be made smaller");
        } else {
            info = {
                can_shrink: false,
                can_grow: true,
                grow_needs_unmount: true
            };
            shrink_excuse = _("Unrecognized data can not be made smaller here.");
        }
        if (to_fit) {
            // Shrink to fit doesn't need to resize the content
            shrink_excuse = null;
        }
    } else {
        info = { };
        shrink_excuse = grow_excuse = _("This volume needs to be activated before it can be resized.");
    }

    return { info, shrink_excuse, grow_excuse };
}

export function grow_dialog(client, lvol, info, to_fit) {
    const block = client.lvols_block[lvol.path];
    const vgroup = client.vgroups[lvol.VolumeGroup];
    const pool = client.lvols[lvol.ThinPool];

    const usage = get_active_usage(client, block && info.grow_needs_unmount ? block.path : null, _("grow"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), lvol.Name),
            Body: BlockingMessage(usage)
        });
        return;
    }

    let grow_size;
    let size_fields = [];
    if (!to_fit) {
        size_fields = [
            SizeSlider("size", _("Size"),
                       {
                           value: lvol.Size,
                           min: lvol.Size,
                           max: (pool ? pool.Size * 3 : lvol.Size + vgroup.FreeSize),
                           allow_infinite: !!pool,
                           round: vgroup.ExtentSize
                       })
        ];
    } else {
        grow_size = block.Size;
    }

    let recovered_passphrase;
    let passphrase_fields = [];
    if (block && block.IdType == "crypto_LUKS" && block.IdVersion == 2)
        passphrase_fields = existing_passphrase_fields(_("Resizing an encrypted filesystem requires unlocking the disk. Please provide a current disk passphrase."));

    if (!usage.Teardown && size_fields.length + passphrase_fields.length === 0) {
        return lvol_and_fsys_resize(client, lvol, grow_size, info.grow_needs_unmount, null);
    }

    const dlg = dialog_open({
        Title: _("Grow logical volume"),
        Teardown: TeardownMessage(usage),
        Fields: size_fields.concat(passphrase_fields),
        Action: {
            Title: _("Grow"),
            action: function (vals) {
                return teardown_active_usage(client, usage)
                        .then(function () {
                            return (lvol_and_fsys_resize(client, lvol,
                                                         to_fit ? grow_size : vals.size,
                                                         info.grow_needs_unmount,
                                                         vals.passphrase || recovered_passphrase)
                                    .catch(request_passphrase_on_error_handler(dlg, vals, recovered_passphrase, block)));
                        });
            }
        },
        Inits: [
            init_active_usage_processes(client, usage),
            passphrase_fields.length
                ? init_existing_passphrase(block, false, pp => { recovered_passphrase = pp })
                : null
        ]
    });
}

export function shrink_dialog(client, lvol, info, to_fit) {
    const block = client.lvols_block[lvol.path];
    const vgroup = client.vgroups[lvol.VolumeGroup];

    const usage = get_active_usage(client, block && !to_fit && info.shrink_needs_unmount ? block.path : null,
                                   _("shrink"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), lvol.Name),
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
                           value: lvol.Size,
                           max: lvol.Size,
                           round: vgroup.ExtentSize
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
            console.warn("Couldn't determine size to shrink to.");
            return;
        }
    }

    let recovered_passphrase;
    let passphrase_fields = [];
    if (block && block.IdType == "crypto_LUKS" && block.IdVersion == 2)
        passphrase_fields = existing_passphrase_fields(_("Resizing an encrypted filesystem requires unlocking the disk. Please provide a current disk passphrase."));

    if (usage.length == 0 && size_fields.length + passphrase_fields.length === 0) {
        return lvol_and_fsys_resize(client, lvol, shrink_size, false, null);
    }

    const dlg = dialog_open({
        Title: _("Shrink logical volume"),
        Teardown: TeardownMessage(usage),
        Fields: size_fields.concat(passphrase_fields),
        Action: {
            Title: _("Shrink"),
            action: function (vals) {
                return teardown_active_usage(client, usage)
                        .then(function () {
                            return (lvol_and_fsys_resize(client, lvol,
                                                         to_fit ? shrink_size : vals.size,
                                                         to_fit ? false : info.shrink_needs_unmount,
                                                         vals.passphrase || recovered_passphrase)
                                    .catch(request_passphrase_on_error_handler(dlg, vals, recovered_passphrase, block)));
                        });
            }
        },
        Inits: [
            init_active_usage_processes(client, usage),
            passphrase_fields.length
                ? init_existing_passphrase(block, false, pp => { recovered_passphrase = pp })
                : null
        ]
    });
}
