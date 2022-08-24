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
    CodeBlockCode,
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
            storeDest: this.props.initialTarget.type, // dialog mode, depends on location
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
        const compressionPossible = !this.props.settings || this.props.settings.compression.allowed;
        let directory = "";
        if (this.props.settings && "path" in this.props.settings.targets[this.state.storeDest])
            directory = this.props.settings.targets[this.state.storeDest].path;

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
            let nfs = {};
            if (this.props.settings && "nfs" in this.props.settings.targets)
                nfs = this.props.settings.targets.nfs;
            const server = nfs.server || "";
            const exportpath = nfs.export || "";
            detailRows = (
                <>
                    <FormGroup fieldId="kdump-settings-nfs-server" label={_("Server")}>
                        <TextInput id="kdump-settings-nfs-server" key="server"
                                placeholder="penguin.example.com" value={server}
                                onChange={value => this.props.onChange("server", value)} />
                    </FormGroup>
                    <FormGroup fieldId="kdump-settings-nfs-export" label={_("Export")}>
                        <TextInput id="kdump-settings-nfs-export" key="export"
                                placeholder="/export/cores" value={exportpath}
                                onChange={value => this.props.onChange("export", value)} />
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
            let ssh = {};
            if (this.props.settings && "ssh" in this.props.settings.targets)
                ssh = this.props.settings.targets.ssh;
            const server = ssh.server || "";
            const sshkey = ssh.sshkey || "";
            detailRows = (
                <>
                    <FormGroup fieldId="kdump-settings-ssh-server" label={_("Server")}>
                        <TextInput id="kdump-settings-ssh-server" key="server"
                                   placeholder="user@server.com" value={server}
                                   onChange={value => this.props.onChange("server", value)} />
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
 * onSaveSettings   called with current dialog settings when the user clicks Save
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
        return settings && settings.compression.enabled;
    }

    changeSetting(key, value) {
        let settings = this.state.dialogSettings;

        // a few special cases, otherwise write to config target directly
        if (key == "compression") {
            settings.compression.enabled = value;
        } else if (key === "target") {
            /* target changed, restore settings and wipe all settings associated
             * with a target so no conflicting settings remain */
            settings = {};
            // TODO: do we need a deep copy here?
            Object.keys(this.props.kdumpStatus.config).forEach((key) => {
                settings[key] = { ...this.props.kdumpStatus.config[key] };
            });
            settings.targets = {};
            settings.targets[value] = { type: value };
        } else if (key !== undefined) {
            const type = Object.keys(settings.targets)[0];
            if (!value) {
                if (settings.targets[type][key])
                    delete settings.targets[type][key];
            } else {
                settings.targets[type][key] = value;
            }
        }
        this.setState({ dialogSettings: settings });
        this.state.dialogObj.updateDialogBody(settings);
        this.state.dialogObj.render();
    }

    handleSaveClick() {
        return this.props.onSaveSettings(this.state.dialogSettings)
                .catch(error => {
                    if (error.details) {
                        // avoid bad summary like "systemd job RestartUnit ["kdump.service","replace"] failed with result failed"
                        // if we have a more concrete journal
                        error.message = _("Unable to save settings");
                        error.details = <CodeBlockCode>{ error.details }</CodeBlockCode>;
                    } else {
                        // without a journal, show the error as-is
                        error = new Error(cockpit.format(_("Unable to save settings: $0"), String(error)));
                    }
                    return Promise.reject(error);
                });
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
            settings[key] = { ...self.props.kdumpStatus.config[key] };
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
                    clicked: this.handleSaveClick.bind(this),
                    caption: _("Save"),
                    style: 'primary',
                },
            ],
            dialog_done: this.dialogClosed.bind(this),
        };
        const dialogObj = show_modal_dialog(dialogProps, footerProps);
        dialogObj.updateDialogBody = updateDialogBody;
        this.setState({ dialogSettings: settings, dialogObj });
    }

    render() {
        let kdumpLocation = (
            <div className="dialog-wait-ct">
                <Spinner isSVG size="md" />
                <span>{ _("Loading...") }</span>
            </div>
        );
        let targetCanChange = false;
        if (this.props.kdumpStatus && this.props.kdumpStatus.target) {
            // if we have multiple targets defined, the config is invalid
            const target = this.props.kdumpStatus.target;
            if (target.multipleTargets) {
                kdumpLocation = _("invalid: multiple targets defined");
            } else {
                if (target.type == "local") {
                    if (target.path)
                        kdumpLocation = cockpit.format(_("locally in $0"), target.path);
                    else
                        kdumpLocation = cockpit.format(_("locally in $0"), "/var/crash");
                    targetCanChange = true;
                } else if (target.type == "ssh") {
                    kdumpLocation = _("Remote over SSH");
                    targetCanChange = true;
                } else if (target.type == "nfs") {
                    kdumpLocation = _("Remote over NFS");
                    targetCanChange = true;
                } else if (target.type == "raw") {
                    kdumpLocation = _("Raw to a device");
                } else if (target.type == "mount") {
                    /* mount targets outside of nfs are too complex for the
                     * current target dialog */
                    kdumpLocation = _("On a mounted device");
                } else if (target.type == "ftp") {
                    kdumpLocation = _("Remote over FTP");
                } else if (target.type == "sftp") {
                    kdumpLocation = _("Remote over SFTP");
                } else if (target.type == "cifs") {
                    kdumpLocation = _("Remote over CIFS/SMB");
                } else {
                    kdumpLocation = _("No configuration found");
                }
            }
        }
        // this.storeLocation(this.props.kdumpStatus.config);
        const settingsLink = targetCanChange
            ? <Button variant="link" isInline id="kdump-change-target" onClick={this.handleSettingsClick}>{ kdumpLocation }</Button>
            : <span id="kdump-target-info">{ kdumpLocation }</span>;
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

        let kdumpSwitch = (<Switch isChecked={!!serviceRunning}
                              onChange={this.props.onSetServiceState}
                              aria-label={_("kdump status")}
                              isDisabled={this.props.stateChanging || !this.props.kdumpCmdlineEnabled} />);
        if (!this.props.kdumpCmdlineEnabled) {
            kdumpSwitch = (
                <Tooltip content={_("crashkernel not configured in the kernel command line")} position={TooltipPosition.right}>
                    {kdumpSwitch}
                </Tooltip>);
        }
        return (
            <Page>
                <PageSection variant={PageSectionVariants.light}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <Title headingLevel="h2" size="3xl">
                            {_("Kernel crash dump")}
                        </Title>
                        {kdumpSwitch}
                    </Flex>
                </PageSection>
                <PageSection className="ct-pagesection-mobile">
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
