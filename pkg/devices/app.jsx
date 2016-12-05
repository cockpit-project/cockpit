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

import cockpit from 'cockpit';
import React from 'react';

import { Listing, ListingRow } from 'cockpit-components-listing.jsx';
import PCIDevices, { pciActions } from './pci.jsx';

const _ = cockpit.gettext;

const Router = ({ deviceActions, state }) => {
    const { visibility, pciDevices, pciDrivers } = state;

    /* TODO: Add USB and SCSCI devices */
    switch (visibility.bus) {
        case 'pci':
        default:
            return (<PCIDevices visibility={visibility} pciDevices={pciDevices} pciDrivers={pciDrivers} deviceActions={deviceActions} />)
    }
};

const NavBar = ({ deviceActions, visibility }) => {
    const active = visibility.bus;
    const isActive = (bus) => bus === active ? 'active' : '';

    return (
        <div className='content-filter'>
            <div className='btn-group'>
                <button className={`btn btn-default ${isActive('pci')}`} onClick={() => deviceActions.onPciClassSelected(null)}>{_('PCI')}</button>
                <button className={`btn btn-default ${isActive('scsi')}`}>{_('SCSI')}</button>
                <button className={`btn btn-default ${isActive('usb')}`}>{_('USB')}</button>
            </div>
        </div>
    );
};

const App = ({ store }) => {
    const state = store.getState();
    const dispatch = store.dispatch;

    const deviceActions = Object.assign({}, pciActions(dispatch));

    return (
        <div className='app-devices'>
            <NavBar deviceActions={deviceActions} visibility={state.visibility} />

            <div className='container-fluid content-main'>
                <Router deviceActions={deviceActions} state={state} />
            </div>
        </div>
    );
};

export default App;
