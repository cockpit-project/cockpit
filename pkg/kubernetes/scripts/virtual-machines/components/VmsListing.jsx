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

// @flow

import React, { PropTypes } from 'react';
import { connect } from 'react-redux';
import { gettext as _ } from 'cockpit';

import { Listing } from '../../../../lib/cockpit-components-listing.jsx';
import VmsListingRow from './VmsListingRow.jsx';
import { getPod } from '../selectors.jsx';
import CreateVmButton from './createVmButton.jsx';

const VmsListing = ({ vms, pvs, pods, settings, vmsMessages }) => {
    const isOpenshift = settings.flavor === 'openshift';
    const namespaceLabel = isOpenshift ? _("Project") : _("Namespace");
    const rows = vms.map(vm => (<VmsListingRow vm={vm}
                                               vmMessages={vmsMessages[vm.metadata.uid]}
                                               pod={getPod(vm, pods)}
                                               pvs={pvs}
                                               key={vm.metadata.uid} />));
    let actions = [(
        <CreateVmButton />
    )];

    return (
        <Listing title={_("Virtual Machines")}
                 emptyCaption={_("No virtual machines")}
                 actions={actions}
                 columnTitles={[_("Name"), namespaceLabel, _("Node"), _("State")]}>
            {rows}
        </Listing>
    );
};

VmsListing.propTypes = {
    vms: PropTypes.object.isRequired,
    pvs: PropTypes.object.isRequired,
    pods: PropTypes.object.isRequired,
    vmsMessages: PropTypes.object.isRequired,
};

export default connect(
    ({ vms, pods, pvs, settings, vmsMessages }) => ({
        vms, // VirtualMachines
        pods,
        pvs, // PersistentVolumes
        settings,
        vmsMessages,
    })
)(VmsListing);
