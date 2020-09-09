/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
import { Nav, NavList, NavItem } from '@patternfly/react-core';

import cockpit from "cockpit";

const _ = cockpit.gettext;

export const service_tabs_suffixes = {
    service: _("System services"),
    target: _("Targets"),
    socket: _("Sockets"),
    timer: _("Timers"),
    path: _("Paths")
};

/*
 * React component showing services tabs
 * Required props:
 *  - onChange:
 *      When different tab is selected this callback is called
 */
export function ServiceTabs({ onChange, activeTab, tabErrors }) {
    const [activeItem, setActiveItem] = useState(activeTab);

    return (
        <Nav variant="tertiary" id="services-filter"
             onSelect={result => { setActiveItem(result.itemId); onChange(result.itemId) }}>
            <NavList>
                {Object.keys(service_tabs_suffixes).map(key => {
                    return (
                        <NavItem itemId={key}
                                 key={key}
                                 preventDefault
                                 isActive={activeItem == key}>
                            <a href="#">
                                {service_tabs_suffixes[key]}
                                {tabErrors[key] ? <span className="fa fa-exclamation-circle" /> : null}
                            </a>
                        </NavItem>
                    );
                })}
            </NavList>
        </Nav>
    );
}
ServiceTabs.propTypes = {
    onChange: PropTypes.func.isRequired,
};
