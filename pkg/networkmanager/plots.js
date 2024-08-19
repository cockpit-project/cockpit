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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React from "react";

import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { ZoomControls, SvgPlot, bits_per_sec_config } from "cockpit-components-plot.jsx";

import cockpit from "cockpit";
const _ = cockpit.gettext;

export const NetworkPlots = ({ plot_state }) => {
    return (
        <>
            <Split>
                <SplitItem isFilled />
                <SplitItem><ZoomControls plot_state={plot_state} /></SplitItem>
            </Split>
            <Grid sm={12} md={6} lg={6} hasGutter>
                <GridItem>
                    <SvgPlot className="network-graph"
                             title={_("Transmitting")} config={bits_per_sec_config}
                             plot_state={plot_state} plot_id='tx' />
                </GridItem>
                <GridItem>
                    <SvgPlot className="network-graph"
                             title={_("Receiving")} config={bits_per_sec_config}
                             plot_state={plot_state} plot_id='rx' />
                </GridItem>
            </Grid>
        </>);
};
