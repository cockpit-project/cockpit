import './plot.css';

import React from 'react';
import ReactDOM from "react-dom";

import { PlotState } from "plot.js";
import { SvgPlot, bytes_config } from "cockpit-components-plot.jsx";

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

    ReactDOM.render(<SvgPlot className="mem-graph"
                             title="Direct" config={bytes_config}
                             plot_state={plot_state} plot_id="direct" />,
                    document.getElementById('plot-direct'));

    ReactDOM.render(<SvgPlot className="mem-graph"
                             title="PMCD" config={bytes_config}
                             plot_state={plot_state} plot_id="pmcd" />,
                    document.getElementById('plot-pmcd'));
});
