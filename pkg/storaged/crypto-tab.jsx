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

import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import cockpit from "cockpit";
import { dialog_open, TextInput, PassInput } from "./dialog.jsx";
import { encode_filename, decode_filename, block_name, parse_options, unparse_options, extract_option, edit_crypto_config } from "./utils.js";
import { is_mounted } from "./fsys-tab.jsx";

import React from "react";
import { StorageLink } from "./storage-controls.jsx";

import * as python from "python.js";
import luksmeta_monitor_hack_py from "./luksmeta-monitor-hack.py";
import * as timeformat from "timeformat.js";

import { CryptoKeyslots } from "./crypto-keyslots.jsx";

const _ = cockpit.gettext;

function parse_tag_mtime(tag) {
    if (tag && tag.indexOf("1:") == 0) {
        try {
            const parts = tag.split("-")[1].split(".");
            // s:ns → ms
            const mtime = parseInt(parts[0]) * 1000 + parseInt(parts[1]) * 1e-6;
            return cockpit.format(_("Last modified: $0"), timeformat.dateTime(mtime));
        } catch {
            return null;
        }
    } else
        return null;
}

export class CryptoTab extends React.Component {
    constructor() {
        super();
        this.state = {
            luks_version: null,
            slots: null,
            slot_error: null,
            max_slots: null,
            stored_passphrase_mtime: 0,
        };
    }

    monitor_slots(block) {
        // HACK - we only need this until UDisks2 has a Encrypted.Slots property or similar.
        if (block != this.monitored_block) {
            if (this.monitored_block)
                this.monitor_channel.close();
            this.monitored_block = block;
            if (block) {
                const dev = decode_filename(block.Device);
                this.monitor_channel = python.spawn(luksmeta_monitor_hack_py, [dev], { superuser: true });
                let buf = "";
                this.monitor_channel.stream(output => {
                    buf += output;
                    const lines = buf.split("\n");
                    buf = lines[lines.length - 1];
                    if (lines.length >= 2) {
                        const data = JSON.parse(lines[lines.length - 2]);
                        this.setState({ slots: data.slots, luks_version: data.version, max_slots: data.max_slots });
                    }
                });
                this.monitor_channel.catch(err => {
                    this.setState({ slots: [], slot_error: err });
                });
            }
        }
    }

    monitor_path_mtime(path) {
        if (path != this.monitored_path) {
            if (this.monitored_file)
                this.monitored_file.close();
            this.monitored_path = path;
            if (path) {
                this.monitored_file = cockpit.file(path, { superuser: true });
                this.monitored_file.watch((_, tag) => this.setState({ stored_passphrase_mtime: parse_tag_mtime(tag) }),
                                          { read: false });
            }
        }
    }

    componentWillUnmount() {
        this.monitor_slots(null);
        this.monitor_path_mtime(null);
    }

    render() {
        const self = this;
        const client = self.props.client;
        const block = self.props.block;

        this.monitor_slots(block);

        function edit_stored_passphrase() {
            edit_crypto_config(block, function (config, commit) {
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
                        Title: _("Save"),
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

        let old_options, passphrase_path;
        const old_config = block.Configuration.find(c => c[0] == "crypttab");
        if (old_config) {
            old_options = (decode_filename(old_config[1].options.v)
                    .split(",")
                    .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                    .join(","));
            passphrase_path = decode_filename(old_config[1]["passphrase-path"].v);
        }

        this.monitor_path_mtime(passphrase_path);

        const split_options = parse_options(old_options);
        let opt_noauto = extract_option(split_options, "noauto");
        const extra_options = unparse_options(split_options);

        function edit_options() {
            const fsys_config = client.blocks_crypto[block.path]?.ChildConfiguration.find(c => c[0] == "fstab");
            const content_block = client.blocks_cleartext[block.path];
            const is_fsys = fsys_config || (content_block && content_block.IdUsage == "filesystem");

            edit_crypto_config(block, function (config, commit) {
                dialog_open({
                    Title: _("Encryption options"),
                    Fields: [
                        TextInput("options", "", { value: extra_options }),
                    ],
                    isFormHorizontal: false,
                    Action: {
                        Title: _("Save"),
                        action: function (vals) {
                            let opts = [];
                            if (is_fsys && content_block)
                                opt_noauto = !is_mounted(client, content_block);
                            if (opt_noauto)
                                opts.push("noauto");
                            opts = opts.concat(parse_options(vals.options));
                            config.options = {
                                t: 'ay',
                                v: encode_filename(unparse_options(opts))
                            };
                            return commit();
                        }
                    }
                });
            });
        }

        const cleartext = client.blocks_cleartext[block.path];

        const option_parts = [];
        if (extra_options)
            option_parts.push(extra_options);
        const options = option_parts.join(", ");

        return (
            <div>
                <DescriptionList className="pf-m-horizontal-on-sm ct-wide-labels">
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Encryption type")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            { this.state.luks_version ? "LUKS" + this.state.luks_version : "-" }
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Cleartext device")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {cleartext ? block_name(cleartext) : "-"}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Stored passphrase")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Flex>
                                <FlexItem>{ passphrase_path ? this.state.stored_passphrase_mtime || _("yes") : _("none") }</FlexItem>
                                <FlexItem><StorageLink onClick={edit_stored_passphrase}>{_("edit")}</StorageLink></FlexItem>
                            </Flex>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Options")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Flex>
                                <FlexItem>{ options || _("none") }</FlexItem>
                                <FlexItem><StorageLink onClick={edit_options}>{_("edit")}</StorageLink></FlexItem>
                            </Flex>
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
