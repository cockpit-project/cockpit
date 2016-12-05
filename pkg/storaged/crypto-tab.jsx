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
var dialog = require("./dialog");
var utils = require("./utils.js");

var React = require("react");
var StorageControls = require("./storage-controls.jsx");
var FormatDialog = require("./format-dialog.jsx");

var StorageButton = StorageControls.StorageButton;
var StorageLink =   StorageControls.StorageLink;
var FormatButton =  FormatDialog.FormatButton;

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

var CryptoTab = React.createClass({
    render: function () {
        var self = this;
        var client = self.props.client;
        var block = self.props.block;
        var cleartext_block = client.blocks_cleartext[block.path];

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
                    old_config = utils.array_find(items, function (c) { return c[0] == "crypttab"; });
                    new_config = [ "crypttab", old_config? $.extend({ }, old_config[1]) : { } ];
                    modify (new_config[1], commit);
                });
        }

        function edit_stored_passphrase() {
            edit_config(function (config, commit) {
                dialog.open({ Title: _("Stored Passphrase"),
                              Fields: [
                                  { PassInput: "passphrase",
                                    Title: _("Stored Passphrase"),
                                    Value: (config && config['passphrase-contents'] ?
                                            utils.decode_filename(config['passphrase-contents'].v) :
                                            "")
                                  }
                              ],
                              Action: {
                                  Title: _("Apply"),
                                  action: function (vals) {
                                      config["passphrase-contents"] = {
                                          t: 'ay',
                                          v: utils.encode_filename(vals.passphrase)
                                      }
                                      delete config["passphrase-path"];
                                      return commit();
                                  }
                              }
                });
            });
        }

        var old_config, old_options;

        old_config = utils.array_find(block.Configuration, function (c) { return c[0] == "crypttab"; });
        if (old_config) {
            old_options = (utils.decode_filename(old_config[1].options.v).
                                 split(",").
                                 filter(function (s) { return s.indexOf("x-parent") !== 0; }).
                                 join(","));
        }

        function edit_options(event) {
            edit_config(function (config, commit) {
                dialog.open({ Title: _("Encryption Options"),
                              Fields: [
                                  { TextInput: "options",
                                    Title: _("Options"),
                                    Value: old_options
                                  }
                              ],
                              Action: {
                                  Title: _("Apply"),
                                  action: function (vals) {
                                      config["options"] = {
                                          t: 'ay',
                                          v: utils.encode_filename(vals.options)
                                      }
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
                    <FormatButton client={this.props.client} block={this.props.block}/>
                </div>
                <table className="info-table-ct">
                    { !self.props.client.is_old_udisks2 ?
                      <tr>
                          <td>{_("Stored passphrase")}</td>
                          <td><StorageButton onClick={edit_stored_passphrase}>{_("Edit")}</StorageButton></td>
                      </tr> : null
                    }
                    { !self.props.client.is_old_udisks2 ?
                      <tr>
                          <td>{_("Options")}</td>
                          <td><StorageLink onClick={edit_options}>{old_options || _("(none)")}</StorageLink></td>
                    </tr> : null
                    }
                </table>
            </div>
        );
    },
});

module.exports = {
    CryptoTab: CryptoTab
};
