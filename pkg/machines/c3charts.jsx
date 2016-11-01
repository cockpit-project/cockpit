/*jshint esversion: 6 */
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import $ from 'jquery';
import React from "react";

import c3 from "c3/c3";
import {logDebug} from "./helpers.es6";

var idCounter = 0; // To keep <div id=""> unique

class DonutChart extends React.Component {
    constructor(props) {
        super(props);
        this.domId = `chart-donut-${idCounter++}`;
    }

    prepareProps(props) {
        const state = {
            data: props['data'] ? props['data'] : {},
            size: props['size'] ? props['size'] : {width: 150, height: 100},
            width: props['width'] ? props['width'] : 10,

            tooltipText: props['tooltipText'],
            primaryTitle: props['primaryTitle'],
            secondaryTitle: props['secondaryTitle'],

            caption: props['caption'] ? props['caption'] : ''
        };
        state.data['type'] = 'donut';
        return state;
    }

    componentDidMount() {
        this._renderChart();
    }

    componentWillUnmount() {
        this.donutChart.destroy();
    }

    shouldComponentUpdate(nextProps) {
        if (this.props['data']) {
            const result = JSON.stringify(this.props.data.columns) !== JSON.stringify(nextProps.data.columns);
            logDebug(`shouldComponentUpdate() ${result}\nold: ${JSON.stringify(this.props.data.columns)}\nnew: ${JSON.stringify(nextProps.data.columns)}`);
            return result;
        }

        return true;
    }

    _renderChart() {
        logDebug('DonutChart._render() called');
        const bindTo = `#${this.domId}`;
        const c3ChartDefaults = $().c3ChartDefaults();
        const options = c3ChartDefaults.getDefaultDonutConfig('');

        const props = this.prepareProps(this.props);

        options.bindto = bindTo;
        options.data = props.data;
        options.size = props.size;
        options.donut.width = props.width;
        options.tooltip = props.tooltipText ? {contents: $().pfGetUtilizationDonutTooltipContentsFn(props.tooltipText)} : options.tooltip;

        try {
            this.donutChart = c3.generate(options);
            $().pfSetDonutChartTitle(bindTo, props.primaryTitle, props.secondaryTitle);
        } catch (err) {
            logDebug('Exception thrown when rendering donut chart: ', err);
        }
    }

    render() {
        this._renderChart();

        return (<div>
            <div id={this.domId} />
            <div className='usage-donut-caption'>{this.props['caption']}</div>
        </div>);
    }
}

export default DonutChart;
