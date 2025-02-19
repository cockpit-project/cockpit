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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */
import React from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";

import cockpit from "cockpit";
import * as machine_info from "machine-info.js";
import * as timeformat from "timeformat";

import "./systemInformationCard.scss";

const _ = cockpit.gettext;

export class SystemInformationCard extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            machineID: null,
            model: null,
            assetTag: null,
            systemUptime: null,
            bootType: null,
            securebootEnabled: false,
        };
        this.getSystemUptime = this.getSystemUptime.bind(this);
    }

    componentDidMount() {
        this.getDMIInfo();
        this.getMachineId();
        this.getSystemUptime();
        this.getBootType();

        this.uptimeTimer = setInterval(this.getSystemUptime, 60000);
    }

    componentWillUnmount() {
        clearInterval(this.uptimeTimer); // not-covered: callers currently never unmount this
    }

    getMachineId() {
        const machine_id = cockpit.file("/etc/machine-id");

        machine_id.read()
                .then(machineID => this.setState({ machineID }))
                .catch(ex => console.error("Error reading machine id", ex.toString())) // not-covered: OS error
                .finally(machine_id.close);
    }

    getDMIInfo() {
        machine_info.dmi_info()
                .then(fields => {
                    let vendor = fields.sys_vendor;
                    let name = fields.product_name;
                    if (!vendor || !name) {
                        vendor = fields.board_vendor;
                        name = fields.board_name;
                    }
                    if (!vendor || !name)
                        this.setState({ model: null });
                    else
                        this.setState({ model: vendor + " " + name });

                    this.setState({ assetTag: fields.product_serial || fields.chassis_serial });
                })
                .catch(ex => {
                    // try DeviceTree
                    machine_info.devicetree_info() // not-covered: coverage only runs on x86_64
                            .then(fields => this.setState({ assetTag: fields.serial, model: fields.model }))
                            .catch(dmiex => {
                                console.debug("couldn't read dmi info: " + ex.toString());
                                console.debug("couldn't read DeviceTree info: " + dmiex.toString());
                                this.setState({ assetTag: null, model: null });
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
                .catch(ex => console.error("Error reading system uptime", ex.toString())); // not-covered: OS error
    }

    async getBootType() {
        // https://uefi.org/specs/UEFI/2.10/03_Boot_Manager.html#globally-defined-variables
        let secure_boot_enabled = false;
        const secure_boot_file = "/sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c";
        // TODO: constant?
        const output = await cockpit.script("set -e; test -d /sys/firmware/efi && echo 'efi' || echo 'bios'; cat /proc/sys/kernel/arch");
        const [firmware, arch] = output.trim().split("\n");

        // TODO: check if secure boot is available?
        if (arch === "x86_64" || arch === "arm64") {
            try {
                const result = await cockpit.file(secure_boot_file, { binary: true }).read();
                if (result[4] === 1)
                    secure_boot_enabled = true;
            } catch (err) {
                console.warn("cannot read secure boot EFI var", err);
            }

            this.setState({
                bootType: firmware,
                securebootEnabled: secure_boot_enabled,
            });
        }
    }

    getBootTypeStr() {
        const { bootType, securebootEnabled } = this.state;
        if (bootType === "efi") {
            return cockpit.format(_("EFI (Secure Boot $0)"), securebootEnabled ? _("enabled") : _("disabled"));
        } else {
            _("BIOS or Legacy");
        }
    }

    render() {
        return (
            <Card className="system-information">
                <CardTitle>{_("System information")}</CardTitle>
                <CardBody>
                    <table className="pf-v5-c-table pf-m-grid-md pf-m-compact">
                        <tbody className="pf-v5-c-table__tbody">
                            {this.state.model && <tr className="pf-v5-c-table__tr">
                                <th className="pf-v5-c-table__th" scope="row">{_("Model")}</th>
                                <td className="pf-v5-c-table__td">
                                    <div id="system_information_hardware_text">{this.state.model}</div>
                                </td>
                            </tr>}
                            {this.state.assetTag && <tr className="pf-v5-c-table__tr">
                                <th className="pf-v5-c-table__th" scope="row">{_("Asset tag")}</th>
                                <td className="pf-v5-c-table__td">
                                    <div id="system_information_asset_tag_text">{this.state.assetTag}</div>
                                </td>
                            </tr>}
                            <tr className="pf-v5-c-table__tr">
                                <th className="pf-v5-c-table__th system-information-machine-id" scope="row">{_("Machine ID")}</th>
                                <td className="pf-v5-c-table__td">
                                    <div id="system_machine_id">{this.state.machineID}</div>
                                </td>
                            </tr>
                            {this.state.bootType && <tr className="pf-v5-c-table__tr">
                                <th className="pf-v5-c-table__th system-information-boot-type" scope="row">{_("Boot type")}</th>
                                <td className="pf-v5-c-table__td">
                                    <div id="boot_type">{this.getBootTypeStr()}</div>
                                </td>
                            </tr>}
                            <tr className="pf-v5-c-table__tr">
                                <th className="pf-v5-c-table__th system-information-uptime" scope="row">{_("Up since")}</th>
                                <td className="pf-v5-c-table__td">
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
