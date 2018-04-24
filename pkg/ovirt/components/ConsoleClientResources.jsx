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
import React from "react";

import CONFIG from '../config.es6';

const _ = cockpit.gettext;

const ConsoleClientResources = ({ vm, providerState }) => {
    const clusterVm = providerState.vms[vm.id];
    if (!clusterVm) { // not an oVirt-managed VM
        return null;
    }

    const msg = cockpit.format(_("Please refer to oVirt's $0 for more information about Remote Viewer setup."),
                               `<a href="${CONFIG.CONSOLE_CLIENT_RESOURCES_URL}" target="_blank">Console Client Resources</a>`);

    return (
        <div dangerouslySetInnerHTML={{__html: msg}} />
    );
};

export default ConsoleClientResources;
