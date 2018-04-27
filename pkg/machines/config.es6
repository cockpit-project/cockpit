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

const MACHINES_CONF_FILE = '/etc/cockpit/virtual-machines.config';

const defaultSystemConnection = {
    params: ['-c', 'qemu:///system']
};

/**
 * Application-wide constants
 */
const VMS_CONFIG = { // default values, will be replaced by content of MACHINES_CONF_FILE
    DefaultRefreshInterval: 10000, // in ms
    LeaveCreateVmDialogVisibleAfterSubmit: 3000, // in ms; to wait for an error
    DummyVmsWaitInterval: 10 * 60 * 1000, // show dummy vms for max 10 minutes; to let virt-install do work before getting vm from virsh
    WaitForRetryInstallVm: 3 * 1000, // wait for vm to recover in the ui after failed install to show the error
    Virsh: {
        connections: {
            'system': defaultSystemConnection,
            'session': {
                params: ['-c', 'qemu:///session']
            }
        }
    },

    debug: false, // Never commit with 'true'
};

// TODO: write test
export function doReadConfiguration() {
    console.debug('Attempt to read configuration from: ', MACHINES_CONF_FILE);
    // Configuration can be changed by admin after installation
    // and so is kept in separate file (out of manifest.json)
    return cockpit.file(MACHINES_CONF_FILE).read()
            .done(content => {
                if (content) {
                    const config = JSON.parse(content);
                    console.info('Configuration file parsed');
                    Object.assign(VMS_CONFIG, config);

                    fixConfig();
                }

                console.debug('Effective configuration: ', JSON.stringify(VMS_CONFIG));
            })
            .fail(() => {
                console.info('Configuration file is not readable, so using defaults: ', MACHINES_CONF_FILE);
            });
}

/**
 * Various "adjustments" to user's input.
 */
function fixConfig() {
    if (!VMS_CONFIG.Virsh || !VMS_CONFIG.Virsh.connections) {
        console.warn('Virsh.connections is missing in configuration file: ', MACHINES_CONF_FILE, ' . For default connections, avoid the "Virsh" section in config file entirely.');
        VMS_CONFIG.Virsh = {
            connections: {
                'system': defaultSystemConnection
            }
        };
    }
}

export default VMS_CONFIG;
