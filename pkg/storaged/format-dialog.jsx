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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import * as utils from "./utils.js";

import {
    dialog_open,
    TextInput, PassInput, CheckBoxes, SelectOne, SizeSlider,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "./dialog.jsx";

import { get_fstab_config, is_valid_mount_point } from "./fsys-tab.jsx";
import { edit_config } from "./crypto-tab.jsx";
import { init_existing_passphrase, unlock_with_type } from "./crypto-keyslots.jsx";
import { job_progress_wrapper } from "./jobs-panel.jsx";

const _ = cockpit.gettext;

export function parse_options(options) {
    if (options)
        return (options.split(",")
                .map(function (s) { return s.trim() })
                .filter(function (s) { return s != "" }));
    else
        return [];
}

export function unparse_options(split) {
    return split.join(",");
}

export function extract_option(split, opt) {
    const index = split.indexOf(opt);
    if (index >= 0) {
        split.splice(index, 1);
        return true;
    } else {
        return false;
    }
}

export function initial_tab_options(client, block, for_fstab) {
    const options = { };

    utils.get_parent_blocks(client, block.path).forEach(p => {
        if (utils.is_netdev(client, p)) {
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

export const never_auto_explanation = _("If this option is checked, the filesystem will not be mounted during the next boot even if it was mounted before it.  This is useful if mounting during boot is not possible, such as when a passphrase is required to unlock the filesystem but booting is unattended.");

export function format_dialog(client, path, start, size, enable_dos_extended) {
    const block = client.blocks[path];
    if (block.IdUsage == "crypto") {
        cockpit.spawn(["cryptsetup", "luksDump", utils.decode_filename(block.Device)], { superuser: true })
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
                    format_dialog_internal(client, path, start, size, enable_dos_extended, version);
                });
    } else {
        format_dialog_internal(client, path, start, size, enable_dos_extended);
    }
}

function format_dialog_internal(client, path, start, size, enable_dos_extended, old_luks_version) {
    const block = client.blocks[path];
    const block_ptable = client.blocks_ptable[path];

    const offer_keep_keys = block.IdUsage == "crypto";
    const unlock_before_format = offer_keep_keys && !client.blocks_cleartext[path];

    const create_partition = (start !== undefined);

    let title;
    if (create_partition)
        title = cockpit.format(_("Create partition on $0"), utils.block_name(block));
    else
        title = cockpit.format(_("Format $0"), utils.block_name(block));

    function is_filesystem(vals) {
        return vals.type != "empty" && vals.type != "dos-extended";
    }

    function add_fsys(storaged_name, entry) {
        if (storaged_name === true ||
            (client.fsys_info && client.fsys_info[storaged_name] && client.fsys_info[storaged_name].can_format)) {
            filesystem_options.push(entry);
        }
    }

    const filesystem_options = [];
    add_fsys("xfs", { value: "xfs", title: "XFS " + _("(recommended)") });
    add_fsys("ext4", { value: "ext4", title: "EXT4" });
    add_fsys("vfat", { value: "vfat", title: "VFAT" });
    add_fsys("ntfs", { value: "ntfs", title: "NTFS" });
    add_fsys(true, { value: "empty", title: _("No filesystem") });
    if (create_partition && enable_dos_extended)
        add_fsys(true, { value: "dos-extended", title: _("Extended partition") });

    function is_encrypted(vals) {
        return vals.crypto && vals.crypto !== "none";
    }

    function add_crypto_type(value, title, recommended) {
        if ((client.manager.SupportedEncryptionTypes && client.manager.SupportedEncryptionTypes.indexOf(value) != -1) ||
            value == "luks1") {
            crypto_types.push({
                value: value,
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

    const usage = utils.get_active_usage(client, create_partition ? null : path, _("format"), _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), utils.block_name(block)),
            Body: BlockingMessage(usage)
        });
        return;
    }

    const crypto_config = utils.array_find(block.Configuration, function (c) { return c[0] == "crypttab" });
    let crypto_options;
    if (crypto_config) {
        crypto_options = (utils.decode_filename(crypto_config[1].options.v)
                .split(",")
                .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                .join(","));
    } else {
        crypto_options = initial_crypto_options(client, block);
    }

    const crypto_split_options = parse_options(crypto_options);
    extract_option(crypto_split_options, "noauto");
    const crypto_extra_options = unparse_options(crypto_split_options);

    let [, old_dir, old_opts] = get_fstab_config(block, true);
    if (!old_opts || old_opts == "defaults")
        old_opts = initial_mount_options(client, block);

    const split_options = parse_options(old_opts == "defaults" ? "" : old_opts);
    extract_option(split_options, "noauto");
    const opt_ro = extract_option(split_options, "ro");
    const opt_never_auto = extract_option(split_options, "x-cockpit-never-auto");
    const extra_options = unparse_options(split_options);

    let existing_passphrase_type = null;

    const dlg = dialog_open({
        Title: title,
        Teardown: TeardownMessage(usage),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          validate: (name, vals) => utils.validate_fsys_label(name, vals.type),
                          visible: is_filesystem
                      }),
            SelectOne("type", _("Type"),
                      { choices: filesystem_options }),
            SizeSlider("size", _("Size"),
                       {
                           value: size,
                           max: size,
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
            TextInput("mount_point", _("Mount point"),
                      {
                          visible: is_filesystem,
                          value: old_dir || "",
                          validate: val => is_valid_mount_point(client, block, val)
                      }),
            CheckBoxes("mount_options", _("Mount options"),
                       {
                           visible: is_filesystem,
                           value: {
                               auto: true,
                               ro: opt_ro,
                               never_auto: opt_never_auto,
                               extra: extra_options || false
                           },
                           fields: [
                               { title: _("Mount now"), tag: "auto" },
                               { title: _("Mount read only"), tag: "ro" },
                               {
                                   title: _("Never mount at boot"), tag: "never_auto",
                                   tooltip: never_auto_explanation,
                               },
                               { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                           ]
                       }),
            SelectOne("crypto", _("Encryption"),
                      {
                          choices: crypto_types,
                          value: offer_keep_keys ? " keep" : "none",
                          visible: vals => vals.type != "dos-extended",
                          nested_fields: [
                              PassInput("passphrase", _("Passphrase"),
                                        {
                                            validate: function (phrase, vals) {
                                                if (vals.crypto != " keep" && phrase === "")
                                                    return _("Passphrase cannot be empty");
                                            },
                                            visible: vals => is_encrypted(vals) && vals.crypto != " keep",
                                        }),
                              PassInput("passphrase2", _("Confirm"),
                                        {
                                            validate: function (phrase2, vals) {
                                                if (vals.crypto != " keep" && phrase2 != vals.passphrase)
                                                    return _("Passphrases do not match");
                                            },
                                            visible: vals => is_encrypted(vals) && vals.crypto != " keep",
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
                                            explanation: _("The disk needs to be unlocked before formatting.  Please provide a existing passphrase.")
                                        }),
                              TextInput("crypto_options", _("Encryption options"),
                                        {
                                            visible: is_encrypted,
                                            value: crypto_extra_options
                                        })
                          ]
                      })
        ],
        Action: {
            Title: create_partition ? _("Create partition") : _("Format"),
            Danger: (create_partition ? null : _("Formatting erases all data on a storage device.")),
            wrapper: job_progress_wrapper(client, block.path, client.blocks_cleartext[block.path]?.path),
            action: function (vals) {
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
                    if (vals.mount_options &&
                        (!vals.mount_options.auto || vals.mount_options.never_auto)) {
                        opts.push("noauto");
                    }

                    opts = opts.concat(parse_options(vals.crypto_options));
                    new_crypto_options = { t: 'ay', v: utils.encode_filename(unparse_options(opts)) };
                    const item = {
                        options: new_crypto_options,
                        "track-parents": { t: 'b', v: true }
                    };

                    if (!keep_keys) {
                        if (vals.store_passphrase.on) {
                            item["passphrase-contents"] = { t: 'ay', v: utils.encode_filename(vals.passphrase) };
                        } else {
                            item["passphrase-contents"] = { t: 'ay', v: utils.encode_filename("") };
                        }
                        config_items.push(["crypttab", item]);
                        options["encrypt.passphrase"] = { t: 's', v: vals.passphrase };
                        options["encrypt.type"] = { t: 's', v: vals.crypto };
                    }
                }

                if (is_filesystem(vals)) {
                    const mount_options = [];
                    if (!vals.mount_options.auto || vals.mount_options.never_auto) {
                        mount_options.push("noauto");
                    }
                    if (vals.mount_options.ro)
                        mount_options.push("ro");
                    if (vals.mount_options.never_auto)
                        mount_options.push("x-cockpit-never-auto");
                    if (vals.mount_options.extra)
                        mount_options.push(vals.mount_options.extra);

                    let mount_point = vals.mount_point;
                    if (mount_point[0] != "/")
                        mount_point = "/" + mount_point;

                    config_items.push(["fstab", {
                        dir: { t: 'ay', v: utils.encode_filename(mount_point) },
                        type: { t: 'ay', v: utils.encode_filename("auto") },
                        opts: { t: 'ay', v: utils.encode_filename(mount_options.join(",") || "defaults") },
                        freq: { t: 'i', v: 0 },
                        passno: { t: 'i', v: 0 },
                        "track-parents": { t: 'b', v: true }
                    }]);
                }

                if (config_items.length > 0)
                    options["config-items"] = { t: 'a(sa{sv})', v: config_items };

                function maybe_unlock() {
                    const content_block = client.blocks_cleartext[path];
                    if (content_block)
                        return content_block;

                    return (unlock_with_type(client, block, vals.old_passphrase, existing_passphrase_type)
                            .catch(error => {
                                dlg.set_values({ needs_explicit_passphrase: true });
                                return Promise.reject(error);
                            })
                            .then(() => client.blocks_cleartext[path]));
                }

                function format() {
                    if (create_partition) {
                        if (vals.type == "dos-extended")
                            return block_ptable.CreatePartition(start, vals.size, "0x05", "", { });
                        else if (vals.type == "empty")
                            return block_ptable.CreatePartition(start, vals.size, "", "", { });
                        else
                            return block_ptable.CreatePartitionAndFormat(start, vals.size, "", "", { },
                                                                         vals.type, options);
                    } else if (keep_keys) {
                        return (edit_config(block,
                                            (config, commit) => {
                                                config.options = new_crypto_options;
                                                return commit();
                                            })
                                .then(() => maybe_unlock())
                                .then(content_block => {
                                    return content_block.Format(vals.type, options);
                                }));
                    } else {
                        return block.Format(vals.type, options);
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

                function block_crypto_for_block(path) {
                    return client.blocks_crypto[path];
                }

                function maybe_mount(new_path) {
                    const path = new_path || block.path;
                    if (is_filesystem(vals) && vals.mount_options.auto)
                        return (client.wait_for(() => block_fsys_for_block(path))
                                .then(block_fsys => block_fsys.Mount({ })));
                    if (is_encrypted(vals) && vals.mount_options && !vals.mount_options.auto)
                        return (client.wait_for(() => block_crypto_for_block(path))
                                .then(block_crypto => block_crypto.Lock({ })));
                }

                return utils.teardown_active_usage(client, usage)
                        .then(utils.reload_systemd)
                        .then(format)
                        .then(new_path => utils.reload_systemd().then(() => new_path))
                        .then(maybe_mount);
            }
        },
        Inits: [
            init_active_usage_processes(client, usage),
            unlock_before_format
                ? init_existing_passphrase(block, true, type => { existing_passphrase_type = type })
                : null
        ]
    });
}
