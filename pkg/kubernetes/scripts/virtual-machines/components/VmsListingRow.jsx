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

import { ListingRow } from '../../../../lib/cockpit-components-listing.jsx';
import VmOverviewTab from './VmOverviewTabKubevirt.jsx';
import VmActions from './VmActions.jsx';

import type { Vm, VmMessages } from '../types.jsx';
import { NODE_LABEL, vmIdPrefx } from '../utils.jsx';

const VmsListingRow = ({ vm, vmMessages }: { vm: Vm, vmMessages: VmMessages }) => {
    const node = (vm.metadata.labels && vm.metadata.labels[NODE_LABEL]) || '-';
    const phase = (vm.status && vm.status.phase) || _("n/a");
    const overviewTabRenderer = {
        name: _("Overview"),
        renderer: VmOverviewTab,
        data: { vm, vmMessages },
        presence: 'always',
    };

    return (
        <ListingRow
            rowId={vmIdPrefx(vm)}
            columns={[
                {name: vm.metadata.name, 'header': true},
                vm.metadata.namespace,
                node,
                phase // phases description https://github.com/kubevirt/kubevirt/blob/master/pkg/api/v1/types.go
            ]}
            tabRenderers={[overviewTabRenderer]}
            listingActions={<VmActions vm={vm}/>}/>
    );
};

VmsListingRow.propTypes = {
    vm: React.PropTypes.object.isRequired
};

export default VmsListingRow;
