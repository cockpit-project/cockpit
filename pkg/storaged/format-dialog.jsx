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

"use strict";

import {
    dialog_open,
    TextInput, PassInput, CheckBox, SelectOne, TextInputChecked, SizeSlider,
    BlockingMessage, TeardownMessage
} from "./dialogx.jsx";

var React = require("react");
var createReactClass = require('create-react-class');

var cockpit = require("cockpit");
var utils = require("./utils.js");

var StorageControls = require("./storage-controls.jsx");

var _ = cockpit.gettext;

function parse_options(options) {
    if (options)
        return (options.split(",")
                .map(function (s) { return s.trim() })
                .filter(function (s) { return s != "" }));
    else
        return [ ];
}

function unparse_options(split) {
    return split.join(",");
}

function extract_option(split, opt) {
    var index = split.indexOf(opt);
    if (index >= 0) {
        split.splice(index, 1);
        return true;
    } else {
        return false;
    }
}

function mounting_dialogx_fields(is_custom, mount_dir, mount_options, visible) {
    if (!visible)
        visible = function () { return true };

    var split_options = parse_options(mount_options == "defaults" ? "" : mount_options);
    var opt_auto = !extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "ro");
    var extra_options = unparse_options(split_options);

    return [
        SelectOne("mounting", _("Mounting"),
                  { value: is_custom ? "custom" : "default",
                    visible: visible,
                    choices: [
                        { value: "default", title: _("Default"), selected: !is_custom },
                        { value: "custom", title: _("Custom"), selected: is_custom }
                    ]}),
        TextInput("mount_point", _("Mount Point"),
                  { value: mount_dir,
                    visible: function (vals) {
                        return visible(vals) && vals.mounting == "custom";
                    },
                    validate: function (val) {
                        if (val.trim() == "")
                            return _("Mount point can not be empty");
                    }
                  }),
        CheckBox("mount_auto", _("Mount at boot"),
                 { row_title: _("Mount options"),
                   value: opt_auto,
                   visible: function (vals) {
                       return visible(vals) && vals.mounting == "custom";
                   }
                 }),
        CheckBox("mount_ro", _("Mount read only"),
                 { value: opt_ro,
                   visible: function (vals) {
                       return visible(vals) && vals.mounting == "custom";
                   }
                 }),
        TextInputChecked("mount_extra_options", _("Custom mount options"),
                         { value: extra_options == "" ? false : extra_options,
                           visible: function (vals) {
                               return visible(vals) && vals.mounting == "custom";
                           }
                         })
    ];
}

function mounting_dialog_options(vals) {
    var opts = [ ];
    if (!vals.mount_auto)
        opts.push("noauto");
    if (vals.mount_ro)
        opts.push("ro");
    if (vals.mount_extra_options !== false)
        opts = opts.concat(parse_options(vals.mount_extra_options));
    return unparse_options(opts);
}

function crypto_options_dialogx_fields(options, visible) {
    var split_options = parse_options(options);
    var opt_auto = !extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "readonly");
    var extra_options = unparse_options(split_options);

    return [
        CheckBox("crypto_options_auto", _("Unlock at boot"),
                 { row_title: _("Encryption Options"),
                   value: opt_auto,
                   visible: visible
                 }),
        CheckBox("crypto_options_ro", _("Unlock read only"),
                 { value: opt_ro,
                   visible: visible
                 }),
        TextInputChecked("crypto_extra_options", _("Custom encryption options"),
                         { value: extra_options == "" ? false : extra_options,
                           visible: visible
                         })
    ];
}

function crypto_options_dialog_options(vals) {
    var opts = [ ];
    if (!vals.crypto_options_auto)
        opts.push("noauto");
    if (vals.crypto_options_ro)
        opts.push("readonly");
    if (vals.crypto_extra_options !== false)
        opts = opts.concat(parse_options(vals.crypto_extra_options));
    return unparse_options(opts);
}

function format_dialog(client, path, start, size, enable_dos_extended) {
    var block = client.blocks[path];
    var block_ptable = client.blocks_ptable[path];

    var create_partition = (start !== undefined);

    var title;
    if (create_partition)
        title = cockpit.format(_("Create partition on $0"), utils.block_name(block));
    else
        title = cockpit.format(_("Format $0"), utils.block_name(block));

    function is_encrypted(vals) {
        return vals.type == "luks+xfs" || vals.type == "luks+ext4";
    }

    function is_filesystem(vals) {
        return vals.type != "empty" && vals.type != "dos-extended";
    }

    /* Older UDisks2 implementation don't have good
     * enough support for maintaining fstab and crypptab, so
     * we don't offer that in the UI.  (Most importantly, they
     * miss the 'tear-down' option and without that we'll end
     * up with obsolete fstab files all the time, which will
     * break the next boot.)
     */

    function is_encrypted_and_not_old_udisks2(vals) {
        return !client.is_old_udisks2 && is_encrypted(vals);
    }

    function is_filesystem_and_not_old_udisks2(vals) {
        return !client.is_old_udisks2 && is_filesystem(vals);
    }

    /* Older UDisks2 implementations don't have
     * CreateAndFormatPartition, so we simulate that.
     */

    function create_partition_and_format(ptable,
        start, size,
        part_type, part_name, part_options,
        type, options) {
        if (!client.is_old_udisks2)
            return ptable.CreatePartitionAndFormat(start, size,
                                                   part_type, part_name, part_options,
                                                   type, options);

        return ptable.CreatePartition(start, size, part_type, part_name, part_options)
                .then(function (partition) {
                // We don't use client.blocks[partition] here
                // because it might temporarily not exist.  In
                // that case, we prefer storaged to tell us in a
                // D-Bus error instead of causing a JavaScript
                // exception.
                //
                // See https://github.com/cockpit-project/cockpit/issues/4181
                    return client.call(partition, "Block", "Format", [ type, options ]).then(function () {
                        return partition;
                    });
                });
    }

    function add_fsys(storaged_name, entry) {
        if (storaged_name === true ||
            (client.fsys_info[storaged_name] && client.fsys_info[storaged_name].can_format)) {
            filesystem_options.push(entry);
        }
    }

    var filesystem_options = [ ];
    add_fsys("xfs", { value: "xfs", title: _("XFS - Red Hat Enterprise Linux 7 default") });
    add_fsys("ext4", { value: "ext4", title: _("ext4 - Red Hat Enterprise Linux 6 default") });
    add_fsys("xfs", { value: "luks+xfs", title: _("Encrypted XFS (LUKS)") });
    add_fsys("ext4", { value: "luks+ext4", title: _("Encrypted EXT4 (LUKS)") });
    add_fsys("vfat", { value: "vfat", title: _("VFAT - Compatible with all systems and devices") });
    add_fsys("ntfs", { value: "ntfs", title: _("NTFS - Compatible with most systems") });
    add_fsys(true, { value: "dos-extended",
                     title: _("Extended Partition"),
                     disabled: !(create_partition && enable_dos_extended) });
    add_fsys(true, { value: "empty", title: _("No Filesystem") });
    add_fsys(true, { value: "custom", title: _("Custom (Enter filesystem type)") });

    var usage = utils.get_active_usage(client, create_partition ? null : path);

    if (usage.Blocking) {
        dialog_open({ Title: cockpit.format(_("$0 is in active use"), utils.block_name(block)),
                      Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({ Title: title,
                  Footer: TeardownMessage(usage),
                  Fields: [
                      SizeSlider("size", _("Size"),
                                 { value: size,
                                   max: size,
                                   visible: function () {
                                       return create_partition;
                                   }
                                 }),
                      SelectOne("erase", _("Erase"),
                                { choices: [
                                    { value: "no", title: _("Don't overwrite existing data") },
                                    { value: "zero", title: _("Overwrite existing data with zeros") }
                                ]}),
                      SelectOne("type", _("Type"),
                                { choices: filesystem_options
                                }),
                      TextInput("name", _("Name"),
                                { visible: is_filesystem
                                }),
                      TextInput("custom", _("Filesystem type"),
                                { visible: function (vals) {
                                    return vals.type == "custom";
                                }
                                }),
                      PassInput("passphrase", _("Passphrase"),
                                { validate: function (phrase) {
                                    if (phrase === "")
                                        return _("Passphrase cannot be empty");
                                },
                                  visible: is_encrypted
                                }),
                      PassInput("passphrase2", _("Confirm passphrase"),
                                { validate: function (phrase2, vals) {
                                    if (phrase2 != vals.passphrase)
                                        return _("Passphrases do not match");
                                },
                                  visible: is_encrypted
                                }),
                      CheckBox("store_passphrase", _("Store passphrase"),
                               { visible: is_encrypted_and_not_old_udisks2 })
                  ].concat(crypto_options_dialogx_fields("", is_encrypted_and_not_old_udisks2))
                          .concat(mounting_dialogx_fields(false, "", "", is_filesystem_and_not_old_udisks2)),
                  update: function (dlg, vals, trigger) {
                      if (trigger == "crypto_options_auto" && vals.crypto_options_auto == false)
                          dlg.set_values({ "mount_auto": false });
                      if (trigger == "crypto_options_ro" && vals.crypto_options_ro == true)
                          dlg.set_values({ "mount_ro": true });
                      if (trigger == "mount_auto" && vals.mount_auto == true)
                          dlg.set_values({ "crypto_options_auto": true });
                      if (trigger == "mount_ro" && vals.mount_ro == false)
                          dlg.set_values({ "crypto_options_ro": false });
                  },
                  Action: {
                      Title: create_partition ? _("Create partition") : _("Format"),
                      Danger: (create_partition
                          ? null : _("Formatting a storage device will erase all data on it.")),
                      action: function (vals) {
                          if (vals.type == "custom")
                              vals.type = vals.custom;

                          var options = { 'no-block': { t: 'b', v: true },
                                          'dry-run-first': { t: 'b', v: true },
                                          'tear-down': { t: 'b', v: true }
                          };
                          if (vals.erase != "no")
                              options.erase = { t: 's', v: vals.erase };
                          if (vals.name)
                              options.label = { t: 's', v: vals.name };

                          // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1516041
                          if (client.vdo_overlay.find_by_block(block)) {
                              options['no-discard'] = { t: 'b', v: true };
                          }

                          var config_items = [ ];
                          var mount_options = mounting_dialog_options(vals);
                          if (vals.mounting == "custom")
                              config_items.push([
                                  "fstab", {
                                      dir: { t: 'ay', v: utils.encode_filename(vals.mount_point) },
                                      type: { t: 'ay', v: utils.encode_filename("auto") },
                                      opts: { t: 'ay', v: utils.encode_filename(mount_options || "defaults") },
                                      freq: { t: 'i', v: 0 },
                                      passno: { t: 'i', v: 0 },
                                      "track-parents": { t: 'b', v: true }
                                  }]);

                          var crypto_options = crypto_options_dialog_options(vals);
                          if (is_encrypted(vals)) {
                              vals.type = vals.type.replace("luks+", "");
                              options["encrypt.passphrase"] = { t: 's', v: vals.passphrase };

                              var item = {
                                  options: { t: 'ay', v: utils.encode_filename(crypto_options) },
                                  "track-parents": { t: 'b', v: true }
                              };
                              if (vals.store_passphrase) {
                                  item["passphrase-contents"] =
                                  { t: 'ay', v: utils.encode_filename(vals.passphrase) };
                              } else {
                                  item["passphrase-contents"] =
                                  { t: 'ay', v: utils.encode_filename("") };
                              }
                              config_items.push([ "crypttab", item ]);
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
                                      return create_partition_and_format(block_ptable,
                                                                         start, vals.size, "", "", { },
                                                                         vals.type, options);
                              } else {
                                  return block.Format(vals.type, options);
                              }
                          }

                          return utils.teardown_active_usage(client, usage).then(format);
                      }
                  }
    });
}

var FormatButton = createReactClass({
    onClick: function () {
        format_dialog(this.props.client, this.props.block.path);
    },
    render: function () {
        return (
            <StorageControls.StorageButton onClick={this.onClick}
                                           excuse={this.props.block.ReadOnly ? _("Device is read-only") : null}>
                {_("Format")}
            </StorageControls.StorageButton>
        );
    }
});

module.exports = {
    parse_options: parse_options,
    unparse_options: unparse_options,
    extract_option: extract_option,

    mounting_dialogx_fields: mounting_dialogx_fields,
    mounting_dialog_options: mounting_dialog_options,
    crypto_options_dialogx_fields: crypto_options_dialogx_fields,
    crypto_options_dialog_options: crypto_options_dialog_options,
    format_dialog: format_dialog,
    FormatButton: FormatButton
};
