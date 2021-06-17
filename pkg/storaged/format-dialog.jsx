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
    BlockingMessage, TeardownMessage
} from "./dialog.jsx";

import { get_fstab_config, is_valid_mount_point, get_cryptobacking_noauto } from "./fsys-tab.jsx";
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
    var index = split.indexOf(opt);
    if (index >= 0) {
        split.splice(index, 1);
        return true;
    } else {
        return false;
    }
}

export function crypto_options_dialog_fields(options, visible, include_store_passphrase, showLabel) {
    var split_options = parse_options(options);
    var opt_auto = !extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "readonly");
    var extra_options = unparse_options(split_options);

    let fields = [
        CheckBoxes("crypto_options", showLabel ? _("Encryption options") : "",
                   {
                       visible: visible,
                       value: {
                           auto: opt_auto,
                           ro: opt_ro,
                           extra: extra_options === "" ? false : extra_options
                       },
                       fields: [
                           { title: _("Unlock at boot"), tag: "auto" },
                           { title: _("Unlock read only"), tag: "ro" },
                           { title: _("Custom encryption options"), tag: "extra", type: "checkboxWithInput" },
                       ]
                   },
        )
    ];

    if (include_store_passphrase)
        fields = [
            CheckBoxes("store_passphrase", "",
                       {
                           visible: visible,
                           fields: [{ title: _("Store passphrase"), tag: "on" }]
                       }
            )
        ].concat(fields);

    return fields;
}

export function crypto_options_dialog_options(vals) {
    var opts = [];
    if (!vals.crypto_options || !vals.crypto_options.auto)
        opts.push("noauto");
    if (vals.crypto_options && vals.crypto_options.ro)
        opts.push("readonly");
    if (vals.crypto_options && vals.crypto_options.extra !== false)
        opts = opts.concat(parse_options(vals.crypto_options.extra));
    return unparse_options(opts);
}

export function initial_tab_options(client, block, for_fstab) {
    var options = { };

    utils.get_parent_blocks(client, block.path).forEach(p => {
        if (utils.is_netdev(client, p)) {
            options._netdev = true;
        }
        // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1589541
        if (client.vdo_overlay.find_by_block(client.blocks[p])) {
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
    var block = client.blocks[path];
    var block_ptable = client.blocks_ptable[path];

    var create_partition = (start !== undefined);

    var title;
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

    var filesystem_options = [];
    add_fsys("xfs", { value: "xfs", title: "XFS " + _("(recommended)") });
    add_fsys("ext4", { value: "ext4", title: "EXT4" });
    add_fsys("vfat", { value: "vfat", title: "VFAT" });
    add_fsys("ntfs", { value: "ntfs", title: "NTFS" });
    add_fsys(true, { value: "empty", title: _("No filesystem") });
    if (create_partition && enable_dos_extended)
        add_fsys(true, { value: "dos-extended", title: _("Extended partition") });

    function is_encrypted(vals) {
        return vals.crypto !== "none";
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

    var crypto_types = [{ value: "none", title: _("No encryption") }];
    add_crypto_type("luks1", "LUKS1", false);
    add_crypto_type("luks2", "LUKS2", true);

    var usage = utils.get_active_usage(client, create_partition ? null : path);

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in active use"), utils.block_name(block)),
            Body: BlockingMessage(usage)
        });
        return;
    }

    var crypto_options = initial_crypto_options(client, block);
    var [, old_dir, old_opts] = get_fstab_config(block);
    if (!old_opts || old_opts == "defaults")
        old_opts = initial_mount_options(client, block);

    var split_options = parse_options(old_opts == "defaults" ? "" : old_opts);
    var opt_noauto = extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "ro");
    var extra_options = unparse_options(split_options);

    dialog_open({
        Title: title,
        Footer: TeardownMessage(usage),
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
            CheckBoxes("erase", _("Erase"),
                       {
                           fields: [
                               { tag: "on", title: _("Overwrite existing data with zeros") }
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
                               auto: !opt_noauto,
                               ro: opt_ro,
                               extra: extra_options || false
                           },
                           fields: [
                               { title: _("Mount now"), tag: "auto" },
                               { title: _("Mount read only"), tag: "ro" },
                               { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                           ]
                       }),
            SelectOne("crypto", _("Encryption"),
                      { choices: crypto_types }),
            [
                PassInput("passphrase", _("Passphrase"),
                          {
                              validate: function (phrase) {
                                  if (phrase === "")
                                      return _("Passphrase cannot be empty");
                              },
                              visible: is_encrypted
                          }),
                PassInput("passphrase2", _("Confirm"),
                          {
                              validate: function (phrase2, vals) {
                                  if (phrase2 != vals.passphrase)
                                      return _("Passphrases do not match");
                              },
                              visible: is_encrypted
                          })
            ].concat(crypto_options_dialog_fields(crypto_options, is_encrypted, true, true)),

        ],
        update: function (dlg, vals, trigger) {
            if (trigger == "crypto_options" && vals.crypto_options.ro == true)
                dlg.set_nested_values("mount_options", { ro: true });
            if (trigger == "mount_options" && vals.mount_options.ro == false)
                dlg.set_nested_values("crypto_options", { ro: false });
        },
        Action: {
            Title: create_partition ? _("Create partition") : _("Format"),
            Danger: (create_partition ? null : _("Formatting a storage device will erase all data on it.")),
            wrapper: job_progress_wrapper(client, block.path),
            action: function (vals) {
                var options = {
                    'tear-down': { t: 'b', v: true }
                };
                if (vals.erase.on)
                    options.erase = { t: 's', v: "zero" };
                if (vals.name)
                    options.label = { t: 's', v: vals.name };

                // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1516041
                if (client.vdo_overlay.find_by_block(block)) {
                    options['no-discard'] = { t: 'b', v: true };
                }

                var config_items = [];
                if (is_encrypted(vals)) {
                    options["encrypt.passphrase"] = { t: 's', v: vals.passphrase };
                    options["encrypt.type"] = { t: 's', v: vals.crypto };

                    var item = {
                        options: { t: 'ay', v: utils.encode_filename(crypto_options_dialog_options(vals)) },
                        "track-parents": { t: 'b', v: true }
                    };
                    if (vals.crypto_options && vals.store_passphrase.on) {
                        item["passphrase-contents"] =
                                  { t: 'ay', v: utils.encode_filename(vals.passphrase) };
                    } else {
                        item["passphrase-contents"] =
                                  { t: 'ay', v: utils.encode_filename("") };
                    }
                    config_items.push(["crypttab", item]);
                }

                if (is_filesystem(vals)) {
                    var mount_options = [];
                    if (!vals.mount_options.auto ||
                        (is_encrypted(vals) && !vals.crypto_options.auto) ||
                        get_cryptobacking_noauto(client, block)) {
                        mount_options.push("noauto");
                    }
                    if (vals.mount_options.ro)
                        mount_options.push("ro");
                    if (vals.mount_options.extra)
                        mount_options.push(vals.mount_options.extra);

                    var mount_point = vals.mount_point;
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

                function format() {
                    if (create_partition) {
                        if (vals.type == "dos-extended")
                            return block_ptable.CreatePartition(start, vals.size, "0x05", "", { });
                        else if (vals.type == "empty")
                            return block_ptable.CreatePartition(start, vals.size, "", "", { });
                        else
                            return block_ptable.CreatePartitionAndFormat(start, vals.size, "", "", { },
                                                                         vals.type, options);
                    } else {
                        return block.Format(vals.type, options);
                    }
                }

                function block_fsys_for_block(path) {
                    return (client.blocks_fsys[path] ||
                            (client.blocks_cleartext[path] &&
                             client.blocks_fsys[client.blocks_cleartext[path].path]));
                }

                function maybe_mount(new_path) {
                    const path = new_path || block.path;
                    if (is_filesystem(vals) && vals.mount_options.auto)
                        return (client.wait_for(() => block_fsys_for_block(path))
                                .then(block_fsys => block_fsys.Mount({ })));
                }

                return utils.teardown_active_usage(client, usage)
                        .then(utils.reload_systemd)
                        .then(format)
                        .then(new_path => utils.reload_systemd().then(() => new_path))
                        .then(maybe_mount);
            }
        }
    });
}
