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

import '../../src/base1/patternfly-cockpit.scss';
import 'polyfills'; // once per application

import cockpit from "cockpit";
import moment from 'moment';
import React from "react";
import ReactDOM from 'react-dom';

import { ListView, Modal } from 'patternfly-react';
import { Alert, AlertActionCloseButton, Button } from '@patternfly/react-core';
import { SortByDirection } from "@patternfly/react-table";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";
import { ListingTable } from "cockpit-components-table.jsx";

import kernelopt_sh from "raw-loader!./kernelopt.sh";
import detect from "./hw-detect.js";

import { PrivilegedButton } from "cockpit-components-privileged.jsx";

const _ = cockpit.gettext;

class SystemInfo extends React.Component {
    constructor(props) {
        super(props);
        this.permission = cockpit.permission({ admin: true });
    }

    render() {
        const info = this.props.info;
        if ((!info.name || !info.version) && info.alt_name && info.alt_version) {
            info.name = info.alt_name;
            info.version = info.alt_version;
        }
        const onSecurityClick = this.props.onSecurityClick;

        const mitigations = (
            <PrivilegedButton variant="link" buttonId="cpu_mitigations" tooltipId="tip-cpu-security"
                        excuse={ _("The user $0 is not permitted to change cpu security mitigations") }
                        permission={ this.permission } onClick={ onSecurityClick }>
                { _("Mitigations") }
            </PrivilegedButton>
        );

        return (
            <table className="info-table-ct wide-split-table-ct">
                { info.type &&
                <tbody>
                    <tr>
                        <th>{ _("Type") }</th>
                        <td>{ info.type }</td>
                    </tr>
                    <tr>
                        <th>{ _("Name") }</th>
                        <td>{ info.name }</td>
                    </tr>
                    <tr>
                        <th>{ _("Version") }</th>
                        <td>{ info.version }</td>
                    </tr>
                </tbody>
                }
                <tbody>
                    { info.bios_vendor &&
                    <>
                        <tr>
                            <th>{ _("BIOS") }</th>
                            <td>{ info.bios_vendor }</td>
                        </tr>
                        <tr>
                            <th>{ _("BIOS version") }</th>
                            <td>{ info.bios_version }</td>
                        </tr>
                        <tr>
                            <th>{ _("BIOS date") }</th>
                            <td>{ moment(info.bios_date).isValid() ? moment(info.bios_date).format('L') : info.bios_date }</td>
                        </tr>
                    </>
                    }
                    { info.nproc !== undefined &&
                    <>
                        <tr>
                            <th>{ _("CPU") }</th>
                            <td>{ (info.nproc > 1) ? `${info.nproc}x ${info.cpu_model}` : info.cpu_model }</td>
                        </tr>
                        { onSecurityClick !== undefined &&
                        <tr>
                            <th>{ _("CPU Security") }</th>
                            <td>{ mitigations }</td>
                        </tr>
                        }
                    </>
                    }
                </tbody>
            </table>
        );
    }
}

function availableMitigations() {
    if (availableMitigations.cachedMitigations !== undefined)
        return Promise.resolve(availableMitigations.cachedMitigations);
    /* nosmt */
    const promises = [cockpit.spawn(["lscpu"], { environ: ["LC_ALL=C.UTF-8"], }), cockpit.file("/proc/cmdline").read()];
    return Promise.all(promises).then(values => {
        let threads_per_core;
        try {
            threads_per_core = Number(values[0].split('\n')
                    .find(l => l.indexOf('Thread(s) per core:') !== -1)
                    .split(':')[1]);
        } catch (e) {
            console.warn(e);
            return { available: false };
        }
        /* "nosmt" and "nosmt=force" are valid */
        const nosmt_enabled = (values[1].indexOf("nosmt") !== -1 && values[1].indexOf("nosmt=") === -1) || values[1].indexOf("nosmt=force") !== -1;
        /* available if threads>1 and the cmdline is valid */
        const nosmt_available = threads_per_core > 1 && (values[1].indexOf("nosmt=") === -1 || values[1].indexOf("nosmt=force") !== -1);
        const mitigations_match = values[1].match(/\bmitigations=(\S*)\b/);

        availableMitigations.cachedMitigations = {
            available: nosmt_available,
            nosmt_enabled: nosmt_enabled,
            mitigations_arg: mitigations_match ? mitigations_match[1] : undefined,
        };
        return availableMitigations.cachedMitigations;
    });
}

class CPUSecurityMitigationsDialog extends React.Component {
    constructor(props) {
        super(props);
        this.close = this.close.bind(this);
        this.saveAndReboot = this.saveAndReboot.bind(this);
        this.state = {
            nosmt: undefined,
            alert: undefined,
            mitigationsAvailable: false,
            rebooting: false,
        };
        availableMitigations().then(({ available, nosmt_enabled }) => {
            this.setState({ mitigationsAvailable: available, nosmt: nosmt_enabled });
        });
    }

    close() {
        if (this.props.onClose)
            this.props.onClose();
    }

    saveAndReboot() {
        let options = [];
        if (this.state.nosmt) {
            options = ['set', 'nosmt'];
        } else {
            // this may either be an argument of its own, or part of mitigations=
            const ma = availableMitigations.cachedMitigations.mitigations_arg;
            if (ma && ma.indexOf("nosmt") >= 0) {
                const new_args = ma.split(',').filter(opt => opt != 'nosmt');
                options = ['set', 'mitigations=' + new_args.join(',')];
            } else {
                options = ['remove', 'nosmt'];
            }
        }

        cockpit.script(kernelopt_sh, options, { superuser: "require", err: "message" })
                .then(() => {
                    cockpit.spawn(["shutdown", "--reboot", "now"], { superuser: "require", err: "message" })
                            .catch(error => this.setState({ rebooting: false, alert: error.message }));
                })
                .catch(error => this.setState({ rebooting: false, alert: error.message }));
        this.setState({ rebooting: true });
    }

    render() {
        const rows = [];
        if (this.state.nosmt !== undefined)
            rows.push((
                <ListView.Item key="nosmt" heading={ <span>{ _("Disable simultaneous multithreading") } (nosmt)<small>
                    <a href="https://access.redhat.com/security/vulnerabilities/L1TF" target="_blank" rel="noopener noreferrer">
                        <i className="fa fa-external-link" aria-hidden="true" /> { _("Read more...") }
                    </a>
                </small></span> }
                               actions={ <div id="nosmt-switch">
                                   <OnOffSwitch disabled={this.state.rebooting} onChange={ value => this.setState({ nosmt: value }) } state={ this.state.nosmt } />
                               </div> } />
            ));

        return (
            <Modal show={this.props.show} id="cpu-mitigations-dialog">
                <Modal.Header>
                    <Modal.Title>{ _("CPU Security Toggles") }</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    { _("Software-based workarounds help prevent CPU security issues. These mitigations have the side effect of reducing performance. Change these settings at your own risk.") }
                    <ListView>
                        { rows }
                    </ListView>
                    { this.state.alert !== undefined &&
                    <Alert variant="danger"
                        actionClose={<AlertActionCloseButton onClose={() => this.setState({ alert: undefined })} />}
                        title={this.state.alert} />}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant='danger' isDisabled={this.state.rebooting || this.state.nosmt === undefined} onClick={this.saveAndReboot}>
                        { _("Save and reboot") }
                    </Button>
                    <Button variant='link' className='btn-cancel' isDisabled={this.state.rebooting} onClick={this.close}>
                        { _("Cancel") }
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

class HardwareInfo extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            showCpuSecurityDialog: false,
            mitigationsAvailable: false,
        };
        availableMitigations().then(({ available }) => {
            this.setState({ mitigationsAvailable: available });
        });
    }

    render() {
        let pci = null;
        let memory = null;

        if (this.props.info.pci.length > 0) {
            const sortedPci = this.props.info.pci.concat();

            pci = (
                <ListingTable caption={ _("PCI") }
                    sortBy={{ index: 0, direction: SortByDirection.asc }}
                    columns={ [
                        { title: _("Class"), sortable: true },
                        { title: _("Model"), sortable: true },
                        { title: _("Vendor"), sortable: true },
                        { title: _("Slot"), sortable: true }
                    ] }
                    rows={ sortedPci.map(dev => ({
                        props: { key: dev.slot },
                        columns: [dev.cls, dev.model, dev.vendor, dev.slot]
                    }))} />
            );
        }

        if (this.props.info.memory.length > 0) {
            memory = (
                <ListingTable caption={ _("Memory") }
                    columns={ [_("ID"), _("Memory Technology"), _("Type"), _("Size"), _("State"), _("Rank"), _("Speed")]}
                    rows={ this.props.info.memory.map(dimm => ({
                        props: { key: dimm.locator },
                        columns: [dimm.locator, dimm.technology, dimm.type, dimm.size, dimm.state, dimm.rank, dimm.speed]
                    })) } />
            );
        }

        return (
            <div className="page-ct container-fluid">
                <CPUSecurityMitigationsDialog show={this.state.showCpuSecurityDialog} onClose={ () => this.setState({ showCpuSecurityDialog: false }) } />
                <ol className="breadcrumb">
                    <li><Button variant="link" isInline onClick={ () => cockpit.jump("/system", cockpit.transport.host) }>{ _("Overview") }</Button></li>
                    <li className="active">{ _("Hardware Information") }</li>
                </ol>

                <h2>{ _("System Information") }</h2>
                <SystemInfo info={this.props.info.system}
                            onSecurityClick={ this.state.mitigationsAvailable ? () => this.setState({ showCpuSecurityDialog: true }) : undefined } />

                <div id="pci-listing">
                    { pci }
                </div>
                <div id="memory-listing">
                    { memory }
                </div>
            </div>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);
    moment.locale(cockpit.language);
    detect().then(info => {
        console.debug("hardware info collection data:", JSON.stringify(info));
        ReactDOM.render(<HardwareInfo info={info} />, document.getElementById("hwinfo"));
    });
});
