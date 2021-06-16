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

import React from "react";
import {
    Alert,
    DescriptionList,
    DescriptionListTerm,
    DescriptionListGroup,
    DescriptionListDescription,
    Flex, FlexItem,
} from "@patternfly/react-core";

import cockpit from "cockpit";
import * as utils from "./utils.js";

import { dialog_open, TextInput, CheckBoxes } from "./dialog.jsx";
import { StorageButton, StorageLink } from "./storage-controls.jsx";
import { initial_tab_options, parse_options, unparse_options, extract_option } from "./format-dialog.jsx";

const _ = cockpit.gettext;

export function is_mounted(client, block) {
    const block_fsys = client.blocks_fsys[block.path];
    const mounted_at = block_fsys ? block_fsys.MountPoints : [];
    const config = utils.array_find(block.Configuration, function (c) { return c[0] == "fstab" });
    if (config && config[1].dir.v) {
        let dir = utils.decode_filename(config[1].dir.v);
        if (dir[0] != "/")
            dir = "/" + dir;
        return mounted_at.map(utils.decode_filename).indexOf(dir) >= 0;
    } else
        return null;
}

export function get_fstab_config(block) {
    const config = utils.array_find(block.Configuration, function (c) { return c[0] == "fstab" });
    if (config) {
        let dir = utils.decode_filename(config[1].dir.v);
        const opts = (utils.decode_filename(config[1].opts.v)
                .split(",")
                .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                .join(","));
        const parents = (utils.decode_filename(config[1].opts.v)
                .split(",")
                .filter(function (s) { return s.indexOf("x-parent") === 0 })
                .join(","));
        if (dir[0] != "/")
            dir = "/" + dir;
        return [config, dir, opts, parents];
    } else
        return [];
}

export function find_blocks_for_mount_point(client, mount_point, self) {
    const blocks = [];

    function is_self(b) {
        return self && (b == self || client.blocks[b.CryptoBackingDevice] == self);
    }

    for (const p in client.blocks) {
        const b = client.blocks[p];
        const [, dir] = get_fstab_config(b);
        if (dir == mount_point && !is_self(b))
            blocks.push(b);
    }

    return blocks;
}

export function is_valid_mount_point(client, block, val) {
    if (val === "")
        return _("Mount point cannot be empty");

    const other_blocks = find_blocks_for_mount_point(client, val, block);
    if (other_blocks.length > 0)
        return cockpit.format(_("Mount point is already used for $0"),
                              other_blocks.map(utils.block_name).join(", "));
}

export function get_cryptobacking_noauto(client, block) {
    const crypto_backing = client.blocks[block.CryptoBackingDevice];
    if (!crypto_backing)
        return false;

    const crypto_config = utils.array_find(crypto_backing.Configuration, function (c) { return c[0] == "crypttab" });
    if (!crypto_config)
        return false;

    const crypto_options = utils.decode_filename(crypto_config[1].options.v).split(",");
    return crypto_options.map(o => o.trim()).indexOf("noauto") >= 0;
}

export function check_mismounted_fsys(client, path, enter_warning) {
    const block = client.blocks[path];
    const block_fsys = client.blocks_fsys[path];

    if (!block || !block_fsys)
        return;

    const mounted_at = block_fsys.MountPoints.map(utils.decode_filename);
    const [, dir, opts] = get_fstab_config(block);
    const split_options = parse_options(opts);
    const opt_noauto = extract_option(split_options, "noauto");
    const opt_systemd_automount = split_options.indexOf("x-systemd.automount") >= 0;
    const is_mounted = mounted_at.indexOf(dir) >= 0;
    const other_mounts = mounted_at.filter(m => m != dir);
    const crypto_backing_noauto = get_cryptobacking_noauto(client, block);

    let type;
    if (dir) {
        if (!is_mounted && other_mounts.length > 0) {
            if (!opt_noauto)
                type = "change-mount-on-boot";
            else
                type = "mounted-no-config";
        } else if (crypto_backing_noauto && !opt_noauto)
            type = "locked-on-boot-mount";
        else if (!is_mounted && !opt_noauto)
            type = "mount-on-boot";
        else if (is_mounted && opt_noauto && !crypto_backing_noauto && !opt_systemd_automount)
            type = "no-mount-on-boot";
    } else if (other_mounts.length > 0) {
        type = "mounted-no-config";
    }

    if (type)
        enter_warning(path, { warning: "mismounted-fsys", type: type, other: other_mounts[0] });
}

export function mounting_dialog(client, block, mode) {
    const block_fsys = client.blocks_fsys[block.path];
    var [old_config, old_dir, old_opts, old_parents] = get_fstab_config(block);
    var options = old_config ? old_opts : initial_tab_options(client, block, true);
    const crypto_backing_noauto = get_cryptobacking_noauto(client, block);

    var split_options = parse_options(options == "defaults" ? "" : options);
    var opt_noauto = extract_option(split_options, "noauto");
    var opt_ro = extract_option(split_options, "ro");
    var extra_options = unparse_options(split_options);

    var is_filesystem_mounted = is_mounted(client, block);

    function maybe_update_config(new_dir, new_opts) {
        var new_config = null;
        var all_new_opts;

        if (new_opts && old_parents)
            all_new_opts = new_opts + "," + old_parents;
        else if (new_opts)
            all_new_opts = new_opts;
        else
            all_new_opts = old_parents;

        if (new_dir != "") {
            if (new_dir[0] != "/")
                new_dir = "/" + new_dir;
            new_config = [
                "fstab", {
                    fsname: old_config ? old_config[1].fsname : undefined,
                    dir: { t: 'ay', v: utils.encode_filename(new_dir) },
                    type: { t: 'ay', v: utils.encode_filename("auto") },
                    opts: { t: 'ay', v: utils.encode_filename(all_new_opts || "defaults") },
                    freq: { t: 'i', v: 0 },
                    passno: { t: 'i', v: 0 },
                    "track-parents": { t: 'b', v: !old_config }
                }];
        }

        function undo() {
            if (!old_config && new_config)
                return block.RemoveConfigurationItem(new_config, {});
            else if (old_config && !new_config)
                return block.AddConfigurationItem(old_config, {});
            else if (old_config && new_config && (new_dir != old_dir || new_opts != old_opts)) {
                return block.UpdateConfigurationItem(new_config, old_config, {});
            }
        }

        function maybe_unmount() {
            if (block_fsys.MountPoints.length > 0)
                return block_fsys.Unmount({ });
            else
                return Promise.resolve();
        }

        function maybe_mount() {
            if (mode == "mount" || (mode == "update" && is_filesystem_mounted)) {
                return (block_fsys.Mount({ })
                        .catch(error => {
                            return (undo()
                                    .then(() => block_fsys.Mount({ }))
                                    .then(() => Promise.reject(error))
                                    .catch(ignored_error => {
                                        console.warn("Error during undo:", ignored_error);
                                        return Promise.reject(error);
                                    }));
                        }));
            } else
                return Promise.resolve();
        }

        // We need to reload systemd twice: Once at the beginning so
        // that it is up to date with whatever is currently in fstab,
        // and once at the end to make it see our changes.  Otherwise
        // systemd might do some uexpected mounts/unmounts behind our
        // backs.

        return (utils.reload_systemd()
                .then(maybe_unmount)
                .then(() => {
                    if (!old_config && new_config)
                        return (block.AddConfigurationItem(new_config, {})
                                .then(maybe_mount)
                                .then(utils.reload_systemd));
                    else if (old_config && !new_config)
                        return block.RemoveConfigurationItem(old_config, {}).then(utils.reload_systemd);
                    else if (old_config && new_config && (new_dir != old_dir || new_opts != old_opts))
                        return (block.UpdateConfigurationItem(old_config, new_config, {})
                                .then(maybe_mount)
                                .then(utils.reload_systemd));
                    else if (new_config && !is_mounted(client, block))
                        return maybe_mount();
                }));
    }

    function remove() {
        dlg.run(null, maybe_update_config("", "").then(() => dlg.close()));
    }

    let fields = null;
    if (mode == "mount" || mode == "update")
        fields = [
            TextInput("mount_point", _("Mount point"),
                      {
                          value: old_dir,
                          validate: val => is_valid_mount_point(client, block, val)
                      }),
            CheckBoxes("mount_options", _("Mount options"),
                       {
                           value: {
                               ro: opt_ro,
                               extra: extra_options === "" ? false : extra_options
                           },
                           fields: [
                               { title: _("Mount read only"), tag: "ro" },
                               { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                           ]
                       },
            ),
        ];

    let footer = null;
    const show_clear_button = false;
    if (old_dir && mode == "update" && show_clear_button)
        footer = <div className="modal-footer-teardown"><button className="pf-c-button pf-m-link" onClick={remove}>{_("Clear mount point configuration")}</button></div>;
    if (!is_filesystem_mounted && block_fsys.MountPoints.length > 0)
        footer = (
            <>
                {footer}
                <div className="modal-footer-teardown">
                    <p>{cockpit.format(_("The filesystem is already mounted at $0. Proceeding will unmount it."),
                                       utils.decode_filename(block_fsys.MountPoints[0]))}</p>
                </div>
            </>);

    const mode_title = {
        mount: _("Mount filesystem"),
        unmount: _("Unmount filesystem"),
        update: _("Mount configuration")
    };

    const mode_action = {
        mount: _("Mount"),
        unmount: _("Unmount"),
        update: _("Apply")
    };

    function do_unmount() {
        var opts = [];
        opts.push("noauto");
        if (opt_ro)
            opts.push("ro");
        opts = opts.concat(extra_options);
        return maybe_update_config(old_dir, unparse_options(opts));
    }

    if (mode == "unmount") {
        client.run(do_unmount).catch(error => dialog_open({ Title: _("Error"), Body: error.toString() }));
        return;
    }

    const dlg = dialog_open({
        Title: mode_title[mode],
        Fields: fields,
        Footer: footer,
        Action: {
            Title: mode_action[mode],
            action: function (vals) {
                if (mode == "unmount") {
                    return do_unmount();
                } else if (mode == "mount" || mode == "update") {
                    var opts = [];
                    if ((mode == "update" && opt_noauto) || crypto_backing_noauto)
                        opts.push("noauto");
                    if (vals.mount_options.ro)
                        opts.push("ro");
                    if (vals.mount_options.extra !== false)
                        opts = opts.concat(parse_options(vals.mount_options.extra));
                    return maybe_update_config(vals.mount_point, unparse_options(opts));
                }
            }
        }
    });
}

export class FilesystemTab extends React.Component {
    constructor(props) {
        super(props);
        this.onSamplesChanged = this.onSamplesChanged.bind(this);
    }

    onSamplesChanged() {
        if (!this.props.client.busy)
            this.setState({});
    }

    componentDidMount() {
        this.props.client.fsys_sizes.addEventListener("changed", this.onSamplesChanged);
    }

    componentWillUnmount() {
        this.props.client.fsys_sizes.removeEventListener("changed", this.onSamplesChanged);
    }

    render() {
        var self = this;
        var block = self.props.block;
        var block_fsys = block && self.props.client.blocks_fsys[block.path];
        var mismounted_fsys_warning = self.props.warnings.find(w => w.warning == "mismounted-fsys");

        function rename_dialog() {
            dialog_open({
                Title: _("Filesystem name"),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                                  validate: name => utils.validate_fsys_label(name, block.IdType),
                                  value: block.IdLabel
                              })
                ],
                Action: {
                    Title: _("Apply"),
                    action: function (vals) {
                        return block_fsys.SetLabel(vals.name, {});
                    }
                }
            });
        }

        var is_filesystem_mounted = is_mounted(self.props.client, block);
        var [old_config, old_dir, old_opts, old_parents] = get_fstab_config(block);
        var split_options = parse_options(old_opts == "defaults" ? "" : old_opts);
        extract_option(split_options, "noauto");
        var opt_ro = extract_option(split_options, "ro");

        var used;
        if (is_filesystem_mounted) {
            var samples = self.props.client.fsys_sizes.data[old_dir];
            if (samples)
                used = cockpit.format(_("$0 of $1"),
                                      utils.fmt_size(samples[0]),
                                      utils.fmt_size(samples[1]));
            else
                used = _("Unknown");
        } else {
            used = "-";
        }

        var mount_point_text = null;
        if (old_dir) {
            if (old_opts && old_opts != "defaults") {
                var opt_texts = [];
                if (opt_ro)
                    opt_texts.push(_("read only"));
                opt_texts = opt_texts.concat(split_options);
                if (opt_texts.length)
                    mount_point_text = cockpit.format("$0 ($1)", old_dir, opt_texts.join(", "));
                else
                    mount_point_text = old_dir;
            } else
                mount_point_text = old_dir;
        }

        var extra_text = null;
        if (!is_filesystem_mounted) {
            if (!old_dir)
                extra_text = _("The filesystem has no permanent mount point.");
            else
                extra_text = _("The filesystem is not mounted.");
        }
        if (extra_text && mount_point_text)
            extra_text = <><br />{extra_text}</>;

        function fix_config() {
            const { type, other } = mismounted_fsys_warning;

            const opts = [];
            if (type == "mount-on-boot" || type == "locked-on-boot-mount")
                opts.push("noauto");
            if (opt_ro)
                opts.push("ro");

            const new_opts = unparse_options(opts.concat(split_options));
            let all_new_opts;
            if (new_opts && old_parents)
                all_new_opts = new_opts + "," + old_parents;
            else if (new_opts)
                all_new_opts = new_opts;
            else
                all_new_opts = old_parents;

            let new_dir = old_dir;
            if (type == "change-mount-on-boot" || type == "mounted-no-config")
                new_dir = other;

            const new_config = [
                "fstab", {
                    fsname: old_config ? old_config[1].fsname : undefined,
                    dir: { t: 'ay', v: utils.encode_filename(new_dir) },
                    type: { t: 'ay', v: utils.encode_filename("auto") },
                    opts: { t: 'ay', v: utils.encode_filename(all_new_opts || "defaults") },
                    freq: { t: 'i', v: 0 },
                    passno: { t: 'i', v: 0 }
                }];

            if (old_config)
                return block.UpdateConfigurationItem(old_config, new_config, {}).then(utils.reload_systemd);
            else
                return block.AddConfigurationItem(new_config, {}).then(utils.reload_systemd);
        }

        function fix_mount() {
            const { type } = mismounted_fsys_warning;
            if (type == "change-mount-on-boot")
                return block_fsys.Unmount({}).then(() => block_fsys.Mount({}));
            else if (type == "mount-on-boot")
                return block_fsys.Mount({});
            else if (type == "no-mount-on-boot")
                return block_fsys.Unmount({});
            else if (type == "mounted-no-config")
                return block_fsys.Unmount({});
        }

        var mismounted_section = null;
        if (mismounted_fsys_warning) {
            const { type, other } = mismounted_fsys_warning;
            let text;
            let fix_config_text;
            let fix_mount_text;

            if (type == "change-mount-on-boot") {
                text = cockpit.format(_("The filesystem is currently mounted on $0 but will be mounted on $1 on the next boot."), other, old_dir);
                fix_config_text = cockpit.format(_("Mount automatically on $0 on boot"), other);
                fix_mount_text = cockpit.format(_("Mount on $0 now"), old_dir);
            } else if (type == "mount-on-boot") {
                text = _("The filesystem is currently not mounted but will be mounted on the next boot.");
                fix_config_text = _("Do not mount automatically on boot");
                fix_mount_text = _("Mount now");
            } else if (type == "no-mount-on-boot") {
                text = _("The filesystem is currently mounted but will not be mounted after the next boot.");
                fix_config_text = _("Mount also automatically on boot");
                fix_mount_text = _("Unmount now");
            } else if (type == "mounted-no-config") {
                text = cockpit.format(_("The filesystem is currently mounted on $0 but will not be mounted after the next boot."), other);
                fix_config_text = cockpit.format(_("Mount automatically on $0 on boot"), other);
                fix_mount_text = _("Unmount now");
            } else if (type == "locked-on-boot-mount") {
                text = _("The filesystem is configured to be automatically mounted on boot but its encryption container will not be unlocked at that time.");
                fix_config_text = _("Do not mount automatically on boot");
                fix_mount_text = null;
            }

            mismounted_section = (
                <>
                    <br />
                    <Alert variant="warning"
                           isInline
                           title={_("Inconsistent filesystem mount")}>
                        {text}
                        <div className="storage_alert_action_buttons">
                            <StorageButton onClick={fix_config}>{fix_config_text}</StorageButton>
                            { fix_mount_text && <StorageButton onClick={fix_mount}>{fix_mount_text}</StorageButton> }
                        </div>
                    </Alert>
                </>);
        }

        return (
            <div>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Name")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Flex>
                                <FlexItem>{this.props.block.IdLabel || "-"}</FlexItem>
                                <FlexItem><StorageLink onClick={rename_dialog}>{_("edit")}</StorageLink></FlexItem>
                            </Flex>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Mount point")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            { mount_point_text &&
                            <Flex>
                                <FlexItem>{ mount_point_text }</FlexItem>
                                <FlexItem>
                                    <StorageLink onClick={() => mounting_dialog(self.props.client, block, "update")}>
                                        {_("edit")}
                                    </StorageLink>
                                </FlexItem>
                            </Flex>
                            }
                            { extra_text }
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Used")}</DescriptionListTerm>
                        <DescriptionListDescription>{used}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
                { mismounted_section }
            </div>
        );
    }
}
