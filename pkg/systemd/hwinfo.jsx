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

import 'cockpit-dark-theme'; // once per page
import '../lib/patternfly/patternfly-4-cockpit.scss';
import 'polyfills'; // once per application

import cockpit from "cockpit";
import React from "react";
import { createRoot } from 'react-dom/client';

import * as timeformat from 'timeformat';

import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DataList, DataListAction, DataListCell, DataListItem, DataListItemCells, DataListItemRow } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { EmptyState } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { ExternalLinkAltIcon } from "@patternfly/react-icons";
import { SortByDirection } from "@patternfly/react-table";
import { ListingTable } from "cockpit-components-table.jsx";
import { WithDialogs, DialogsContext } from "dialogs.jsx";

import kernelopt_sh from "raw-loader!./kernelopt.sh";
import detect from "./hw-detect.js";

import { superuser } from "superuser";
import { PrivilegedButton } from "cockpit-components-privileged.jsx";

import "./hwinfo.scss";

const _ = cockpit.gettext;

class SystemInfo extends React.Component {
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
                        onClick={ onSecurityClick }>
                { _("Mitigations") }
            </PrivilegedButton>
        );

        const bios_date = Date.parse(info.bios_date); // NaN for undefined, null, or invalid dates

        return (
            <Flex id="hwinfo-system-info-list" direction={{ default: 'column', sm: 'row' }}>
                <FlexItem className="hwinfo-system-info-list-item" flex={{ default: 'flex_1' }}>
                    <DescriptionList className="pf-m-horizontal-on-md">
                        { info.type &&
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("Type") }</DescriptionListTerm>
                                <DescriptionListDescription>{ info.type }</DescriptionListDescription>
                            </DescriptionListGroup> }
                        { info.name &&
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("Name") }</DescriptionListTerm>
                                <DescriptionListDescription>{ info.name }</DescriptionListDescription>
                            </DescriptionListGroup> }
                        { info.version &&
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("Version") }</DescriptionListTerm>
                                <DescriptionListDescription>{ info.version }</DescriptionListDescription>
                            </DescriptionListGroup> }
                    </DescriptionList>
                </FlexItem>
                <FlexItem className="hwinfo-system-info-list-item" flex={{ default: 'flex_1' }}>
                    <DescriptionList className="pf-m-horizontal-on-md">
                        { info.bios_vendor && <>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("BIOS") }</DescriptionListTerm>
                                <DescriptionListDescription>{ info.bios_vendor }</DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("BIOS version") }</DescriptionListTerm>
                                <DescriptionListDescription>{ info.bios_version }</DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("BIOS date") }</DescriptionListTerm>
                                <DescriptionListDescription>{ bios_date ? timeformat.date(bios_date) : info.bios_date }</DescriptionListDescription>
                            </DescriptionListGroup>
                        </> }
                        { info.nproc !== undefined && <>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("CPU") }</DescriptionListTerm>
                                <DescriptionListDescription>{ (info.nproc > 1) ? `${info.nproc}x ${info.cpu_model}` : info.cpu_model }</DescriptionListDescription>
                            </DescriptionListGroup>
                            { onSecurityClick !== undefined && <DescriptionListGroup>
                                <DescriptionListTerm>{ _("CPU security") }</DescriptionListTerm>
                                <DescriptionListDescription>{ mitigations }</DescriptionListDescription>
                            </DescriptionListGroup>}
                        </> }
                    </DescriptionList>
                </FlexItem>
            </Flex>
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
            nosmt_enabled,
            mitigations_arg: mitigations_match ? mitigations_match[1] : undefined,
        };
        return availableMitigations.cachedMitigations;
    });
}

class CPUSecurityMitigationsDialog extends React.Component {
    static contextType = DialogsContext;

    constructor(props) {
        super(props);
        this.saveAndReboot = this.saveAndReboot.bind(this);
        this.state = {
            nosmt: undefined,
            alert: undefined,
            rebooting: false,
        };
        availableMitigations().then(({ available, nosmt_enabled }) => {
            this.setState({ nosmt: nosmt_enabled });
        });
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
        const Dialogs = this.context;
        const rows = [];
        if (this.state.nosmt !== undefined)
            rows.push(
                <DataListItem key="nosmt">
                    <DataListItemRow>
                        <DataListItemCells
                            dataListCells={[
                                <DataListCell key="primary content">
                                    <span>
                                        <div className='nosmt-heading'>{ _("Disable simultaneous multithreading") } (nosmt)</div>
                                        <small className='nosmt-read-more-link'>
                                            <a href="https://access.redhat.com/security/vulnerabilities/L1TF" target="_blank" rel="noopener noreferrer">
                                                <ExternalLinkAltIcon /> { _("Read more...") }
                                            </a>
                                        </small>
                                    </span>
                                </DataListCell>,
                            ]}
                        />
                        <DataListAction>
                            <div id="nosmt-switch">
                                <Switch isDisabled={this.state.rebooting}
                                        onChange={ value => this.setState({ nosmt: value }) }
                                        isChecked={ this.state.nosmt } />
                            </div>
                        </DataListAction>
                    </DataListItemRow>
                </DataListItem>
            );

        const footer = (
            <>
                <Button variant='danger' isDisabled={this.state.rebooting || this.state.nosmt === undefined} onClick={this.saveAndReboot}>
                    { _("Save and reboot") }
                </Button>
                <Button variant='link' className='btn-cancel' isDisabled={this.state.rebooting} onClick={Dialogs.close}>
                    { _("Cancel") }
                </Button>
            </>
        );

        return (
            <Modal isOpen id="cpu-mitigations-dialog"
                   position="top" variant="medium"
                   footer={footer}
                   onClose={Dialogs.close}
                   title={ _("CPU security toggles") }>
                <>
                    <Text className='cpu-mitigations-dialog-info' component={TextVariants.p}>
                        { _("Software-based workarounds help prevent CPU security issues. These mitigations have the side effect of reducing performance. Change these settings at your own risk.") }
                    </Text>
                    <DataList>
                        { rows }
                    </DataList>
                    { this.state.alert !== undefined &&
                    <Alert variant="danger"
                        actionClose={<AlertActionCloseButton onClose={() => this.setState({ alert: undefined })} />}
                        title={this.state.alert} />}
                </>
            </Modal>
        );
    }
}

class HardwareInfo extends React.Component {
    static contextType = DialogsContext;

    constructor(props) {
        super(props);
        this.state = {
            mitigationsAvailable: false,
        };
        availableMitigations().then(({ available }) => {
            this.setState({ mitigationsAvailable: available });
        });
    }

    render() {
        const Dialogs = this.context;
        let pci = null;
        let memory = null;

        if (this.props.info.pci.length > 0) {
            const sortedPci = this.props.info.pci.concat();

            pci = (
                <ListingTable aria-label={ _("PCI") }
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
                <ListingTable aria-label={ _("Memory") }
                    columns={ [_("ID"), _("Memory technology"), _("Type"), _("Size"), _("State"), _("Rank"), _("Speed")]}
                    rows={ this.props.info.memory.map(dimm => ({
                        props: { key: dimm.locator },
                        columns: [dimm.locator, dimm.technology, dimm.type, dimm.size, dimm.state, dimm.rank, dimm.speed]
                    })) } />
            );
        } else if (!superuser.allowed) {
            memory = (<EmptyState>
                {_("Viewing memory information requires administrative access.")}
            </EmptyState>);
        }

        return (
            <Page groupProps={{ sticky: 'top' }}
                  isBreadcrumbGrouped
                  breadcrumb={
                      <Breadcrumb>
                          <BreadcrumbItem onClick={ () => cockpit.jump("/system", cockpit.transport.host)} className="pf-c-breadcrumb__link">{ _("Overview") }</BreadcrumbItem>
                          <BreadcrumbItem isActive>{ _("Hardware information") }</BreadcrumbItem>
                      </Breadcrumb>}>
                <PageSection>
                    <Gallery hasGutter>
                        <Card>
                            <CardHeader>
                                <CardTitle>
                                    <Text component={TextVariants.h2}>{_("System information")}</Text>
                                </CardTitle>
                            </CardHeader>
                            <CardBody>
                                <SystemInfo info={this.props.info.system}
                                            onSecurityClick={ this.state.mitigationsAvailable
                                                ? () => Dialogs.show(<CPUSecurityMitigationsDialog />)
                                                : undefined } />
                            </CardBody>
                        </Card>
                        <Card id="pci-listing">
                            <CardHeader>
                                <CardTitle>
                                    <Text component={TextVariants.h2}>{_("PCI")}</Text>
                                </CardTitle>
                            </CardHeader>
                            <CardBody className="contains-list">
                                { pci }
                            </CardBody>
                        </Card>
                        <Card id="memory-listing">
                            <CardHeader>
                                <CardTitle>
                                    <Text component={TextVariants.h2}>{_("Memory")}</Text>
                                </CardTitle>
                            </CardHeader>
                            <CardBody className="contains-list">
                                { memory }
                            </CardBody>
                        </Card>
                    </Gallery>
                </PageSection>
            </Page>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);
    detect().then(info => {
        const root = createRoot(document.getElementById('hwinfo'));
        root.render(<WithDialogs><HardwareInfo info={info} /></WithDialogs>);
    });
});
