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

var React = require("react");
var Tooltip = require("cockpit-components-tooltip.jsx").Tooltip;

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

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

module.exports = {
    StorageAction: StorageAction,
    StorageButton: StorageButton,
    StorageLink:   StorageLink
};
