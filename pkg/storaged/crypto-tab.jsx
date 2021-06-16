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
    DescriptionListDescription,
    Flex, FlexItem,
} from "@patternfly/react-core";
import cockpit from "cockpit";
import moment from "moment";
import { dialog_open, PassInput } from "./dialog.jsx";
import { array_find, encode_filename, decode_filename } from "./utils.js";

import React from "react";
import { StorageLink } from "./storage-controls.jsx";
import { crypto_options_dialog_fields, crypto_options_dialog_options } from "./format-dialog.jsx";

import * as python from "python.js";
import luksmeta_monitor_hack_py from "raw-loader!./luksmeta-monitor-hack.py";

import { CryptoKeyslots } from "./crypto-keyslots.jsx";

const _ = cockpit.gettext;

function parse_tag_mtime(tag) {
    if (tag && tag.indexOf("1:") == 0) {
        try {
            const parts = tag.split("-")[1].split(".");
            const mtime = parseInt(parts[0]) + parseInt(parts[1]) * 1e-9;
            return cockpit.format(_("Last modified: $0"), moment.unix(mtime).calendar());
        } catch {
            return null;
        }
    } else
        return null;
}

export class CryptoTab extends React.Component {
    constructor() {
        super();
        // Initialize for LUKSv1 and set max_slots to 8.
        this.state = {
            luks_version: 1, slots: null, slot_error: null, max_slots: 8,
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
        var self = this;
        var client = self.props.client;
        var block = self.props.block;

        this.monitor_slots(block);

        function edit_config(modify) {
            var old_config, new_config;

            function commit() {
                new_config[1]["track-parents"] = { t: 'b', v: true };
                if (old_config)
                    return block.UpdateConfigurationItem(old_config, new_config, { });
                else
                    return block.AddConfigurationItem(new_config, { });
            }

            block.GetSecretConfiguration({}).done(
                function (items) {
                    old_config = array_find(items, function (c) { return c[0] == "crypttab" });
                    new_config = ["crypttab", old_config ? Object.assign({ }, old_config[1]) : { }];

                    // UDisks insists on always having a "passphrase-contents" field when
                    // adding a crypttab entry, but doesn't include one itself when returning
                    // an entry without a stored passphrase.
                    //
                    if (!new_config[1]['passphrase-contents'])
                        new_config[1]['passphrase-contents'] = { t: 'ay', v: encode_filename("") };

                    modify(new_config[1], commit);
                });
        }

        function edit_stored_passphrase() {
            edit_config(function (config, commit) {
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

        var old_config, old_options, passphrase_path;

        old_config = array_find(block.Configuration, function (c) { return c[0] == "crypttab" });
        if (old_config) {
            old_options = (decode_filename(old_config[1].options.v)
                    .split(",")
                    .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                    .join(","));
            passphrase_path = decode_filename(old_config[1]["passphrase-path"].v);
        }

        this.monitor_path_mtime(passphrase_path);

        function edit_options() {
            edit_config(function (config, commit) {
                dialog_open({
                    Title: _("Encryption options"),
                    Fields: crypto_options_dialog_fields(old_options, undefined, undefined, false),
                    isFormHorizontal: false,
                    Action: {
                        Title: _("Apply"),
                        action: function (vals) {
                            config.options = {
                                t: 'ay',
                                v: encode_filename(crypto_options_dialog_options(vals))
                            };
                            return commit();
                        }
                    }
                });
            });
        }

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
                                <FlexItem>{ old_options || _("none") }</FlexItem>
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
