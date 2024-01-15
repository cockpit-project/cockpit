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
import {
    edit_crypto_config, parse_options, unparse_options, extract_option,
    get_parent_blocks, is_netdev,
    decode_filename, encode_filename, block_name,
    get_active_usage, reload_systemd, teardown_active_usage,
    validate_fsys_label,
} from "../utils.js";

import React from "react";
import { FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { HelperText, HelperTextItem, } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { ExclamationTriangleIcon, InfoCircleIcon } from "@patternfly/react-icons";

import {
    dialog_open,
    TextInput, PassInput, CheckBoxes, SelectOne, SizeSlider,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "../dialog.jsx";

import { get_fstab_config, is_valid_mount_point } from "../filesystem/utils.jsx";
import { init_existing_passphrase, unlock_with_type } from "../crypto/keyslots.jsx";
import { job_progress_wrapper } from "../jobs-panel.jsx";

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

export const mount_explanation = {
    local:
    <FormHelperText>
        <HelperText>
            <HelperTextItem hasIcon>
                {_("Mounts before services start")}
            </HelperTextItem>
            <HelperTextItem hasIcon>
                {_("Appropriate for critical mounts, such as /var")}
            </HelperTextItem>
            <HelperTextItem hasIcon icon={<ExclamationTriangleIcon className="ct-icon-exclamation-triangle" />}>
                {_("Boot fails if filesystem does not mount, preventing remote access")}
            </HelperTextItem>
        </HelperText>
    </FormHelperText>,
    nofail:
    <FormHelperText>
        <HelperText>
            <HelperTextItem hasIcon>
                {_("Mounts in parallel with services")}
            </HelperTextItem>
            <HelperTextItem hasIcon icon={<InfoCircleIcon className="ct-icon-info-circle" />}>
                {_("Boot still succeeds when filesystem does not mount")}
            </HelperTextItem>
        </HelperText>
    </FormHelperText>,
    netdev:
    <FormHelperText>
        <HelperText>
            <HelperTextItem hasIcon>
                {_("Mounts in parallel with services, but after network is available")}
            </HelperTextItem>
            <HelperTextItem hasIcon icon={<InfoCircleIcon className="ct-icon-info-circle" />}>
                {_("Boot still succeeds when filesystem does not mount")}
            </HelperTextItem>
        </HelperText>
    </FormHelperText>,
    never:
    <FormHelperText>
        <HelperText>
            <HelperTextItem hasIcon>
                {_("Does not mount during boot")}
            </HelperTextItem>
            <HelperTextItem hasIcon>
                {_("Useful for mounts that are optional or need interaction (such as passphrases)")}
            </HelperTextItem>
        </HelperText>
    </FormHelperText>,
};

export function format_dialog(client, path, start, size, enable_dos_extended) {
    const block = client.blocks[path];
    if (block.IdUsage == "crypto") {
        cockpit.spawn(["cryptsetup", "luksDump", decode_filename(block.Device)], { superuser: true })
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

function format_dialog_internal(client, path, start, size, enable_dos_extended, old_luks_version) {
    const block = client.blocks[path];
    const block_part = client.blocks_part[path];
    const block_ptable = client.blocks_ptable[path] || client.blocks_ptable[block_part?.Table];

    const offer_keep_keys = block.IdUsage == "crypto";
    const unlock_before_format = offer_keep_keys && !client.blocks_cleartext[path];

    const create_partition = (start !== undefined);

    let title;
    if (create_partition)
        title = cockpit.format(_("Create partition on $0"), block_name(block));
    else
        title = cockpit.format(_("Format $0"), block_name(block));

    function is_filesystem(vals) {
        return vals.type != "empty" && vals.type != "dos-extended" && vals.type != "biosboot";
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
    if (client.in_anaconda_mode()) {
        if (block_ptable && block_ptable.Type == "gpt" && !client.anaconda.efi)
            add_fsys(true, { value: "biosboot", title: "BIOS boot partition" });
        if (block_ptable && client.anaconda.efi)
            add_fsys(true, { value: "efi", title: "EFI system partition" });
    }
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
    const crypto_extra_options = unparse_options(crypto_split_options);

    let [, old_dir, old_opts] = get_fstab_config(block, true);
    if (old_opts == undefined)
        old_opts = initial_mount_options(client, block);

    old_dir = client.strip_mount_point_prefix(old_dir);
    if (old_dir === false)
        return Promise.reject(_("This device can not be used for the installation target."));

    const split_options = parse_options(old_opts);
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
        { tag: null, Title: create_partition ? _("Create") : _("Format") }
    ];

    if (client.in_anaconda_mode()) {
        action_variants = [
            { tag: "nomount", Title: create_partition ? _("Create") : _("Format") }
        ];
    }

    const dlg = dialog_open({
        Title: title,
        Teardown: TeardownMessage(usage),
        Fields: [
            TextInput("name", _("Name"),
                      {
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
                                            explanation: _("The disk needs to be unlocked before formatting.  Please provide a existing passphrase.")
                                        }),
                              TextInput("crypto_options", _("Encryption options"),
                                        {
                                            visible: is_encrypted,
                                            value: crypto_extra_options
                                        })
                          ]
                      }),
            SelectOne("at_boot", _("At boot"),
                      {
                          visible: is_filesystem,
                          value: at_boot,
                          explanation: mount_explanation[at_boot],
                          choices: [
                              {
                                  value: "local",
                                  title: _("Mount before services start"),
                              },
                              {
                                  value: "nofail",
                                  title: _("Mount without waiting, ignore failure"),
                              },
                              {
                                  value: "netdev",
                                  title: _("Mount after network becomes available, ignore failure"),
                              },
                              {
                                  value: "never",
                                  title: _("Do not mount"),
                              },
                          ]
                      }),
            CheckBoxes("mount_options", _("Mount options"),
                       {
                           visible: is_filesystem,
                           value: {
                               ro: opt_ro,
                               extra: extra_options || false
                           },
                           fields: [
                               { title: _("Mount read only"), tag: "ro" },
                               { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                           ]
                       }),
        ],
        update: function (dlg, vals, trigger) {
            if (trigger == "at_boot")
                dlg.set_options("at_boot", { explanation: mount_explanation[vals.at_boot] });
            else if (trigger == "type") {
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
                    if (vals.mount_options.ro)
                        mount_options.push("ro");
                    if (vals.at_boot == "never")
                        mount_options.push("x-cockpit-never-auto");
                    if (vals.at_boot == "nofail")
                        mount_options.push("nofail");
                    if (vals.at_boot == "netdev")
                        mount_options.push("_netdev");
                    if (vals.mount_options.extra)
                        mount_options.push(vals.mount_options.extra);

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
                        if (type == "dos-extended")
                            return block_ptable.CreatePartition(start, vals.size, "0x05", "", { });
                        else if (type == "empty")
                            return block_ptable.CreatePartition(start, vals.size, partition_type, "", { });
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

                function block_crypto_for_block(path) {
                    return client.blocks_crypto[path];
                }

                function maybe_mount(new_path) {
                    const path = new_path || block.path;
                    if (is_filesystem(vals) && mount_now)
                        return (client.wait_for(() => block_fsys_for_block(path))
                                .then(block_fsys => client.mount_at(client.blocks[block_fsys.path],
                                                                    mount_point)));
                    if (is_encrypted(vals) && is_filesystem(vals) && !mount_now)
                        return (client.wait_for(() => block_crypto_for_block(path))
                                .then(block_crypto => block_crypto.Lock({ })));
                }

                return teardown_active_usage(client, usage)
                        .then(reload_systemd)
                        .then(format)
                        .then(new_path => reload_systemd().then(() => new_path))
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
