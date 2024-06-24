/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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
import React from "react";
import client from "../client";

import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { useObject, useEvent } from "hooks";
import * as python from "python.js";
import * as timeformat from "timeformat";

import { dialog_open, TextInput, PassInput } from "../dialog.jsx";
import { block_name, encode_filename, decode_filename, parse_options, unparse_options, extract_option, edit_crypto_config } from "../utils.js";
import { StorageCard, StorageDescription, new_card } from "../pages.jsx";
import luksmeta_monitor_hack_py from "./luksmeta-monitor-hack.py";
import { is_mounted } from "../filesystem/utils.jsx";
import { StorageLink } from "../storage-controls.jsx";
import { CryptoKeyslots } from "./keyslots.jsx";

const _ = cockpit.gettext;

export function make_encryption_card(next, block) {
    return new_card({
        title: _("Encryption"),
        next,
        type_extra: _("encrypted"),
        component: EncryptionCard,
        props: { block },
    });
}

function monitor_luks(block) {
    const self = {
        stop,

        luks_version: null,
        slots: null,
        slot_error: null,
        max_slots: null,
    };

    cockpit.event_target(self);

    const dev = decode_filename(block.Device);
    const channel = python.spawn(luksmeta_monitor_hack_py, [dev], { superuser: "require" });
    let buf = "";

    channel.stream(output => {
        buf += output;
        const lines = buf.split("\n");
        buf = lines[lines.length - 1];
        if (lines.length >= 2) {
            const data = JSON.parse(lines[lines.length - 2]);
            self.slots = data.slots;
            self.luks_version = data.version;
            self.max_slots = data.max_slots;
            self.dispatchEvent("changed");
        }
    });

    channel.catch(err => {
        self.slots = [];
        self.slot_error = err;
        self.dispatchEvent("changed");
    });

    function stop() {
        channel.close();
    }

    return self;
}

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

function monitor_mtime(path) {
    const self = {
        stop,

        mtime: 0
    };

    cockpit.event_target(self);

    let file = null;
    if (path) {
        file = cockpit.file(path, { superuser: "require" });
        file.watch((_, tag) => { self.mtime = parse_tag_mtime(tag); self.dispatchEvent("changed") },
                   { read: false });
    }

    function stop() {
        if (file)
            file.close();
    }

    return self;
}

const EncryptionCard = ({ card, block }) => {
    const luks_info = useObject(() => monitor_luks(block),
                                m => m.stop(),
                                [block]);
    useEvent(luks_info, "changed");

    let old_options, passphrase_path;
    const old_config = block.Configuration.find(c => c[0] == "crypttab");
    if (old_config) {
        old_options = (decode_filename(old_config[1].options.v)
                .split(",")
                .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                .join(","));
        passphrase_path = decode_filename(old_config[1]["passphrase-path"].v);
    }

    const stored_passphrase_info = useObject(() => monitor_mtime(passphrase_path),
                                             m => m.stop(),
                                             [passphrase_path]);
    useEvent(stored_passphrase_info, "changed");

    const split_options = parse_options(old_options);
    let opt_noauto = extract_option(split_options, "noauto");
    const extra_options = unparse_options(split_options);

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
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm wide-label">
                    <StorageDescription title={_("Encryption type")}>
                        { luks_info.luks_version ? "LUKS" + luks_info.luks_version : "-" }
                    </StorageDescription>
                    <StorageDescription title={_("Cleartext device")}>
                        {cleartext ? block_name(cleartext) : "-"}
                    </StorageDescription>
                    <StorageDescription title={_("Stored passphrase")}
                           value={ passphrase_path ? stored_passphrase_info.mtime || _("yes") : _("none") }
                           action={<StorageLink onClick={edit_stored_passphrase}>{_("edit")}</StorageLink>} />
                    <StorageDescription title={_("Options")}
                           value={options || _("none")}
                           action={<StorageLink onClick={edit_options}>{_("edit")}</StorageLink>} />
                </DescriptionList>
            </CardBody>
            <CryptoKeyslots client={client} block={block}
                            slots={luks_info.slots} slot_error={luks_info.slot_error}
                            max_slots={luks_info.max_slots} />
        </StorageCard>);
};
