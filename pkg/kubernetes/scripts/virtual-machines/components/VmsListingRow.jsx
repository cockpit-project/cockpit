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
import cockpit, { gettext as _ } from 'cockpit';
import { connect } from "react-redux";

import { ListingRow } from '../../../../lib/cockpit-components-listing.jsx';
import VmOverviewTab from './VmOverviewTabKubevirt.jsx';
import VmActions from './VmActions.jsx';
import VmMetricsTab from './VmMetricsTab.jsx';
import VmDisksTab from './VmDisksTabKubevirt.jsx';

import type { Vm, VmMessages, PersistenVolumes, Pod } from '../types.jsx';
import { NODE_LABEL, vmIdPrefx, prefixedId, getValueOrDefault } from '../utils.jsx';
import { vmExpanded } from "../action-creators.jsx";

const navigateToVm = (vm) => {
    return cockpit.location.go([ 'vms', vm.metadata.namespace, vm.metadata.name ]);
};

const VmsListingRow = ({ vm, vmMessages, pvs, pod, podMetrics, vmUi, onExpandChanged }:
                           { vm: Vm, vmMessages: VmMessages, pvs: PersistenVolumes, pod: Pod, onExpandChanged: Function }) => {
    const node = getValueOrDefault(() => vm.metadata.labels[NODE_LABEL], '-');
    const phase = getValueOrDefault(() => vm.status.phase, _("n/a"));
    const idPrefix = vmIdPrefx(vm);

    const overviewTabRenderer = {
        name: (<div id={prefixedId(idPrefix, 'overview-tab')}>{_("Overview")}</div>),
        renderer: VmOverviewTab,
        data: { vm, vmMessages, pod },
        presence: 'always',
    };

    const metricsTabRenderer = {
        name: (<div id={prefixedId(idPrefix, 'usage-tab')}>{_("Usage")}</div>),
        renderer: VmMetricsTab,
        data: { idPrefix, podMetrics },
        presence: 'always',
    };

    const disksTabRenderer = {
        name: (<div id={prefixedId(idPrefix, 'disks-tab')}>{_("Disks")}</div>),
        renderer: VmDisksTab,
        data: { vm, pvs },
        presence: 'onlyActive',
    };

    const initiallyExpanded = getValueOrDefault(() => vmUi.isExpanded, false);

    return (
        <ListingRow
            rowId={idPrefix}
            columns={[
                { name: vm.metadata.name, 'header': true },
                vm.metadata.namespace,
                node,
                phase // phases description https://github.com/kubevirt/kubevirt/blob/master/pkg/api/v1/types.go
            ]}
            tabRenderers={[ overviewTabRenderer, metricsTabRenderer, disksTabRenderer ]}
            listingActions={[ <VmActions vm={vm} /> ]}
            expandChanged={onExpandChanged(vm)}
            navigateToItem={navigateToVm.bind(this, vm)}
            initiallyExpanded={initiallyExpanded} />
    );
};

VmsListingRow.propTypes = {
    vm: PropTypes.object.isRequired,
    vmMessages: PropTypes.object,
    pvs: PropTypes.array.isRequired,
    pod: PropTypes.object.isRequired,
    podMetrics: PropTypes.object,
    vmUi: PropTypes.object,
    onExpandChanged: PropTypes.func.isRequired,
};

export default connect(
    ({ ui }, { vm }) => ({
        vmUi: ui[vm.metadata.uid]
    }),
    (dispatch) => ({
        onExpandChanged: (vm) => (isExpanded) => dispatch(vmExpanded({ vm, isExpanded }))
    })
)(VmsListingRow);
