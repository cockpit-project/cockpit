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
import React from 'react';
import PropTypes from 'prop-types';

import HostVmsList from "./hostvmslist.jsx";
import LibvirtSlate from "./components/libvirtSlate.jsx";
import { createVmAction } from "./components/create-vm-dialog/createVmDialog.jsx";

const App = ({ store }) => {
    const { vms, config, storagePools, systemInfo, ui } = store.getState();
    const dispatch = store.dispatch;

    if (systemInfo.libvirtService.activeState !== 'running') {
        return (<LibvirtSlate libvirtService={systemInfo.libvirtService} dispatch={dispatch} />);
    }

    // pass ui object
    return (<HostVmsList vms={vms}
        config={config}
        ui={ui}
        storagePools={storagePools}
        dispatch={dispatch}
        actions={createVmAction({ dispatch, systemInfo })} />);
};
App.propTypes = {
    store: PropTypes.object.isRequired,
};

export default App;
