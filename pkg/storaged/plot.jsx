/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

import React from "react";

import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { ZoomControls, SvgPlot, bytes_per_sec_config } from "cockpit-components-plot.jsx";

import { decode_filename, get_other_devices } from "./utils.js";

const _ = cockpit.gettext;

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

    // show all top-level block objects: Drives and Other devices
    const blocks = Object.keys(client.drives).map(p => client.drives_block[p])
            .concat(get_other_devices(client).map(p => client.blocks[p]));

    blocks.forEach(block => {
        const dev = block && decode_filename(block.Device).replace(/^\/dev\//, "");
        if (dev)
            devs.push(dev);
    });

    if (devs.length > 10) {
        ps.plot_single('read', single_read_metric);
        ps.plot_single('write', single_write_metric);
    } else {
        ps.plot_instances('read', instances_read_metric, devs);
        ps.plot_instances('write', instances_write_metric, devs);
    }
}

export const StoragePlots = ({ plot_state }) => {
    return (
        <>
            <Split>
                <SplitItem isFilled />
                <SplitItem><ZoomControls plot_state={plot_state} /></SplitItem>
            </Split>
            <Grid sm={12} md={6} lg={6} hasGutter>
                <GridItem>
                    <SvgPlot className="storage-graph"
                             title={_("Reading")} config={bytes_per_sec_config}
                             plot_state={plot_state} plot_id='read' />
                </GridItem>
                <GridItem>
                    <SvgPlot className="storage-graph"
                             title={_("Writing")} config={bytes_per_sec_config}
                             plot_state={plot_state} plot_id='write' />
                </GridItem>
            </Grid>
        </>);
};
