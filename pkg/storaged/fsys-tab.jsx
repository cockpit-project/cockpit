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
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import cockpit from "cockpit";
import * as utils from "./utils.js";
import { parse_options, unparse_options, extract_option, set_crypto_options, set_crypto_auto_option, get_fstab_config_with_client } from "./utils.js";

import {
    dialog_open, TextInput, PassInput, CheckBoxes, SelectOne,
    TeardownMessage, init_active_usage_processes
} from "./dialog.jsx";
import { StorageButton, StorageLink } from "./storage-controls.jsx";
import { initial_tab_options, mount_explanation } from "./format-dialog.jsx";
import { init_existing_passphrase, unlock_with_type } from "./crypto-keyslots.jsx";

import client from "./client.js";

const _ = cockpit.gettext;

export function is_mounted(client, block) {
    const block_fsys = client.blocks_fsys[block.path];
    const mounted_at = block_fsys ? block_fsys.MountPoints : [];
    const config = block.Configuration.find(c => c[0] == "fstab");
    if (config && config[1].dir.v) {
        let dir = utils.decode_filename(config[1].dir.v);
        if (dir[0] != "/")
            dir = "/" + dir;
        return mounted_at.map(utils.decode_filename).indexOf(dir) >= 0;
    } else
        return null;
}

export function get_fstab_config(block, also_child_config) {
    return get_fstab_config_with_client(client, block, also_child_config);
}

function find_blocks_for_mount_point(client, mount_point, self) {
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

function nice_block_name(block) {
    return utils.block_name(client.blocks[block.CryptoBackingDevice] || block);
}

export function is_valid_mount_point(client, block, val, format_only, for_fstab) {
    if (val === "") {
        if (!format_only || for_fstab)
            return _("Mount point cannot be empty");
        return null;
    }

    const other_blocks = find_blocks_for_mount_point(client, val, block);
    if (other_blocks.length > 0)
        return cockpit.format(_("Mount point is already used for $0"),
                              other_blocks.map(nice_block_name).join(", "));

    if (!format_only) {
        const children = utils.find_children_for_mount_point(client, val, block);
        if (Object.keys(children).length > 0)
            return <>
                {_("Filesystems are already mounted below this mountpoint.")}
                {Object.keys(children).map(m => <div key={m}>{cockpit.format("• $0 on $1", nice_block_name(children[m]), m)}</div>)}
                {_("Please unmount them first.")}
            </>;
    }
}

export function get_cryptobacking_noauto(client, block) {
    const crypto_backing = block.IdUsage == "crypto" ? block : client.blocks[block.CryptoBackingDevice];
    if (!crypto_backing)
        return false;

    const crypto_config = crypto_backing.Configuration.find(c => c[0] == "crypttab");
    if (!crypto_config)
        return false;

    const crypto_options = utils.decode_filename(crypto_config[1].options.v).split(",")
            .map(o => o.trim());
    return crypto_options.indexOf("noauto") >= 0;
}

export function check_mismounted_fsys(client, path, enter_warning) {
    const block = client.blocks[path];
    const block_fsys = client.blocks_fsys[path];
    const is_locked_crypto = block.IdUsage == "crypto" && !client.blocks_cleartext[path];
    const [, dir, opts] = get_fstab_config(block, is_locked_crypto);

    if (!block || !(block_fsys || dir))
        return;

    const mounted_at = block_fsys ? block_fsys.MountPoints.map(utils.decode_filename) : [];
    const split_options = parse_options(opts);
    const opt_noauto = extract_option(split_options, "noauto");
    const opt_noauto_intent = extract_option(split_options, "x-cockpit-never-auto");
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
        else if (is_mounted && opt_noauto && !opt_noauto_intent && !opt_systemd_automount)
            type = "no-mount-on-boot";
    } else if (other_mounts.length > 0) {
        // We don't complain about the rootfs, it's probably
        // configured somewhere else, like in the bootloader.
        if (other_mounts[0] != "/")
            type = "mounted-no-config";
    }

    if (type)
        enter_warning(path, { warning: "mismounted-fsys", type, other: other_mounts[0] });
}

export function mounting_dialog(client, block, mode, forced_options) {
    const block_fsys = client.blocks_fsys[block.path];
    const [old_config, old_dir, old_opts, old_parents] = get_fstab_config(block, true);
    const options = old_config ? old_opts : initial_tab_options(client, block, true);

    const split_options = parse_options(options);
    extract_option(split_options, "noauto");
    const opt_never_auto = extract_option(split_options, "x-cockpit-never-auto");
    const opt_ro = extract_option(split_options, "ro");
    const opt_nofail = extract_option(split_options, "nofail");
    const opt_netdev = extract_option(split_options, "_netdev");
    if (forced_options)
        for (const opt of forced_options)
            extract_option(split_options, opt);
    const extra_options = unparse_options(split_options);

    const is_filesystem_mounted = is_mounted(client, block);

    function maybe_update_config(new_dir, new_opts, passphrase, passphrase_type) {
        let new_config = null;
        let all_new_opts;

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

        function get_block_fsys() {
            if (block_fsys)
                return Promise.resolve(block_fsys);
            else
                return client.wait_for(() => (client.blocks_cleartext[block.path] &&
                                              client.blocks_fsys[client.blocks_cleartext[block.path].path]));
        }

        function maybe_mount() {
            if (mode == "mount" || (mode == "update" && is_filesystem_mounted)) {
                return (get_block_fsys()
                        .then(block_fsys => {
                            const block = client.blocks[block_fsys.path];
                            return (client.mount_at(block, new_dir)
                                    .catch(error => {
                                        // systemd might have mounted the filesystem for us after
                                        // unlocking, because fstab told it to.  Ignore any error
                                        // from mounting in that case.  This only happens when this
                                        // code runs to fix a inconsistent mount.
                                        return (utils.is_mounted_synch(block)
                                                .then(mounted_at => {
                                                    if (mounted_at == new_dir)
                                                        return;
                                                    return (undo()
                                                            .then(() => {
                                                                if (is_filesystem_mounted)
                                                                    return client.mount_at(block, old_dir);
                                                            })
                                                            .catch(ignored_error => {
                                                                console.warn("Error during undo:", ignored_error);
                                                            })
                                                            .then(() => Promise.reject(error)));
                                                }));
                                    }));
                        }));
            } else
                return Promise.resolve();
        }

        function maybe_unlock() {
            const crypto = client.blocks_crypto[block.path];
            if (mode == "mount" && crypto) {
                return (unlock_with_type(client, block, passphrase, passphrase_type)
                        .catch(error => {
                            dlg.set_values({ needs_explicit_passphrase: true });
                            return Promise.reject(error);
                        }));
            } else
                return Promise.resolve();
        }

        function maybe_lock() {
            if (mode == "unmount") {
                const crypto_backing = client.blocks[block.CryptoBackingDevice];
                const crypto_backing_crypto = crypto_backing && client.blocks_crypto[crypto_backing.path];
                if (crypto_backing_crypto) {
                    return crypto_backing_crypto.Lock({});
                } else
                    return Promise.resolve();
            }
        }

        // We need to reload systemd twice: Once at the beginning so
        // that it is up to date with whatever is currently in fstab,
        // and once at the end to make it see our changes.  Otherwise
        // systemd might do some uexpected mounts/unmounts behind our
        // backs.

        return (utils.reload_systemd()
                .then(() => utils.teardown_active_usage(client, usage))
                .then(maybe_unlock)
                .then(() => {
                    if (!old_config && new_config)
                        return (block.AddConfigurationItem(new_config, {})
                                .then(maybe_mount));
                    else if (old_config && !new_config)
                        return block.RemoveConfigurationItem(old_config, {});
                    else if (old_config && new_config)
                        return (block.UpdateConfigurationItem(old_config, new_config, {})
                                .then(maybe_mount));
                    else if (new_config && !is_mounted(client, block))
                        return maybe_mount();
                })
                .then(maybe_lock)
                .then(utils.reload_systemd));
    }

    let at_boot;
    if (opt_never_auto)
        at_boot = "never";
    else if (opt_netdev)
        at_boot = "netdev";
    else if (opt_nofail)
        at_boot = "nofail";
    else
        at_boot = "local";

    let fields = null;
    if (mode == "mount" || mode == "update") {
        fields = [
            TextInput("mount_point", _("Mount point"),
                      {
                          value: old_dir,
                          validate: val => is_valid_mount_point(client, block, val, mode == "update" && !is_filesystem_mounted, true)
                      }),
            CheckBoxes("mount_options", _("Mount options"),
                       {
                           value: {
                               ro: opt_ro,
                               extra: extra_options || false
                           },
                           fields: [
                               { title: _("Mount read only"), tag: "ro" },
                               { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                           ]
                       }),
            SelectOne("at_boot", _("At boot"),
                      {
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
        ];

        if (block.IdUsage == "crypto" && mode == "mount")
            fields = fields.concat([
                PassInput("passphrase", _("Passphrase"),
                          {
                              visible: vals => vals.needs_explicit_passphrase,
                              validate: val => !val.length && _("Passphrase cannot be empty"),
                          })
            ]);
    }

    const mode_title = {
        mount: _("Mount filesystem"),
        unmount: _("Unmount filesystem $0"),
        update: _("Mount configuration")
    };

    const mode_action = {
        mount: _("Mount"),
        unmount: _("Unmount"),
        update: _("Save")
    };

    function do_unmount() {
        let opts = [];
        opts.push("noauto");
        if (opt_ro)
            opts.push("ro");
        if (opt_never_auto)
            opts.push("x-cockpit-never-auto");
        if (opt_nofail)
            opts.push("nofail");
        if (opt_netdev)
            opts.push("_netdev");
        if (forced_options)
            opts = opts.concat(forced_options);
        if (extra_options)
            opts = opts.concat(extra_options);
        return (maybe_set_crypto_options(null, false, null, null)
                .then(() => maybe_update_config(old_dir, unparse_options(opts))));
    }

    let passphrase_type;

    function maybe_set_crypto_options(readonly, auto, nofail, netdev) {
        if (client.blocks_crypto[block.path]) {
            return set_crypto_options(block, readonly, auto, nofail, netdev);
        } else if (client.blocks_crypto[block.CryptoBackingDevice]) {
            return set_crypto_options(client.blocks[block.CryptoBackingDevice], readonly, auto, nofail, netdev);
        } else
            return Promise.resolve();
    }

    const usage = utils.get_active_usage(client, block.path);

    const dlg = dialog_open({
        Title: cockpit.format(mode_title[mode], old_dir),
        Fields: fields,
        Teardown: TeardownMessage(usage, old_dir),
        update: function (dlg, vals, trigger) {
            if (trigger == "at_boot")
                dlg.set_options("at_boot", { explanation: mount_explanation[vals.at_boot] });
        },
        Action: {
            Title: mode_action[mode],
            action: function (vals) {
                if (mode == "unmount") {
                    return do_unmount();
                } else if (mode == "mount" || mode == "update") {
                    let opts = [];
                    if ((mode == "update" && !is_filesystem_mounted) || vals.at_boot == "never")
                        opts.push("noauto");
                    if (vals.mount_options.ro)
                        opts.push("ro");
                    if (vals.at_boot == "never")
                        opts.push("x-cockpit-never-auto");
                    if (vals.at_boot == "nofail")
                        opts.push("nofail");
                    if (vals.at_boot == "netdev")
                        opts.push("_netdev");
                    if (forced_options)
                        opts = opts.concat(forced_options);
                    if (vals.mount_options.extra !== false)
                        opts = opts.concat(parse_options(vals.mount_options.extra));
                    return (maybe_update_config(vals.mount_point, unparse_options(opts),
                                                vals.passphrase, passphrase_type)
                            .then(() => maybe_set_crypto_options(vals.mount_options.ro,
                                                                 opts.indexOf("noauto") == -1,
                                                                 vals.at_boot == "nofail",
                                                                 vals.at_boot == "netdev")));
                }
            }
        },
        Inits: [
            init_active_usage_processes(client, usage, old_dir),
            (block.IdUsage == "crypto" && mode == "mount")
                ? init_existing_passphrase(block, true, type => { passphrase_type = type })
                : null
        ]
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
        const self = this;
        const block = self.props.block;
        const forced_options = self.props.forced_options;
        const is_locked = block && block.IdUsage == 'crypto';
        const block_fsys = block && self.props.client.blocks_fsys[block.path];
        const stratis_fsys = block && self.props.client.blocks_stratis_fsys[block.path];

        const mismounted_fsys_warning = self.props.warnings.find(w => w.warning == "mismounted-fsys");

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
                    Title: _("Save"),
                    action: function (vals) {
                        return block_fsys.SetLabel(vals.name, {});
                    }
                }
            });
        }

        const is_filesystem_mounted = is_mounted(self.props.client, block);
        const [old_config, old_dir, old_opts, old_parents] = get_fstab_config(block, true);
        const split_options = parse_options(old_opts);
        extract_option(split_options, "noauto");
        const opt_ro = extract_option(split_options, "ro");
        const opt_never_auto = extract_option(split_options, "x-cockpit-never-auto");
        const opt_nofail = extract_option(split_options, "nofail");
        const opt_netdev = extract_option(split_options, "_netdev");
        const split_options_for_fix_config = split_options.slice();
        if (forced_options)
            for (const opt of forced_options)
                extract_option(split_options, opt);

        let mount_point_text = null;
        if (old_dir) {
            let opt_texts = [];
            if (opt_ro)
                opt_texts.push(_("read only"));
            if (opt_never_auto)
                opt_texts.push(_("never mount at boot"));
            else if (opt_netdev)
                opt_texts.push(_("after network"));
            else if (opt_nofail)
                opt_texts.push(_("ignore failure"));
            else
                opt_texts.push(_("stop boot on failure"));
            opt_texts = opt_texts.concat(split_options);
            if (opt_texts.length) {
                mount_point_text = cockpit.format("$0 ($1)", old_dir, opt_texts.join(", "));
            } else {
                mount_point_text = old_dir;
            }
        }

        let extra_text = null;
        if (!is_filesystem_mounted) {
            if (!old_dir)
                extra_text = _("The filesystem has no permanent mount point.");
            else
                extra_text = _("The filesystem is not mounted.");
        } else if (block.CryptoBackingDevice != "/") {
            if (!opt_never_auto)
                extra_text = _("The filesystem will be unlocked and mounted on the next boot. This might require inputting a passphrase.");
        }

        if (extra_text && mount_point_text)
            extra_text = <><br />{extra_text}</>;

        function fix_config() {
            const { type, other } = mismounted_fsys_warning;

            let opts = [];
            if (type == "mount-on-boot")
                opts.push("noauto");
            if (type == "locked-on-boot-mount") {
                opts.push("noauto");
                opts.push("x-cockpit-never-auto");
            }
            if (opt_ro)
                opts.push("ro");
            if (opt_nofail)
                opts.push("nofail");
            if (opt_netdev)
                opts.push("_netdev");

            // Add the forced options, but only to new entries.  We
            // don't want to modify existing entries beyond what we
            // say on the button.
            if (!old_config && forced_options)
                opts = opts.concat(forced_options);

            const new_opts = unparse_options(opts.concat(split_options_for_fix_config));
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
                    passno: { t: 'i', v: 0 },
                    "track-parents": { t: 'b', v: !old_config }
                }];

            function fixup_crypto_backing() {
                const crypto_backing = (block.IdUsage == "crypto") ? block : client.blocks[block.CryptoBackingDevice];
                if (!crypto_backing)
                    return;
                if (type == "no-mount-on-boot")
                    return set_crypto_auto_option(crypto_backing, true);
                if (type == "locked-on-boot-mount")
                    return set_crypto_auto_option(crypto_backing, false);
            }

            function fixup_fsys() {
                if (old_config)
                    return block.UpdateConfigurationItem(old_config, new_config, {}).then(utils.reload_systemd);
                else
                    return block.AddConfigurationItem(new_config, {}).then(utils.reload_systemd);
            }

            return fixup_fsys().then(fixup_crypto_backing);
        }

        function fix_mount() {
            const { type, other } = mismounted_fsys_warning;
            const crypto_backing = (block.IdUsage == "crypto") ? block : client.blocks[block.CryptoBackingDevice];
            const crypto_backing_crypto = crypto_backing && client.blocks_crypto[crypto_backing.path];

            function do_mount() {
                if (crypto_backing == block)
                    mounting_dialog(client, block, "mount", forced_options);
                else
                    return client.mount_at(block, old_dir);
            }

            function do_unmount() {
                return client.unmount_at(old_dir)
                        .then(() => {
                            if (crypto_backing)
                                return crypto_backing_crypto.Lock({});
                        });
            }

            if (type == "change-mount-on-boot")
                return client.unmount_at(other).then(() => client.mount_at(block, old_dir));
            else if (type == "mount-on-boot")
                return do_mount();
            else if (type == "no-mount-on-boot")
                return do_unmount();
            else if (type == "mounted-no-config")
                return do_unmount();
            else if (type == "locked-on-boot-mount") {
                if (crypto_backing)
                    return set_crypto_auto_option(crypto_backing, true);
            }
        }

        let mismounted_section = null;
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
                fix_mount_text = _("Unlock automatically on boot");
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
                    { !stratis_fsys &&
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Name")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Flex>
                                <FlexItem>{this.props.block.IdLabel || "-"}</FlexItem>
                                <FlexItem>
                                    <StorageLink onClick={rename_dialog}
                                                 excuse={is_locked ? _("Filesystem is locked") : null}>
                                        {_("edit")}
                                    </StorageLink>
                                </FlexItem>
                            </Flex>
                        </DescriptionListDescription>
                    </DescriptionListGroup> }
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Mount point")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            { mount_point_text &&
                            <Flex>
                                <FlexItem>{ mount_point_text }</FlexItem>
                                <FlexItem>
                                    <StorageLink onClick={() => mounting_dialog(self.props.client, block, "update",
                                                                                forced_options)}>
                                        {_("edit")}
                                    </StorageLink>
                                </FlexItem>
                            </Flex>
                            }
                            { extra_text }
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
                { mismounted_section }
            </div>
        );
    }
}
