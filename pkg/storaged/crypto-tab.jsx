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

import cockpit from "cockpit";
import { dialog_open, PassInput } from "./dialogx.jsx";
import { array_find, encode_filename, decode_filename } from "./utils.js";

import React from "react";
import { StorageButton, StorageLink } from "./storage-controls.jsx";
import { FormatButton, crypto_options_dialogx_fields, crypto_options_dialog_options } from "./format-dialog.jsx";

import { CryptoKeyslots } from "./crypto-keyslots.jsx";

var createReactClass = require('create-react-class');

var _ = cockpit.gettext;

var CryptoTab = createReactClass({
    render: function () {
        var self = this;
        var client = self.props.client;
        var block = self.props.block;

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
                    new_config = [ "crypttab", old_config ? Object.assign({ }, old_config[1]) : { } ];

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
                dialog_open({ Title: _("Stored Passphrase"),
                              Fields: [
                                  PassInput("passphrase", _("Stored Passphrase"),
                                            { value: (config && config['passphrase-contents']
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

        function edit_options() {
            edit_config(function (config, commit) {
                dialog_open({ Title: _("Encryption Options"),
                              Fields: crypto_options_dialogx_fields(old_options),
                              Action: {
                                  Title: _("Apply"),
                                  action: function (vals) {
                                      config["options"] = {
                                          t: 'ay',
                                          v: encode_filename(crypto_options_dialog_options(vals))
                                      };
                                      return commit();
                                  }
                              }
                });
            });
        }

        // See format-dialog.jsx above for why we don't offer editing
        // crypttab for the old UDisks2

        return (
            <div>
                <div className="tab-actions">
                    <FormatButton client={this.props.client} block={this.props.block} />
                </div>
                <table className="info-table-ct">
                    <tbody>
                        { !self.props.client.is_old_udisks2
                            ? <tr>
                                <td>{_("Stored passphrase")}</td>
                                <td><StorageButton onClick={edit_stored_passphrase}>{_("Edit")}</StorageButton></td>
                            </tr> : null
                        }
                        { !self.props.client.is_old_udisks2
                            ? <tr>
                                <td>{_("Options")}</td>
                                <td><StorageLink onClick={edit_options}>{old_options || _("(none)")}</StorageLink></td>
                            </tr> : null
                        }
                    </tbody>
                </table>
                <br />
                <CryptoKeyslots client={client} block={block} />
            </div>
        );
    },
});

module.exports = {
    CryptoTab: CryptoTab
};
