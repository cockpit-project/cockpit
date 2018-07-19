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
import React from 'react';
import { gettext as _ } from 'cockpit';
import { connect } from 'react-redux';

import { commonTitles } from '../../../../../machines/components/vmOverviewTab.jsx';

import type { Vm, Vmi, Message as MessageType, Pod } from '../../types.es6';
import { kindIdPrefx } from '../../utils.es6';
import { getLabels } from '../util/utils.jsx';
import { getNodeName, getMemory, getCPUs, getPhase, getAge } from '../../selectors.es6';
import { removeVmMessage } from '../../action-creators.es6';
import OverviewTab from '../common/OverviewTab.jsx';
import Message from '../common/Message.jsx';
import EntityLink from '../common/EntityLink.jsx';
import NodeLink from '../common/NodeLink.jsx';

const VmOverviewTab = ({ vm, vmi, message, onMessageDismiss, pod, showState }: { vm: Vm, vmi: Vmi, message: MessageType, pod: Pod, showState: boolean }) => {
    const idPrefix = kindIdPrefx(vm);

    const messageElem = (<Message idPrefix={idPrefix} message={message} onDismiss={onMessageDismiss} />);

    const nodeItem = {title: _("Node:"), value: (<NodeLink name={getNodeName(vmi)} />), idPostfix: 'node'};
    const labelsItem = {title: _("Labels:"), value: getLabels(vm), idPostfix: 'labels', className: 'clearfix'};

    const leftItems = [
        {title: commonTitles.MEMORY, value: getMemory(vm), idPostfix: 'memory'},
        {title: commonTitles.CPUS, value: getCPUs(vm), idPostfix: 'vcpus'},
        {title: _("Pod:"), value: (<EntityLink path='/l/pods' entity={pod} />), idPostfix: 'pod'},
        {title: _("VM Instance:"), value: (<EntityLink path='/vmis' entity={vmi} />), idPostfix: 'vmi'},
    ];

    const rightItems = showState ? [
        {title: _("State"), value: getPhase(vmi), idPostfix: 'state'},
        {title: _("Age"), value: getAge(vm), idPostfix: 'age'},
        nodeItem,
        labelsItem,
    ] : [
        nodeItem,
        labelsItem,
    ];

    return (<OverviewTab message={messageElem}
                           idPrefix={idPrefix}
                           leftItems={leftItems}
                           rightItems={rightItems} />);
};

export default connect(
    () => ({ }),
    (dispatch, { vm }) => ({
        onMessageDismiss: () => dispatch(removeVmMessage({ vm })),
    }),
)(VmOverviewTab);
