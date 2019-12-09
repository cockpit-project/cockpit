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
    Card, CardHeader, CardBody, CardFooter,
    Progress, ProgressMeasureLocation, ProgressVariant,
} from '@patternfly/react-core';

import * as machine_info from "machine-info.js";
import cockpit from "cockpit";

import "./usageCard.less";

const _ = cockpit.gettext;

const UPDATE_DELAY = 5000;

export class UsageCard extends React.Component {
    constructor(props) {
        super(props);

        this.state = { pollingEnabled: true };
        this.updateMemoryInfo = this.updateMemoryInfo.bind(this);
    }

    componentDidMount() {
        this.updateMemoryInfo();

        cockpit.addEventListener("visibilitychange", () => {
            this.setState((prevState, _) => ({ pollingEnabled: !prevState.pollingEnabled }));
        }, () => this.updateMemoryInfo());
    }

    componentWillUnmount() {
        this.setState({ pollingEnabled: false });
    }

    updateMemoryInfo() {
        if (!this.state.pollingEnabled)
            return;

        machine_info.cpu_ram_info().done(info => {
            this.setState({
                memTotal: Number((info.memory / (1024 * 1024 * 1024)).toFixed(1)),
                memAvailable: Number((info.available_memory / (1024 * 1024 * 1024)).toFixed(1))
            });
        });
        window.setTimeout(this.updateMemoryInfo.bind(this), UPDATE_DELAY);
    }

    render() {
        const memUsed = Number((this.state.memTotal - this.state.memAvailable).toFixed(1));
        const fraction = memUsed / this.state.memTotal;

        return (
            <Card className="system-usage">
                <CardHeader>{_("Usage")}</CardHeader>
                <CardBody>
                    <table className="pf-c-table pf-m-grid-md pf-m-compact">
                        <tbody>
                            <tr>
                                <th scope="row">{_("Memory")}</th>
                                <td>
                                    <Progress value={memUsed}
                                        className="pf-m-sm"
                                        min={0} max={Number(this.state.memTotal)}
                                        variant={fraction > 0.9 ? ProgressVariant.danger : ProgressVariant.info}
                                        label={cockpit.format(_("$0 GiB / $1 GiB"), memUsed, this.state.memTotal)}
                                        measureLocation={ProgressMeasureLocation.outside} />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </CardBody>
                <CardFooter>
                    <a role="link" tabIndex="0" className="no-left-padding" onClick={() => cockpit.jump("/system/graphs", cockpit.transport.host)}>
                        {_("View graphs")}
                    </a>
                </CardFooter>
            </Card>
        );
    }
}
