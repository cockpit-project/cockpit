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

import cockpit from "cockpit";
import * as machine_info from "machine-info.js";
import * as timeformat from "timeformat.js";

import "./systemInformationCard.scss";

const _ = cockpit.gettext;

export class SystemInfomationCard extends React.Component {
    constructor(props) {
        super(props);

        this.state = {};
        this.getDMIInfo = this.getDMIInfo.bind(this);
        this.getMachineId = this.getMachineId.bind(this);
        this.getSystemUptime = this.getSystemUptime.bind(this);
    }

    componentDidMount() {
        this.getDMIInfo();
        this.getMachineId();
        this.getSystemUptime();

        this.uptimeTimer = setInterval(this.getSystemUptime, 60000);
    }

    componentWillUnmount() {
        clearInterval(this.uptimeTimer);
    }

    getMachineId() {
        const machine_id = cockpit.file("/etc/machine-id");
        const self = this;

        machine_id.read()
                .done(function(content) {
                    self.setState({ machineID: content });
                })
                .fail(function(ex) {
                    // FIXME show proper Alerts
                    console.error("Error reading machine id", ex);
                })
                .always(function() {
                    machine_id.close();
                });
    }

    getDMIInfo() {
        const self = this;

        machine_info.dmi_info()
                .then(fields => {
                    let vendor = fields.sys_vendor;
                    let name = fields.product_name;
                    if (!vendor || !name) {
                        vendor = fields.board_vendor;
                        name = fields.board_name;
                    }
                    if (!vendor || !name)
                        self.setState({ hardwareText: undefined });
                    else
                        self.setState({ hardwareText: vendor + " " + name });

                    self.setState({ assetTagText: fields.product_serial || fields.chassis_serial || undefined });
                })
                .catch(ex => {
                    // try DeviceTree
                    machine_info.devicetree_info()
                            .then(fields => self.setState({ assetTagText: fields.serial, hardwareText: fields.model || undefined }))
                            .catch(dmiex => {
                                console.debug("couldn't read dmi info: " + ex);
                                console.debug("couldn't read DeviceTree info: " + dmiex.toString());
                                self.setState({ assetTagText: undefined, hardwareText: undefined });
                            });
                });
    }

    getSystemUptime() {
        cockpit.file("/proc/uptime").read()
                .then(content => {
                    const uptime = parseFloat(content.split(' ')[0]);
                    const bootTime = new Date().valueOf() - uptime * 1000;
                    this.setState({ systemUptime: timeformat.distanceToNow(bootTime) });
                })
                .fail(ex => console.error("Error reading system uptime", ex));
    }

    render() {
        return (
            <Card className="system-information">
                <CardTitle>{_("System information")}</CardTitle>
                <CardBody>
                    <table className="pf-v5-c-table pf-m-grid-md pf-m-compact">
                        <tbody>
                            {this.state.hardwareText && <tr>
                                <th scope="row">{_("Model")}</th>
                                <td>
                                    <div id="system_information_hardware_text">{this.state.hardwareText}</div>
                                </td>
                            </tr>}
                            {this.state.assetTagText && <tr>
                                <th scope="row">{_("Asset tag")}</th>
                                <td>
                                    <div id="system_information_asset_tag_text">{this.state.assetTagText}</div>
                                </td>
                            </tr>}
                            <tr>
                                <th scope="row" className="system-information-machine-id">{_("Machine ID")}</th>
                                <td>
                                    <div id="system_machine_id">{this.state.machineID}</div>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row" className="system-information-uptime">{_("Uptime")}</th>
                                <td>
                                    <div id="system_uptime">{this.state.systemUptime}</div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </CardBody>
                <CardFooter>
                    <Button isInline variant="link" component="a" onClick={ev => { ev.preventDefault(); cockpit.jump("/system/hwinfo", cockpit.transport.host) }}>
                        {_("View hardware details")}
                    </Button>
                </CardFooter>
            </Card>
        );
    }
}
