/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import { DetailPage, DetailPageRow, DetailPageHeader } from 'cockpit-components-detail-page.jsx';
import { getPod, getPodMetrics } from '../selectors.jsx';
import VmOverviewTab from './VmOverviewTabKubevirt.jsx';
import VmActions from './VmActions.jsx';
import VmMetricsTab from './VmMetricsTab.jsx';
import VmDisksTab from './VmDisksTabKubevirt.jsx';

import type { Vm, VmMessages, PersistenVolumes, Pod } from '../types.jsx';
import { vmIdPrefx, prefixedId } from '../utils.jsx';

const navigateToVms = () => {
    cockpit.location.go([ 'vms' ]);
};

const VmDetail = ({ vm, pageParams, vmMessages, pvs, pod, podMetrics }:
                      { vm: Vm, vmMessages: VmMessages, pageParams: Object, pvs: PersistenVolumes, pod: Pod}) => {
    const mainTitle = vm ? `${vm.metadata.namespace}:${vm.metadata.name}` : null;
    const actions = vm ? <VmActions vm={vm} onDeleteSuccess={navigateToVms} /> : null;
    const header = (<DetailPageHeader title={mainTitle}
                                      navigateUpTitle={_("Show all VMs")}
                                      onNavigateUp={navigateToVms}
                                      actions={actions}
                                      idPrefix={'vm-header'}
                                      iconClass='fa pficon-virtual-machine fa-fw' />);

    if (!vm) {
        return (
            <div>
                <DetailPage>
                    {header}
                    <DetailPageRow title={cockpit.format(_("VM $0:$1 does not exist."), pageParams.namespace, pageParams.name)}
                                   idPrefix={'vm-not-found'} />
                </DetailPage>
            </div>
        );
    }
    const idPrefix = vmIdPrefx(vm);

    return (
        <div>
            <DetailPage>
                {header}
                <DetailPageRow title={_("VM")} idPrefix={prefixedId(idPrefix, 'vm')} >
                    <VmOverviewTab vm={vm} vmMessages={vmMessages} pod={pod} showState />
                </DetailPageRow>
                <DetailPageRow title={_("Usage")} idPrefix={prefixedId(idPrefix, 'usage')} >
                    <VmMetricsTab idPrefix={idPrefix} podMetrics={podMetrics} />
                </DetailPageRow>
                <DetailPageRow title={_("Disks")} idPrefix={prefixedId(idPrefix, 'disks')} >
                    <VmDisksTab vm={vm} pvs={pvs} />
                </DetailPageRow>
            </DetailPage>
        </div>
    );
};

VmDetail.propTypes = {
    vm: PropTypes.object.isRequired,
    pageParams: PropTypes.object,
    vmMessages: PropTypes.object,
    pvs: PropTypes.array.isRequired,
    pod: PropTypes.object.isRequired,
    podMetrics: PropTypes.object,
};

export default connect(
    ({vms, pvs, pods, vmsMessages, nodeMetrics}) => {
        const vm = vms.length > 0 ? vms[0] : null;
        const pod = getPod(vm, pods);
        const podMetrics = getPodMetrics(pod, nodeMetrics);
        return {
            vm,
            vmMessages: vm ? vmsMessages[vm.metadata.uid] : null,
            pvs,
            pod,
            podMetrics,
        };
    },
)(VmDetail);
