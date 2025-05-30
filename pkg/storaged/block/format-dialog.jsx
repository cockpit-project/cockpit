/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

import cockpit from "cockpit";
import client from "../client.js";

import {
    edit_crypto_config, parse_options, unparse_options, extract_option,
    get_parent_blocks, is_netdev,
    decode_filename, encode_filename, block_name,
    get_active_usage, reload_systemd, teardown_active_usage,
    validate_fsys_label,
} from "../utils.js";

import {
    dialog_open,
    TextInput, PassInput, CheckBoxes, SelectOne, SizeSlider,
    BlockingMessage, TeardownMessage,
    init_teardown_usage
} from "../dialog.jsx";

import { get_fstab_config, is_valid_mount_point } from "../filesystem/utils.jsx";
import { init_existing_passphrase, unlock_with_type } from "../crypto/keyslots.jsx";
import { job_progress_wrapper } from "../jobs-panel.jsx";
import { at_boot_input, update_at_boot_input, mount_options } from "../filesystem/mounting-dialog.jsx";
import { remember_passphrase } from "../anaconda.jsx";

const _ = cockpit.gettext;

export function initial_tab_options(client, block, for_fstab) {
    const options = { };

    // "nofail" is the default for new filesystems with Cockpit so
    // that a failure to mount one of them will not prevent
    // Cockpit from starting.  This allows people to debug and fix
    // these failures with Cockpit itself.
    //
    // In Anaconda mode however, we don't make "nofail" the
    // default since people will be creating the core filesystems
    // like "/", "/var", etc.

    if (!client.in_anaconda_mode())
        options.nofail = true;

    get_parent_blocks(client, block.path).forEach(p => {
        if (is_netdev(client, p)) {
            options._netdev = true;
        }
        // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1589541
        if (client.legacy_vdo_overlay.find_by_block(client.blocks[p])) {
            options._netdev = true;
            options["x-systemd.device-timeout=0"] = true;
            if (for_fstab)
                options["x-systemd.requires=vdo.service"] = true;
        }
    });

    return Object.keys(options).join(",");
}

export function initial_crypto_options(client, block) {
    return initial_tab_options(client, block, false);
}

export function initial_mount_options(client, block) {
    return initial_tab_options(client, block, true);
}

export function format_dialog(client, path, start, size, enable_dos_extended) {
    const block = client.blocks[path];
    if (block.IdUsage == "crypto") {
        cockpit.spawn(["cryptsetup", "luksDump", decode_filename(block.Device)], { superuser: "require" })
                .then(output => {
                    if (output.indexOf("Keyslots:") >= 0) // This is what luksmeta-monitor-hack looks for
                        return 2;
                    else
                        return 1;
                })
                .catch(() => {
                    return false;
                })
                .then(version => {
                    return format_dialog_internal(client, path, start, size, enable_dos_extended, version);
                });
    } else {
        return format_dialog_internal(client, path, start, size, enable_dos_extended);
    }
}

function find_root_fsys_block() {
    const root = client.anaconda?.mount_point_prefix || "/";
    for (const p in client.blocks) {
        if (client.blocks_fsys[p] && client.blocks_fsys[p].MountPoints.map(decode_filename).indexOf(root) >= 0)
            return client.blocks[p];
        if (client.blocks[p].Configuration.find(c => c[0] == "fstab" && decode_filename(c[1].dir.v) == root))
            return client.blocks[p];
    }
    return null;
}

function format_dialog_internal(client, path, start, size, enable_dos_extended, old_luks_version) {
    const block = client.blocks[path];
    const block_part = client.blocks_part[path];
    const block_ptable = client.blocks_ptable[path] || client.blocks_ptable[block_part?.Table];
    const content_block = block.IdUsage == "crypto" ? client.blocks_cleartext[path] : block;

    const offer_keep_keys = block.IdUsage == "crypto";
    const unlock_before_format = offer_keep_keys && (!content_block || content_block.ReadOnly);

    const create_partition = (start !== undefined);

    let title;
    if (create_partition)
        title = cockpit.format(_("Create partition on $0"), block_name(block));
    else
        title = cockpit.format(_("Format $0"), block_name(block));

    function is_filesystem(vals) {
        return vals.type != "empty" && vals.type != "dos-extended" && vals.type != "biosboot" && vals.type != "swap";
    }

    function add_fsys(storaged_name, entry) {
        if (storaged_name === true ||
            (client.fsys_info && client.fsys_info[storaged_name] && client.fsys_info[storaged_name].can_format)) {
            filesystem_options.push(entry);
        }
    }

    const filesystem_options = [];
    add_fsys("xfs", { value: "xfs", title: "XFS" });
    add_fsys("ext4", { value: "ext4", title: "EXT4" });
    if (client.features.btrfs)
        add_fsys("btrfs", { value: "btrfs", title: "BTRFS" });
    add_fsys("vfat", { value: "vfat", title: "VFAT" });
    add_fsys("ntfs", { value: "ntfs", title: "NTFS" });
    add_fsys("swap", { value: "swap", title: "Swap" });
    if (client.in_anaconda_mode()) {
        if (block_ptable && block_ptable.Type == "gpt" && !client.anaconda.efi)
            add_fsys(true, { value: "biosboot", title: "BIOS boot partition" });
        if (block_ptable && client.anaconda.efi)
            add_fsys(true, { value: "efi", title: "EFI system partition" });
    }
    add_fsys(true, { value: "empty", title: _("No filesystem") });
    if (create_partition && enable_dos_extended)
        add_fsys(true, { value: "dos-extended", title: _("Extended partition") });

    function is_supported(type) {
        return filesystem_options.find(o => o.value == type);
    }

    let default_type = null;
    if (content_block?.IdUsage == "filesystem" && is_supported(content_block.IdType))
        default_type = content_block.IdType;
    else {
        const root_block = find_root_fsys_block();
        if (root_block && is_supported(root_block.IdType)) {
            default_type = root_block.IdType;
        } else if (client.anaconda?.default_fsys_type && is_supported(client.anaconda.default_fsys_type)) {
            default_type = client.anaconda.default_fsys_type;
        } else {
            default_type = "ext4";
        }
    }

    function is_encrypted(vals) {
        return vals.crypto && vals.crypto !== "none";
    }

    function add_crypto_type(value, title, recommended) {
        if ((client.manager.SupportedEncryptionTypes && client.manager.SupportedEncryptionTypes.indexOf(value) != -1) ||
            value == "luks1") {
            crypto_types.push({
                value,
                title: title + (recommended ? " " + _("(recommended)") : "")
            });
        }
    }

    const crypto_types = [{ value: "none", title: _("No encryption") }];
    if (offer_keep_keys) {
        if (old_luks_version)
            crypto_types.push({
                value: " keep",
                title: cockpit.format(_("Reuse existing encryption ($0)"), "LUKS" + old_luks_version)
            });
        else
            crypto_types.push({ value: " keep", title: _("Reuse existing encryption") });
    }
    add_crypto_type("luks1", "LUKS1", false);
    add_crypto_type("luks2", "LUKS2", true);

    const usage = get_active_usage(client, create_partition ? null : path, _("format"), _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), block_name(block)),
            Body: BlockingMessage(usage)
        });
        return;
    }

    const crypto_config = block.Configuration.find(c => c[0] == "crypttab");
    let crypto_options;
    if (crypto_config) {
        crypto_options = (decode_filename(crypto_config[1].options.v)
                .split(",")
                .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                .join(","));
    } else {
        crypto_options = initial_crypto_options(client, block);
    }

    const crypto_split_options = parse_options(crypto_options);
    extract_option(crypto_split_options, "noauto");
    extract_option(crypto_split_options, "nofail");
    extract_option(crypto_split_options, "_netdev");
    extract_option(crypto_split_options, "readonly");
    extract_option(crypto_split_options, "read-only");
    const crypto_extra_options = unparse_options(crypto_split_options);

    let [, old_dir, old_opts] = get_fstab_config(block, true,
                                                 content_block?.IdType == "btrfs"
                                                     ? { pathname: "/", id: 5 }
                                                     : undefined);
    if (old_opts == undefined)
        old_opts = initial_mount_options(client, block);

    old_dir = client.strip_mount_point_prefix(old_dir);
    if (old_dir === false)
        return Promise.reject(_("This device can not be used for the installation target."));

    // Strip out btrfs subvolume mount options
    const split_options = parse_options(old_opts).filter(opt => !(opt.startsWith('subvol=') || opt.startsWith('subvolid=')));
    extract_option(split_options, "noauto");
    const opt_ro = extract_option(split_options, "ro");
    const opt_never_auto = extract_option(split_options, "x-cockpit-never-auto");
    const opt_nofail = extract_option(split_options, "nofail");
    const opt_netdev = extract_option(split_options, "_netdev");
    const extra_options = unparse_options(split_options);

    let existing_passphrase_type = null;

    let at_boot;
    if (opt_never_auto)
        at_boot = "never";
    else if (opt_netdev)
        at_boot = "netdev";
    else if (opt_nofail)
        at_boot = "nofail";
    else
        at_boot = "local";

    let action_variants = [
        { tag: null, Title: create_partition ? _("Create and mount") : _("Format and mount") },
        { tag: "nomount", Title: create_partition ? _("Create only") : _("Format only") }
    ];

    const action_variants_for_empty = [
        { tag: "nomount", Title: create_partition ? _("Create") : _("Format") }
    ];

    let action_variants_for_swap = [
        { tag: null, Title: create_partition ? _("Create and start") : _("Format and start") },
        { tag: "nomount", Title: create_partition ? _("Create only") : _("Format only") }
    ];

    if (client.in_anaconda_mode()) {
        action_variants = action_variants_for_swap = [
            { tag: "nomount", Title: create_partition ? _("Create") : _("Format") }
        ];
    }

    const dlg = dialog_open({
        Title: title,
        Teardown: TeardownMessage(usage),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: content_block?.IdLabel,
                          validate: (name, vals) => validate_fsys_label(name, vals.type),
                          visible: is_filesystem
                      }),
            TextInput("mount_point", _("Mount point"),
                      {
                          visible: is_filesystem,
                          value: old_dir || "",
                          validate: (val, values, variant) => {
                              return is_valid_mount_point(client,
                                                          block,
                                                          client.add_mount_point_prefix(val),
                                                          variant == "nomount");
                          }
                      }),
            SelectOne("type", _("Type"),
                      {
                          value: default_type,
                          choices: filesystem_options
                      }),
            SizeSlider("size", _("Size"),
                       {
                           value: size,
                           max: size,
                           round: 1024 * 1024,
                           visible: function () {
                               return create_partition;
                           }
                       }),
            CheckBoxes("erase", _("Overwrite"),
                       {
                           fields: [
                               { tag: "on", title: _("Overwrite existing data with zeros (slower)") }
                           ],
                       }),
            SelectOne("crypto", _("Encryption"),
                      {
                          choices: crypto_types,
                          value: offer_keep_keys ? " keep" : "none",
                          visible: vals => vals.type != "dos-extended" && vals.type != "biosboot" && vals.type != "efi",
                          nested_fields: [
                              PassInput("passphrase", _("Passphrase"),
                                        {
                                            validate: function (phrase, vals) {
                                                if (vals.crypto != " keep" && phrase === "")
                                                    return _("Passphrase cannot be empty");
                                            },
                                            visible: vals => is_encrypted(vals) && vals.crypto != " keep",
                                            new_password: true
                                        }),
                              PassInput("passphrase2", _("Confirm"),
                                        {
                                            validate: function (phrase2, vals) {
                                                if (vals.crypto != " keep" && phrase2 != vals.passphrase)
                                                    return _("Passphrases do not match");
                                            },
                                            visible: vals => is_encrypted(vals) && vals.crypto != " keep",
                                            new_password: true
                                        }),
                              CheckBoxes("store_passphrase", "",
                                         {
                                             visible: vals => is_encrypted(vals) && vals.crypto != " keep",
                                             value: {
                                                 on: false,
                                             },
                                             fields: [
                                                 { title: _("Store passphrase"), tag: "on" }
                                             ]
                                         }),
                              PassInput("old_passphrase", _("Passphrase"),
                                        {
                                            validate: function (phrase) {
                                                if (phrase === "")
                                                    return _("Passphrase cannot be empty");
                                            },
                                            visible: vals => vals.crypto == " keep" && vals.needs_explicit_passphrase,
                                            explanation: _("The disk needs to be unlocked before formatting. Please provide an existing passphrase.")
                                        }),
                              TextInput("crypto_options", _("Encryption options"),
                                        {
                                            visible: is_encrypted,
                                            value: crypto_extra_options
                                        })
                          ]
                      }),
            at_boot_input(at_boot, is_filesystem),
            mount_options(opt_ro, extra_options, is_filesystem),
        ],
        update: function (dlg, vals, trigger) {
            update_at_boot_input(dlg, vals, trigger);
            if (trigger == "type") {
                if (dlg.get_value("type") == "empty") {
                    dlg.update_actions({ Variants: action_variants_for_empty });
                } else if (dlg.get_value("type") == "swap") {
                    dlg.update_actions({ Variants: action_variants_for_swap });
                } else {
                    dlg.update_actions({ Variants: action_variants });
                }
                if (vals.type == "efi" && !vals.mount_point)
                    dlg.set_values({ mount_point: "/boot/efi" });
            }
        },
        Action: {
            Variants: action_variants,
            Danger: (create_partition ? null : _("Formatting erases all data on a storage device.")),
            wrapper: job_progress_wrapper(client, block.path, client.blocks_cleartext[block.path]?.path),
            disable_on_error: usage.Teardown,
            action: function (vals) {
                const mount_now = vals.variant != "nomount";
                let type = vals.type;
                let partition_type = "";

                if (type == "efi") {
                    type = "vfat";
                    partition_type = block_ptable.Type == "dos" ? "0xEF" : "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
                }

                if (type == "biosboot") {
                    type = "empty";
                    partition_type = "21686148-6449-6e6f-744e-656564454649";
                }

                if (type == "swap") {
                    partition_type = (block_ptable && block_ptable.Type == "dos"
                        ? "0x82"
                        : "0657fd6d-a4ab-43c4-84e5-0933c84b4f4f");
                }

                const options = {
                    'tear-down': { t: 'b', v: true }
                };
                if (vals.erase.on)
                    options.erase = { t: 's', v: "zero" };
                if (vals.name)
                    options.label = { t: 's', v: vals.name };

                // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1516041
                if (client.legacy_vdo_overlay.find_by_block(block)) {
                    options['no-discard'] = { t: 'b', v: true };
                }

                const keep_keys = is_encrypted(vals) && offer_keep_keys && vals.crypto == " keep";

                const config_items = [];
                let new_crypto_options;
                if (is_encrypted(vals)) {
                    let opts = [];
                    if (is_filesystem(vals)) {
                        if (vals.mount_options?.ro)
                            opts.push("readonly");
                        if (!mount_now || vals.at_boot == "never")
                            opts.push("noauto");
                        if (vals.at_boot == "nofail")
                            opts.push("nofail");
                        if (vals.at_boot == "netdev")
                            opts.push("_netdev");
                    }

                    opts = opts.concat(parse_options(vals.crypto_options));
                    new_crypto_options = { t: 'ay', v: encode_filename(unparse_options(opts)) };
                    const item = {
                        options: new_crypto_options,
                        "track-parents": { t: 'b', v: true }
                    };

                    if (!keep_keys) {
                        if (vals.store_passphrase.on) {
                            item["passphrase-contents"] = { t: 'ay', v: encode_filename(vals.passphrase) };
                        } else {
                            item["passphrase-contents"] = { t: 'ay', v: encode_filename("") };
                        }
                        config_items.push(["crypttab", item]);
                        options["encrypt.passphrase"] = { t: 's', v: vals.passphrase };
                        options["encrypt.type"] = { t: 's', v: vals.crypto };
                    }
                }

                let mount_point;

                if (is_filesystem(vals)) {
                    const mount_options = [];
                    if (!mount_now || vals.at_boot == "never") {
                        mount_options.push("noauto");
                    }
                    if (vals.mount_options?.ro)
                        mount_options.push("ro");
                    if (vals.at_boot == "never")
                        mount_options.push("x-cockpit-never-auto");
                    if (vals.at_boot == "nofail")
                        mount_options.push("nofail");
                    if (vals.at_boot == "netdev")
                        mount_options.push("_netdev");
                    if (vals.mount_options?.extra)
                        mount_options.push(vals.mount_options.extra);
                    if (type == "btrfs")
                        mount_options.push("subvol=/");

                    mount_point = vals.mount_point;
                    if (mount_point != "") {
                        if (mount_point[0] != "/")
                            mount_point = "/" + mount_point;
                        mount_point = client.add_mount_point_prefix(mount_point);

                        config_items.push(["fstab", {
                            dir: { t: 'ay', v: encode_filename(mount_point) },
                            type: { t: 'ay', v: encode_filename("auto") },
                            opts: { t: 'ay', v: encode_filename(mount_options.join(",") || "defaults") },
                            freq: { t: 'i', v: 0 },
                            passno: { t: 'i', v: 0 },
                            "track-parents": { t: 'b', v: true }
                        }]);
                    }
                }

                if (type == "swap") {
                    config_items.push(["fstab", {
                        dir: { t: 'ay', v: encode_filename("none") },
                        type: { t: 'ay', v: encode_filename("swap") },
                        opts: { t: 'ay', v: encode_filename(mount_now ? "defaults" : "noauto") },
                        freq: { t: 'i', v: 0 },
                        passno: { t: 'i', v: 0 },
                        "track-parents": { t: 'b', v: true }
                    }]);
                }

                if (config_items.length > 0)
                    options["config-items"] = { t: 'a(sa{sv})', v: config_items };

                async function maybe_unlock() {
                    const content_block = client.blocks_cleartext[path];
                    if (content_block) {
                        if (content_block.ReadOnly) {
                            const block_crypto = client.blocks_crypto[path];
                            await block_crypto.Lock({});
                            await unlock_with_type(client, block, vals.old_passphrase, existing_passphrase_type, false);
                        }
                        return content_block;
                    }

                    try {
                        await unlock_with_type(client, block, vals.old_passphrase, existing_passphrase_type, false);
                        return client.blocks_cleartext[path];
                    } catch (error) {
                        dlg.set_values({ needs_explicit_passphrase: true });
                        throw error;
                    }
                }

                function format() {
                    if (create_partition) {
                        if (type == "dos-extended")
                            return block_ptable.CreatePartition(start, vals.size, "0x05", "", { });
                        else
                            return block_ptable.CreatePartitionAndFormat(start, vals.size, partition_type, "", { },
                                                                         type, options);
                    } else if (keep_keys) {
                        return (edit_crypto_config(block,
                                                   (config, commit) => {
                                                       config.options = new_crypto_options;
                                                       return commit();
                                                   })
                                .then(() => maybe_unlock())
                                .then(content_block => {
                                    return content_block.Format(type, options);
                                }));
                    } else {
                        return block.Format(type, options)
                                .then(() => {
                                    if (partition_type != "" && block_part)
                                        return block_part.SetType(partition_type, {});
                                });
                    }
                }

                function block_fsys_for_block(path) {
                    if (keep_keys) {
                        const content_block = client.blocks_cleartext[path];
                        return client.blocks_fsys[content_block.path];
                    } else if (is_encrypted(vals))
                        return (client.blocks_cleartext[path] &&
                                client.blocks_fsys[client.blocks_cleartext[path].path]);
                    else
                        return client.blocks_fsys[path];
                }

                function block_swap_for_block(path) {
                    if (keep_keys) {
                        const content_block = client.blocks_cleartext[path];
                        return client.blocks_swap[content_block.path];
                    } else if (is_encrypted(vals))
                        return (client.blocks_cleartext[path] &&
                                client.blocks_swap[client.blocks_cleartext[path].path]);
                    else
                        return client.blocks_swap[path];
                }

                function block_crypto_for_block(path) {
                    return client.blocks_crypto[path];
                }

                async function maybe_mount(new_path) {
                    const path = new_path || block.path;
                    const new_block = await client.wait_for(() => client.blocks[path]);

                    if (is_encrypted(vals) && vals.passphrase)
                        remember_passphrase(new_block, vals.passphrase);

                    if (is_encrypted(vals) && is_filesystem(vals) && vals.mount_options?.ro) {
                        const block_crypto = await client.wait_for(() => block_crypto_for_block(path));
                        await block_crypto.Lock({});
                        if (vals.passphrase)
                            await block_crypto.Unlock(vals.passphrase, { "read-only": { t: "b", v: true } });
                        else
                            await unlock_with_type(client, block, vals.old_passphrase, existing_passphrase_type, true);
                    }

                    if (is_filesystem(vals) && mount_now) {
                        const block_fsys = await client.wait_for(() => block_fsys_for_block(path));
                        await client.mount_at(client.blocks[block_fsys.path], mount_point);
                    }
                    if (type == "swap" && mount_now) {
                        const block_swap = await client.wait_for(() => block_swap_for_block(path));
                        await block_swap.Start({});
                    }
                    if (is_encrypted(vals) && vals.type != "empty" && !mount_now && !client.in_anaconda_mode()) {
                        const block_crypto = await client.wait_for(() => block_crypto_for_block(path));
                        await block_crypto.Lock({ });
                    }
                }

                return teardown_active_usage(client, usage)
                        .then(reload_systemd)
                        .then(format)
                        .then(new_path => reload_systemd().then(() => new_path))
                        .then(maybe_mount);
            }
        },
        Inits: [
            init_teardown_usage(client, usage),
            unlock_before_format
                ? init_existing_passphrase(block, true, type => { existing_passphrase_type = type })
                : null
        ]
    });
}
