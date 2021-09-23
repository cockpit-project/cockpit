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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import cockpit from "cockpit";

import React from "react";
import {
    Button, Checkbox,
    Card, CardBody,
    Flex,
    Form, FormGroup, FormSection,
    FormSelect, FormSelectOption,
    Page, PageSection, PageSectionVariants,
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
    Spinner, Switch,
    TextInput, Title, Tooltip, TooltipPosition,
} from "@patternfly/react-core";
import { OutlinedQuestionCircleIcon } from "@patternfly/react-icons";

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

/* kdump: dump target dialog body
 * Expected props:
 *   - onChange           callback to signal when the data has changed (key, value)
 *   - settings           kdump settings
 *   - initialTarget      initial target, e.g. "local"
 *   - compressionEnabled whether compression is enabled for all targets
 *
 * Internally, the dialog has three modes, defined by target storage:
 *   - local
 *   - nfs
 *   - ssh
 *
 */

class KdumpTargetBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            storeDest: this.props.initialTarget.target, // dialog mode, depends on location
        };
        this.changeLocation = this.changeLocation.bind(this);
    }

    changeLocation(target) {
        // settings for the new target will be changed when the details are edited
        this.props.onChange("target", target);
        // depending on our chosen target, we should send the default values we show in the ui
        this.setState({ storeDest: target });
    }

    render() {
        let detailRows;
        // only allow compression if there is no core collector set or it's set to makedumpfile
        const compressionPossible = (
            !this.props.settings ||
            !("core_collector" in this.props.settings) ||
            (this.props.settings.core_collector.value.trim().indexOf("makedumpfile") === 0)
        );
        let directory = "";
        if (this.props.settings && "path" in this.props.settings)
            directory = this.props.settings.path.value;

        if (this.state.storeDest == "local") {
            detailRows = (
                <FormGroup fieldId="kdump-settings-local-directory" label={_("Directory")}>
                    <TextInput id="kdump-settings-local-directory" key="directory"
                               placeholder="/var/crash" value={directory}
                               data-stored={directory}
                               onChange={value => this.props.onChange("path", value)} />
                </FormGroup>
            );
        } else if (this.state.storeDest == "nfs") {
            let nfs = "";
            if (this.props.settings && "nfs" in this.props.settings)
                nfs = this.props.settings.nfs.value;
            detailRows = (
                <>
                    <FormGroup fieldId="kdump-settings-nfs-mount" label={_("Mount")}>
                        <TextInput id="kdump-settings-nfs-mount" key="mount"
                                placeholder="penguin.example.com:/export/cores" value={nfs}
                                onChange={value => this.props.onChange("nfs", value)} />
                    </FormGroup>
                    <FormGroup fieldId="kdump-settings-nfs-directory" label={_("Directory")}>
                        <TextInput id="kdump-settings-nfs-directory" key="directory"
                                placeholder="/var/crash" value={directory}
                                data-stored={directory}
                                onChange={value => this.props.onChange("path", value)} />
                    </FormGroup>
                </>
            );
        } else if (this.state.storeDest == "ssh") {
            let ssh = "";
            if (this.props.settings && "ssh" in this.props.settings)
                ssh = this.props.settings.ssh.value;
            let sshkey = "";
            if (this.props.settings && "sshkey" in this.props.settings)
                sshkey = this.props.settings.sshkey.value;
            detailRows = (
                <>
                    <FormGroup fieldId="kdump-settings-ssh-server" label={_("Server")}>
                        <TextInput id="kdump-settings-ssh-server" key="server"
                                   placeholder="user@server.com" value={ssh}
                                   onChange={value => this.props.onChange("ssh", value)} />
                    </FormGroup>

                    <FormGroup fieldId="kdump-settings-ssh-key" label={_("ssh key")}>
                        <TextInput id="kdump-settings-ssh-key" key="ssh"
                                   placeholder="/root/.ssh/kdump_id_rsa" value={sshkey}
                                   onChange={value => this.props.onChange("sshkey", value)} />
                    </FormGroup>

                    <FormGroup fieldId="kdump-settings-ssh-directory" label={_("Directory")}>
                        <TextInput id="kdump-settings-ssh-directory" key="directory"
                                   placeholder="/var/crash" value={directory}
                                   data-stored={directory}
                                   onChange={value => this.props.onChange("path", value)} />
                    </FormGroup>
                </>
            );
        }

        const targetDescription = {
            local: _("Local filesystem"),
            nfs: _("Remote over NFS"),
            ssh: _("Remote over SSH"),
        };
        // we don't support all known storage options currently
        const storageDest = this.state.storeDest;
        return (
            <Form isHorizontal>
                <FormGroup fieldId="kdump-settings-location" label={_("Location")}>
                    <FormSelect key="location" onChange={this.changeLocation}
                                id="kdump-settings-location" value={storageDest}>
                        <FormSelectOption value='local'
                                          label={targetDescription.local} />
                        <FormSelectOption value='ssh'
                                          label={targetDescription.ssh} />
                        <FormSelectOption value='nfs'
                                          label={targetDescription.nfs} />
                    </FormSelect>
                </FormGroup>

                {detailRows}

                <FormSection>
                    <FormGroup fieldId="kdump-settings-compression" label={_("Compression")} hasNoPaddingTop>
                        <Checkbox id="kdump-settings-compression"
                                  isChecked={this.props.compressionEnabled}
                                  onChange={value => this.props.onChange("compression", value)}
                                  isDisabled={!compressionPossible.toString()}
                                  label={_("Compress crash dumps to save space")} />
                    </FormGroup>
                </FormSection>
            </Form>
        );
    }
}

/* Show kdump status of the system and offer options to change or test the state
 * Expected properties:
 * kdumpActive       kdump service status
 * onSetServiceState called when the OnOff state is toggled (for kdumpActive), parameter: desired state
 * stateChanging     whether we're currently waiting for our last change to take effect
 * onApplySettings   called with current dialog settings when the user clicks apply
 * kdumpStatus       object as described in kdump-client
 * reservedMemory    memory reserved at boot time for kdump use
 * onCrashKernel     callback to crash the kernel via kdumpClient, expects a promise
 */
export class KdumpPage extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dialogSettings: undefined,
            dialogObj: undefined, // this is used if there's an open dialog
        };
        this.changeSetting = this.changeSetting.bind(this);
        this.handleTestSettingsClick = this.handleTestSettingsClick.bind(this);
        this.dialogClosed = this.dialogClosed.bind(this);
        this.handleSettingsClick = this.handleSettingsClick.bind(this);
    }

    compressionStatus(settings) {
        // compression is enabled if we have a core_collector command with the "-c" parameter
        return (
            settings &&
              ("core_collector" in settings) &&
              settings.core_collector.value &&
              (settings.core_collector.value.split(" ").indexOf("-c") != -1)
        );
    }

    changeSetting(key, value) {
        let settings = this.state.dialogSettings;

        // a few special cases, otherwise write to config directly
        if (key == "compression") {
            if (value) {
                // enable compression
                if ("core_collector" in settings)
                    settings.core_collector.value = settings.core_collector.value + " -c";
                else
                    settings.core_collector = { value: "makedumpfile -c" };
            } else {
                // disable compression
                if ("core_collector" in this.props.kdumpStatus.config) {
                    // just remove all "-c" parameters
                    settings.core_collector.value =
                        settings.core_collector.value
                                .split(" ")
                                .filter((e) => { return (e != "-c") })
                                .join(" ");
                } else {
                    // if we don't have anything on this in the original settings,
                    // we can get rid of the entry altogether
                    delete settings.core_collector;
                }
            }
        } else if (key === "target") {
            /* target changed, restore settings and wipe all settings associated
             * with a target so no conflicting settings remain */
            settings = {};
            Object.keys(this.props.kdumpStatus.config).forEach((key) => {
                settings[key] = cockpit.extend({}, this.props.kdumpStatus.config[key]);
            });
            Object.keys(this.props.kdumpStatus.target).forEach((key) => {
                if (settings[key])
                    delete settings[key];
            });
            if (value === "ssh")
                settings.ssh = { value: "" };
            else if (value === "nfs")
                settings.nfs = { value: "" };

            if ("core_collector" in settings &&
                settings.core_collector.value.includes("makedumpfile")) {
                /* ssh target needs a flattened vmcore for transport */
                if (value === "ssh" && !settings.core_collector.value.includes("-F"))
                    settings.core_collector.value += " -F";
                else if (settings.core_collector.value.includes("-F"))
                    settings.core_collector.value =
                        settings.core_collector.value
                                .split(" ")
                                .filter(e => e != "-F")
                                .join(" ");
            }
        } else if (key !== undefined) {
            if (!value) {
                if (settings[key])
                    delete settings[key];
            } else {
                if (key in settings)
                    settings[key].value = value;
                else
                    settings[key] = { value: value };
            }
        }
        this.setState({ dialogSettings: settings });
        this.state.dialogObj.updateDialogBody(settings);
        this.state.dialogObj.render();
    }

    handleApplyClick() {
        const dfd = cockpit.defer();
        this.props.onApplySettings(this.state.dialogSettings)
                .done(dfd.resolve)
                .fail(function(error) {
                    dfd.reject(cockpit.format(_("Unable to apply settings: $0"), String(error)));
                });
        return dfd.promise();
    }

    handleTestSettingsClick(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        // don't let the click "fall through" to the dialog that we are about to open
        e.preventDefault();
        // open a dialog to confirm crashing the kernel to test the settings - then do it
        const self = this;
        // open the confirmation dialog
        const dialogProps = {
            title: _("Test kdump settings"),
            body: (
                <span>{_("This will test kdump settings by crashing the kernel and thereby the system. Depending on the settings, the system may not automatically reboot and the process may take a while.")}</span>
            )
        };
        // also test modifying properties in subsequent render calls
        const footerProps = {
            actions: [
                {
                    clicked: self.props.onCrashKernel.bind(self),
                    caption: _("Crash system"),
                    style: 'danger',
                }
            ],
            dialog_done: self.dialogClosed,
        };
        const dialogObj = show_modal_dialog(dialogProps, footerProps);
        this.setState({ dialogObj: dialogObj });
    }

    handleServiceDetailsClick(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        cockpit.jump("/system/services#/kdump.service", cockpit.transport.host);
    }

    dialogClosed() {
        this.setState({ dialogSettings: undefined, dialogObj: undefined });
    }

    handleSettingsClick(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        e.preventDefault();
        const self = this;
        const settings = { };
        Object.keys(self.props.kdumpStatus.config).forEach((key) => {
            settings[key] = cockpit.extend({}, self.props.kdumpStatus.config[key]);
        });
        // open the settings dialog
        const dialogProps = {
            title: _("Crash dump location"),
            id: "kdump-settings-dialog"
        };
        const updateDialogBody = function(newSettings) {
            dialogProps.body = React.createElement(KdumpTargetBody, {
                settings: newSettings || settings,
                onChange: self.changeSetting,
                initialTarget: self.props.kdumpStatus.target,
                compressionEnabled: self.compressionStatus(newSettings || settings)
            });
        };
        updateDialogBody();
        // also test modifying properties in subsequent render calls
        const footerProps = {
            actions: [
                {
                    clicked: this.handleApplyClick.bind(this),
                    caption: _("Apply"),
                    style: 'primary',
                },
            ],
            dialog_done: this.dialogClosed.bind(this),
        };
        const dialogObj = show_modal_dialog(dialogProps, footerProps);
        dialogObj.updateDialogBody = updateDialogBody;
        this.setState({ dialogSettings: settings, dialogTarget: self.props.kdumpStatus.target, dialogObj: dialogObj });
    }

    render() {
        let kdumpLocation = (
            <div className="dialog-wait-ct">
                <Spinner isSVG size="md" />
                <span>{ _("Loading...") }</span>
            </div>
        );
        let targetCanChange = true;
        if (this.props.kdumpStatus && this.props.kdumpStatus.target) {
            // if we have multiple targets defined, the config is invalid
            const target = this.props.kdumpStatus.target;
            if (target.multipleTargets) {
                kdumpLocation = _("invalid: multiple targets defined");
            } else {
                if (target.target == "local") {
                    if (target.path)
                        kdumpLocation = cockpit.format(_("locally in $0"), target.path);
                    else
                        kdumpLocation = cockpit.format(_("locally in $0"), "/var/crash");
                } else if (target.target == "ssh") {
                    kdumpLocation = _("Remote over SSH");
                } else if (target.target == "nfs") {
                    kdumpLocation = _("Remote over NFS");
                } else if (target.target == "raw") {
                    kdumpLocation = _("Raw to a device");
                    targetCanChange = false;
                } else if (target.target == "mount") {
                    /* mount targets outside of nfs are too complex for the
                     * current target dialog */
                    kdumpLocation = _("On a mounted device");
                    targetCanChange = false;
                } else {
                    kdumpLocation = _("No configuration found");
                    targetCanChange = false;
                }
            }
        }
        // this.storeLocation(this.props.kdumpStatus.config);
        const settingsLink = (targetCanChange && !!this.props.kdumpStatus)
            ? <Button variant="link" isInline id="kdump-change-target" onClick={this.handleSettingsClick}>{ kdumpLocation }</Button>
            : <span>{ kdumpLocation }</span>;
        let reservedMemory;
        if (this.props.reservedMemory === undefined) {
            // still waiting for result
            reservedMemory = (
                <div className="dialog-wait-ct">
                    <Spinner isSVG size="md" />
                    <span>{ _("Reading...") }</span>
                </div>
            );
        } else if (this.props.reservedMemory == 0) {
            // nothing reserved, give hint
            reservedMemory = (
                <span>{_("None")} </span>
            );
        } else if (this.props.reservedMemory == "error") {
            // error while reading
        } else {
            // assume we have a proper value
            // TODO: hint at using debug_mem_level to identify actual memory required?
            reservedMemory = <span>{this.props.reservedMemory}</span>;
        }

        const serviceRunning = this.props.kdumpStatus &&
                             this.props.kdumpStatus.installed &&
                             this.props.kdumpStatus.state == "running";

        let kdumpServiceDetails;
        let serviceDescription;
        let serviceHint;
        if (this.props.kdumpStatus && this.props.kdumpStatus.installed) {
            if (this.props.kdumpStatus.state == "running")
                serviceDescription = <span>{_("Service is running")}</span>;
            else if (this.props.kdumpStatus.state == "stopped")
                serviceDescription = <span>{_("Service is stopped")}</span>;
            else if (this.props.kdumpStatus.state == "failed")
                serviceDescription = <span>{_("Service has an error")}</span>;
            else if (this.props.kdumpStatus.state == "starting")
                serviceDescription = <span>{_("Service is starting")}</span>;
            else if (this.props.kdumpStatus.state == "stopping")
                serviceDescription = <span>{_("Service is stopping")}</span>;
            if (this.props.reservedMemory == 0) {
                const tooltip = _("No memory reserved. Append a crashkernel option to the kernel command line (e.g. in /etc/default/grub) to reserve memory at boot time. Example: crashkernel=512M");
                serviceHint = (
                    <Tooltip id="tip-service" content={tooltip} position={TooltipPosition.bottom}>
                        <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                    </Tooltip>
                );
            }
            kdumpServiceDetails = (
                <>
                    {serviceDescription}
                    {serviceHint}
                    <Button variant="link" isInline className="service-link-ct-kdump" onClick={this.handleServiceDetailsClick}>{_("more details")}</Button>
                </>
            );
        } else if (this.props.kdumpStatus && !this.props.kdumpStatus.installed) {
            const tooltip = _("Kdump service not installed. Please ensure package kexec-tools is installed.");
            // FIXME: Accessibility needs to be improved: https://github.com/patternfly/patternfly-react/issues/5535
            kdumpServiceDetails = (
                <Tooltip id="tip-service" content={tooltip} position={TooltipPosition.bottom}>
                    <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                </Tooltip>
            );
        }
        let serviceWaiting;
        if (this.props.stateChanging)
            serviceWaiting = <Spinner isSVG size="md" />;

        let testButton;
        if (serviceRunning) {
            testButton = (
                <Button variant="secondary" onClick={this.handleTestSettingsClick}>
                    {_("Test configuration")}
                </Button>
            );
        } else {
            const tooltip = _("Test is only available while the kdump service is running.");
            testButton = (
                <Tooltip id="tip-test" content={tooltip}>
                    <Button variant="secondary" isDisabled>
                        {_("Test configuration")}
                    </Button>
                </Tooltip>
            );
        }
        const tooltip_info = _("This will test the kdump configuration by crashing the kernel.");
        return (
            <Page>
                <PageSection variant={PageSectionVariants.light}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <Title headingLevel="h2" size="3xl">
                            {_("Kernel crash dump")}
                        </Title>
                        <Switch isChecked={!!serviceRunning}
                                onChange={this.props.onSetServiceState}
                                aria-label={_("kdump status")}
                                isDisabled={this.props.stateChanging} />
                    </Flex>
                </PageSection>
                <PageSection>
                    <Card>
                        <CardBody>
                            <DescriptionList className="pf-m-horizontal-on-sm">
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Status")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                                            {serviceWaiting}
                                            {kdumpServiceDetails}
                                        </Flex>
                                    </DescriptionListDescription>
                                </DescriptionListGroup>

                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Reserved memory")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {reservedMemory}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>

                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Crash dump location")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {settingsLink}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>

                                <DescriptionListGroup>
                                    <DescriptionListTerm />
                                    <DescriptionListDescription>
                                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                                            {testButton}
                                            <Tooltip id="tip-test-info" content={tooltip_info}>
                                                <OutlinedQuestionCircleIcon className="popover-ct-kdump" />
                                            </Tooltip>
                                        </Flex>
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                            </DescriptionList>
                        </CardBody>
                    </Card>
                </PageSection>
            </Page>
        );
    }
}
