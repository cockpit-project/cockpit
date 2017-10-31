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

import { OnOffSwitch } from "cockpit-components-onoff.jsx";

var _ = cockpit.gettext;

/* StorageControl - a button or similar that triggers
 *                  a privileged action.
 *
 * It can be disabled and will show a tooltip then.  It will
 * automatically disable itself when the logged in user doesn't
 * have permission.
 *
 * Properties:
 *
 * - excuse:  If set, the button/link is disabled and will show the
 *            excuse in a tooltip.
 */

var StorageControl = React.createClass({
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
    render: function () {
        var excuse = this.props.excuse;
        if (!this.state.allowed) {
            var markup = {
                __html: cockpit.format(_("The user <b>$0</b> is not permitted to manage storage"),
                                       permission.user ? permission.user.name : '')
            }
            excuse = <span dangerouslySetInnerHTML={markup}></span>;
        }

        return (
            <Tooltip tip={excuse}>
                { this.props.content(excuse) }
            </Tooltip>
        );
    }

});

function checked(callback) {
    return function (event) {
        // only consider primary mouse button
        if (!event || event.button !== 0)
            return;
        var promise = callback();
        if (promise)
            promise.fail(function (error) {
                $('#error-popup-title').text(_("Error"));
                $('#error-popup-message').text(error.toString());
                $('#error-popup').modal('show');
            });
        event.stopPropagation();
    };
}

var StorageButton = React.createClass({
    render: function () {
        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                    <button onClick={checked(this.props.onClick)}
                                            className={"btn btn-default" + (excuse? " disabled" : "")}>
                                                      {this.props.children}
                                    </button>
                                )}/>
        );
    }
});

var StorageLink = React.createClass({
    render: function () {
        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                    <a onClick={checked(this.props.onClick)}
                                       className={excuse? " disabled" : ""}>
                                                 {this.props.children}
                                    </a>
                            )}/>
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
            } else if (client.blocks[path] && client.blocks[client.blocks[path].CryptoBackingDevice]) {
                is_crypt = true;
                path = client.blocks[path].CryptoBackingDevice;
            } else {
                break;
            }
        }

        block = client.blocks[path];

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

// StorageOnOff - OnOff switch for asynchronous actions.
//

class StorageOnOff extends React.Component {
    constructor() {
        super();
        this.state = { promise: null };
    }

    render() {
        var self = this;

        function onChange(val) {
            var promise = self.props.onChange(val);
            if (promise) {
                promise.always(function() {
                    self.setState({ promise: null })
                });
                promise.fail(function(error) {
                    $('#error-popup-title').text(_("Error"));
                    $('#error-popup-message').text(error.toString());
                    $('#error-popup').modal('show');
                });
            }

            self.setState({ promise: promise, promise_goal_state: val });
        }

        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                    <OnOffSwitch state={this.state.promise
                                                        ? this.state.promise_goal_state
                                                        : this.props.state}
                                                 enabled={!excuse && !this.state.promise}
                                                 onChange={onChange}/>
                                )}/>
        );
    }
}

class StorageMultiAction extends React.Component {
    render() {
        var dflt = this.props.actions[this.props.default];

        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => {
                                    var btn_classes = "btn btn-default";
                                    if (excuse)
                                        btn_classes += " disabled";
                                    return (
                                        <div className="btn-group">
                                            <button className={btn_classes} onClick={checked(dflt.action)}>
                                                                                                 {dflt.title}
                                            </button>
                                            <button className={btn_classes + " dropdown-toggle"}
                                                    data-toggle="dropdown">
                                                <span className="caret"></span>
                                            </button>
                                            <ul className="dropdown-menu action-dropdown-menu" role="menu">
                                                { this.props.actions.map((act) => (
                                                      <li className="presentation">
                                                          <a role="menuitem" onClick={checked(act.action)}>
                                                                                     {act.title}
                                                          </a>
                                                      </li>))
                                                }
                                            </ul>
                                        </div>
                                    );
                            }}/>
        );
    }
}

module.exports = {
    StorageButton: StorageButton,
    StorageLink:   StorageLink,
    StorageBlockNavLink: StorageBlockNavLink,
    StorageOnOff: StorageOnOff,
    StorageMultiAction: StorageMultiAction
};
