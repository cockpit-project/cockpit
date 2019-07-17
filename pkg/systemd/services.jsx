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

/*
 * React component showing services tabs
 * Required props:
 *  - onChange:
 *      When different tab is selected this callback is called
 */
export class ServiceTabs extends React.Component {
    render() {
        return (
            <Tabs defaultActiveKey=".service$" id="service-tabs" onSelect={this.props.onChange}>
                <Tab eventKey=".service$" title={ _("System Services") } />
                <Tab eventKey=".target$" title={ _("Targets") } />
                <Tab eventKey=".socket$" title={ _("Sockets") } />
                <Tab eventKey=".timer$" title={ _("Timers") } />
                <Tab eventKey=".path$" title={ _("Paths") } />
            </Tabs>
        );
    }
}

ServiceTabs.propTypes = {
    onChange: PropTypes.func.isRequired,
};
