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

import React from "react";
import PropTypes from "prop-types";
import { Tabs, Tab } from 'patternfly-react';

import cockpit from "cockpit";

const _ = cockpit.gettext;

export const service_tabs_suffixes = new Set(["service", "target", "socket", "timer", "path"]);

/*
 * React component showing services tabs
 * Required props:
 *  - onChange:
 *      When different tab is selected this callback is called
 */
export class ServiceTabs extends React.Component {
    render() {
        const { warnings } = this.props;

        function title(label, tag) {
            if (warnings[tag])
                return <span>{label} <span className="fa fa-exclamation-triangle" /></span>;
            else
                return label;
        }

        return (
            <Tabs defaultActiveKey=".service$" id="service-tabs" onSelect={this.props.onChange}>
                <Tab eventKey=".service$" title={ title(_("System Services"), "service") } />
                <Tab eventKey=".target$" title={ title(_("Targets"), "target") } />
                <Tab eventKey=".socket$" title={ title(_("Sockets"), "socket") } />
                <Tab eventKey=".timer$" title={ title(_("Timers"), "timer") } />
                <Tab eventKey=".path$" title={ title(_("Paths"), "path") } />
            </Tabs>
        );
    }
}

ServiceTabs.propTypes = {
    onChange: PropTypes.func.isRequired,
};
