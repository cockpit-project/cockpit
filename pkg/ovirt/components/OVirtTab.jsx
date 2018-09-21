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
import cockpit from 'cockpit';
import React from "react";

import { isSameHostAddress } from '../helpers.es6';
import { vmId } from '../../machines/helpers.es6';
import { migrateVm } from '../actions.es6';

import ConfirmButtons from './ConfirmButtons.jsx';
import VmProperty from '../../machines/components/infoRecord.jsx';
import rephraseUI from '../rephraseUI.es6';

import './OVirtTab.css';

const _ = cockpit.gettext;

function canVmMigrateToHost ({ host }) {
    return host.status === 'up';
}

class MigrateTo extends React.Component {
    constructor (props) {
        super(props);

        this.state = {
            confirmAction: false,
            selectedHostId: null,
        };
    }

    render () {
        const { vm, hosts, dispatch } = this.props;

        const onHostChange = e => { this.setState({selectedHostId: e.target.value}) };
        const onAction = () => { this.setState({ confirmAction: true }) };
        const onActionCanceled = () => { this.setState({ confirmAction: false }) };
        const onActionConfirmed = () => {
            this.setState({ confirmAction: false });
            dispatch(migrateVm(vm.id, vm.name, this.state.selectedHostId));
        };

        const idPrefix = `${vmId(vm.name)}-ovirt`;

        return (
            <tr>
                <td>
                    {this.state.confirmAction
                        ? (<ConfirmButtons confirmText={_("Confirm migration")}
                                         dismissText={_("Cancel")}
                                         onYes={onActionConfirmed}
                                         onNo={onActionCanceled} />)
                        : (<button className="btn btn-default btn-danger" onClick={onAction} id={`${idPrefix}-migratetobutton`}>
                            {_("Migrate To:")}
                        </button>)
                    }
                </td>
                <td>
                    <select className='combobox form-control ovirt-provider-migrateto-combo'
                            onChange={onHostChange}
                            disabled={this.state.confirmAction}
                            id={`${idPrefix}-migratetoselect`}
                            defaultValue={this.state.selectedHostId}>
                        <option value={null} key='select-automatically'>
                            {_("Automatically selected host")}
                        </option>
                        {Object.getOwnPropertyNames(hosts)
                                .filter(hostId => canVmMigrateToHost({host: hosts[hostId]}))
                                .map(hostId => (
                                    <option value={hostId} key={hostId}
                                        disabled={isSameHostAddress(hosts[hostId].address)}>
                                        {hosts[hostId].name}
                                    </option>
                                ))}
                    </select>
                </td>
            </tr>
        );
    }
}

const VmTemplate = ({ clusterVm, templates, id }) => {
    if (!templates || !clusterVm) {
        return null;
    }

    const template = templates[clusterVm.templateId];
    if (!template) {
        return (
            <VmProperty descr={_("Base template:")}
                        value='' />
        );
    }

    const version = template.version;
    return (
        <VmProperty descr={_("Base template:")}
                    value={version.name
                        ? (`${version.name} (${template.name})`)
                        : template.name}
                    id={id}
        />
    );
};

const VmHA = ({ clusterVm, id }) => {
    let value = _("disabled");
    if (clusterVm.highAvailability && clusterVm.highAvailability.enabled === 'true') {
        value = _("enabled");
    }

    return (<VmProperty descr={_("HA:")} value={value} id={id} />);
};

const OVirtTab = ({ vm, providerState, dispatch }) => {
    const clusterVm = providerState.vms[vm.id]; // 'vm' is from Libvirt, 'clusterVm' is from oVirt
    if (!clusterVm) {
        return (<div>{_("This virtual machine is not managed by oVirt")}</div>);
    }

    const idPrefix = `${vmId(vm.name)}-ovirt`;

    return (
        <table className='machines-width-max'>
            <tbody>
                <tr className='machines-listing-ct-body-detail'>
                    <td className='ovirt-provider-listing-top-column'>
                        <table className='form-table-ct'>
                            <tbody>
                                <VmProperty descr={_("Description:")} value={clusterVm.description || ""} id={`${idPrefix}-description`} />
                                <VmTemplate clusterVm={clusterVm} templates={providerState.templates} id={`${idPrefix}-template`} />
                                <VmProperty descr={_("OS Type:")} value={clusterVm.os.type} id={`${idPrefix}-ostype`} />
                            </tbody>
                        </table>
                    </td>
                    <td className='ovirt-provider-listing-top-column'>
                        <table className='form-table-ct'>
                            <tbody>
                                <VmHA clusterVm={clusterVm} id={`${idPrefix}-ha`} />
                                <VmProperty descr={_("Stateless:")} value={rephraseUI('stateless', clusterVm.stateless)} id={`${idPrefix}-stateless`} />
                                <VmProperty descr={_("Optimized for:")} value={clusterVm.type} id={`${idPrefix}-optimizedfor`} />
                            </tbody>
                        </table>
                    </td>
                    <td className='ovirt-provider-listing-top-column'>
                        <table className='form-table-ct'>
                            <tbody>
                                <MigrateTo vm={vm} hosts={providerState.hosts} dispatch={dispatch} />
                            </tbody>
                        </table>
                    </td>
                </tr>
            </tbody>
        </table>
    );
};

export default OVirtTab;
