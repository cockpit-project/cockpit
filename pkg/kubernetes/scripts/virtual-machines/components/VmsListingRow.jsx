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

import React from 'react'
import { gettext as _ } from 'cockpit'

import { ListingRow } from '../../../../lib/cockpit-components-listing.jsx'
import type { Vm } from '../types.jsx'
import { getPairs } from '../utils.jsx'

const NODE_LABEL = 'kubevirt.io/nodeName'
function getNodeName(vm: Vm) {
    return (vm.metadata.labels && vm.metadata.labels[NODE_LABEL]) || null
}

const GeneralTab = ({ vm }: { vm: Vm }) => {
    const nodeName = getNodeName(vm)
    const nodeLink = nodeName ? (<a href={`#/nodes/${nodeName}`}>{nodeName}</a>) : '-'
    return (
        <div className="row">
            <div className="col-xs-12 col-md-6">
                <dl>
                    <dt>{_("Node")}</dt>
                    <dd className="vm-node">{nodeLink}</dd>
                </dl>
            </div>
            <div className="col-xs-12 col-md-6">
                <dl className="full-width">
                    <dt>{_("Labels")}</dt>
                    {vm.metadata.labels && getPairs(vm.metadata.labels).map(pair => {
                        const printablePair = pair.key + '=' + pair.value
                        return (<dd key={printablePair}>{printablePair}</dd>)
                    })}
                </dl>
            </div>
        </div>
    )
}

const VmsListingRow = ({ vm }: { vm: Vm }) => {
    const node = (vm.metadata.labels && vm.metadata.labels[NODE_LABEL]) || '-'
    const phase = (vm.status && vm.status.phase) || _("n/a")
    const generalTabRenderer = {
        name: _("General"),
        renderer: GeneralTab,
        data: { vm },
        presence: 'always',
    }
    return (
        <ListingRow
            rowId={`vm-${vm.metadata.name}`}
            columns={[
                {name: vm.metadata.name, 'header': true},
                vm.metadata.namespace,
                node,
                phase // phases description https://github.com/kubevirt/kubevirt/blob/master/pkg/api/v1/types.go
            ]}
            tabRenderers={[generalTabRenderer]}/>
    )
}

VmsListingRow.propTypes = {
    vm: React.PropTypes.object.isRequired
}

export default VmsListingRow
