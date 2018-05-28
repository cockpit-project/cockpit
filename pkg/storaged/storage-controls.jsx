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

import { OnOffSwitch } from "cockpit-components-onoff.jsx";

var React = require("react");
var createReactClass = require('create-react-class');

var cockpit = require("cockpit");
var utils = require("./utils.js");
var $ = require("jquery");

var Tooltip = require("cockpit-components-tooltip.jsx").Tooltip;

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

var permission = cockpit.permission({ admin: true });

var StorageControl = createReactClass({
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
            };
            excuse = <span dangerouslySetInnerHTML={markup} />;
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

var StorageButton = createReactClass({
    render: function () {
        var classes = "btn";
        if (this.props.kind)
            classes += " btn-" + this.props.kind;
        else
            classes += " btn-default";

        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                <button id={this.props.id}
                                            onClick={checked(this.props.onClick)}
                                            className={classes + (excuse ? " disabled" : "")}>
                                    {this.props.children}
                                </button>
                            )} />
        );
    }
});

var StorageLink = createReactClass({
    render: function () {
        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                <a onClick={checked(this.props.onClick)}
                                       role="link"
                                       tabIndex="0"
                                       className={excuse ? " disabled" : ""}>
                                    {this.props.children}
                                </a>
                            )} />
        );
    }
});

/* StorageBlockNavLink - describe a given block device concisely and
                         allow navigating to its details.

   Properties:

   - client
   - block
 */

var StorageBlockNavLink = createReactClass({
    render: function () {
        var self = this;
        var client = self.props.client;
        var block = self.props.block;

        if (!block)
            return null;

        var parts = utils.get_block_link_parts(client, block.path);

        var link = (
            // There is only one element in the array produced by fmt_to_array below, but
            // React wants it to have a unique key anyway, so we give it one.
            <a key="key" role="link" tabIndex="0" onClick={() => { cockpit.location.go(parts.location) }}>
                {parts.link}
            </a>
        );

        return <span>{utils.fmt_to_array(parts.format, link)}</span>;
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
                promise.always(() => { self.setState({ promise: null }) });
                promise.fail((error) => {
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
                                                 onChange={onChange} />
                            )} />
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
                                            <span className="caret" />
                                        </button>
                                        <ul className="dropdown-menu action-dropdown-menu" role="menu">
                                            { this.props.actions.map((act) => (
                                                <li className="presentation">
                                                    <a role="menuitem" tabIndex="0" onClick={checked(act.action)}>
                                                        {act.title}
                                                    </a>
                                                </li>))
                                            }
                                        </ul>
                                    </div>
                                );
                            }} />
        );
    }
}

/* Render a usage bar showing props.stats[0] out of props.stats[1]
 * bytes in use.  If the ratio is above props.critical, the bar will be
 * in a dangerous color.
 */

class StorageUsageBar extends React.Component {
    render() {
        var stats = this.props.stats;
        var fraction = stats ? stats[0] / stats[1] : null;

        return (
            <div className="progress">
                { stats
                    ? <div className={ "progress-bar" + (fraction > this.props.critical ? " progress-bar-danger" : "") }
                        style={{ width: fraction * 100 + "%" }} />
                    : null
                }
            </div>
        );
    }
}

module.exports = {
    StorageButton: StorageButton,
    StorageLink:   StorageLink,
    StorageBlockNavLink: StorageBlockNavLink,
    StorageOnOff: StorageOnOff,
    StorageMultiAction: StorageMultiAction,
    StorageUsageBar: StorageUsageBar
};
