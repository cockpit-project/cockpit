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
    parse_options, unparse_options, extract_option,
    get_parent_blocks, is_netdev,
    decode_filename, encode_filename, block_name,
    get_active_usage, reload_systemd, teardown_active_usage,
    validate_fsys_label,
} from "../utils.js";

import {
    dialog_open,
    TextInput, PassInput, CheckBoxes, SelectOne, SelectOneRadio, SizeSlider,
    BlockingMessage, TeardownMessage,
    init_teardown_usage
} from "../dialog.jsx";

import { get_fstab_config, is_valid_mount_point } from "../filesystem/utils.jsx";
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

export function format_dialog(block, options) {
    const { free_spaces, enable_dos_extended, add_encryption } = options || { };
    const is_already_encrypted = options?.is_encrypted;
    const block_part = client.blocks_part[block.path];
    const block_ptable = client.blocks_ptable[block.path] || client.blocks_ptable[block_part?.Table];
    const content_block = block.IdUsage == "crypto" ? client.blocks_cleartext[block.path] : block;

    const create_partition = (free_spaces !== undefined);

    let title;
    if (add_encryption)
        title = cockpit.format(_("Format $0 with encryption"), block_name(block));
    else if (create_partition)
        title = cockpit.format(_("Create partition on $0"), block_name(block));
    else
        title = cockpit.format(_("Format $0 as filesystem"), block_name(block));

    function is_filesystem(vals) {
        return !add_encryption && vals.type != "empty" && vals.type != "dos-extended" && vals.type != "biosboot";
    }

    function add_fsys(storaged_name, entry) {
        if (storaged_name === true ||
            (client.fsys_info && client.fsys_info[storaged_name] && client.fsys_info[storaged_name].can_format)) {
            filesystem_options.push(entry);
        }
    }

    const filesystem_options = [];
    if (create_partition)
        add_fsys(true, { value: "empty", title: _("Empty") });
    add_fsys("xfs", { value: "xfs", title: "XFS" });
    add_fsys("ext4", { value: "ext4", title: "EXT4" });
    if (client.features.btrfs)
        add_fsys("btrfs", { value: "btrfs", title: "BTRFS" });
    add_fsys("vfat", { value: "vfat", title: "VFAT" });
    add_fsys("ntfs", { value: "ntfs", title: "NTFS" });
    if (client.in_anaconda_mode()) {
        if (block_ptable && block_ptable.Type == "gpt" && !client.anaconda.efi)
            add_fsys(true, { value: "biosboot", title: "BIOS boot partition" });
        if (block_ptable && client.anaconda.efi)
            add_fsys(true, { value: "efi", title: "EFI system partition" });
    }
    if (create_partition && enable_dos_extended)
        add_fsys(true, { value: "dos-extended", title: _("Extended partition") });

    function is_supported(type) {
        return filesystem_options.find(o => o.value == type);
    }

    let default_type = null;
    if (create_partition)
        default_type = "empty";
    else if (content_block?.IdUsage == "filesystem" && is_supported(content_block.IdType))
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

    let default_crypto_type = null;

    function add_crypto_type(value, title, recommended) {
        if ((client.manager.SupportedEncryptionTypes && client.manager.SupportedEncryptionTypes.indexOf(value) != -1) ||
            value == "luks1") {
            crypto_types.push({
                value,
                title: title + (recommended ? "" : " " + _("(legacy)"))
            });
            if (recommended && !default_crypto_type)
                default_crypto_type = value;
        }
    }

    const crypto_types = [];
    if (!add_encryption) {
        crypto_types.push({ value: "none", title: _("No encryption") });
        default_crypto_type = "none";
    }
    add_crypto_type("luks2", "LUKS2", true);
    add_crypto_type("luks1", "LUKS1", false);

    const usage = get_active_usage(client, create_partition ? null : block.path, _("format"), _("delete"));

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

    if (client.in_anaconda_mode()) {
        action_variants = [
            { tag: "nomount", Title: create_partition ? _("Create") : _("Format") }
        ];
    }

    if (add_encryption) {
        action_variants = [
            { Title: _("Format with encryption") }
        ];
    }

    let max_size = 0;
    if (create_partition)
        max_size = Math.max(...free_spaces.map(f => f.size));

    dialog_open({
        Title: title,
        Teardown: TeardownMessage(usage),
        Fields: [
            SelectOne("type", create_partition ? _("Format") : _("Type"),
                      {
                          value: default_type,
                          choices: filesystem_options,
                          visible: () => !add_encryption,
                      }),
            SizeSlider("size", _("Size"),
                       {
                           value: max_size,
                           max: max_size,
                           round: 1024 * 1024,
                           visible: () => create_partition,
                       }),
            TextInput("name", _("Volume label"),
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
            SelectOneRadio("crypto", _("Encryption"),
                           {
                               choices: crypto_types,
                               value: default_crypto_type,
                               visible: vals => vals.type != "dos-extended" && vals.type != "biosboot" && vals.type != "efi" && vals.type != "empty" && !is_already_encrypted,
                               nested_fields: [
                                   PassInput("passphrase", _("Passphrase"),
                                             {
                                                 validate: function (phrase, vals) {
                                                     if (phrase === "")
                                                         return _("Passphrase cannot be empty");
                                                 },
                                                 visible: is_encrypted,
                                                 new_password: true
                                             }),
                                   PassInput("passphrase2", _("Confirm"),
                                             {
                                                 validate: function (phrase2, vals) {
                                                     if (phrase2 != vals.passphrase)
                                                         return _("Passphrases do not match");
                                                 },
                                                 visible: is_encrypted,
                                                 new_password: true
                                             }),
                                   CheckBoxes("store_passphrase", _("Persistence"),
                                              {
                                                  visible: is_encrypted,
                                                  value: {
                                                      on: false,
                                                  },
                                                  fields: [
                                                      { title: _("Store passphrase"), tag: "on" }
                                                  ]
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
                } else {
                    dlg.update_actions({ Variants: action_variants });
                }
                if (vals.type == "efi" && !vals.mount_point)
                    dlg.set_values({ mount_point: "/boot/efi" });
            }
        },
        Action: {
            Variants: default_type == "empty" ? action_variants_for_empty : action_variants,
            wrapper: job_progress_wrapper(client, block.path, client.blocks_cleartext[block.path]?.path),
            disable_on_error: usage.Teardown,
            action: function (vals) {
                const mount_now = vals.variant != "nomount";
                let type = add_encryption ? "empty" : vals.type;
                let partition_type = "";

                if (type == "efi") {
                    type = "vfat";
                    partition_type = block_ptable.Type == "dos" ? "0xEF" : "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
                }

                if (type == "biosboot") {
                    type = "empty";
                    partition_type = "21686148-6449-6e6f-744e-656564454649";
                }

                const options = {
                    'tear-down': { t: 'b', v: true }
                };
                if (vals.name)
                    options.label = { t: 's', v: vals.name };

                // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1516041
                if (client.legacy_vdo_overlay.find_by_block(block)) {
                    options['no-discard'] = { t: 'b', v: true };
                }

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

                    if (vals.store_passphrase.on) {
                        item["passphrase-contents"] = { t: 'ay', v: encode_filename(vals.passphrase) };
                    } else {
                        item["passphrase-contents"] = { t: 'ay', v: encode_filename("") };
                    }
                    config_items.push(["crypttab", item]);
                    options["encrypt.passphrase"] = { t: 's', v: vals.passphrase };
                    options["encrypt.type"] = { t: 's', v: vals.crypto };
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

                if (config_items.length > 0)
                    options["config-items"] = { t: 'a(sa{sv})', v: config_items };

                function format() {
                    if (create_partition) {
                        let start = free_spaces[0].start;
                        for (const fs of free_spaces) {
                            if (fs.size >= vals.size) {
                                start = fs.start;
                                break;
                            }
                        }
                        if (type == "dos-extended")
                            return block_ptable.CreatePartition(start, vals.size, "0x05", "", { });
                        else
                            return block_ptable.CreatePartitionAndFormat(start, vals.size, partition_type, "", { },
                                                                         type, options);
                    } else {
                        return block.Format(type, options)
                                .then(() => {
                                    if (partition_type != "" && block_part)
                                        return block_part.SetType(partition_type, {});
                                });
                    }
                }

                function block_fsys_for_block(path) {
                    if (is_encrypted(vals))
                        return (client.blocks_cleartext[path] &&
                                client.blocks_fsys[client.blocks_cleartext[path].path]);
                    else
                        return client.blocks_fsys[path];
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
                        await block_crypto.Unlock(vals.passphrase, { "read-only": { t: "b", v: true } });
                    }

                    if (is_filesystem(vals) && mount_now) {
                        const block_fsys = await client.wait_for(() => block_fsys_for_block(path));
                        await client.mount_at(client.blocks[block_fsys.path], mount_point);
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
        ]
    });
}
