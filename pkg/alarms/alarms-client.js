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

import { ConfigFile } from './config-client.js';

import fileCreate from 'raw-loader!./createFile.sh';
import configChange from 'raw-loader!./enableAlarms.sh';
// const _ = cockpit.gettext;

/*  initializes the Alarms state
 *  emits "alarmsStatusChanged" when the config file changed by external means:
 *  {
 *      config:    settings from kdump.conf
 *  }
 *
 */
export class AlarmsClient {
    constructor() {
        this.state = {
            config: undefined,
        };
        cockpit.event_target(this);

        // watch the config file
        this.configClient = new ConfigFile("/etc/cockpit/cockpit-alarms.conf", true);
        this._watchConfigChanges();
    }

    _watchConfigChanges() {
        // catch config changes
        this.configClient.addEventListener('alarmsConfigFileChanged', () => {
            this.state.config = this.configClient.settings;
            // this.state.target = this.targetFromSettings(this.configClient.settings);
            this.dispatchEvent("alarmsConfigChanged", this.state);
        });
    }

    updateConfig(desiredState) {
        if (desiredState === false)
            cockpit.script(configChange, ["/etc/cockpit/cockpit-alarms.conf", "DISABLED"], { superuser: "require" });
        else
            cockpit.script(configChange, ["/etc/cockpit/cockpit-alarms.conf", "ENABLED"], { superuser: "require" });
    }

    writeSettings(settings) {
        cockpit.script(fileCreate, ["/etc/cockpit/cockpit-alarms.conf", "90", "4", "60", "5"], { superuser: "require" });
        return this.configClient.write(settings);
    }
}
