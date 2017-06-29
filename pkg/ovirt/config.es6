/*jshint esversion: 6 */
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
export const INSTALL_SH = '/usr/share/cockpit/ovirt/install.sh';

export const OVIRT_CONF_FILE = '/etc/cockpit/machines-ovirt.config'; // relative URL for async download
export const VDSM_CONF_FILE = '/etc/vdsm/vdsm.conf';
export const PEM_FILE = '/etc/pki/vdsm/certs/cacert.pem';
export const OVIRT_DEFAULT_PORT = 443;

export const CONSOLE_TYPE_ID_MAP = {
    // TODO: replace this by API call /vms/[ID]/graphicsconsoles for more flexibility
    // but it's hardcoded in oVirt anyway ...
    'spice': '7370696365',
    'vnc': '766e63',
    'rdp': 'rdp_not_yet_supported',
};


export const REQUIRED_OVIRT_API_VERSION = {
    major: 4,
    minor: 0, // TODO: do not commit change, keep to 0!
};

const CONFIG = { // will be dynamically replaced by content of CONFIG_FILE_URL within OVIRT_PROVIDER.init()
    /**
     * Set to false to turn off the debug logging
     * See install.sh for production default.
     */
    debug: true,

    OVIRT_FQDN: 'replace.by.engine.fqdn',
    OVIRT_PORT: 443,

    CONSOLE_CLIENT_RESOURCES_URL: 'https://www.ovirt.org/documentation/admin-guide/virt/console-client-resources/',

    /**
     * oVirt polling is not called more than once per this time period.
     * Just single execution can be in progress at a time.
     * The delay window starts since previous polling processing is finished.
     * In ms.
     *
     * See install.sh for production default.
     */
    ovirt_polling_interval: 5000,

    cockpitPort: 9090,

    /**
     * If optional 'Virsh' property is provided here, it will be injected
     * to machines/config.es6 to adjust virsh connection parameters.
     *
     * See machines/config.es6
     * See ovirt/configFuncs.es6:readConfiguration()
     */
    Virsh: {
        connections: null,
    },

    /**
     * oVirt SSO token, filled in login.js
     */
    token: null,
};

export function getOvirtBaseUrl () {
    return `https://${CONFIG.OVIRT_FQDN}:${CONFIG.OVIRT_PORT}/ovirt-engine`;
}

export default CONFIG;

