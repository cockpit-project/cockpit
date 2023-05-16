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
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Progress, ProgressMeasureLocation, ProgressVariant } from "@patternfly/react-core/dist/esm/components/Progress/index.js";

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
            memTotal: 0, // bytes
            memUsed: 0, // bytes
            memUsedText: " ",
            numCpu: 1, // number
            cpuUsed: 0, // percentage
        };

        machine_info.cpu_ram_info()
                .then(info => this.setState({
                    memTotal: info.memory,
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

        let used_text;
        if (this.state.memTotal) {
            const [total_fmt, unit] = cockpit.format_bytes(this.state.memTotal, 1024, { separate: true, precision: 2 });
            const used_fmt = cockpit.format_bytes(this.samples[3], unit, { separate: true, precision: 2 })[0];
            used_text = cockpit.format("$0 / $1 $2", used_fmt, total_fmt, unit);
        } else {
            used_text = " ";
        }

        this.setState({ memUsed: this.samples[3], memUsedText: used_text });
    }

    render() {
        const fraction = this.state.memTotal ? this.state.memUsed / this.state.memTotal : 0;
        const cores_str = cockpit.format(cockpit.ngettext("of $0 CPU", "of $0 CPUs", this.state.numCpu), this.state.numCpu);

        return (
            <Card className="system-usage">
                <CardTitle>{_("Usage")}</CardTitle>
                <CardBody>
                    <table className="pf-v5-c-table pf-m-grid-md pf-m-compact">
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
                                        min={0} max={this.state.memTotal}
                                        variant={fraction > 0.9 ? ProgressVariant.danger : null}
                                        aria-labelledby="system-usage-memory-progress"
                                        label={this.state.memUsedText}
                                        measureLocation={ProgressMeasureLocation.outside} />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </CardBody>
                <CardFooter>
                    <Button isInline variant="link" component="a" onClick={ev => { ev.preventDefault(); cockpit.jump("/metrics", cockpit.transport.host) }}>
                        {_("View metrics and history")}
                    </Button>
                </CardFooter>
            </Card>
        );
    }
}
