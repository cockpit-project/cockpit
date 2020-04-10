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
import { Card, CardHeader, CardBody, CardFooter } from '@patternfly/react-core';

import cockpit from "cockpit";
import * as machine_info from "machine-info.js";

import "./systemInformationCard.scss";

const _ = cockpit.gettext;

export class SystemInfomationCard extends React.Component {
    constructor(props) {
        super(props);

        this.state = {};
        this.system_uptime = null;
        this.getDMIInfo = this.getDMIInfo.bind(this);
        this.getMachineId = this.getMachineId.bind(this);
        this.getSystemUptime = this.getSystemUptime.bind(this);
    }

    componentDidMount() {
        this.getDMIInfo();
        this.getMachineId();
        this.getSystemUptime();
    }

    getMachineId() {
        var machine_id = cockpit.file("/etc/machine-id");
        var self = this;

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
        var self = this;

        machine_info.dmi_info()
                .then(function(fields) {
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

                    self.setState({ assetTagText: fields.product_serial || fields.chassis_serial });
                }, function(ex) {
                    // FIXME show proper Alerts
                    console.debug("couldn't read dmi info: " + ex);
                    self.setState({ assetTagText: undefined, hardwareText: undefined });
                });
    }

    getSystemUptime() {
        var self = this;

        cockpit.spawn(["cat", "/proc/uptime"])
                .done(function(text) {
                    var uptime_days = 0;
                    var uptime_hours = 0;
                    var uptime_minutes = 0;
                    var match = text.match(/[0-9]*\.[0-9]{2}/);
                    var uptime_raw = match && parseFloat(match[0]);

                    uptime_days = Math.floor(uptime_raw / 86400);
                    uptime_raw = uptime_raw - (uptime_days * 86400);

                    uptime_hours = Math.floor(uptime_raw / 3600);
                    uptime_raw = uptime_raw - (uptime_hours * 3600);

                    uptime_minutes = Math.floor(uptime_raw / 60);

                    if (uptime_days == 0) {
                        if (uptime_hours == 0) {
                            self.system_uptime = (<> <div id="system_uptime">{uptime_minutes} {_("Minutes")} </div> </>);
                        } else {
                            self.system_uptime = (<> <div id="system_uptime">{uptime_hours} {_("Hours")} {uptime_minutes} {_("Minutes")} </div> </>);
                        }
                    } else {
                        if (uptime_hours == 0) {
                            self.system_uptime = (<> <div id="system_uptime">{uptime_days} {_("Days")} {uptime_minutes} {_("Minutes")} </div> </>);
                        } else {
                            self.system_uptime = (<> <div id="system_uptime">{uptime_days} {_("Days")} {uptime_hours} {_("Hours")} </div> </>);
                        }
                    }
                })
                .fail(function(ex) {
                    console.error("Error reading system uptime", ex);
                });
    }

    render() {
        return (
            <Card className="system-information">
                <CardHeader>{_("System information")}</CardHeader>
                <CardBody>
                    <table className="pf-c-table pf-m-grid-md pf-m-compact">
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
                                <th scope="row" className="system-information-uptime">{_("System uptime")}</th>
                                <td>
                                    {this.system_uptime}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </CardBody>
                <CardFooter>
                    <a role="link" tabIndex="0" className="no-left-padding" onClick={() => cockpit.jump("/system/hwinfo", cockpit.transport.host)}>
                        {_("View hardware details")}
                    </a>
                </CardFooter>
            </Card>
        );
    }
}
