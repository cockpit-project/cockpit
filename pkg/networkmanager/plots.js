/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
