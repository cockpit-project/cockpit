/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

// @flow
import React, { PropTypes } from 'react';
import { DonutChart } from 'patternfly-react';
import cockpit, { gettext as _ } from 'cockpit';
import { prefixedId } from '../utils.jsx';

import './VmMetricsTab.less';

const MetricColumn = ({ type, children, className }) => {
    return (
        <div className={`col-sm-4 ${className || ''}`}>
            <div className="container metric">
                {children}
            </div>
            <div className="text-center">{type}</div>
        </div>
    );
};

const MetricColumnContent = ({ id, title, smallTitle }) => {
    return (
        <div id={id} className="centered">
            <span id={prefixedId(id, 'title')} className="block donut-title-big-pf">
                {title}
            </span>
            <div className="container small-text-layout">
                <span id={prefixedId(id, 'small-title')} className="donut-title-small-pf small-text">
                    {smallTitle}
                </span>
            </div>
        </div>
    );
};

const CPUChart = ({ id, podMetrics }) => {
    const used = podMetrics.cpu && podMetrics.cpu.usageNanoCores ? Math.round((podMetrics.cpu.usageNanoCores / 1000000000) * 100) : 0;
    const available = 100 - used;
    const unit = "%";
    const index = [90, 80, 70, -1].findIndex((v) => used > v);
    const color = ["#CE0000", "#EC7A08", "#F9D67A", "#D4F0FA"][index];

    return (
        <div className="centered" id={id}>
            <DonutChart
                size={{ width: 150, height: 150 }}
                data={{
                    columns: [[_("Used"), used], [_("Free"), available]],
                    order: null,
                    colors: {
                        "Used": color,
                        "Free": "#BBBBBB",
                    },
                }}
                title={{ primary: used + unit, secondary: _("Used") }}
                tooltip={{
                    contents: (data) => `${data[0].value}${unit}&nbsp;${data[0].name}`
                }}
                donut={{ width: 9, label: { show: false } }}
            />
        </div>
    );
};

const CpuColumn = ({ idPrefix, podMetrics }) => {
    return (
        <MetricColumn type={_("CPU")}>
            <CPUChart id={prefixedId(idPrefix, 'cpu-metric')} podMetrics={podMetrics} />
        </MetricColumn>
    );
};

const MemoryColumn = ({ idPrefix, podMetrics }) => {
    const usage = cockpit.format_bytes(podMetrics.memory.usageBytes);
    return (
        <MetricColumn type={_("Memory")}>
            <MetricColumnContent id={prefixedId(idPrefix, 'memory-metric')} title={usage} />
        </MetricColumn>
    );
};

const NetworkColumn = ({ idPrefix, podMetrics }) => {
    const received = cockpit.format_bytes_per_sec(podMetrics.network.rxBytes);
    const transmitted = cockpit.format_bytes_per_sec(podMetrics.network.txBytes);
    const title = (
        <div>
            <div className="inline-block" id={prefixedId(idPrefix, 'download-metric')}>
                <div className="next-to-left fa fa-arrow-down" />
                {received}
            </div>
            <div className="inline-block" id={prefixedId(idPrefix, 'upload-metric')}>
                <div className="next-clear fa fa-arrow-up" />
                {transmitted}
            </div>
        </div>
    );
    return (
        <MetricColumn type={_("Network")} className="no-padding-left">
            <MetricColumnContent id={prefixedId(idPrefix, 'network-metric')} title={title} />
        </MetricColumn>
    );
};

const PodMetrics = ({ idPrefix, podMetrics }) => {
    return (
        <div className="row">
            <CpuColumn idPrefix={idPrefix} podMetrics={podMetrics} />
            <MemoryColumn idPrefix={idPrefix} podMetrics={podMetrics} />
            <NetworkColumn idPrefix={idPrefix} podMetrics={podMetrics} />
        </div>
    );
};

const VmMetricsTab = ({idPrefix, podMetrics}) => {
    const content = podMetrics ? (<PodMetrics idPrefix={idPrefix} podMetrics={podMetrics} />)
        : _("Usage metrics are available after the pod starts");

    return (
        <div id={prefixedId(idPrefix, 'usage-metrics')}>
            {content}
        </div>
    );
};

VmMetricsTab.propTypes = {
    podMetrics: PropTypes.object.isRequired,
};

export default VmMetricsTab;
