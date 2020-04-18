/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import {
    Button, Card, CardTitle, CardHeader, CardActions, CardBody,
    Divider, TextInput,
    Toolbar, ToolbarContent, ToolbarItem,
    Select, SelectOption, SelectVariant,
    Page, PageSection, Text, TextVariants,
} from '@patternfly/react-core';
import { cellWidth } from '@patternfly/react-table';

import VmActions from './components/vm/vmActions.jsx';
import { updateVm } from './actions/store-actions.js';

import { vmId, rephraseUI, dummyVmsFilter, DOMAINSTATE } from "./helpers.js";

import { ListingTable } from "cockpit-components-table.jsx";
import StateIcon from './components/stateIcon.jsx';
import { AggregateStatusCards } from "./components/aggregateStatusCards.jsx";

import "./hostvmslist.scss";

const VmState = ({ vm, dismissError }) => {
    let state = null;

    if (vm.installInProgress) {
        state = _("Creating VM installation");
    } else if (vm.createInProgress) {
        state = _("Creating VM");
    } else {
        state = vm.state;
    }

    return <StateIcon dismissError={dismissError} error={vm.error} state={state} valueId={`${vmId(vm.name)}-state`} />;
};

const _ = cockpit.gettext;

/**
 * List of all VMs defined on this host
 */
const HostVmsList = ({ vms, config, ui, storagePools, dispatch, actions, networks, onAddErrorNotification }) => {
    const [statusSelected, setStatusSelected] = useState({ value: _("All"), toString: function() { return this.value } });
    const [currentTextFilter, setCurrentTextFilter] = useState("");
    const [statusIsExpanded, setStatusIsExpanded] = useState(false);
    const combinedVms = [...vms, ...dummyVmsFilter(vms, ui.vms)];
    const combinedVmsFiltered = combinedVms
            .filter(vm => vm.name.indexOf(currentTextFilter) != -1 && (!statusSelected.apiState || statusSelected.apiState == vm.state));

    const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);

    let domainStates = DOMAINSTATE.filter(state => vms.some(vm => vm.state === state));
    const prioritySorting = { // Put running, shut off and divider at top of the list. The lower the value, the bigger priority it has
        running: -3,
        "shut off": -2,
        _divider: -1,
    };
    if (domainStates.some(e => ["running", "shut off"].includes(e)) && domainStates.some(e => !["running", "shut off"].includes(e)))
        domainStates = domainStates.concat(["_divider"]);
    const sortOptions = [{ value: _("All") }]
            .concat(domainStates
                    .map(state => { return { value: rephraseUI('resourceStates', state), apiState: state } })
                    .sort((a, b) => (prioritySorting[a.apiState] || 0) - (prioritySorting[b.apiState] || 0) || a.value.localeCompare(b.value)));

    const toolBar = <Toolbar>
        <ToolbarContent>
            <ToolbarItem>
                <TextInput name="text-search" id="text-search" type="search"
                    value={currentTextFilter}
                    onChange={currentTextFilter => setCurrentTextFilter(currentTextFilter)}
                    placeholder={_("Filter by name")} />
            </ToolbarItem>
            {domainStates.length > 1 && <>
                <ToolbarItem variant="label" id="vm-state-select">
                    {_("State")}
                </ToolbarItem>
                <ToolbarItem>
                    <Select variant={SelectVariant.single}
                            toggleId="vm-state-select-toggle"
                            onToggle={statusIsExpanded => setStatusIsExpanded(statusIsExpanded)}
                            onSelect={(event, selection) => { setStatusIsExpanded(false); setStatusSelected(selection) }}
                            selections={statusSelected}
                            isOpen={statusIsExpanded}
                            aria-labelledby="vm-state-select">
                        {sortOptions.map((option, index) => (
                            option.apiState === "_divider"
                                ? <Divider component="li" key={index} />
                                : <SelectOption key={index} value={{ ...option, toString: function() { return this.value } }} />
                        ))}
                    </Select>
                </ToolbarItem>
            </>}
            <ToolbarItem variant="separator" />
            <ToolbarItem>{actions}</ToolbarItem>
        </ToolbarContent>
    </Toolbar>;

    // table-hover class is needed till PF4 Table has proper support for clickable rows
    // https://github.com/patternfly/patternfly-react/issues/3267
    return (<Page>
        <PageSection>
            <AggregateStatusCards networks={networks} storagePools={storagePools} />
            <Card id='virtual-machines-listing'>
                <CardHeader>
                    <CardTitle>
                        <Text component={TextVariants.h2}>{_("Virtual machines")}</Text>
                    </CardTitle>
                    <CardActions>
                        {toolBar}
                    </CardActions>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable aria-label={_("Virtual machines")}
                        variant='compact'
                        columns={[
                            { title: _("Name"), header: true, transforms: [cellWidth(25)] },
                            { title: _("Connection"), transforms: [cellWidth(25)] },
                            { title: _("State"), transforms: [cellWidth(25)] },
                            { title: _(""), transforms: [cellWidth(25)] },
                        ]}
                        emptyCaption={_("No VM is running or defined on this host")}
                        rows={ combinedVmsFiltered
                                .sort(sortFunction)
                                .map(vm => {
                                    const vmActions = <VmActions
                                        vm={vm}
                                        config={config}
                                        dispatch={dispatch}
                                        storagePools={storagePools}
                                        onAddErrorNotification={onAddErrorNotification}
                                    />;

                                    return {
                                        columns: [
                                            {
                                                title: <Button id={`${vmId(vm.name)}-${vm.connectionName}-name`}
                                                          variant="link"
                                                          isInline
                                                          isDisabled={vm.isUi}
                                                          component="a"
                                                          href={'#' + cockpit.format("vm?name=$0&connection=$1", vm.name, vm.connectionName)}
                                                          className="vm-list-item-name">{vm.name}</Button>
                                            },
                                            { title: rephraseUI('connections', vm.connectionName) },
                                            {
                                                title: (
                                                    <VmState vm={vm}
                                                             dismissError={() => dispatch(updateVm({
                                                                 connectionName: vm.connectionName,
                                                                 name: vm.name,
                                                                 error: null
                                                             }))} />
                                                )
                                            },
                                            { title: !vm.isUi ? vmActions : null },
                                        ],
                                        rowId: cockpit.format("$0-$1", vmId(vm.name), vm.connectionName),
                                        props: { key: cockpit.format("$0-$1-row", vmId(vm.name), vm.connectionName) },
                                    };
                                }) }
                    />
                </CardBody>
            </Card>
        </PageSection>
    </Page>);
};
HostVmsList.propTypes = {
    vms: PropTypes.array.isRequired,
    config: PropTypes.object.isRequired,
    ui: PropTypes.object.isRequired,
    storagePools: PropTypes.array.isRequired,
    dispatch: PropTypes.func.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
};

export default HostVmsList;
