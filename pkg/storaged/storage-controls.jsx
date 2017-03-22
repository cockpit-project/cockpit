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
var permission = require("./permissions.js").permission;
var utils = require("./utils.js");
var $ = require("jquery");

var React = require("react");
var Tooltip = require("cockpit-components-tooltip.jsx").Tooltip;

var _ = cockpit.gettext;

/* StorageAction - a button or link that triggers a action.
 *
 * It can be disabled and will show a tooltip then.  It will
 * automatically disable itself when the logged in user doesn't
 * have permission.
 *
 * Properties:
 *
 * - onClick: function to execute the action.  It can return a promise and
 *            a error dialog will be shown when the promise fails.
 *
 * - link:    If true renders as a link, otherwise as a button.
 *
 * - excuse:  If set, the button/link is disabled and will show the
 *            excuse in a tooltip.
 */

var StorageAction = React.createClass({
    getInitialState: function () {
        return { allowed: permission.allowed !== false };
    },
    onPermissionChanged: function () {
        this.setState({ allowed: permission.allowed !== false });
    },
    componentDidMount: function () {
        $(permission).on("changed", this.onPermissionChanged);
    },
    componentWillUnmount: function () {
        $(permission).off("changed", this.onPermissionChanged);
    },
    onClick: function (event) {
        // only consider primary mouse button
        if (!event || event.button !== 0)
            return;
        var promise = this.props.onClick();
        if (promise)
            promise.fail(function (error) {
                $('#error-popup-title').text(_("Error"));
                $('#error-popup-message').text(error.toString());
                $('#error-popup').modal('show');
            });
        event.stopPropagation();
    },
    render: function () {
        var excuse = this.props.excuse;
        if (!this.state.allowed) {
            var markup = {
                __html: cockpit.format(_("The user <b>$0</b> is not permitted to manage storage"),
                                       permission.user ? permission.user.name : '')
            }
            excuse = <span dangerouslySetInnerHTML={markup}></span>;
        }

        var thing;
        if (this.props.link) {
            thing = (
                <a onClick={this.onClick}
                   className={excuse? " disabled" : ""}>
                    {this.props.children}
                </a>
            );
        } else {
            thing = (
                <button onClick={this.onClick}
                        className={"btn btn-default" + (excuse? " disabled" : "")}>
                    {this.props.children}
                </button>
            );
        }

        return (
            <Tooltip tip={excuse}>
                {thing}
            </Tooltip>
        );
    }

});

var StorageButton = React.createClass({
    render: function () {
        return (
            <StorageAction onClick={this.props.onClick}
                           excuse={this.props.excuse}>
                {this.props.children}
            </StorageAction>
        );
    }
});

var StorageLink = React.createClass({
    render: function () {
        return (
            <StorageAction onClick={this.props.onClick}
                           excuse={this.props.excuse}
                           link={true}>
                {this.props.children}
            </StorageAction>
        );
    }
});

/* StorageBlockNavLink - describe a given block device concisely and
                         allow navigating to its details.

   Properties:

   - client
   - block
 */

var StorageBlockNavLink = React.createClass({
    render: function () {
        var self = this;
        var client = self.props.client;
        var block = self.props.block;

        if (!block)
            return;

        var path = block.path;
        var is_part, is_crypt, is_lvol;

        for (;;) {
            if (client.blocks_part[path] && client.blocks_ptable[client.blocks_part[path].Table]) {
                is_part = true;
                path = client.blocks_part[path].Table;
            } else if (client.blocks_crypto[path] && client.blocks[client.blocks_crypto[path].CryptoBackingDevice]) {
                is_crypt = true;
                path = client.blocks_crypto[path].CryptoBackingDevice;
            } else {
                break;
            }
        }

        if (client.blocks_lvm2[path] && client.lvols[client.blocks_lvm2[path].LogicalVolume])
            is_lvol = true;

        var name, go;
        if (client.mdraids[block.MDRaid]) {
            name = cockpit.format(_("RAID Device $0"), utils.mdraid_name(client.mdraids[block.MDRaid]));
            go = function () {
                cockpit.location.go([ 'mdraid', client.mdraids[block.MDRaid].UUID ]);
            };
        } else if (client.blocks_lvm2[path] &&
                   client.lvols[client.blocks_lvm2[path].LogicalVolume] &&
                   client.vgroups[client.lvols[client.blocks_lvm2[path].LogicalVolume].VolumeGroup]) {
                       var vg = client.vgroups[client.lvols[client.blocks_lvm2[path].LogicalVolume].VolumeGroup].Name;
                       name = cockpit.format(_("Volume Group $0"), vg);
                       go = function () {
                           console.location.go([ 'vg', vg ]);
                       };
        } else {
            if (client.drives[block.Drive])
                name = utils.drive_name(client.drives[block.Drive]);
            else
                name = utils.block_name(block);
            go = function () {
                cockpit.location.go([ utils.block_name(block).replace(/^\/dev\//, "") ]);
            };
        }

        var link = <a onClick={go}>{name}</a>;

        // TODO - generalize this to arbitrary number of arguments (when needed)
        function fmt_to_array(fmt, arg) {
            var index = fmt.indexOf("$0");
            if (index >= 0)
                return [ fmt.slice(0, index), arg, fmt.slice(index+2) ];
            else
                return [ fmt ];
        }

        if (is_lvol && is_crypt)
            return <span>{fmt_to_array(_("Encrypted Logical Volume of $0"), link)}</span>;
        else if (is_part && is_crypt)
            return <span>{fmt_to_array(_("Encrypted Partition of $0"), link)}</span>;
        else if (is_lvol)
            return <span>{fmt_to_array(_("Logical Volume of $0"), link)}</span>;
        else if (is_part)
            return <span>{fmt_to_array(_("Partition of $0"), link)}</span>;
        else if (is_crypt)
            return <span>{fmt_to_array(_("Encrypted $0"), link)}</span>;
        else
            return link;
    }
});

module.exports = {
    StorageAction: StorageAction,
    StorageButton: StorageButton,
    StorageLink:   StorageLink,

    StorageBlockNavLink: StorageBlockNavLink
};
