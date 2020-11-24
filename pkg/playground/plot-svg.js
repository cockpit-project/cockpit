import 'jquery';

import '../lib/patternfly/patternfly-cockpit.scss';
import './plot-svg.css';

import React, { useState } from 'react';
import ReactDOM from "react-dom";

import {
    Page,
    Card,
    CardBody,
    Split,
    SplitItem,
    Grid,
    GridItem
} from '@patternfly/react-core';

import { PlotState } from "plot.js";
import { ZoomControls, SvgPlot, bytes_per_sec_config } from "cockpit-components-plot.jsx";
import { useObject } from "hooks.js";

import "../lib/patternfly/patternfly-4-overrides.scss";

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

const StoragePlots = () => {
    const devs = ["vda", "sda", "sdb"];

    const ps = useObject(() => new PlotState(), ps => null, []);
    const [hovered, setHovered] = useState(null);

    if (devs.length > 10) {
        ps.plot_single('read', single_read_metric);
        ps.plot_single('write', single_write_metric);
    } else {
        ps.plot_instances('read', instances_read_metric, devs);
        ps.plot_instances('write', instances_write_metric, devs);
    }

    return (
        <>
            <Split>
                <SplitItem isFilled />
                <SplitItem><ZoomControls plot_state={ps} /></SplitItem>
            </Split>
            <Grid sm={12} md={6} lg={6} hasGutter>
                <GridItem>
                    <SvgPlot className="storage-graph"
                             title="Reading" config={bytes_per_sec_config}
                             plot_state={ps} plot_id='read' onHover={setHovered} />
                </GridItem>
                <GridItem>
                    <SvgPlot className="storage-graph"
                             title="Writing" config={bytes_per_sec_config}
                             plot_state={ps} plot_id='write' onHover={setHovered} />
                </GridItem>
            </Grid>
            <div>{hovered || "--"}</div>
        </>);
};

const MyPage = () => {
    return (
        <Page>
            <Card>
                <CardBody>
                    <StoragePlots />
                </CardBody>
            </Card>
        </Page>);
};

document.addEventListener("DOMContentLoaded", function() {
    ReactDOM.render(<MyPage />, document.getElementById('plots'));
});
