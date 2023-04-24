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

import React, { useEffect, useState } from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Card, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup, FormSection } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Tooltip, TooltipPosition } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { OutlinedQuestionCircleIcon } from "@patternfly/react-icons";

import { useDialogs, DialogsContext } from "dialogs.jsx";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { FormHelper } from "cockpit-components-form-helper";
import { ModalError } from 'cockpit-components-inline-notification.jsx';

const _ = cockpit.gettext;

const KdumpSettingsModal = ({ settings, initialTarget, handleSave }) => {
    const Dialogs = useDialogs();
    const compressionAllowed = settings.compression?.allowed;
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);
    const [isFormValid, setFormValid] = useState(true);
    const [validationErrors, setValidationErrors] = useState({});

    const [storageLocation, setStorageLocation] = useState(Object.keys(settings.targets)[0]);
    // common options
    const [compressionEnabled, setCompressionEnabled] = useState(settings.compression?.enabled);
    const [directory, setDirectory] = useState(initialTarget.path || "/var/crash");
    // nfs and ssh
    const [server, setServer] = useState(settings.targets.nfs?.server || settings.targets.ssh?.server);
    // nfs
    const [exportPath, setExportPath] = useState(settings.targets.nfs?.export || "");
    // ssh
    const [sshkey, setSSHKey] = useState(settings.targets.ssh?.sshkey || "");

    useEffect(() => {
        // We can't use a ref in a functional component
        const elem = document.querySelector("#kdump-settings-form");
        if (elem)
            setFormValid(elem.checkValidity());
    }, [storageLocation, directory, sshkey, server, exportPath]);

    const changeStorageLocation = target => {
        setError(null);
        setDirectory("/var/crash");
        setServer("");
        setStorageLocation(target);
    };

    const changeSSHKey = value => {
        if (value.trim() && !value.match("/.+")) {
            setValidationErrors({ sshkey: _("SSH key isn't a path") });
        } else {
            setValidationErrors({});
        }
        setSSHKey(value);
    };

    const saveSettings = () => {
        setError(null);
        setIsSaving(true);
        const newSettings = {
            compression: {
                allowed: compressionAllowed,
                enabled: compressionEnabled,
            },
            targets: {
                [storageLocation]: {
                    type: storageLocation,
                    // HACK: to not needlessly write a path /var/crash as this is the default,
                    // set an empty string.
                    path: directory === "/var/crash" ? "" : directory,
                }
            },
            _internal: {
                ...settings._internal
            }
        };

        if (storageLocation === "ssh") {
            newSettings.targets.ssh.server = server;
            newSettings.targets.ssh.sshkey = sshkey;
        }

        if (storageLocation === "nfs") {
            newSettings.targets.nfs.server = server;
            newSettings.targets.nfs.export = exportPath;
        }

        handleSave(newSettings)
                .then(Dialogs.close)
                .finally(() => setIsSaving(false))
                .catch(error => {
                    if (error.details) {
                        // avoid bad summary like "systemd job RestartUnit ["kdump.service","replace"] failed with result failed"
                        // if we have a more concrete journal and trim journal's `kdump: ` prefix.
                        error.message = _("Unable to save settings");
                        error.details = <CodeBlockCode>{ error.details.replaceAll(/\nkdump: /g, "\n") }</CodeBlockCode>;
                        setError(error);
                    } else {
                        // without a journal, show the error as-is
                        setError(new Error(cockpit.format(_("Unable to save settings: $0"), String(error))));
                    }
                });
    };

    return (
        <Modal position="top" variant="small" id="kdump-settings-dialog" isOpen
               title={_("Crash dump location")}
               onClose={Dialogs.close}
               footer={
                   <>
                       <Button variant="primary"
                               isLoading={isSaving}
                               isDisabled={isSaving || !isFormValid || Object.keys(validationErrors).length !== 0}
                               onClick={saveSettings}>
                           {_("Save changes")}
                       </Button>
                       <Button variant="link"
                               isDisabled={isSaving}
                               className="cancel"
                               onClick={Dialogs.close}>
                           {_("Cancel")}
                       </Button>
                   </>
               }>
            {error && <ModalError isExpandable
                                  dialogError={error.message || error}
                                  dialogErrorDetail={error?.details} />}
            <Form id="kdump-settings-form" isHorizontal>
                <FormGroup fieldId="kdump-settings-location" label={_("Location")}>
                    <FormSelect key="location" onChange={changeStorageLocation}
                                id="kdump-settings-location" value={storageLocation}>
                        <FormSelectOption value='local'
                                          label={_("Local filesystem")} />
                        <FormSelectOption value='ssh'
                                          label={_("Remote over SSH")} />
                        <FormSelectOption value='nfs'
                                          label={_("Remote over NFS")} />
                    </FormSelect>
                </FormGroup>

                {storageLocation === "local" &&
                    <FormGroup fieldId="kdump-settings-local-directory" label={_("Directory")} isRequired>
                        <TextInput id="kdump-settings-local-directory" key="directory"
                                   placeholder="/var/crash" value={directory}
                                   data-stored={directory}
                                   onChange={setDirectory}
                                   isRequired />
                    </FormGroup>
                }

                {storageLocation === "nfs" &&
                    <>
                        <FormGroup fieldId="kdump-settings-nfs-server" label={_("Server")} isRequired>
                            <TextInput id="kdump-settings-nfs-server" key="server"
                                    placeholder="penguin.example.com" value={server}
                                    onChange={setServer} isRequired />
                        </FormGroup>
                        <FormGroup fieldId="kdump-settings-nfs-export" label={_("Export")} isRequired>
                            <TextInput id="kdump-settings-nfs-export" key="export"
                                    placeholder="/export/cores" value={exportPath}
                                    onChange={setExportPath} isRequired />
                        </FormGroup>
                        <FormGroup fieldId="kdump-settings-nfs-directory" label={_("Directory")} isRequired>
                            <TextInput id="kdump-settings-nfs-directory" key="directory"
                                    placeholder="/var/crash" value={directory}
                                    data-stored={directory}
                                    onChange={setDirectory}
                                    isRequired />
                        </FormGroup>
                    </>
                }

                {storageLocation === "ssh" &&
                    <>
                        <FormGroup fieldId="kdump-settings-ssh-server" label={_("Server")} isRequired>
                            <TextInput id="kdump-settings-ssh-server" key="server"
                                       placeholder="user@server.com" value={server}
                                       onChange={setServer} isRequired />
                        </FormGroup>

                        <FormGroup fieldId="kdump-settings-ssh-key" label={_("SSH key")}>
                            <TextInput id="kdump-settings-ssh-key" key="ssh"
                                       placeholder="/root/.ssh/kdump_id_rsa" value={sshkey}
                                       onChange={changeSSHKey}
                                       validated={validationErrors.sshkey ? "error" : "default"} />
                            <FormHelper helperTextInvalid={validationErrors.sshkey} />
                        </FormGroup>

                        <FormGroup fieldId="kdump-settings-ssh-directory" label={_("Directory")} isRequired>
                            <TextInput id="kdump-settings-ssh-directory" key="directory"
                                       placeholder="/var/crash" value={directory}
                                       data-stored={directory}
                                       onChange={setDirectory}
                                       isRequired />
                        </FormGroup>
                    </>
                }

                <FormSection>
                    <FormGroup fieldId="kdump-settings-compression" label={_("Compression")} hasNoPaddingTop>
                        <Checkbox id="kdump-settings-compression"
                                  isChecked={compressionEnabled}
                                  onChange={(_, c) => setCompressionEnabled(c)}
                                  isDisabled={!compressionAllowed}
                                  label={_("Compress crash dumps to save space")} />
                    </FormGroup>
                </FormSection>
            </Form>
        </Modal>);
};

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
    static contextType = DialogsContext;

    constructor(props) {
        super(props);
        this.handleTestSettingsClick = this.handleTestSettingsClick.bind(this);
        this.handleSettingsClick = this.handleSettingsClick.bind(this);
    }

    handleTestSettingsClick() {
        // open a dialog to confirm crashing the kernel to test the settings - then do it
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
                    clicked: this.props.onCrashKernel.bind(this),
                    caption: _("Crash system"),
                    style: 'danger',
                }
            ],
        };
        show_modal_dialog(dialogProps, footerProps);
    }

    handleServiceDetailsClick() {
        cockpit.jump("/system/services#/kdump.service", cockpit.transport.host);
    }

    handleSettingsClick() {
        const Dialogs = this.context;
        Dialogs.show(<KdumpSettingsModal settings={this.props.kdumpStatus.config}
                                         initialTarget={this.props.kdumpStatus.target}
                                         handleSave={this.props.onSaveSettings} />);
    }

    render() {
        let kdumpLocation = (
            <div className="dialog-wait-ct">
                <Spinner size="md" />
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
                    <Spinner size="md" />
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
            serviceWaiting = <Spinner size="md" />;

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
                        <HelperText>
                            <HelperTextItem variant="indeterminate">{serviceRunning ? _("Enabled") : _("Disabled")}</HelperTextItem>
                        </HelperText>
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
