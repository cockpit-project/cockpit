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

var cockpit = require("cockpit");
var _ = cockpit.gettext;

var React = require("react");

var OnOffSwitch = require("cockpit-components-onoff.jsx").OnOffSwitch;
var Select = require("cockpit-components-select.jsx");
var dialogPattern = require("cockpit-components-dialog.jsx");
var Tooltip = require("cockpit-components-tooltip.jsx").Tooltip;

/* kdump: dump target dialog body
 * Expected props:
 *   - onChange           callback to signal when the data has changed (key, value)
 *   - settings           kdump settings
 *   - initialTarget      initial target, e.g. "local"
 *   - compressionEnabled whether compression is enabled for all targets
 *
 * Internally, the dialog has four modes, defined by target storage:
 *   - local
 *   - nfs
 *   - ssh
 *   - other This is used if the config file has no known target explicitly set
 *
 * nfs and ssh are disabled for now
 */

var KdumpTargetBody = React.createClass({
    getInitialState: function() {
        return {
            storeDest: this.props.initialTarget.target,  // dialog mode, depends on location
        };
    },
    changeLocation: function(target) {
        // if previous dest wasn't "other", remove that
        // settings for the new target will be changed when the details are edited
        if (this.state.storeDest != "other")
            this.props.onChange(this.state.storeDest.target, undefined);
        // depending on our chosen target, we should send the default values we show in the ui
        this.setState( { storeDest: target } );
    },
    changeValue: function(key, e) {
        if (this.props.onChange) {
            if (e && e.target && e.target.value)
                this.props.onChange(key, e.target.value);
        }
    },
    handleCompressionClick: function(e) {
        this.props.onChange("compression", e.target.checked);
    },
    render: function() {
        var detailRows;
        // only allow compression if there is no core collector set or it's set to makedumpfile
        var compressionPossible = (
            !this.props.settings ||
            !("core_collector" in this.props.settings) ||
            (this.props.settings["core_collector"].value.trim().indexOf("makedumpfile") === 0)
        );
        if (this.state.storeDest == "local") {
            var directory;
            if (this.props.settings && "path" in this.props.settings)
                directory = this.props.settings["path"].value;
            detailRows = (
                <tr>
                    <td className="top">
                        <label className="control-label">
                            {_("Directory")}
                        </label>
                    </td>
                    <td>
                        <input id="kdump-settings-local-directory" className="form-control" type="text"
                               placeholder="/var/crash" value={directory}
                               data-stored={directory}
                               onChange={this.changeValue.bind(this, "path")}/>
                    </td>
                </tr>
            );
        } else if (this.state.storeDest == "nfs") {
            var nfs;
            if (this.props.settings && "nfs" in this.props.settings)
                nfs = this.props.settings["nfs"].value;
            detailRows = (
                <tr>
                    <td className="top">
                        <label className="control-label">
                            {_("Mount")}
                        </label>
                    </td>
                    <td>
                        <label>
                            <input id="kdump-settings-nfs-mount" className="form-control" type="text"
                                   placeholder="penguin.example.com:/export/cores" value={nfs}
                                   onChange={this.changeValue.bind(this, "nfs")}/>
                        </label>
                    </td>
                </tr>
            );
        } else if (this.state.storeDest == "ssh") {
            var ssh;
            if (this.props.settings && "ssh" in this.props.settings)
                ssh = this.props.settings["ssh"].value;
            var sshkey;
            if (this.props.settings && "sshkey" in this.props.settings)
                sshkey = this.props.settings["sshkey"].value;
            detailRows = [
                (<tr>
                    <td className="top">
                        <label className="control-label">
                            {_("Server")}
                        </label>
                    </td>
                    <td>
                        <label>
                            <input id="kdump-settings-ssh-server" className="form-control" type="text"
                                   placeholder="user@server.com" value={ssh}
                                   onChange={this.changeValue.bind(this, "ssh")}/>
                        </label>
                    </td>
                </tr>),
                (<tr>
                    <td className="top">
                        <label className="control-label">
                            {_("ssh key")}
                        </label>
                    </td>
                    <td>
                        <label>
                            <input id="kdump-settings-ssh-server" className="form-control" type="text"
                                   placeholder="/root/.ssh/kdump_id_rsa" value={sshkey}
                                   onChange={this.changeValue.bind(this, "sshkey")}/>
                        </label>
                    </td>
                </tr>),
            ];
        }
        /* some options are disabled for now
               <Select.SelectEntry data='nfs' key='nfs'>{targetDescription.nfs}</Select.SelectEntry>
               <Select.SelectEntry data='ssh' key='ssh'>{targetDescription.ssh}</Select.SelectEntry>
         */
        var targetDescription = {
            local: _("Local Filesystem"),
            nfs: _("Remote over NFS"),
            ssh: _("Remote over SSH"),
            other: _("Use the setting in /etc/kdump.conf"),
        };
        // we don't support all known storage options currently
        var storageDest = this.state.storeDest;
        if (["local", "other"].indexOf(this.state.storeDest) === -1)
            storageDest = "other";
        return (
            <div className="modal-body">
                <table className="form-table-ct">
                    <tr>
                        <td className="top">
                            <label className="control-label" for="kdump-settings-location">
                                {_("Location")}
                            </label>
                        </td>
                        <td>
                            <Select.Select key='location' onChange={this.changeLocation}
                                           id="kdump-settings-location" initial={storageDest}>
                                <Select.SelectEntry data='local' key='local'>{targetDescription.local}</Select.SelectEntry>
                                <Select.SelectEntry data='other' key='other'>{targetDescription.other}</Select.SelectEntry>
                            </Select.Select>
                        </td>
                    </tr>
                    {detailRows}
                    <tr>
                        <td className="top">
                            <label className="control-label">
                                {_("Compression")}
                            </label>
                        </td>
                        <td>
                            <div className="checkbox">
                                <label>
                                    <input id="kdump-settings-compression" type="checkbox" checked={this.props.compressionEnabled}
                                           onChange={this.handleCompressionClick.bind(this)}
                                           enabled={compressionPossible}/>
                                    {_("Compress crash dumps to save space")}
                                </label>
                            </div>
                        </td>
                    </tr>
                </table>
            </div>
        );
    }
});

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
var KdumpPage = React.createClass({
    getInitialState: function() {
        return {
            dialogSettings: undefined,
            dialogObj: undefined,  // this is used if there's an open dialog
        };
    },
    compressionStatus: function(settings) {
        // compression is enabled if we have a core_collector command with the "-c" parameter
        return (
              settings &&
              ("core_collector" in settings) &&
              settings["core_collector"].value &&
              (settings["core_collector"].value.split(" ").indexOf("-c") != -1)
        );
    },
    changeSetting: function(key, value) {
        var settings = this.state.dialogSettings;

        // is compression enabled in the current config?
        var compressionEnabled = this.compressionStatus(this.props.kdumpStatus.config);

        // a few special cases, otherwise write to config directly
        if (key == "compression") {
            if (value && !compressionEnabled) {
                // enable compression
                if ("core_collector" in settings)
                    settings["core_collector"].value = settings["core_collector"].value + " -c";
                else
                    settings["core_collector"] = { value: "makedumpfile -c" };
            } else if (!value && compressionEnabled) {
                // disable compression
                if ("core_collector" in this.props.kdumpStatus.config) {
                    // just remove all "-c" parameters
                    settings["core_collector"].value =
                        settings["core_collector"].value
                        .split(" ")
                        .filter((e) => {return (e != "-c");})
                        .join(" ");
                } else {
                    // if we don't have anything on this in the original settings,
                    // we can get rid of the entry altogether
                    delete settings["core_collector"];
                }
            } else {
                console.log("not changing compression setting")
                return;
            }
        } else if (key !== undefined) {
            if (value === undefined) {
                if (settings[key])
                    delete settings[key];
            } else {
                if (key in settings)
                    settings[key].value = value;
                else
                    settings[key] = { value: value };
            }
        }
        this.setState( { dialogSettings: settings } );
        this.state.dialogObj.updateDialogBody();
        this.state.dialogObj.render();
    },
    handleApplyClick: function() {
        // TODO test settings (e.g. path writable, nfs mountable, ssh key works)
        var dfd = cockpit.defer();
        this.props.onApplySettings(this.state.dialogSettings)
            .done(dfd.resolve)
            .fail(function(error) {
                dfd.reject(cockpit.format(_("Unable to apply settings: $0"), String(error)));
            });
        return dfd.promise();
    },
    handleTestSettingsClick: function(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
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
            'actions': [
                  { 'clicked': self.props.onCrashKernel.bind(self),
                    'caption': _("Crash system"),
                    'style': 'danger',
                  }
              ],
            'dialog_done': self.dialogClosed,
        };
        var dialogObj = dialogPattern.show_modal_dialog(dialogProps, footerProps);
        this.setState( { dialogObj: dialogObj } );
    },
    handleServiceDetailsClick: function(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        cockpit.jump("/system/services#/kdump.service")
    },
    dialogClosed: function() {
        this.setState( { dialogSettings: undefined, dialogObj: undefined } );
    },
    handleSettingsClick: function(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        var self = this;
        var settings = { };
        Object.keys(self.props.kdumpStatus.config).forEach( (key) => {
            settings[key] = cockpit.extend({}, self.props.kdumpStatus.config[key]);
        });
        // open the settings dialog
        var dialogProps = {
            title: _("Crash dump location"),
            id: "kdump-settings-dialog"
        };
        var updateDialogBody = function() {
            dialogProps.body = React.createElement(KdumpTargetBody, {
                settings: settings,
                onChange: self.changeSetting,
                initialTarget: self.props.kdumpStatus.target,
                compressionEnabled: self.compressionStatus(settings)
            });
        }
        updateDialogBody();
        // also test modifying properties in subsequent render calls
        var footerProps = {
            'actions': [
                  { 'clicked': this.handleApplyClick.bind(this),
                    'caption': _("Apply"),
                    'style': 'primary',
                  },
              ],
            'dialog_done': this.dialogClosed.bind(this),
        };
        var dialogObj = dialogPattern.show_modal_dialog(dialogProps, footerProps);
        dialogObj.updateDialogBody = updateDialogBody;
        this.setState( { dialogSettings: settings, dialogObj: dialogObj } );
    },
    render: function() {
        var kdumpLocation = (
            <div className="dialog-wait-ct">
                <div className="spinner spinner-sm"></div>
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
                } else if (target.target == "mount") {
                    kdumpLocation = _("On a mounted device");
                } else {
                    kdumpLocation = _("No configuration found")
                    targetCanChange = false;
                }
            }
        }
        // this.storeLocation(this.props.kdumpStatus.config);
        var settingsLink;
        if (targetCanChange)
            settingsLink = <a href="#" onClick={this.handleSettingsClick}>{ kdumpLocation }</a>;
        else
            settingsLink = <span>{ kdumpLocation }</span>;
        var reservedMemory;
        if (this.props.reservedMemory === undefined) {
            // still waiting for result
            reservedMemory = (
                <div className="dialog-wait-ct">
                    <div className="spinner spinner-sm"></div>
                    <span>{ _("Reading...") }</span>
                </div>
            );
        } else if (this.props.reservedMemory == 0) {
            // nothing reserved, give hint
            reservedMemory = [
                <span>{_("None")} </span>
            ];
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
                serviceHint = (
                    <a className="popover-ct-kdump">
                        <Tooltip tip={_("No memory reserved. Append a crashkernel option to the kernel command line (e.g. in /etc/default/grub) to reserve memory at boot time. Example: crashkernel=512M")} pos="top">
                            <span className="fa fa-lg fa-info-circle"></span>
                        </Tooltip>
                    </a>
                );
            }
            kdumpServiceDetails = <a href="#" onClick={this.handleServiceDetailsClick}>{serviceDescription}{serviceHint}</a>;
        } else if (this.props.kdumpStatus && !this.props.kdumpStatus.installed) {
            kdumpServiceDetails = (
                <a className="popover-ct-kdump">
                    <Tooltip tip={_("Kdump service not installed. Please ensure package kexec-tools is installed.")} pos="top">
                        <span className="fa fa-lg fa-info-circle"></span>
                    </Tooltip>
                </a>
            );
        }
        var serviceWaiting;
        if (this.props.stateChanging)
            serviceWaiting = <div className="spinner spinner-sm"></div>;

        var testButton;
        if (serviceRunning) {
            testButton = (
                <button className="btn btn-default" onClick={this.handleTestSettingsClick}>
                    {_("Test Configuration")}
                </button>
            );
        } else {
            testButton = (
                <Tooltip tip={_("Test is only available while the kdump service is running.")} pos="top">
                    <button className="btn btn-default disabled">
                        {_("Test Configuration")}
                    </button>
                </Tooltip>
            )
        }
        return (
            <div className="container-fluid">
                <table className="form-table-ct">
                        <tr>
                            <td><label className="control-label">{_("kdump status")}</label></td>
                            <td colspan="2">
                                <div>
                                    <OnOffSwitch state={serviceRunning} onChange={this.props.onSetServiceState}
                                                 enabled={!this.props.stateChanging}/>
                                    {serviceWaiting}
                                    {kdumpServiceDetails}
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td><label className="control-label">{_("Reserved memory")}</label></td>
                            <td colspan="2">
                                {reservedMemory}
                            </td>
                        </tr>
                        <tr>
                            <td><label className="control-label">{_("Crash dump location")}</label></td>
                            <td colspan="2">{settingsLink}</td>
                        </tr>
                        <tr>
                            <td></td>
                            <td>
                                {testButton}
                                <a className="popover-ct-kdump">
                                        <Tooltip tip={_("This will test the kdump configuration by crashing the kernel.")} pos="top">
                                            <span className="fa fa-lg fa-info-circle"></span>
                                        </Tooltip>
                                </a>
                            </td>
                        </tr>
                </table>
            </div>
        );
    }
});

module.exports = {
    page: KdumpPage,
};
