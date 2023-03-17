import './plot.css';

import React from 'react';
import { createRoot } from 'react-dom/client';

import { PlotState } from "plot";
import { SvgPlot, bytes_config } from "cockpit-components-plot";

const direct_metric = {
    direct: ["mem.util.available"],
    units: "bytes"
};

const pmcd_metric = {
    pmcd: ["mem.util.available"],
    units: "bytes"
};

document.addEventListener("DOMContentLoaded", function() {
    const plot_state = new PlotState();
    plot_state.plot_single('direct', direct_metric);
    plot_state.plot_single('pmcd', pmcd_metric);

    // For the tests
    window.plot_state = plot_state;

    createRoot(document.getElementById('plot-direct')).render(
        <SvgPlot className="mem-graph"
                 title="Direct" config={bytes_config}
                 plot_state={plot_state} plot_id="direct" />
    );

    createRoot(document.getElementById('plot-pmcd')).render(
        <SvgPlot className="mem-graph"
                 title="PMCD" config={bytes_config}
                 plot_state={plot_state} plot_id="pmcd" />
    );
});
