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
import React from "react";
import cockpit from 'cockpit';

import './HostToMaintenance.css';

import DialogPattern from 'cockpit-components-dialog.jsx';
import { switchHostToMaintenance } from '../actions.es6';

const _ = cockpit.gettext;

const hostToMaintenanceDialog = (dispatch, host) => {
    const hostId = host && host.id;

    const body = (
        <div className="modal-body">
            {_("Please confirm, the host shall be switched to maintenance mode.")}
            <br />
            {_("All running virtual machines will be turned off.")}
        </div>
    );
    const dialogProps = {
        'title': _("Switch Host to Maintenance"),
        body,
    };

    let footerProps = {
        'actions': [
            { 'clicked': () => { return dispatch(switchHostToMaintenance({ hostId })) },
              'caption': _("OK"),
              'style': 'primary',
            },
        ],
    };

    DialogPattern.show_modal_dialog(dialogProps, footerProps);
};

const showHostToMaintenanceDialog = (dispatch, hosts) => {
    return (event) => {
        if (!event || event.button !== 0) {
            return;
        }
        hostToMaintenanceDialog(dispatch, hosts);
    };
};

const hostToMaintenance = ({ dispatch, host }) => {
    if (!host) {
        return null;
    }

    // TODO: "pficon-maintenance" seems to be added to patternfly since 3.26 release - change once this gets to cockpit
    return (
        <a key='host-to-maintenance' className='card-pf-link-with-icon pull-right' id='ovirt-host-to-maintenance'
           onClick={showHostToMaintenanceDialog(dispatch, host)}>
            <div className='ovirt-action-padding'>
                <span className='pficon pficon-close' />{_("Host to Maintenance")}
            </div>
        </a>
    );
};

export default hostToMaintenance;
