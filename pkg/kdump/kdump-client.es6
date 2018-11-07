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
import {proxy as serviceProxy} from 'service';
import {ConfigFile} from './config-client.es6';

const crashKernelScript = require('raw!./crashkernel.sh');
const testWritableScript = require('raw!./testwritable.sh');
const _ = cockpit.gettext;

const deprecatedKeys = ["net", "options", "link_delay", "disk_timeout", "debug_mem_level", "blacklist"];
const knownKeys = [
    "raw", "nfs", "ssh", "sshkey", "path", "core_collector", "kdump_post", "kdump_pre", "extra_bins", "extra_modules",
    "default", "force_rebuild", "override_resettable", "dracut_args", "fence_kdump_args", "fence_kdump_nodes"
];

/*  initializes the kdump status
 *  emits "kdumpStatusChanged" when the status changes, along with a status object:
 *  {
 *      installed: true/false,
 *      enabled:   true/false,
 *      state:     current state,
 *      config:    settings from kdump.conf
 *      target:    dump target info, content depends on dump type
 *                 always contains the keys:
 *                     target          value in ["local", "nfs", "ssh", "raw", "mount", "unknown"]
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
        // catch config changes
        this.configClient.addEventListener('kdumpConfigChanged', () => {
            this.state.config = this.configClient.settings;
            this.state.target = this.targetFromSettings(this.configClient.settings);
            this.dispatchEvent("kdumpStatusChanged", this.state);
        });
    }

    ensureOn() {
        // we consider the state to be "on" when it's enabled and running
        return cockpit.all(
            this.kdumpService.enable(),
            this.kdumpService.start()
        );
    }

    ensureOff() {
        // we consider the state to be "off" when it's disabled and stopped
        return cockpit.all(
            this.kdumpService.stop(),
            this.kdumpService.disable()
        );
    }

    crashKernel() {
        // crash the system kernel
        return cockpit.script(crashKernelScript, [], { superuser: "require" });
    }

    validateSettings(settings) {
        var target = this.targetFromSettings(settings);
        var path;
        if (target && target.path)
            path = target.path;
        // if path is invalid or we haven't set one, use default
        if (!path)
            path = "/var/crash";

        var dfd = cockpit.defer();
        if (target.target === "local") {
            // local path, try to see if we can write
            cockpit.script(testWritableScript, [path], { superuser: "try" })
                    .done(dfd.resolve)
                    .fail(() => dfd.reject(cockpit.format(_("Directory $0 isn't writable or doesn't exist."), path)));
            return dfd.promise();
        } else if (target.target === "nfs") {
            if (!target.nfs.value.match("\\S+:/.+"))
                dfd.reject(_("nfs dump target isn't formated as server:path"));
        } else if (target.target === "ssh") {
            if (!target.ssh.value.trim())
                dfd.reject(_("ssh server is empty"));
            if (target.sshkey && !target.sshkey.value.match("/.+"))
                dfd.reject(_("ssh key isn't a path"));
        }

        /* no-op if already rejected  */
        dfd.resolve();
        return dfd.promise();
    }

    writeSettings(settings) {
        var dfd = cockpit.defer();
        this.configClient.write(settings)
                .done(() => {
                // after we've written the new config, we may have to restart the service
                    this.kdumpService.tryRestart()
                            .done(dfd.resolve)
                            .fail(dfd.reject);
                })
                .fail(dfd.reject);
        return dfd.promise();
    }

    targetFromSettings(settings) {
        // since local target is the default and can be used even without "path", we need to
        // check for the presence of all known targets
        // we have the additional difficulty that partitions don't have a good config key, since their
        // lines begin with the fs_type
        var target = {
            target: "unknown",
            multipleTargets: false,
        };

        if (!settings)
            return target;

        if ("nfs" in settings) {
            if (target.target != "unknown")
                target.multipleTargets = true;
            target.target = "nfs";
            target.nfs = settings.nfs;
            if ("path" in settings)
                target.path = settings.path;
        } else if ("ssh" in settings) {
            if (target.target != "unknown")
                target.multipleTargets = true;
            target.target = "ssh";
            target.ssh = settings.ssh;
            target.sshkey = settings.sshkey;
        } else if ("raw" in settings) {
            if (target.target != "unknown")
                target.multipleTargets = true;
            target.target = "raw";
            target.raw = settings.raw;
        } else {
            // probably local, but we might also have a mount
            // check all keys against known keys, the ones left over may be a mount target
            Object.keys(settings).forEach((key) => {
                // if the key is empty or known, we don't care about it here
                if (!key || key in knownKeys || key in deprecatedKeys)
                    return;
                // if we have a UUID, LABEL or /dev in the value, we can be pretty sure it's a mount option
                var value = JSON.stringify(settings[key]).toLowerCase();
                if (value.indexOf("uuid") > -1 || value.indexOf("label") > -1 || value.indexOf("/dev") > -1) {
                    if (target.target != "unknown")
                        target.multipleTargets = true;
                    target.target = "mount";
                    target.fsType = key;
                    target.partition = settings[key].value;
                } else {
                    // TODO: check for know filesystem types here
                }
            });
        }

        // if no target matches, then we use the local filesystem
        if (target.target == "unknown")
            target.target = "local";

        // "path" applies to all targets
        // default to "/var/crash for "
        if ("path" in settings)
            target.path = settings["path"].value;
        else if (["local", "ssh", "nfs", "mount"].indexOf(target.target) !== -1)
            target.path = "/var/crash";
        return target;
    }
}
