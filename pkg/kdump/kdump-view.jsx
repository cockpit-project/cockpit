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

import '../lib/patternfly/patternfly-5-cockpit.scss';
import cockpit from "cockpit";

import React, { useEffect, useState } from "react";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup, FormSection } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Text, TextContent, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";

import { useDialogs, DialogsContext } from "dialogs.jsx";
import { read_os_release } from "os-release.js";
import { fmt_to_fragments } from 'utils.jsx';
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { FormHelper } from "cockpit-components-form-helper";
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { PrivilegedButton } from "cockpit-components-privileged.jsx";
import { ModificationsExportDialog } from "cockpit-components-modifications.jsx";

const _ = cockpit.gettext;
const DEFAULT_KDUMP_PATH = "/var/crash";

const exportAnsibleTask = (settings, os_release) => {
    const target = Object.keys(settings.targets)[0];
    const targetSettings = settings.targets[target];
    const kdump_core_collector = settings.core_collector;

    let role_name = "linux-system-roles";
    if (os_release.NAME === "RHEL" || os_release.ID_LIKE?.includes('rhel')) {
        role_name = "rhel-system-roles";
    }

    let ansible = `
---
# Also available via https://galaxy.ansible.com/ui/standalone/roles/linux-system-roles/kdump/
- name: install ${role_name}
  package:
    name: ${role_name}
    state: present
  delegate_to: 127.0.0.1
  become: true
- name: run kdump system role
  include_role:
    name: ${role_name}.kdump
  vars:
    kdump_path: ${targetSettings.path || DEFAULT_KDUMP_PATH}
    kdump_core_collector: ${kdump_core_collector}`;

    if (target === "ssh") {
        // HACK: we should not have to specify kdump_ssh_user and kdump_ssh_user as it is in kdump_target.location
        // https://github.com/linux-system-roles/kdump/issues/184
        let ssh_user;
        let ssh_server;
        const parts = targetSettings.server.split('@');
        if (parts.length === 1) {
            ssh_user = "root";
            ssh_server = parts[0];
        } else if (parts.length === 2) {
            ssh_user = parts[0];
            ssh_server = parts[1];
        } else {
            throw new Error("ssh server contains two @ symbols");
        }
        ansible += `
    kdump_target:
      type: ssh
    kdump_sshkey: ${targetSettings.sshkey}
    kdump_ssh_server: ${ssh_server}
    kdump_ssh_user: ${ssh_user}`;
    } else if (target === "nfs") {
        ansible += `
    kdump_target:
      type: nfs
      location: ${targetSettings.server}:${targetSettings.export}
`;
    } else if (target !== "local") {
        // target is unsupported
        throw new Error("Unsupported kdump target"); // not-covered: assertion
    }

    return ansible;
};

function getLocation(target) {
    let path = target.path || DEFAULT_KDUMP_PATH;

    if (target.type === "ssh") {
        path = `${target.server}:${path}`;
    } else if (target.type == "nfs") {
        path = path[0] !== '/' ? '/' + path : path;
        path = `${target.server}:${target.export + path}`;
    }

    return path;
}

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
    const [directory, setDirectory] = useState(initialTarget.path || DEFAULT_KDUMP_PATH);
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
        setDirectory(DEFAULT_KDUMP_PATH);
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
                    path: directory === DEFAULT_KDUMP_PATH ? "" : directory,
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
                                  dialogErrorDetail={error.details} />}
            <Form id="kdump-settings-form" isHorizontal>
                <FormGroup fieldId="kdump-settings-location" label={_("Location")}>
                    <FormSelect key="location" onChange={(_, val) => changeStorageLocation(val)}
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
                                   placeholder={DEFAULT_KDUMP_PATH} value={directory}
                                   data-stored={directory}
                                   onChange={(_event, value) => setDirectory(value)}
                                   isRequired />
                    </FormGroup>
                }

                {storageLocation === "nfs" &&
                    <>
                        <FormGroup fieldId="kdump-settings-nfs-server" label={_("Server")} isRequired>
                            <TextInput id="kdump-settings-nfs-server" key="server"
                                    placeholder="penguin.example.com" value={server}
                                    onChange={(_event, value) => setServer(value)} isRequired />
                        </FormGroup>
                        <FormGroup fieldId="kdump-settings-nfs-export" label={_("Export")} isRequired>
                            <TextInput id="kdump-settings-nfs-export" key="export"
                                    placeholder="/export/cores" value={exportPath}
                                    onChange={(_event, value) => setExportPath(value)} isRequired />
                        </FormGroup>
                        <FormGroup fieldId="kdump-settings-nfs-directory" label={_("Directory")} isRequired>
                            <TextInput id="kdump-settings-nfs-directory" key="directory"
                                    placeholder={DEFAULT_KDUMP_PATH} value={directory}
                                    data-stored={directory}
                                    onChange={(_event, value) => setDirectory(value)}
                                    isRequired />
                        </FormGroup>
                    </>
                }

                {storageLocation === "ssh" &&
                    <>
                        <FormGroup fieldId="kdump-settings-ssh-server" label={_("Server")} isRequired>
                            <TextInput id="kdump-settings-ssh-server" key="server"
                                       placeholder="user@server.com" value={server}
                                       onChange={(_event, value) => setServer(value)} isRequired />
                        </FormGroup>

                        <FormGroup fieldId="kdump-settings-ssh-key" label={_("SSH key")}>
                            <TextInput id="kdump-settings-ssh-key" key="ssh"
                                       placeholder="/root/.ssh/kdump_id_rsa" value={sshkey}
                                       onChange={(_event, value) => changeSSHKey(value)}
                                       validated={validationErrors.sshkey ? "error" : "default"} />
                            <FormHelper helperTextInvalid={validationErrors.sshkey} />
                        </FormGroup>

                        <FormGroup fieldId="kdump-settings-ssh-directory" label={_("Directory")} isRequired>
                            <TextInput id="kdump-settings-ssh-directory" key="directory"
                                       placeholder={DEFAULT_KDUMP_PATH} value={directory}
                                       data-stored={directory}
                                       onChange={(_event, value) => setDirectory(value)}
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
        this.state = { os_release: null };

        this.handleTestSettingsClick = this.handleTestSettingsClick.bind(this);
        this.handleSettingsClick = this.handleSettingsClick.bind(this);
        this.handleAutomationClick = this.handleAutomationClick.bind(this);
        read_os_release().then(os_release => this.setState({ os_release }));
    }

    handleTestSettingsClick() {
        // if we have multiple targets defined, the config is invalid
        const target = this.props.kdumpStatus.target;
        let verifyMessage;
        if (!target.multipleTargets) {
            const path = getLocation(target);
            if (target.type === "local") {
                verifyMessage = fmt_to_fragments(
                    ' ' + _("Results of the crash will be stored in $0 as $1, if kdump is properly configured."),
                    <span className="pf-v5-u-font-family-monospace-vf">{path}</span>,
                    <span className="pf-v5-u-font-family-monospace-vf">vmcore</span>);
            } else if (target.type === "ssh" || target.type == "nfs") {
                verifyMessage = fmt_to_fragments(
                    ' ' + _("Results of the crash will be copied through $0 to $1 as $2, if kdump is properly configured."),
                    <span className="pf-v5-u-font-family-monospace-vf">{target.type === "ssh" ? "SSH" : "NFS"}</span>,
                    <span className="pf-v5-u-font-family-monospace-vf">{path}</span>,
                    <span className="pf-v5-u-font-family-monospace-vf">vmcore</span>);
            }
        }

        // open a dialog to confirm crashing the kernel to test the settings - then do it
        const dialogProps = {
            title: _("Test kdump settings"),
            body: (<TextContent>
                <Text component={TextVariants.p}>
                    {_("Test kdump settings by crashing the kernel. This may take a while and the system might not automatically reboot. Do not purposefully crash the system while any important task is running.")}
                </Text>
                {verifyMessage && <Text component={TextVariants.p}>
                    {verifyMessage}
                </Text>}
            </TextContent>),
            showClose: true,
            titleIconVariant: "warning",
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

    handleAutomationClick() {
        const Dialogs = this.context;
        let enableCrashKernel = '';
        let kdumpconf = this.props.exportConfig(this.props.kdumpStatus.config);
        kdumpconf = kdumpconf.replaceAll('$', '\\$');
        if (this.state.os_release.NAME?.includes('Fedora')) {
            enableCrashKernel = `
# A reboot will be required if crashkernel was not set before
kdumpctl reset-crashkernel`;
        }
        const shell = `
cat > /etc/kdump.conf << EOF
${kdumpconf}
EOF
systemctl enable --now kdump.service
${enableCrashKernel}
`;

        Dialogs.show(
            <ModificationsExportDialog
              ansible={exportAnsibleTask(this.props.kdumpStatus.config, this.state.os_release)}
              shell={shell}
              show
              onClose={Dialogs.close}
            />);
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
                const locationPath = getLocation(target);
                if (target.type == "local") {
                    kdumpLocation = cockpit.format(_("Local, $0"), locationPath);
                    targetCanChange = true;
                } else if (target.type == "ssh") {
                    kdumpLocation = cockpit.format(_("Remote over SSH, $0"), locationPath);
                    targetCanChange = true;
                } else if (target.type == "nfs") {
                    kdumpLocation = cockpit.format(_("Remote over NFS, $0"), locationPath);
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
        const settingsLink = targetCanChange && <Button variant="link" isInline id="kdump-change-target" onClick={this.handleSettingsClick}>{_("Edit")}</Button>;
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
            // nothing reserved
            reservedMemory = <span>{_("None")} </span>;
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

        let testButton;
        if (serviceRunning) {
            testButton = (
                <PrivilegedButton variant="secondary" isDanger
                                  excuse={ _("The user $0 is not permitted to test crash the kernel") }
                                  onClick={this.handleTestSettingsClick}>
                    { _("Test configuration") }
                </PrivilegedButton>
            );
        } else {
            const tooltip = _("Test is only available while the kdump service is running.");
            testButton = (
                <Tooltip id="tip-test" content={tooltip}>
                    <Button variant="secondary" isDanger isAriaDisabled>
                        {_("Test configuration")}
                    </Button>
                </Tooltip>
            );
        }

        let automationButton = null;
        if (this.props.kdumpStatus && this.props.kdumpStatus.config !== null && this.state.os_release !== null && targetCanChange) {
            automationButton = (
                <FlexItem align={{ md: 'alignRight' }}>
                    <Button id="kdump-automation-script" variant="secondary" onClick={this.handleAutomationClick}>
                        {_("View automation script")}
                    </Button>
                </FlexItem>
            );
        }

        let kdumpSwitch;
        let kdumpSwitchHelper;
        if (!this.props.kdumpCmdlineEnabled) {
            kdumpSwitchHelper = _("Currently not supported");
        } else {
            kdumpSwitch = (<Switch isChecked={!!serviceRunning}
                onChange={this.props.onSetServiceState}
                aria-label={_("kdump status")}
                isDisabled={this.props.stateChanging} />);
            kdumpSwitchHelper = serviceRunning ? _("Enabled") : _("Disabled");
        }

        let alertMessage;
        let alertDetail;
        if (!this.props.stateChanging && this.props.kdumpStatus && this.props.kdumpStatus.installed !== undefined) {
            if (this.props.kdumpStatus.installed) {
                if (this.props.reservedMemory == 0) {
                    alertMessage = fmt_to_fragments(
                        _("Kernel did not boot with the $0 setting"),
                        <span className="pf-v5-u-font-family-monospace-vf">crashkernel</span>
                    );
                    alertDetail = fmt_to_fragments(
                        _("Reserve memory at boot time by setting a '$0' option on the kernel command line. For example, append '$1' to $2  in $3 or use your distribution's kernel argument editor."),
                        <span className="pf-v5-u-font-family-monospace-vf">crashkernel</span>,
                        <span className="pf-v5-u-font-family-monospace-vf">crashkernel=512M</span>,
                        <span className="pf-v5-u-font-family-monospace-vf">GRUB_CMDLINE_LINUX</span>,
                        <span className="pf-v5-u-font-family-monospace-vf">/etc/default/grub</span>
                    );
                } else if (this.props.kdumpStatus.state == "failed") {
                    alertMessage = (
                        <>
                            {_("Service has an error")}
                            <Button variant="link" isInline className="pf-v5-u-ml-sm" onClick={this.handleServiceDetailsClick}>{_("more details")}</Button>
                        </>
                    );
                }
            } else {
                alertMessage = _("Kdump service is not installed.");
                alertDetail = fmt_to_fragments(
                    _("Install the $0 package."),
                    <span className="pf-v5-u-font-family-monospace-vf">kexec-tools</span>
                );
            }
        }
        return (
            <Page>
                <PageSection variant={PageSectionVariants.light}>
                    <Flex spaceItems={{ default: 'spaceItemsMd' }} alignItems={{ default: 'alignItemsCenter' }}>
                        <Title headingLevel="h2" size="3xl">
                            {_("Kernel crash dump")}
                        </Title>
                        {kdumpSwitch}
                        <HelperText>
                            <HelperTextItem variant="indeterminate">{kdumpSwitchHelper}</HelperTextItem>
                        </HelperText>
                        {automationButton}
                    </Flex>
                </PageSection>
                <PageSection>

                    {alertMessage &&
                        <Alert variant='danger'
                            className="pf-v5-u-mb-md"
                            isLiveRegion={this.props.isLiveRegion}
                            isInline
                            title={alertMessage}>
                            {alertDetail}
                        </Alert>
                    }
                    <Card>
                        <CardTitle>
                            <Title headingLevel="h4" size="xl">
                                {_("Kdump settings")}
                            </Title>
                        </CardTitle>
                        <CardBody>
                            <DescriptionList className="pf-m-horizontal-on-sm">
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Reserved memory")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        {reservedMemory}
                                    </DescriptionListDescription>
                                </DescriptionListGroup>

                                <DescriptionListGroup>
                                    <DescriptionListTerm>{_("Crash dump location")}</DescriptionListTerm>
                                    <DescriptionListDescription>
                                        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                            <span id="kdump-target-info">{ kdumpLocation }</span>
                                            {settingsLink}
                                        </Flex>
                                    </DescriptionListDescription>
                                </DescriptionListGroup>

                                <DescriptionListGroup>
                                    <DescriptionListTerm />
                                    <DescriptionListDescription>
                                        {testButton}
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
