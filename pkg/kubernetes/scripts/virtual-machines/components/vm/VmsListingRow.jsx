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
import { connect } from 'react-redux';

import { ListingRow } from 'cockpit-components-listing.jsx';
import VmOverviewTab from './VmOverviewTab.jsx';
import VmActions from './VmActions.jsx';
import PodMetricsTab from '../common/PodMetricsTab.jsx';
import VmDisksTab from '../common/DisksTabKubevirt.jsx';

import type { Vm, Vmi, VmUi, PersistenVolumes, Pod, PodMetrics } from '../../types.es6';
import { kindIdPrefx, prefixedId, getValueOrDefault } from '../../utils.es6';
import { EMPTY_LABEL } from '../../constants.es6';
import { getNodeName, getPhase, getAge } from '../../selectors.es6';
import { showVm } from '../../action-creators.es6';

const navigateToVm = (vm) => {
    return cockpit.location.go([ 'vms', vm.metadata.namespace, vm.metadata.name ]);
};

const VmsListingRow = ({vm, vmi, vmUi, pvs, pod, podMetrics, onExpandChanged}:
                           { vm: Vm, vmi: Vmi, vmUi: VmUi, pvs: PersistenVolumes, pod: Pod, podMetrics: PodMetrics, onExpandChanged: Function }) => {
    const node = getNodeName(vmi) || EMPTY_LABEL;
    const phase = getPhase(vmi);
    const age = getAge(vm);
    const idPrefix = kindIdPrefx(vm);

    const overviewTabRenderer = {
        name: (<div id={prefixedId(idPrefix, 'overview-tab')}>{_("Overview")}</div>),
        renderer: VmOverviewTab,
        data: {
            vm,
            vmi,
            message: getValueOrDefault(() => vmUi.message, false),
            pod,
        },
        presence: 'always',
    };

    const metricsTabRenderer = {
        name: (<div id={prefixedId(idPrefix, 'usage-tab')}>{_("Usage")}</div>),
        renderer: PodMetricsTab,
        data: { idPrefix, podMetrics },
        presence: 'always',
    };

    const disksTabRenderer = {
        name: (<div id={prefixedId(idPrefix, 'disks-tab')}>{_("Disks")}</div>),
        renderer: VmDisksTab,
        data: { vm, pvs },
        presence: 'onlyActive',
    };

    const initiallyExpanded = getValueOrDefault(() => vmUi.isVisible, false);

    return (
        <ListingRow
            rowId={idPrefix}
            columns={[
                {
                    name: vm.metadata.name,
                    'header': true
                },
                vm.metadata.namespace,
                node,
                age,
                phase
            ]}
            tabRenderers={[ overviewTabRenderer, metricsTabRenderer, disksTabRenderer ]}
            listingActions={[<VmActions vm={vm} vmi={vmi} />]}
            expandChanged={onExpandChanged(vm)}
            navigateToItem={navigateToVm.bind(this, vm)}
            initiallyExpanded={initiallyExpanded} />
    );
};

VmsListingRow.propTypes = {
    vm: PropTypes.object.isRequired,
    vmi: PropTypes.object.isRequired,
    vmUi: PropTypes.object.isRequired,
    pvs: PropTypes.array.isRequired,
    pod: PropTypes.object.isRequired,
    podMetrics: PropTypes.object,
    onExpandChanged: PropTypes.func.isRequired,
};

export default connect(
    ({vmsUi, pvs}, {vm}) => {
        return {
            vmUi: vmsUi[vm.metadata.uid],
            pvs, // PersistentVolumes
        };
    },
    (dispatch) => ({
        onExpandChanged: (vm) => (isVisible) => dispatch(showVm({
            vm,
            isVisible
        }))
    })
)(VmsListingRow);
