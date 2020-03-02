/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React, { useState } from "react";
import PropTypes from "prop-types";
import { Nav, NavList, NavItem, NavVariants } from '@patternfly/react-core';

import cockpit from "cockpit";

const _ = cockpit.gettext;

export const service_tabs_suffixes = new Set(["service", "target", "socket", "timer", "path"]);

/*
 * React component showing services tabs
 * Required props:
 *  - onChange:
 *      When different tab is selected this callback is called
 */
export function ServiceTabs({ onChange, warnings }) {
    const [activeItem, setActiveItem] = useState(".service$");

    function title(label, tag) {
        if (warnings[tag])
            return <span>{label} <span className="fa fa-exclamation-triangle" /></span>;
        else
            return label;
    }

    return (
        <Nav id="service-tabs"
            onSelect={result => { setActiveItem(result.itemId); onChange(result.itemId) }}>
            <NavList variant={NavVariants.tertiary}>
                <NavItem itemId=".service$" isActive={activeItem == ".service$"}> { title(_("System Services"), "service") } </NavItem>
                <NavItem itemId=".target$" isActive={activeItem == ".target$"}> { title(_("Targets"), "target") } </NavItem>
                <NavItem itemId=".socket$" isActive={activeItem == ".socket$"}> { title(_("Sockets"), "socket") } </NavItem>
                <NavItem itemId=".timer$" isActive={activeItem == ".timer$"}> { title(_("Timers"), "timer") } </NavItem>
                <NavItem itemId=".path$" isActive={activeItem == ".path$"}> { title(_("Paths"), "path") } </NavItem>
            </NavList>
        </Nav>
    );
}
ServiceTabs.propTypes = {
    onChange: PropTypes.func.isRequired,
};
