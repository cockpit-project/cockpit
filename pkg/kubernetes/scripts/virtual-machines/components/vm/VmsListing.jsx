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

import { Listing } from 'cockpit-components-listing.jsx';
import VmsListingRow from './VmsListingRow.jsx';
import { getPod, getPodMetrics } from '../../selectors.jsx';
import { combineVms } from '../../utils.jsx';
import CreateVmButton from './createVmButton.jsx';

const VmsListing = ({vmTuples, pods, nodeMetrics, settings}) => {
    const isOpenshift = settings.flavor === 'openshift';
    const namespaceLabel = isOpenshift ? _("Project") : _("Namespace");

    const rows = vmTuples.map(({vm, vmi}) => {
        const pod = getPod(vmi, pods);

        return (
            <VmsListingRow vm={vm}
                           vmi={vmi}
                           pod={pod}
                           podMetrics={getPodMetrics(pod, nodeMetrics)}
                           key={vm.metadata.uid} />
        );
    });

    let actions = [(
        <CreateVmButton key='create-vm' />
    )];

    return (
        <Listing title={_("Virtual Machines")}
                 emptyCaption={_("No virtual machines")}
                 actions={actions}
                 columnTitles={[_("Name"), namespaceLabel, _("Node"), _("Age"), _("State")]}>
            {rows}
        </Listing>
    );
};

VmsListing.propTypes = {
    vmTuples: PropTypes.array.isRequired,
    pods: PropTypes.array.isRequired,
    nodeMetrics: PropTypes.object.isRequired,
    settings: PropTypes.object.isRequired,
};

export default connect(
    ({vms, vmis, pods, settings, nodeMetrics}) => ({
        vmTuples: combineVms(vms, vmis), // VirtualMachines and VirtualMachineInstances
        pods,
        nodeMetrics,
        settings,
    })
)(VmsListing);
