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

import { Split, SplitItem, Grid, GridItem } from '@patternfly/react-core';
import { ZoomControls, SvgPlot, bytes_per_sec_config } from "cockpit-components-plot.jsx";

import { decode_filename } from "./utils.js";

const single_read_metric = {
    direct: ["disk.all.read_bytes"],
    internal: ["disk.all.read"],
    units: "bytes",
    derive: "rate",
    threshold: 1000
};

const single_write_metric = {
    direct: ["disk.all.write_bytes"],
    internal: ["disk.all.written"],
    units: "bytes",
    derive: "rate",
    threshold: 1000
};

const instances_read_metric = {
    direct: "disk.dev.read_bytes",
    internal: "block.device.read",
    units: "bytes",
    derive: "rate",
    threshold: 1000
};

const instances_write_metric = {
    direct: "disk.dev.write_bytes",
    internal: "block.device.written",
    units: "bytes",
    derive: "rate",
    threshold: 1000
};

export function update_plot_state(ps, client) {
    const devs = [];
    for (var p in client.drives) {
        var block = client.drives_block[p];
        var dev = block && decode_filename(block.Device).replace(/^\/dev\//, "");
        if (dev)
            devs.push(dev);
    }

    if (devs.length > 10) {
        ps.plot_single('read', single_read_metric);
        ps.plot_single('write', single_write_metric);
    } else {
        ps.plot_instances('read', instances_read_metric, devs);
        ps.plot_instances('write', instances_write_metric, devs);
    }
}

export const StoragePlots = ({ plot_state, onHover }) => {
    return (
        <>
            <Split>
                <SplitItem isFilled />
                <SplitItem><ZoomControls plot_state={plot_state} /></SplitItem>
            </Split>
            <Grid sm={12} md={6} lg={6} hasGutter>
                <GridItem>
                    <SvgPlot className="storage-graph"
                             title="Reading" config={bytes_per_sec_config}
                             plot_state={plot_state} plot_id='read' onHover={onHover} />
                </GridItem>
                <GridItem>
                    <SvgPlot className="storage-graph"
                             title="Writing" config={bytes_per_sec_config}
                             plot_state={plot_state} plot_id='write' onHover={onHover} />
                </GridItem>
            </Grid>
        </>);
};
