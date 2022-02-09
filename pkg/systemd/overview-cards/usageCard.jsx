/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import {
    Button,
    Card, CardBody, CardFooter,
    Progress, ProgressMeasureLocation, ProgressVariant, CardTitle,
} from '@patternfly/react-core';

import * as machine_info from "machine-info.js";
import cockpit from "cockpit";

import "./usageCard.scss";

const _ = cockpit.gettext;

const METRICS_SPEC = {
    payload: "metrics1",
    source: "internal",
    interval: 3000,
    metrics: [
        { name: "cpu.basic.user", derive: "rate" },
        { name: "cpu.basic.system", derive: "rate" },
        { name: "cpu.basic.nice", derive: "rate" },
        { name: "memory.used" },
    ]
};

export class UsageCard extends React.Component {
    constructor(props) {
        super(props);

        this.metrics_channel = null;
        this.samples = [];

        this.state = {
            memTotal: 0, // GiB
            memUsed: 0, // GiB
            numCpu: 1, // number
            cpuUsed: 0, // percentage
        };

        machine_info.cpu_ram_info().done(info => this.setState({
            memTotal: Number((info.memory / (1024 * 1024 * 1024)).toFixed(1)),
            numCpu: info.cpus,
        }));

        this.onVisibilityChange = this.onVisibilityChange.bind(this);
        this.onMetricsUpdate = this.onMetricsUpdate.bind(this);

        cockpit.addEventListener("visibilitychange", this.onVisibilityChange);
        this.onVisibilityChange();
    }

    onVisibilityChange() {
        if (cockpit.hidden && this.metrics_channel !== null) {
            this.metrics_channel.removeEventListener("message", this.onMetricsUpdate);
            this.metrics_channel.close();
            this.metrics_channel = null;
            return;
        }

        if (!cockpit.hidden && this.metrics_channel === null) {
            this.metrics_channel = cockpit.channel(METRICS_SPEC);
            this.metrics_channel.addEventListener("closed", (ev, error) => console.error("metrics closed:", error));
            this.metrics_channel.addEventListener("message", this.onMetricsUpdate);
        }
    }

    onMetricsUpdate(event, message) {
        const data = JSON.parse(message);

        // reset state on meta messages
        if (!Array.isArray(data)) {
            this.samples = [];
            return;
        }

        // decompress
        data.forEach(samples => {
            samples.forEach((sample, i) => {
                if (sample !== null)
                    this.samples[i] = sample;
            });
        });

        // CPU metrics are in ms/s; divide by 10 to get percentage
        if (this.samples[0] !== false) {
            const cpu = Math.round((this.samples[0] + this.samples[1] + this.samples[2]) / 10 / this.state.numCpu);
            this.setState({ cpuUsed: cpu });
        }
        this.setState({ memUsed: Number((this.samples[3] / (1024 * 1024 * 1024)).toFixed(1)) });
    }

    render() {
        const fraction = this.state.memUsed / this.state.memTotal;
        const cores_str = cockpit.format(cockpit.ngettext("of $0 CPU", "of $0 CPUs", this.state.numCpu), this.state.numCpu);

        return (
            <Card className="system-usage">
                <CardTitle>{_("Usage")}</CardTitle>
                <CardBody>
                    <table className="pf-c-table pf-m-grid-md pf-m-compact">
                        <tbody>
                            <tr>
                                <th id="system-usage-cpu-progress" scope="row">{_("CPU")}</th>
                                <td>
                                    <Progress value={this.state.cpuUsed}
                                        className="pf-m-sm"
                                        min={0} max={100}
                                        variant={ this.state.cpuUsed > 90 ? ProgressVariant.danger : null }
                                        label={ this.state.cpuUsed + '% ' + cores_str }
                                        aria-labelledby="system-usage-cpu-progress"
                                        measureLocation={ProgressMeasureLocation.outside} />
                                </td>
                            </tr>
                            <tr>
                                <th id="system-usage-memory-progress" scope="row">{_("Memory")}</th>
                                <td>
                                    <Progress value={this.state.memUsed}
                                        className="pf-m-sm"
                                        min={0} max={Number(this.state.memTotal)}
                                        variant={fraction > 0.9 ? ProgressVariant.danger : null}
                                        aria-labelledby="system-usage-memory-progress"
                                        label={cockpit.format("$0 / $1 GiB", this.state.memUsed, this.state.memTotal)}
                                        measureLocation={ProgressMeasureLocation.outside} />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </CardBody>
                <CardFooter>
                    <Button isInline variant="link" component="a" href="#" onClick={ev => { ev.preventDefault(); cockpit.jump("/metrics", cockpit.transport.host) }}>
                        {_("View details and history")}
                    </Button>
                </CardFooter>
            </Card>
        );
    }
}
