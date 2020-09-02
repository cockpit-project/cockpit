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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import { Flex, FlexItem } from '@patternfly/react-core';

import {
    logDebug,
    convertToUnit,
    toReadableNumber,
    units,
    toFixedPrecision,
} from "../../helpers.js";

import DonutChart from "../../c3charts.jsx";

const _ = cockpit.gettext;

class VmUsageTab extends React.Component {
    componentDidMount() {
        this.props.onUsageStartPolling();
    }

    componentWillUnmount() {
        this.props.onUsageStopPolling();
    }

    render() {
        const vm = this.props.vm;
        const width = 220;
        const height = 170;

        const rssMem = vm.rssMemory ? vm.rssMemory : 0; // in KiB
        const memTotal = vm.currentMemory ? vm.currentMemory : 0; // in KiB
        let available = memTotal - rssMem; // in KiB
        available = available < 0 ? 0 : available;

        const totalCpus = vm.vcpus && vm.vcpus.count > 0 ? vm.vcpus.count : 0;
        let cpuUsage = isNaN(vm.cpuUsage) ? 0 : vm.cpuUsage;
        cpuUsage = toFixedPrecision(cpuUsage, 1);

        logDebug(`VmUsageTab.render(): rssMem: ${rssMem} KiB, memTotal: ${memTotal} KiB, available: ${available} KiB, totalCpus: ${totalCpus}, cpuUsage: ${cpuUsage}`);

        const memChartData = {
            columns: [
                [_("Used"), toReadableNumber(convertToUnit(rssMem, units.KiB, units.GiB))],
                [_("Available"), toReadableNumber(convertToUnit(available, units.KiB, units.GiB))],
            ],
            groups: [
                ["used", "available"],
            ],
            order: null,
        };

        const cpuChartData = {
            columns: [
                [_("Used"), cpuUsage],
                [_("Available"), 100.0 - cpuUsage],
            ],
            groups: [
                ["used", "available"],
            ],
            order: null,
        };

        const chartSize = {
            width, // keep the .usage-donut-caption CSS in sync
            height,
        };

        return (
            <Flex>
                <FlexItem className="memory-usage-chart">
                    <DonutChart data={memChartData} size={chartSize} width='8' tooltipText=' '
                                primaryTitle={toReadableNumber(convertToUnit(rssMem, units.KiB, units.GiB))}
                                secondaryTitle='GiB'
                                caption={`used from ${cockpit.format_bytes(memTotal * 1024)} memory`} />
                </FlexItem>
                <FlexItem className="vcpu-usage-chart">
                    <DonutChart data={cpuChartData} size={chartSize} width='8' tooltipText=' '
                                primaryTitle={cpuUsage} secondaryTitle='%'
                                caption={`used from ${totalCpus} vCPUs`} />
                </FlexItem>
            </Flex>
        );
    }
}

VmUsageTab.propTypes = {
    vm: PropTypes.object.isRequired,
    onUsageStartPolling: PropTypes.func.isRequired,
    onUsageStopPolling: PropTypes.func.isRequired,
};

export default VmUsageTab;
