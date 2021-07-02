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

import {
    DescriptionList,
    DescriptionListTerm,
    DescriptionListGroup,
    DescriptionListDescription
} from "@patternfly/react-core";
import cockpit from "cockpit";
import { dialog_open, PassInput, CheckBoxes } from "./dialog.jsx";
import { array_find, encode_filename, decode_filename, block_name } from "./utils.js";
import { parse_options, unparse_options, extract_option } from "./format-dialog.jsx";
import { is_mounted } from "./fsys-tab.jsx";

import React from "react";
import { StorageButton, StorageLink } from "./storage-controls.jsx";

import * as python from "python.js";
import luksmeta_monitor_hack_py from "raw-loader!./luksmeta-monitor-hack.py";

import { CryptoKeyslots } from "./crypto-keyslots.jsx";

const _ = cockpit.gettext;

export function edit_config(block, modify) {
    var old_config, new_config;

    function commit() {
        new_config[1]["track-parents"] = { t: 'b', v: true };
        if (old_config)
            return block.UpdateConfigurationItem(old_config, new_config, { });
        else
            return block.AddConfigurationItem(new_config, { });
    }

    return block.GetSecretConfiguration({}).then(
        function (items) {
            old_config = array_find(items, function (c) { return c[0] == "crypttab" });
            new_config = ["crypttab", old_config ? Object.assign({ }, old_config[1]) : { }];

            // UDisks insists on always having a "passphrase-contents" field when
            // adding a crypttab entry, but doesn't include one itself when returning
            // an entry without a stored passphrase.
            //
            if (!new_config[1]['passphrase-contents'])
                new_config[1]['passphrase-contents'] = { t: 'ay', v: encode_filename("") };

            return modify(new_config[1], commit);
        });
}

export class CryptoTab extends React.Component {
    constructor() {
        super();
        // Initialize for LUKSv1 and set max_slots to 8.
        this.state = { luks_version: 1, slots: null, slot_error: null, max_slots: 8 };
    }

    monitor_slots(block) {
        // HACK - we only need this until UDisks2 has a Encrypted.Slots property or similar.
        if (block != this.monitored_block) {
            if (this.monitored_block)
                this.monitor_channel.close();
            this.monitored_block = block;
            if (block) {
                var dev = decode_filename(block.Device);
                this.monitor_channel = python.spawn(luksmeta_monitor_hack_py, [dev], { superuser: true });
                var buf = "";
                this.monitor_channel.stream(output => {
                    var lines;
                    buf += output;
                    lines = buf.split("\n");
                    buf = lines[lines.length - 1];
                    if (lines.length >= 2) {
                        const data = JSON.parse(lines[lines.length - 2]);
                        this.setState({ slots: data.slots, luks_version: data.version, max_slots: data.max_slots });
                    }
                });
                this.monitor_channel.fail(err => {
                    this.setState({ slots: [], slot_error: err });
                });
            }
        }
    }

    componentWillUnmount() {
        this.monitor_slots(null);
    }

    render() {
        var self = this;
        var client = self.props.client;
        var block = self.props.block;

        this.monitor_slots(block);

        function edit_stored_passphrase() {
            edit_config(block, function (config, commit) {
                dialog_open({
                    Title: _("Stored passphrase"),
                    Fields: [
                        PassInput("passphrase", _("Stored passphrase"),
                                  {
                                      value: (config && config['passphrase-contents']
                                          ? decode_filename(config['passphrase-contents'].v)
                                          : "")
                                  })
                    ],
                    Action: {
                        Title: _("Apply"),
                        action: function (vals) {
                            config["passphrase-contents"] = {
                                t: 'ay',
                                v: encode_filename(vals.passphrase)
                            };
                            delete config["passphrase-path"];
                            return commit();
                        }
                    }
                });
            });
        }

        var old_config, old_options;

        old_config = array_find(block.Configuration, function (c) { return c[0] == "crypttab" });
        if (old_config) {
            old_options = (decode_filename(old_config[1].options.v)
                    .split(",")
                    .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                    .join(","));
        }

        var split_options = parse_options(old_options);
        var opt_noauto = extract_option(split_options, "noauto");
        var opt_never_auto = extract_option(split_options, "x-cockpit-never-auto");
        var opt_ro = extract_option(split_options, "readonly");
        var extra_options = unparse_options(split_options);

        function edit_options() {
            var fsys_config = array_find(client.blocks_crypto[block.path].ChildConfiguration,
                                         c => c[0] == "fstab");
            var content_block = client.blocks_cleartext[block.path];
            var is_fsys = fsys_config || (content_block && content_block.IdUsage == "filesystem");

            var fields = [];
            fields.push({ title: _("Never unlock at boot"), tag: "never_auto" });
            if (!is_fsys)
                fields.push({ title: _("Unlock read only"), tag: "ro" });
            fields.push({ title: _("Custom encryption options"), tag: "extra", type: "checkboxWithInput" });

            function maybe_set_fsys_noauto(flag) {
                if (!fsys_config)
                    return Promise.resolve();

                const new_config = ["fstab", Object.assign({ }, fsys_config[1])];
                const opts = parse_options(decode_filename(fsys_config[1].opts.v));
                extract_option(opts, "noauto");
                if (flag)
                    opts.push("noauto");
                new_config[1].opts = { t: 'ay', v: encode_filename(unparse_options(opts)) };
                return block.UpdateConfigurationItem(fsys_config, new_config, { });
            }

            edit_config(block, function (config, commit) {
                dialog_open({
                    Title: _("Encryption options"),
                    Fields: [
                        CheckBoxes("options", _(""),
                                   {
                                       value: {
                                           never_auto: opt_never_auto,
                                           ro: opt_ro,
                                           extra: extra_options === "" ? false : extra_options
                                       },
                                       fields: fields
                                   }),
                    ],
                    isFormHorizontal: false,
                    Action: {
                        Title: _("Apply"),
                        action: function (vals) {
                            var opts = [];
                            if (vals.options.never_auto)
                                opt_noauto = true;
                            else if (is_fsys && content_block)
                                opt_noauto = !is_mounted(client, content_block);

                            if (vals.options.never_auto)
                                opts.push("x-cockpit-never-auto");
                            if (opt_noauto || vals.options.never_auto)
                                opts.push("noauto");
                            if (vals.options.ro)
                                opts.push("readonly");
                            if (vals.options.extra !== false)
                                opts = opts.concat(parse_options(vals.options.extra));
                            config.options = {
                                t: 'ay',
                                v: encode_filename(unparse_options(opts))
                            };
                            return commit().then(() => {
                                return maybe_set_fsys_noauto(opt_noauto);
                            });
                        }
                    }
                });
            });
        }

        var cleartext = client.blocks_cleartext[block.path];

        var option_parts = [];
        if (opt_never_auto)
            option_parts.push(_("Never unlock at boot"));
        if (extra_options)
            option_parts.push(extra_options);
        var options = option_parts.join(", ");

        return (
            <div>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    { !this.state.slot_error &&
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Encryption type")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            { "LUKS" + this.state.luks_version }
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    }
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Cleartext device")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {cleartext ? block_name(cleartext) : "-"}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Stored passphrase")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <StorageButton onClick={edit_stored_passphrase}>{_("Edit")}</StorageButton>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Options")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <StorageLink onClick={edit_options}>{options || _("(none)")}</StorageLink>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
                <br />
                <CryptoKeyslots client={client} block={block}
                                slots={this.state.slots} slot_error={this.state.slot_error}
                                max_slots={this.state.max_slots} />
            </div>
        );
    }
}
