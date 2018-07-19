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
import { connect } from 'react-redux';

import { DetailPage, DetailPageHeader, DetailPageRow } from 'cockpit-components-detail-page.jsx';
import { getEntityTitle, getPod, getPodMetrics } from '../../selectors.es6';
import VmOverviewTab from './VmOverviewTab.jsx';
import VmActions from './VmActions.jsx';
import PodMetricsTab from '../common/PodMetricsTab.jsx';
import VmDisksTab from '../common/DisksTabKubevirt.jsx';
import { navigateToVms } from '../../entry-points/util/paths.es6';

import type { PersistenVolumes, Pod, Vm, Vmi, VmUi, PodMetrics } from '../../types.es6';
import { getValueOrDefault, kindIdPrefx, prefixedId } from '../../utils.es6';

const VmDetail = ({vm, vmi, vmUi, pageParams, pvs, pod, podMetrics}:
                       { vm: Vm, vmi: Vmi, vmUi?: VmUi, pageParams: Object, pvs: PersistenVolumes, pod: Pod, podMetrics: PodMetrics }) => {
    const actions = vm ? <VmActions vm={vm} vmi={vmi} onDeleteSuccess={navigateToVms} /> : null;
    const header = (<DetailPageHeader title={getEntityTitle(vm)}
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
    const idPrefix = kindIdPrefx(vm);

    return (
        <div>
            <DetailPage>
                {header}
                <DetailPageRow title={_("VM")} idPrefix={prefixedId(idPrefix, 'vm')} >
                    <VmOverviewTab vm={vm} vmi={vmi} message={getValueOrDefault(() => vmUi.message, false)} pod={pod} showState />
                </DetailPageRow>
                <DetailPageRow title={_("Usage")} idPrefix={prefixedId(idPrefix, 'usage')} >
                    <PodMetricsTab idPrefix={idPrefix} podMetrics={podMetrics} />
                </DetailPageRow>
                <DetailPageRow title={_("Disks")} idPrefix={prefixedId(idPrefix, 'disks')} >
                    <VmDisksTab vm={vm} pvs={pvs} />
                </DetailPageRow>
            </DetailPage>
        </div>
    );
};

VmDetail.propTypes = {
    vm: PropTypes.object,
    vmi: PropTypes.object,
    vmUi: PropTypes.object,
    pageParams: PropTypes.object.isRequired,
    pvs: PropTypes.array.isRequired,
    pod: PropTypes.object.isRequired,
    podMetrics: PropTypes.object,
};

export default connect(
    ({vms, vmis, pvs, pods, vmsUi, nodeMetrics}) => {
        const vm = vms.length > 0 ? vms[0] : null;
        const vmi = vmis.length > 0 ? vmis[0] : null;

        const pod = getPod(vmi, pods);
        const podMetrics = getPodMetrics(pod, nodeMetrics);
        return {
            vm,
            vmi,
            vmUi: vm ? vmsUi[vm.metadata.uid] : null,
            pvs,
            pod,
            podMetrics,
        };
    },
)(VmDetail);
