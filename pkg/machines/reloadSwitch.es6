/*jshint esversion: 6 */
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
import React from "react";

export function ReloadSwitch({ onOn, onOff }) {
    return React.createElement("div", null,
        React.createElement("span", null, "Refresh "),
        React.createElement("div", {className: "btn-group btn-onoff-ct", id: "reloadSwitch", "data-toggle": "buttons"},
            React.createElement("label", {className: "btn active", onClick: onOn},
                React.createElement("input", {type: "radio", name: "options", autocomplete: "off", checked: true}),
                React.createElement("span", null, "On")),
            React.createElement("label", {className: "btn", onClick: onOff},
                React.createElement("input", {type: "radio", name: "options", autocomplete: "off"}),
                React.createElement("span", null, "Off"))
        ));
}
