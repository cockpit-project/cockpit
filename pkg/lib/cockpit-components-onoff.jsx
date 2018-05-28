/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
var React = require("react");
var createReactClass = require('create-react-class');

var _ = cockpit.gettext;

require("./cockpit-components-onoff.css");

/* Component to show an on/off switch
 * state      boolean value (off or on)
 * captionOff optional string, default 'Off'
 * captionOn  optional string, default 'On'
 * onChange   triggered when the switch is flipped, parameter: new state
 * enabled    whether the component is enabled or not, defaults to true
 */
var OnOffSwitch = createReactClass({
    getDefaultProps: function() {
        return {
            captionOff: _("Off"),
            captionOn: _("On"),
            enabled: true,
        };
    },
    handleOnOffClick: function(newState, e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        // only notify if the component is enabled
        if (this.props.onChange && this.props.enabled)
            this.props.onChange(newState);
        e.stopPropagation();
    },
    render: function() {
        var onClasses = ["btn"];
        var offClasses = ["btn"];
        if (this.props.state)
            onClasses.push("active");
        else
            offClasses.push("active");
        if (!this.props.enabled) {
            onClasses.push("disabled");
            offClasses.push("disabled");
        }
        var clickHandler = this.handleOnOffClick.bind(this, !this.props.state);
        return (
            <div className="btn-group btn-onoff-ct">
                <label className={ onClasses.join(" ") }>
                    <input type="radio" />
                    <span onClick={clickHandler}>{this.props.captionOn}</span>
                </label>
                <label className={ offClasses.join(" ") }>
                    <input type="radio" />
                    <span onClick={clickHandler}>{this.props.captionOff}</span>
                </label>
            </div>
        );
    }
});

module.exports = {
    OnOffSwitch: OnOffSwitch,
};
