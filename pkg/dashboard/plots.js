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

import cockpit from "cockpit";
import React, { useState } from "react";

import { Split, SplitItem, Tabs, Tab } from '@patternfly/react-core';
import { ZoomControls, SvgPlot, percent_config, memory_config_with_inline_units, bits_per_sec_config_with_inline_units, bytes_per_sec_config_with_inline_units } from "cockpit-components-plot.jsx";

const _ = cockpit.gettext;

export const DashboardPlots = ({ plot_state, onHover }) => {
    const [ active, setActive ] = useState(0);

    return (
        <>
            <Split>
                <SplitItem isFilled />
                <SplitItem><ZoomControls plot_state={plot_state} /></SplitItem>
            </Split>
            <Tabs isBox={true} activeKey={active} onSelect={(event, index) => setActive(index)}>
                <Tab eventKey={0} title={_("CPU")}>
                    <SvgPlot className="dashboard-graph" config={percent_config} style="lines"
                             plot_state={plot_state} plot_id='cpu' onHover={onHover} />
                </Tab>
                <Tab eventKey={1} title={_("Memory")}>
                    <SvgPlot className="dashboard-graph" config={memory_config_with_inline_units} style="lines"
                             plot_state={plot_state} plot_id='mem' onHover={onHover} />
                </Tab>
                <Tab eventKey={2} title={_("Network")}>
                    <SvgPlot className="dashboard-graph" config={bits_per_sec_config_with_inline_units} style="lines"
                             plot_state={plot_state} plot_id='net' onHover={onHover} />
                </Tab>
                <Tab eventKey={3} title={_("Disk I/O")}>
                    <SvgPlot className="dashboard-graph" config={bytes_per_sec_config_with_inline_units} style="lines"
                             plot_state={plot_state} plot_id='disk' onHover={onHover} />
                </Tab>
            </Tabs>
        </>);
};
