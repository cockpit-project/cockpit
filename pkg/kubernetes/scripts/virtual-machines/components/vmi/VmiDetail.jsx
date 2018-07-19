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
import { getPod, getPodMetrics, getEntityTitle } from '../../selectors.jsx';
import VmiOverviewTab from './VmiOverviewTab.jsx';
import VmiActions from './VmiActions.jsx';
import PodMetricsTab from '../common/PodMetricsTab.jsx';
import VmDisksTab from '../common/DisksTabKubevirt.jsx';
import { navigateToVms } from '../../entry-points/util/paths.es6';

import type { Vmi, VmUi, PersistenVolumes, Pod, PodMetrics } from '../../types.jsx';
import { kindIdPrefx, prefixedId, getValueOrDefault } from '../../utils.jsx';

const VmiDetail = ({ vmi, vmiUi, pageParams, pvs, pod, podMetrics }:
                      { vmi: Vmi, vmiUi?: VmUi, pageParams: Object, pvs: PersistenVolumes, pod: Pod, podMetrics: PodMetrics}) => {
    const actions = vmi ? <VmiActions vmi={vmi} onDeleteSuccess={navigateToVms} /> : null;
    const header = (<DetailPageHeader title={getEntityTitle(vmi)}
                                      navigateUpTitle={_("Show all VMs")}
                                      onNavigateUp={navigateToVms}
                                      actions={actions}
                                      idPrefix={'vmi-header'}
                                      iconClass='fa pficon-virtual-machine fa-fw' />);

    if (!vmi) {
        return (
            <div>
                <DetailPage>
                    {header}
                    <DetailPageRow title={cockpit.format(_("VM Instance $0:$1 does not exist."), pageParams.namespace, pageParams.name)}
                                   idPrefix={'vmi-not-found'} />
                </DetailPage>
            </div>
        );
    }
    const idPrefix = kindIdPrefx(vmi);

    return (
        <div>
            <DetailPage>
                {header}
                <DetailPageRow title={_("VMI")} idPrefix={prefixedId(idPrefix, 'vmi')} >
                    <VmiOverviewTab vmi={vmi} message={getValueOrDefault(() => vmiUi.message, false)} pod={pod} showState />
                </DetailPageRow>
                <DetailPageRow title={_("Usage")} idPrefix={prefixedId(idPrefix, 'usage')} >
                    <PodMetricsTab idPrefix={idPrefix} podMetrics={podMetrics} />
                </DetailPageRow>
                <DetailPageRow title={_("Disks")} idPrefix={prefixedId(idPrefix, 'disks')} >
                    <VmDisksTab vm={vmi} pvs={pvs} />
                </DetailPageRow>
            </DetailPage>
        </div>
    );
};

VmiDetail.propTypes = {
    vmi: PropTypes.object,
    vmiUi: PropTypes.object,
    pageParams: PropTypes.object,
    pvs: PropTypes.array.isRequired,
    pod: PropTypes.object.isRequired,
    podMetrics: PropTypes.object,
};

export default connect(
    ({vmis, pvs, pods, vmisUi, nodeMetrics}) => {
        const vmi = vmis.length > 0 ? vmis[0] : null;
        const pod = getPod(vmi, pods);
        const podMetrics = getPodMetrics(pod, nodeMetrics);
        return {
            vmi,
            vmiUi: vmi ? vmisUi[vmi.metadata.uid] : null,
            pvs,
            pod,
            podMetrics,
        };
    },
)(VmiDetail);
