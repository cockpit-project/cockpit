/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
import React from 'react';

import { INSTALL_SH, OVIRT_DEFAULT_PORT } from '../config.es6';
import { httpGet } from '../ovirtApiAccess.es6';
import { logError } from '../../machines/helpers.es6';
import { isNumeric } from '../helpers.es6';

import { show_modal_dialog } from 'cockpit-components-dialog.jsx';

import './InstallationDialog.css';

const _ = cockpit.gettext;

const INSTALL_SH_ERRORS = {
    '1': _("oVirt Provider installation script failed due to missing arguments."),
    '3': _("oVirt Provider installation script failed: Can't write to /etc/cockpit/machines-ovirt.config, try as root."),
};

const InstallationDialogBody = ({ values, onChange }) => {
    return (
        <div className='modal-body'>
            <table className='form-table-ct'>
                <tbody>
                    <tr>
                        <td className='top'>
                            <label className='control-label' htmlFor='ovirt-provider-install-dialog-engine-fqdn'>
                                {_("FQDN")}
                            </label>
                        </td>
                        <td>
                            <input id='ovirt-provider-install-dialog-engine-fqdn'
                                   className='form-control'
                                   type='text'
                                   placeholder='engine.mydomain.com'
                                   onChange={(event) => {
                                       values.oVirtUrl = event.target.value;
                                       onChange();
                                   }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td className='top'>
                            <label className='control-label' htmlFor='ovirt-provider-install-dialog-engine-port'>
                                {_("Port")}
                            </label>
                        </td>
                        <td>
                            <input id='ovirt-provider-install-dialog-engine-fqdn'
                                   className='form-control'
                                   type='text'
                                   placeholder={OVIRT_DEFAULT_PORT}
                                   onChange={(event) => {
                                       values.oVirtPort = isNumeric(event.target.value) ? event.target.value : values.oVirtPort;
                                       onChange();
                                   }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td colSpan='2'>
                            <p>
                                {_("Please provide fully qualified domain name and port of the oVirt engine.")}
                            </p>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};

function installationDialog({ onCancel }) {
    // TODO: check for root user (permission to write to configuration file)

    const values = {
        oVirtUrl: null,
        oVirtPort: OVIRT_DEFAULT_PORT,
    };

    const dlg = show_modal_dialog(
        { title: _("Connect to oVirt Engine"),
          body: <InstallationDialogBody values={values} onChange={() => dlg.render()} />
        },
        {
            actions: [
                {
                    caption: _("Register oVirt"),
                    style: 'primary',
                    clicked: () => {
                        return configureOvirtUrl(values.oVirtUrl, values.oVirtPort);
                    }
                }],
            "cancel_clicked": () => onCancel && onCancel()
        });
}

/**
 * Run cockpit/ovirt/install.sh script to configure
 *
 * @param oVirtUrl
 * @returns {boolean}
 */
function configureOvirtUrl(oVirtFqdn, oVirtPort) {
    console.info('configureOvirtUrl: ', oVirtFqdn, oVirtPort);

    const dfd = cockpit.defer();
    dfd.notify(_("Registering oVirt to Cockpit"));

    const failHandler = (ex, data) => {
        if (ex && ex.status === 302) { // Found, redirects would follow
            doRegisterOvirt(oVirtFqdn, oVirtPort, dfd);
            return;
        }

        console.info('Unable to access oVirt engine: ', JSON.stringify(ex), JSON.stringify(data));
        dfd.reject(_("Please provide valid oVirt engine fully qualified domain name (FQDN) and port (443 by default)"));
    };

    httpGet( // make a dummy request to verify just the FQDN:PORT
        oVirtFqdn,
        oVirtPort,
        '/ovirt-engine' // contextRoot - just the main page, the API would require authorization
    ).then(() => {
        doRegisterOvirt(oVirtFqdn, oVirtPort, dfd);
    })
            .fail(failHandler);

    return dfd.promise;
}

function doRegisterOvirt(oVirtFqdn, oVirtPort, dfd) {
    console.info('configureOvirtUrl() - oVirt engine connection can be established', oVirtFqdn, oVirtPort);
    // CONNECTION URI is not passed as an argument here, so oVirt default will be farther used - see configFuncs.es6:readConfiguration()
    cockpit.spawn(['bash', INSTALL_SH, oVirtFqdn, oVirtPort], {"superuser": "try"})
            .done(function () {
                console.info('oVirt installation script was successful');
                window.location.reload(); // to force configuration reload
                dfd.resolve();
            })
            .fail(function (ex, data) {
                logError('oVirt installation script failed. Exception: ', JSON.stringify(ex), ', output: ', JSON.stringify(data));

                let errMsg = _("oVirt installation script failed with following output: ") + (ex.message || data);
                if (ex.exit_status && ex.exit_status >= 1) {
                    errMsg = INSTALL_SH_ERRORS[ex.exit_status] || errMsg;
                }
                dfd.reject(errMsg);
            });
}

export default installationDialog;
