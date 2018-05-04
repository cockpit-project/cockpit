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

var cockpit = require("cockpit");
var utils = require("./utils.js");
var dialog = require("./dialog.js");

var React = require("react");
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

function mounting_dialog_fields(is_custom, mount_dir, mount_options, visible) {
    if (!visible)
        visible = function () { return true; };

    var split_options = parse_options(mount_options == "defaults" ? "" : mount_options);
    var opt_auto = !extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "ro");
    var extra_options = unparse_options(split_options);

    return [
        { SelectOne: "mounting",
          Title: _("Mounting"),
          Options: [
              { value: "default", Title: _("Default"), selected: !is_custom },
              { value: "custom", Title: _("Custom"), selected: is_custom }
          ],
          visible: visible
        },
        { TextInput: "mount_point",
          Title: _("Mount Point"),
          Value: mount_dir,
          visible: function (vals) {
              return visible(vals) && vals.mounting == "custom";
          },
          validate: function (val) {
              if (val.trim() == "")
                  return _("Mount point can not be empty");
          }
        },
        { RowTitle: _("Mount options"),
          CheckBox: "mount_auto",
          Title: _("Mount at boot"),
          Value: opt_auto,
          visible: function (vals) {
              return visible(vals) && vals.mounting == "custom";
          },
          update: function (vals, trigger) {
              if (trigger == "crypto_options_auto" && vals.crypto_options_auto == false)
                  return false;
              else
                  return vals.mount_auto;
          }
        },
        { CheckBox: "mount_ro",
          Title: _("Mount read only"),
          Value: opt_ro,
          visible: function (vals) {
              return visible(vals) && vals.mounting == "custom";
          },
          update: function (vals, trigger) {
              if (trigger == "crypto_options_ro" && vals.crypto_options_ro == true)
                  return true;
              else
                  return vals.mount_ro;
          }
        },
        { CheckBoxText: "mount_extra_options",
          Title: _("Custom mount options"),
          Value: extra_options == "" ? false : extra_options,
          visible: function (vals) {
              return visible(vals) && vals.mounting == "custom";
          }
        }
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

function crypto_options_dialog_fields(options, visible) {
    var split_options = parse_options(options);
    var opt_auto = !extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "readonly");
    var extra_options = unparse_options(split_options);

    return [
        { RowTitle: _("Encryption Options"),
          CheckBox: "crypto_options_auto",
          Title: _("Unlock at boot"),
          Value: opt_auto,
          visible: visible
        },
        { CheckBox: "crypto_options_ro",
          Title: _("Unlock read only"),
          Value: opt_ro,
          visible: visible
        },
        { CheckBoxText: "crypto_extra_options",
          Title: _("Custom encryption options"),
          Value: extra_options == "" ? false : extra_options,
          visible: visible
        }
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
     * we do n't offer that in the UI.  (Most importantly, they
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
    add_fsys("xfs", { value: "xfs", Title: _("XFS - Red Hat Enterprise Linux 7 default") });
    add_fsys("ext4", { value: "ext4", Title: _("ext4 - Red Hat Enterprise Linux 6 default") });
    add_fsys("xfs", { value: "luks+xfs", Title: _("Encrypted XFS (LUKS)") });
    add_fsys("ext4", { value: "luks+ext4", Title: _("Encrypted EXT4 (LUKS)") });
    add_fsys("vfat", { value: "vfat", Title: _("VFAT - Compatible with all systems and devices") });
    add_fsys("ntfs", { value: "ntfs", Title: _("NTFS - Compatible with most systems") });
    add_fsys(true, { value: "dos-extended",
                     Title: _("Extended Partition"),
                     disabled: !(create_partition && enable_dos_extended) });
    add_fsys(true, { value: "empty", Title: _("No Filesystem") });
    add_fsys(true, { value: "custom", Title: _("Custom (Enter filesystem type)") });

    var usage = utils.get_active_usage(client, create_partition ? null : path);

    if (usage.Blocking) {
        dialog.open({ Title: cockpit.format(_("$0 is in active use"), utils.block_name(block)),
                      Blocking: usage.Blocking,
                      Fields: [ ]
        });
        return;
    }

    dialog.open({ Title: title,
                  Teardown: usage.Teardown,
                  Fields: [
                      { SizeSlider: "size",
                        Title: _("Size"),
                        Value: size,
                        Max: size,
                        visible: function () {
                            return create_partition;
                        }
                      },
                      { SelectOne: "erase",
                        Title: _("Erase"),
                        Options: [
                            { value: "no", Title: _("Don't overwrite existing data") },
                            { value: "zero", Title: _("Overwrite existing data with zeros") }
                        ]
                      },
                      { SelectOne: "type",
                        Title: _("Type"),
                        Options: filesystem_options
                      },
                      { TextInput: "name",
                        Title: _("Name"),
                        visible: is_filesystem
                      },
                      { TextInput: "custom",
                        Title: _("Filesystem type"),
                        visible: function (vals) {
                            return vals.type == "custom";
                        }
                      },
                      { PassInput: "passphrase",
                        Title: _("Passphrase"),
                        validate: function (phrase) {
                            if (phrase === "")
                                return _("Passphrase cannot be empty");
                        },
                        visible: is_encrypted
                      },
                      { PassInput: "passphrase2",
                        Title: _("Confirm passphrase"),
                        validate: function (phrase2, vals) {
                            if (phrase2 != vals.passphrase)
                                return _("Passphrases do not match");
                        },
                        visible: is_encrypted
                      },
                      { CheckBox: "store_passphrase",
                        Title: _("Store passphrase"),
                        visible: is_encrypted_and_not_old_udisks2
                      }
                  ].concat(crypto_options_dialog_fields("", is_encrypted_and_not_old_udisks2))
                          .concat(mounting_dialog_fields(false, "", "", is_filesystem_and_not_old_udisks2)),
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

var FormatButton = React.createClass({
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

    mounting_dialog_fields: mounting_dialog_fields,
    mounting_dialog_options: mounting_dialog_options,
    crypto_options_dialog_fields: crypto_options_dialog_fields,
    crypto_options_dialog_options: crypto_options_dialog_options,
    format_dialog: format_dialog,
    FormatButton: FormatButton
};
