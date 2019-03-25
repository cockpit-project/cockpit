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

import React from 'react';
import PropTypes from 'prop-types';
import { Button, FormGroup, HelpBlock, Modal } from 'patternfly-react';

import cockpit from 'cockpit';
import { MachinesConnectionSelector } from '../machinesConnectionSelector.jsx';
import * as Select from "cockpit-components-select.jsx";
import { FileAutoComplete } from "cockpit-components-file-autocomplete.jsx";
import { createVm } from '../../actions/provider-actions.js';
import { addErrorNotification } from '../../actions/store-actions.js';
import {
    isEmpty,
    convertToUnit,
    timeoutedPromise,
    units,
    LIBVIRT_SYSTEM_CONNECTION,
} from "../../helpers.js";
import {
    getPXEInitialNetworkSource,
    getPXENetworkRows,
    getVirtualNetworkByName,
    getVirtualNetworkPXESupport
} from './pxe-helpers.js';

import {
    NOT_SPECIFIED,
    OTHER_OS_SHORT_ID,
    DIVIDER_FAMILY,
    prepareVendors,
    getOSStringRepresentation,
} from "./createVmDialogUtils.js";
import MemorySelectRow from '../memorySelectRow.jsx';

import './createVmDialog.less';
import 'form-layout.less';
import VMS_CONFIG from '../../config.js';

const _ = cockpit.gettext;

const URL_SOURCE = 'url';
const LOCAL_INSTALL_MEDIA_SOURCE = 'file';
const EXISTING_DISK_IMAGE_SOURCE = 'disk_image';
const PXE_SOURCE = 'pxe';

/* Create a virtual machine
 * props:
 *  - valuesChanged callback for changed values with the signature (key, value)
 */
class CreateVM extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            vmName: props.vmParams.vmName,
            vendor: props.vmParams.vendor,
            os: props.vmParams.os,
            source: props.vmParams.source,
            memorySize: convertToUnit(props.vmParams.memorySize, units.MiB, units.GiB), // tied to Unit
            memorySizeUnit: units.GiB.name,
            storageSize: props.vmParams.storageSize, // tied to Unit
            storageSizeUnit: units.GiB.name,
            sourceType: props.vmParams.sourceType,
            startVm: props.vmParams.startVm,
            connectionName: props.vmParams.connectionName,
        };

        this.onChangedValue = this.onChangedValue.bind(this);
    }

    onChangedEventValue(key, e) {
        if (e && e.target && typeof e.target.value !== 'undefined') {
            this.onChangedValue(key, e.target.value);
        }
    }

    onChangedEventChecked(key, e) {
        if (e && e.target && typeof e.target.checked === "boolean") {
            this.onChangedValue(key, e.target.checked);
        }
    }

    onChangedValue(key, value, valueParams) {
        const notifyValuesChanged = (key, value) => {
            if (this.props.valuesChanged) {
                this.props.valuesChanged(key, value);
            }
        };

        switch (key) {
        case 'vmName': {
            this.setState({ [key]: value });
            break;
        }
        case 'vendor': {
            const os = this.props.vendorMap[value][0].shortId;
            this.setState({
                [key]: value,
                os,
            });
            notifyValuesChanged('os', os);
            break;
        }
        case 'os':
            this.setState({ [key]: value });
            break;
        case 'source':
            this.setState({ [key]: value });
            break;
        case 'sourceType':
            this.setState({ [key]: value });
            if (value != PXE_SOURCE) {
                notifyValuesChanged('source', null);
            } else {
                let initialPXESource = getPXEInitialNetworkSource(this.props.nodeDevices,
                                                                  this.props.networks,
                                                                  this.props.vmParams.connectionName);

                notifyValuesChanged('source', initialPXESource);
            }
            break;
        case 'memorySize':
            this.setState({ [key]: value });
            value = convertToUnit(value, this.state.memorySizeUnit, units.MiB);
            break;
        case 'storageSize':
            this.setState({ [key]: value });
            value = convertToUnit(value, this.state.storageSizeUnit, units.GiB);
            break;
        case 'memorySizeUnit':
            this.setState({ [key]: value });
            value = convertToUnit(this.state.memorySize, value, units.MiB);
            key = 'memorySize';
            break;
        case 'storageSizeUnit':
            this.setState({ [key]: value });
            value = convertToUnit(this.state.storageSize, value, units.GiB);
            key = 'storageSize';
            break;
        case 'startVm': {
            this.setState({ [key]: value });
            break;
        }
        case 'connectionName':
            this.setState({ [key]: value });
            break;
        default:
            break;
        }

        notifyValuesChanged(key, value);
    }

    render() {
        const vendorSelectEntries = [];

        if (this.props.familyMap[DIVIDER_FAMILY]) {
            vendorSelectEntries.push((
                <Select.SelectEntry data={NOT_SPECIFIED} key={NOT_SPECIFIED}>{_(NOT_SPECIFIED)}</Select.SelectEntry>));
            vendorSelectEntries.push((<Select.SelectDivider key='divider' />));
        }

        this.props.familyList.forEach(({ family, vendors }) => {
            if (family === DIVIDER_FAMILY) {
                return;
            }

            vendorSelectEntries.push(
                <optgroup key={family} label={family}>
                    { vendors.map(vendor => <Select.SelectEntry data={vendor} key={vendor}>{vendor}</Select.SelectEntry>) }
                </optgroup>);
        });

        const osEntries = (
            this.props.vendorMap[this.state.vendor]
                    .map(os => (
                        <Select.SelectEntry data={os.shortId} key={os.shortId}>
                            {getOSStringRepresentation(os)}
                        </Select.SelectEntry>))
        );

        let installationSource;
        let installationSourceId;
        let installationSourceWarning;
        switch (this.state.sourceType) {
        case LOCAL_INSTALL_MEDIA_SOURCE:
            installationSourceId = "source-file";
            installationSource = (
                <FileAutoComplete id={installationSourceId}
                    placeholder={_("Path to ISO file on host's file system")}
                    onChange={this.onChangedValue.bind(this, 'source')}
                    superUser="try" />
            );
            break;
        case EXISTING_DISK_IMAGE_SOURCE:
            installationSourceId = "source-disk";
            installationSource = (
                <FileAutoComplete id={installationSourceId}
                    placeholder={_("Existing disk image on host's file system")}
                    onChange={this.onChangedValue.bind(this, 'source')}
                    superuser="try" />
            );
            break;
        case PXE_SOURCE:
            installationSourceId = "network";
            if (this.state.source.includes('type=direct')) {
                installationSourceWarning = _("In most configurations, macvtap does not work for host to guest network communication.");
            } else if (this.state.source.includes('network=')) {
                let netObj = getVirtualNetworkByName(this.state.source.split('network=')[1],
                                                     this.props.networks,
                                                     this.state.connectionName);

                if (!getVirtualNetworkPXESupport(netObj))
                    installationSourceWarning = _("Network Selection does not support PXE.");
            }

            installationSource = (
                <React.Fragment>
                    <Select.StatelessSelect id="network-select"
                                            selected={this.state.source}
                                            onChange={this.onChangedValue.bind(this, 'source')}>
                        {getPXENetworkRows(this.props.nodeDevices, this.props.networks, this.state.connectionName)}
                    </Select.StatelessSelect>

                    {installationSourceWarning &&
                    <HelpBlock>
                        <p className="text-warning">{installationSourceWarning}</p>
                    </HelpBlock> }
                </React.Fragment>
            );
            break;
        case URL_SOURCE:
        default:
            installationSourceId = "source-url";
            installationSource = (
                <input id={installationSourceId} className="form-control"
                    type="text"
                    minLength={1}
                    placeholder={_("Remote URL")}
                    value={this.state.source}
                    onChange={this.onChangedEventValue.bind(this, 'source')} />
            );
            break;
        }

        const validationFailed = this.props.vmParams.validate && validateParams(this.props.vmParams);
        const validationStateName = validationFailed.vmName ? 'error' : undefined;
        const validationStateSource = validationFailed.source ? 'error' : undefined;

        const installationSourceVal = (
            <FormGroup validationState={validationStateSource} controlId='source'>
                {installationSource}
                { validationStateSource == 'error' &&
                <HelpBlock>
                    <p className="text-danger">{validationFailed.source}</p>
                </HelpBlock> }
            </FormGroup>
        );

        return (
            <form className="ct-form-layout">
                <label className="control-label" htmlFor="connection">
                    {_("Connection")}
                </label>
                <MachinesConnectionSelector id='connection'
                    dialogValues={this.state}
                    onValueChanged={this.onChangedValue}
                    loggedUser={this.props.loggedUser} />

                <hr />

                <label className="control-label" htmlFor="vm-name">
                    {_("Name")}
                </label>
                <FormGroup validationState={validationStateName} controlId='name'>
                    <input id='vm-name' className='form-control'
                           type='text'
                           minLength={1}
                           value={this.state.vmName || ''}
                           placeholder={_("Unique name")}
                           onChange={this.onChangedEventValue.bind(this, 'vmName')} />
                    { validationStateName == 'error' &&
                    <HelpBlock>
                        <p className="text-danger">{validationFailed.vmName}</p>
                    </HelpBlock> }
                </FormGroup>

                <hr />

                <label className="control-label" htmlFor="source-type">
                    {_("Installation Source Type")}
                </label>
                <Select.Select id="source-type"
                               initial={this.state.sourceType}
                               onChange={this.onChangedValue.bind(this, 'sourceType')}>
                    <Select.SelectEntry data={LOCAL_INSTALL_MEDIA_SOURCE}
                                        key={LOCAL_INSTALL_MEDIA_SOURCE}>{_("Local Install Media")}</Select.SelectEntry>
                    <Select.SelectEntry data={URL_SOURCE} key={URL_SOURCE}>{_("URL")}</Select.SelectEntry>
                    { this.props.providerName == 'LibvirtDBus' &&
                    <Select.SelectEntry data={PXE_SOURCE} key={PXE_SOURCE}>{_("Network Boot (PXE)")}</Select.SelectEntry> }
                    <Select.SelectEntry data={EXISTING_DISK_IMAGE_SOURCE} key={EXISTING_DISK_IMAGE_SOURCE}>{_("Existing Disk Image")}</Select.SelectEntry>
                </Select.Select>

                <label className="control-label" htmlFor={installationSourceId}>
                    {_("Installation Source")}
                </label>
                {installationSourceVal}

                <hr />
                <label className="control-label" htmlFor="vendor-select">
                    {_("OS Vendor")}
                </label>
                <Select.Select id="vendor-select"
                               initial={this.state.vendor}
                               onChange={this.onChangedValue.bind(this, 'vendor')}>
                    {vendorSelectEntries}
                </Select.Select>

                <label className="control-label" htmlFor="vendor-select">
                    {_("Operating System")}
                </label>
                <Select.StatelessSelect id="system-select"
                                        selected={this.state.os}
                                        onChange={this.onChangedValue.bind(this, 'os')}>
                    {osEntries}
                </Select.StatelessSelect>

                <hr />

                <MemorySelectRow label={_("Memory")}
                                 id={"memory-size"}
                                 value={this.state.memorySize}
                                 initialUnit={this.state.memorySizeUnit}
                                 onValueChange={this.onChangedEventValue.bind(this, 'memorySize')}
                                 onUnitChange={this.onChangedValue.bind(this, 'memorySizeUnit')} />

                {this.state.sourceType != EXISTING_DISK_IMAGE_SOURCE &&
                <MemorySelectRow label={_("Storage Size")}
                                 id={"storage-size"}
                                 value={this.state.storageSize}
                                 initialUnit={this.state.storageSizeUnit}
                                 onValueChange={this.onChangedEventValue.bind(this, 'storageSize')}
                                 onUnitChange={this.onChangedValue.bind(this, 'storageSizeUnit')} />}

                <hr />

                <label className="checkbox-inline">
                    <input id="start-vm" type="checkbox"
                           checked={this.state.startVm}
                           onChange={this.onChangedEventChecked.bind(this, 'startVm')} />
                    {_("Immediately Start VM")}
                </label>
            </form>
        );
    }
}

CreateVM.propTypes = {
    valuesChanged: PropTypes.func.isRequired,
    vmParams: PropTypes.object.isRequired,
    vendorMap: PropTypes.object.isRequired,
    familyMap: PropTypes.object.isRequired,
    familyList: PropTypes.array.isRequired,
    loggedUser: PropTypes.object.isRequired,
};

function validateParams(vmParams) {
    let validationFailed = {};

    if (isEmpty(vmParams.vmName.trim())) {
        validationFailed['vmName'] = _("Name should not be empty");
    }

    let source = vmParams.source ? vmParams.source.trim() : null;

    if (!isEmpty(source)) {
        switch (vmParams.sourceType) {
        case PXE_SOURCE:
            break;
        case LOCAL_INSTALL_MEDIA_SOURCE:
        case EXISTING_DISK_IMAGE_SOURCE:
            if (!vmParams.source.startsWith("/")) {
                validationFailed['source'] = _("Invalid filename");
            }
            break;
        case URL_SOURCE:
        default:
            if (!vmParams.source.startsWith("http") &&
                !vmParams.source.startsWith("ftp") &&
                !vmParams.source.startsWith("nfs")) {
                validationFailed['source'] = _("Source should start with http, ftp or nfs protocol");
            }
            break;
        }
    } else {
        validationFailed['source'] = _("Installation Source should not be empty");
    }

    return validationFailed;
}

class CreateVmModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            'inProgress': false,
            'validate': false,
            'vmName': '',
            'connectionName': LIBVIRT_SYSTEM_CONNECTION,
            "sourceType": LOCAL_INSTALL_MEDIA_SOURCE,
            'source': '',
            'vendor': NOT_SPECIFIED,
            "os": OTHER_OS_SHORT_ID,
            'memorySize': 1024, // MiB
            'storageSize': 10, // GiB
            'startVm': false,
        };
        this.onValueChanged = this.onValueChanged.bind(this);
        this.onCreateClicked = this.onCreateClicked.bind(this);
    }

    onValueChanged(key, value) {
        const stateDelta = { [key]: value };
        this.setState(stateDelta);
    }

    onCreateClicked() {
        const { dispatch } = this.props;
        const vmParams = this.state;

        if (Object.getOwnPropertyNames(validateParams(vmParams)).length > 0) {
            this.setState({ inProgress: false, validate: true });
        } else {
            // leave dialog open to show immediate errors from the backend
            // close the dialog after VMS_CONFIG.LeaveCreateVmDialogVisibleAfterSubmit
            // then show errors in the notification area
            this.setState({ inProgress: true });
            return timeoutedPromise(
                dispatch(createVm(vmParams)),
                VMS_CONFIG.LeaveCreateVmDialogVisibleAfterSubmit,
                () => this.props.close(),
                (exception) => {
                    dispatch(addErrorNotification({
                        message: cockpit.format(_("Creation of vm $0 failed"), vmParams.vmName),
                        description: exception,
                    }));
                    this.props.close();
                });
        }
    }

    render() {
        const { osInfoList, loggedUser } = this.props;
        const vendors = prepareVendors(osInfoList);
        const vmParams = this.state;
        const dialogBody = (
            <CreateVM vmParams={vmParams}
                familyList={vendors.familyList}
                familyMap={vendors.familyMap}
                networks={this.props.networks}
                nodeDevices={this.props.nodeDevices}
                vendorMap={vendors.vendorMap}
                valuesChanged={this.onValueChanged}
                loggedUser={loggedUser}
                providerName={this.props.providerName} />
        );

        return (
            <Modal id='create-vm-dialog' show onHide={ this.props.close }>
                <Modal.Header>
                    <Modal.CloseButton onClick={ this.props.close } />
                    <Modal.Title> {`Create New Virtual Machine`} </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {dialogBody}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.inProgress && <div className="spinner spinner-sm pull-left" />}
                    <Button bsStyle='default' className='btn-cancel' onClick={ this.props.close }>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary' onClick={this.onCreateClicked}>
                        {_("Create")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

export class CreateVmAction extends React.Component {
    constructor(props) {
        super(props);
        this.state = { showModal: false };
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
    }

    // That will stop any state setting on unmounted/unmounting components
    componentWillUnmount() {
        this.isClosed = true;
    }

    close() {
        !this.isClosed && this.setState({ showModal: false });
    }

    open() {
        !this.isClosed && this.setState({ showModal: true });
    }

    render() {
        return (
            <React.Fragment>
                <Button className="pull-right" id="create-new-vm" bsStyle='default' onClick={this.open} >
                    {_("Create VM")}
                </Button>
                { this.state.showModal &&
                <CreateVmModal
                    providerName={this.props.providerName}
                    close={this.close} dispatch={this.props.dispatch}
                    networks={this.props.networks}
                    nodeDevices={this.props.nodeDevices}
                    osInfoList={this.props.systemInfo.osInfoList}
                    loggedUser={this.props.systemInfo.loggedUser} /> }
            </React.Fragment>
        );
    }
}
