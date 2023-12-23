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

import cockpit from 'cockpit';
import { proxy as serviceProxy } from 'service';
import { ConfigFile } from './config-client.js';
import { ConfigFileSUSE } from './config-client-suse.js';

import crashKernelScript from './crashkernel.sh';
import testWritableScript from './testwritable.sh';
const _ = cockpit.gettext;

/*  initializes the kdump status
 *  emits "kdumpStatusChanged" when the status changes, along with a status object:
 *  {
 *      installed: true/false,
 *      enabled:   true/false,
 *      state:     current state,
 *      config:    settings from kdump.conf
 *      target:    dump target info, content depends on dump type
 *                 always contains the keys:
 *                     type          value in ["local", "nfs", "ssh", "raw", "mount", "unknown"]
 *                     multipleTargets true if the config file has more than one target defined, false otherwise
 *  }
 *
 */
export class KdumpClient {
    constructor() {
        this.state = {
            installed: undefined,
            enabled: undefined,
            state: undefined,
            config: undefined,
            target: undefined,
        };
        cockpit.event_target(this);

        // listen to service status changes
        this.kdumpService = serviceProxy("kdump");
        this.kdumpService.addEventListener('changed', () => {
            this.state.installed = this.kdumpService.exists;
            this.state.enabled = this.kdumpService.enabled;
            this.state.state = this.kdumpService.state;
            this.dispatchEvent("kdumpStatusChanged", this.state);
        });

        // watch the config file
        this.configClient = new ConfigFile("/etc/kdump.conf", true);
        this._watchConfigChanges();

        this.configClient.wait().then(() => {
            // if no configuration found, try SUSE version
            if (this.configClient.settings === null) {
                this.configClient.close();
                this.configClient = new ConfigFileSUSE("/etc/sysconfig/kdump", true);
                this._watchConfigChanges();
            }
        });
    }

    _watchConfigChanges() {
        // catch config changes
        this.configClient.addEventListener('kdumpConfigChanged', () => {
            this.state.config = this.configClient.settings;
            this.state.target = this.targetFromSettings(this.configClient.settings);
            this.dispatchEvent("kdumpStatusChanged", this.state);
        });
    }

    ensureOn() {
        // we consider the state to be "on" when it's enabled and running
        return Promise.all([
            this.kdumpService.enable(),
            this.kdumpService.start()
        ]);
    }

    ensureOff() {
        // we consider the state to be "off" when it's disabled and stopped
        return Promise.all([
            this.kdumpService.stop(),
            this.kdumpService.disable()
        ]);
    }

    crashKernel() {
        // crash the system kernel
        return cockpit.script(crashKernelScript, [], { superuser: "require" });
    }

    validateSettings(settings) {
        const target = this.targetFromSettings(settings);
        let path;
        if (target && target.path)
            path = target.path;
        // if path is invalid or we haven't set one, use default
        if (!path)
            path = "/var/crash";

        return new Promise((resolve, reject) => {
            if (target.type === "local") {
                // local path, try to see if we can write
                cockpit.script(testWritableScript, [path], { superuser: "try" })
                        .then(resolve)
                        .catch(() => reject(cockpit.format(_("Directory $0 isn't writable or doesn't exist."), path)));
                return;
            } else if (target.type === "nfs") {
                if (!target.server || !target.server.trim())
                    reject(_("nfs server is empty"));
                // IPv6 must be enclosed in square brackets
                if (target.server.trim().match(/^\[.*[^\]]$/))
                    reject(_("nfs server is not valid IPv6"));
                if (!target.export || !target.export.trim())
                    reject(_("nfs export is empty"));
            } else if (target.type === "ssh") {
                if (!target.server || !target.server.trim())
                    reject(_("ssh server is empty"));
                if (target.sshkey && !target.sshkey.match("/.+"))
                    reject(_("ssh key isn't a path"));
            }

            /* no-op if already rejected  */
            resolve();
        });
    }

    writeSettings(settings) {
        return this.configClient.write(settings)
                .then(() => {
                    // after we've written the new config, we have to restart the service to pick up changes or clean up after errors
                    if (this.kdumpService.enabled) {
                        return this.kdumpService.restart()
                                .catch(error => this.kdumpService.getRunJournal(["--output=cat", "--identifier=kdumpctl"])
                                        .then(journal => {
                                            error.details = journal;
                                            return Promise.reject(error);
                                        }, ex => {
                                            console.warn("Failed to get journal of kdump.service:", ex.toString());
                                            return Promise.reject(error);
                                        })
                                );
                    } else {
                        return true;
                    }
                });
    }

    exportConfig(settings) {
        return this.configClient.generateConfig(settings).trim();
    }

    targetFromSettings(settings) {
        const target = {
            type: "unknown",
            multipleTargets: false,
        };

        if (!settings || Object.keys(settings.targets).length === 0)
            return target;

        // copy first target
        cockpit.extend(target, Object.values(settings.targets)[0]);
        target.multipleTargets = Object.keys(settings.targets).length > 1;
        return target;
    }
}
