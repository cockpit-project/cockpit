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

import React from "react";

import "./cockpit-components-onoff.less";

/* Component to show an on/off switch
 * state      boolean value (off or on)
 * onChange   triggered when the switch is flipped, parameter: new state
 * enabled    whether the component is enabled or not, defaults to true
 * id         optional string, ID of the top-level HTML tag (only necessary
 *            when embedding this into a non-React page)
 * text       optional string that appears to the right of the button
 */
export const OnOffSwitch = ({ state, onChange, text, disabled, id }) => (
    <label id={id} className="onoff-ct">
        <input type="checkbox" disabled={disabled} checked={state}
            onChange={ ev => onChange ? onChange(ev.target.checked) : null } />
        <span className="switch-toggle" />
        { text ? <span className={ state ? "switch-on" : "switch-off" }>{text}</span> : null }
    </label>
);
