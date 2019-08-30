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

import cockpit from "cockpit";

import React from "react";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";
import { OverlayTrigger, Tooltip } from "patternfly-react";

import * as Select from "cockpit-components-select.jsx";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

import "form-layout.less";

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

    changeValue(key, e) {
        this.props.onChange(key, e.target.value);
    }

    handleCompressionClick(e) {
        this.props.onChange("compression", e.target.checked);
    }

    render() {
        var detailRows;
        // only allow compression if there is no core collector set or it's set to makedumpfile
        var compressionPossible = (
            !this.props.settings ||
            !("core_collector" in this.props.settings) ||
            (this.props.settings.core_collector.value.trim().indexOf("makedumpfile") === 0)
        );
        var directory = "";
        if (this.props.settings && "path" in this.props.settings)
            directory = this.props.settings.path.value;

        if (this.state.storeDest == "local") {
            detailRows = (
                <React.Fragment>
                    <label className="control-label" htmlFor="kdump-settings-local-directory">{_("Directory")}</label>
                    <input id="kdump-settings-local-directory" key="directory" className="form-control" type="text"
                           placeholder="/var/crash" value={directory}
                           data-stored={directory}
                           onChange={this.changeValue.bind(this, "path")} />
                </React.Fragment>
            );
        } else if (this.state.storeDest == "nfs") {
            var nfs = "";
            if (this.props.settings && "nfs" in this.props.settings)
                nfs = this.props.settings.nfs.value;
            detailRows = (
                <React.Fragment>
                    <label className="control-label" htmlFor="kdump-settings-nfs-mount">{_("Mount")}</label>
                    <label>
                        <input id="kdump-settings-nfs-mount" key="mount" className="form-control" type="text"
                               placeholder="penguin.example.com:/export/cores" value={nfs}
                               onChange={this.changeValue.bind(this, "nfs")} />
                    </label>
                </React.Fragment>
            );
        } else if (this.state.storeDest == "ssh") {
            var ssh = "";
            if (this.props.settings && "ssh" in this.props.settings)
                ssh = this.props.settings.ssh.value;
            var sshkey = "";
            if (this.props.settings && "sshkey" in this.props.settings)
                sshkey = this.props.settings.sshkey.value;
            detailRows = (
                <React.Fragment>
                    <label className="control-label" htmlFor="kdump-settings-ssh-server">{_("Server")}</label>
                    <input id="kdump-settings-ssh-server" key="server" className="form-control" type="text"
                           placeholder="user@server.com" value={ssh}
                           onChange={this.changeValue.bind(this, "ssh")} />

                    <label className="control-label" htmlFor="kdump-settings-ssh-key">{_("ssh key")}</label>
                    <input id="kdump-settings-ssh-key" key="ssh" className="form-control" type="text"
                           placeholder="/root/.ssh/kdump_id_rsa" value={sshkey}
                           onChange={this.changeValue.bind(this, "sshkey")} />

                    <label className="control-label" htmlFor="kdump-settings-local-directory">{_("Directory")}</label>
                    <input id="kdump-settings-local-directory" key="directory" className="form-control" type="text"
                           placeholder="/var/crash" value={directory}
                           data-stored={directory}
                           onChange={this.changeValue.bind(this, "path")} />
                </React.Fragment>
            );
        }

        var targetDescription = {
            local: _("Local Filesystem"),
            nfs: _("Remote over NFS"),
            ssh: _("Remote over SSH"),
        };
        // we don't support all known storage options currently
        var storageDest = this.state.storeDest;
        return (
            <div className="modal-body">
                <form className="ct-form">
                    <label className="control-label" htmlFor="kdump-settings-location">{_("Location")}</label>
                    <Select.Select key="location" onChange={this.changeLocation}
                                   id="kdump-settings-location" initial={storageDest}>
                        <Select.SelectEntry data='local' key='local'>{targetDescription.local}</Select.SelectEntry>
                        <Select.SelectEntry data='ssh' key='ssh'>{targetDescription.ssh}</Select.SelectEntry>
                        <Select.SelectEntry data='nfs' key='nfs'>{targetDescription.nfs}</Select.SelectEntry>
                    </Select.Select>

                    {detailRows}
                    <hr />

                    <label className="control-label">{_("Compression")}</label>
                    <label className="checkbox-inline" key="compression">
                        <input id="kdump-settings-compression" type="checkbox"
                               checked={this.props.compressionEnabled}
                               onChange={this.handleCompressionClick.bind(this)}
                               enabled={compressionPossible.toString()} />
                        {_("Compress crash dumps to save space")}
                    </label>
                </form>
            </div>
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
        var settings = this.state.dialogSettings;

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
        var dfd = cockpit.defer();
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
        var self = this;
        // open the confirmation dialog
        var dialogProps = {
            title: _("Test kdump settings"),
            body: (
                <div className="modal-body">
                    <span>{_("This will test kdump settings by crashing the kernel and thereby the system. Depending on the settings, the system may not automatically reboot and the process may take a while.")}</span>
                </div>
            )
        };
        // also test modifying properties in subsequent render calls
        var footerProps = {
            actions: [
                { clicked: self.props.onCrashKernel.bind(self),
                  caption: _("Crash system"),
                  style: 'danger',
                }
            ],
            dialog_done: self.dialogClosed,
        };
        var dialogObj = show_modal_dialog(dialogProps, footerProps);
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
        var self = this;
        var settings = { };
        Object.keys(self.props.kdumpStatus.config).forEach((key) => {
            settings[key] = cockpit.extend({}, self.props.kdumpStatus.config[key]);
        });
        // open the settings dialog
        var dialogProps = {
            title: _("Crash dump location"),
            id: "kdump-settings-dialog"
        };
        var updateDialogBody = function(newSettings) {
            dialogProps.body = React.createElement(KdumpTargetBody, {
                settings: newSettings || settings,
                onChange: self.changeSetting,
                initialTarget: self.props.kdumpStatus.target,
                compressionEnabled: self.compressionStatus(newSettings || settings)
            });
        };
        updateDialogBody();
        // also test modifying properties in subsequent render calls
        var footerProps = {
            actions: [
                { clicked: this.handleApplyClick.bind(this),
                  caption: _("Apply"),
                  style: 'primary',
                },
            ],
            dialog_done: this.dialogClosed.bind(this),
        };
        var dialogObj = show_modal_dialog(dialogProps, footerProps);
        dialogObj.updateDialogBody = updateDialogBody;
        this.setState({ dialogSettings: settings, dialogTarget: self.props.kdumpStatus.target, dialogObj: dialogObj });
    }

    render() {
        var kdumpLocation = (
            <div className="dialog-wait-ct">
                <div className="spinner spinner-sm" />
                <span>{ _("Loading...") }</span>
            </div>
        );
        var target;
        var targetCanChange = true;
        if (this.props.kdumpStatus && this.props.kdumpStatus.target) {
            // if we have multiple targets defined, the config is invalid
            target = this.props.kdumpStatus.target;
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
        var settingsLink;
        if (targetCanChange)
            settingsLink = <a href="#" tabIndex="0" onClick={this.handleSettingsClick}>{ kdumpLocation }</a>;
        else
            settingsLink = <span>{ kdumpLocation }</span>;
        var reservedMemory;
        if (this.props.reservedMemory === undefined) {
            // still waiting for result
            reservedMemory = (
                <div className="dialog-wait-ct">
                    <div className="spinner spinner-sm" />
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

        var serviceRunning = this.props.kdumpStatus &&
                             this.props.kdumpStatus.installed &&
                             this.props.kdumpStatus.state == "running";

        var kdumpServiceDetails;
        var serviceDescription;
        var serviceHint;
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
            else
                serviceDescription = <span>{_("More details")}</span>;
            if (this.props.reservedMemory == 0) {
                const tooltip = _("No memory reserved. Append a crashkernel option to the kernel command line (e.g. in /etc/default/grub) to reserve memory at boot time. Example: crashkernel=512M");
                serviceHint = (
                    <OverlayTrigger overlay={ <Tooltip id="tip-service">{tooltip}</Tooltip> } placement="bottom">
                        <span className="popover-ct-kdump fa fa-lg fa-info-circle" />
                    </OverlayTrigger>
                );
            }
            kdumpServiceDetails = <a className="popover-ct-kdump" href="#" tabIndex="0" onClick={this.handleServiceDetailsClick}>{serviceDescription}{serviceHint}</a>;
        } else if (this.props.kdumpStatus && !this.props.kdumpStatus.installed) {
            const tooltip = _("Kdump service not installed. Please ensure package kexec-tools is installed.");
            kdumpServiceDetails = (
                <OverlayTrigger overlay={ <Tooltip id="tip-service">{tooltip}</Tooltip> } placement="bottom">
                    <a tabIndex="0" className="popover-ct-kdump">
                        <span className="fa fa-lg fa-info-circle" />
                    </a>
                </OverlayTrigger>
            );
        }
        var serviceWaiting;
        if (this.props.stateChanging)
            serviceWaiting = <div className="spinner spinner-sm" />;

        var testButton;
        if (serviceRunning) {
            testButton = (
                <button className="btn btn-default" onClick={this.handleTestSettingsClick}>
                    {_("Test Configuration")}
                </button>
            );
        } else {
            const tooltip = _("Test is only available while the kdump service is running.");
            testButton = (
                <OverlayTrigger overlay={ <Tooltip id="tip-test">{tooltip}</Tooltip> } placement="top">
                    <button className="btn btn-default disabled">
                        {_("Test Configuration")}
                    </button>
                </OverlayTrigger>
            );
        }
        const tooltip_info = _("This will test the kdump configuration by crashing the kernel.");
        return (
            <div className="container-fluid">
                <form className="ct-form">
                    <label className="control-label">{_("kdump status")}</label>
                    <div role="group">
                        <OnOffSwitch state={!!serviceRunning} onChange={this.props.onSetServiceState}
                            disabled={this.props.stateChanging} />
                        {serviceWaiting}
                        {kdumpServiceDetails}
                    </div>

                    <label className="control-label">{_("Reserved memory")}</label>
                    {reservedMemory}

                    <label className="control-label">{_("Crash dump location")}</label>
                    {settingsLink}

                    <div role="group">
                        {testButton}
                        <a tabIndex="0" className="popover-ct-kdump">
                            <OverlayTrigger overlay={ <Tooltip id="tip-test-info">{tooltip_info}</Tooltip> } placement="top">
                                <span className="fa fa-lg fa-info-circle" />
                            </OverlayTrigger>
                        </a>
                    </div>
                </form>
            </div>
        );
    }
}
