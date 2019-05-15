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
import {
    isEmpty,
    convertToUnit,
    timeoutedPromise,
    units,
    getStorageVolumesUsage,
    LIBVIRT_SYSTEM_CONNECTION,
} from "../../helpers.js";
import {
    getPXEInitialNetworkSource,
    getPXENetworkRows,
    getVirtualNetworkByName,
    getVirtualNetworkPXESupport
} from './pxe-helpers.js';

import {
    autodetectOS,
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

/**
 * Returns an array of storage pools, filtered by connection and presence of volumes
 *
 * @param {array} storagePools
 * @param {string} connectionName
 * @returns {array}
 */
function filterStoragePools(storagePools, connectionName) {
    return storagePools.filter(pool => pool.volumes &&
                                       pool.volumes.length &&
                                       pool.connectionName === connectionName);
}

function validateParams(vmParams) {
    let validationFailed = {};

    if (isEmpty(vmParams.vmName.trim())) {
        validationFailed['vmName'] = _("Name should not be empty");
    }

    // If we select installation media from URL force the user to select
    // OS, since virt-install will not detect the OS, in case we don't choose
    // to start the guest immediately.
    if (vmParams.vendor == NOT_SPECIFIED && vmParams.sourceType == URL_SOURCE && !vmParams.startVm)
        validationFailed['vendor'] = _("You need to select the most closely matching OS vendor and Operating System");

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

const NameRow = ({ vmName, onValueChanged, validationFailed }) => {
    const validationStateName = validationFailed.vmName ? 'error' : undefined;

    return (
        <React.Fragment>
            <label className="control-label" htmlFor="vm-name">
                {_("Name")}
            </label>
            <FormGroup validationState={validationStateName} controlId='name'>
                <input id='vm-name' className='form-control'
                    type='text'
                    minLength={1}
                    value={vmName || ''}
                    placeholder={_("Unique name")}
                    onChange={e => onValueChanged('vmName', e.target.value)} />
                { validationStateName == 'error' &&
                <HelpBlock>
                    <p className="text-danger">{validationFailed.vmName}</p>
                </HelpBlock> }
            </FormGroup>
        </React.Fragment>
    );
};

const SourceRow = ({ source, sourceType, networks, nodeDevices, providerName, onValueChanged, validationFailed }) => {
    let installationSource;
    let installationSourceId;
    let installationSourceWarning;
    const validationStateSource = validationFailed.source ? 'error' : undefined;

    switch (sourceType) {
    case LOCAL_INSTALL_MEDIA_SOURCE:
        installationSourceId = "source-file";
        installationSource = (
            <FileAutoComplete id={installationSourceId}
                placeholder={_("Path to ISO file on host's file system")}
                onChange={value => onValueChanged('source', value)}
                superUser="try" />
        );
        break;
    case EXISTING_DISK_IMAGE_SOURCE:
        installationSourceId = "source-disk";
        installationSource = (
            <FileAutoComplete id={installationSourceId}
                placeholder={_("Existing disk image on host's file system")}
                onChange={value => onValueChanged('source', value)}
                superuser="try" />
        );
        break;
    case PXE_SOURCE:
        installationSourceId = "network";
        if (source && source.includes('type=direct')) {
            installationSourceWarning = _("In most configurations, macvtap does not work for host to guest network communication.");
        } else if (source && source.includes('network=')) {
            let netObj = getVirtualNetworkByName(source.split('network=')[1],
                                                 networks);

            if (!netObj || !getVirtualNetworkPXESupport(netObj))
                installationSourceWarning = _("Network Selection does not support PXE.");
        }

        installationSource = (
            <React.Fragment>
                <Select.StatelessSelect id="network-select"
                    selected={source || 'no-resource'}
                    onChange={value => onValueChanged('source', value)}>
                    {getPXENetworkRows(nodeDevices, networks)}
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
                value={source}
                onChange={e => onValueChanged('source', e.target.value)} />
        );
        break;
    }

    return (
        <React.Fragment>
            <label className="control-label" htmlFor="source-type">
                {_("Installation Source Type")}
            </label>
            <Select.Select id="source-type"
                initial={sourceType}
                onChange={value => onValueChanged('sourceType', value)}>
                <Select.SelectEntry data={LOCAL_INSTALL_MEDIA_SOURCE}
                    key={LOCAL_INSTALL_MEDIA_SOURCE}>{_("Local Install Media")}</Select.SelectEntry>
                <Select.SelectEntry data={URL_SOURCE} key={URL_SOURCE}>{_("URL")}</Select.SelectEntry>
                { providerName == 'LibvirtDBus' &&
                <Select.SelectEntry data={PXE_SOURCE} key={PXE_SOURCE}>{_("Network Boot (PXE)")}</Select.SelectEntry> }
                <Select.SelectEntry data={EXISTING_DISK_IMAGE_SOURCE} key={EXISTING_DISK_IMAGE_SOURCE}>{_("Existing Disk Image")}</Select.SelectEntry>
            </Select.Select>

            <label className="control-label" htmlFor={installationSourceId}>
                {_("Installation Source")}
            </label>
            <FormGroup validationState={validationStateSource} controlId='source'>
                {installationSource}
                { validationStateSource == 'error' &&
                <HelpBlock>
                    <p className="text-danger">{validationFailed.source}</p>
                </HelpBlock> }
            </FormGroup>
        </React.Fragment>
    );
};

const OSRow = ({ vendor, osInfoList, os, vendors, onValueChanged, validationFailed }) => {
    const validationStateOsVendor = validationFailed.vendor ? 'error' : undefined;
    const familyList = vendors.familyList;
    const familyMap = vendors.familyMap;
    const vendorMap = vendors.vendorMap;
    const vendorSelectEntries = [];

    if (familyMap[DIVIDER_FAMILY]) {
        vendorSelectEntries.push((
            <Select.SelectEntry data={NOT_SPECIFIED} key={NOT_SPECIFIED}>{_(NOT_SPECIFIED)}</Select.SelectEntry>));
        vendorSelectEntries.push((<Select.SelectDivider key='divider' />));
    }

    familyList.forEach(({ family, vendors }) => {
        if (family === DIVIDER_FAMILY) {
            return;
        }

        vendorSelectEntries.push(
            <optgroup key={family} label={family}>
                { vendors.map(vendor => <Select.SelectEntry data={vendor} key={vendor}>{vendor}</Select.SelectEntry>) }
            </optgroup>);
    });

    const osEntries = (
        vendorMap[vendor]
                .map(os => (
                    <Select.SelectEntry data={os.shortId} key={os.shortId}>
                        {getOSStringRepresentation(os)}
                    </Select.SelectEntry>))
    );

    return (
        <React.Fragment>
            <label className="control-label" htmlFor="vendor-select">
                {_("OS Vendor")}
            </label>
            <FormGroup validationState={validationStateOsVendor} bsClass='form-group ct-validation-wrapper'>
                <Select.Select id="vendor-select"
                    initial={vendor}
                    onChange={value => onValueChanged('vendor', value)}>
                    {vendorSelectEntries}
                </Select.Select>
                { validationFailed.vendor && vendor == NOT_SPECIFIED &&
                <HelpBlock>
                    <p className="text-danger">{validationFailed.vendor}</p>
                </HelpBlock> }
            </FormGroup>

            <label className="control-label" htmlFor="vendor-select">
                {_("Operating System")}
            </label>
            <Select.StatelessSelect id="system-select"
                selected={os}
                onChange={value => onValueChanged('os', value)}>
                {osEntries}
            </Select.StatelessSelect>
        </React.Fragment>
    );
};

const MemoryRow = ({ memorySize, memorySizeUnit, nodeMaxMemory, onValueChanged }) => {
    return (
        <React.Fragment>
            <label htmlFor='memory-size' className='control-label'>
                {_("Memory")}
            </label>
            <FormGroup bsClass='ct-validation-wrapper' controlId='memory'>
                <MemorySelectRow id='memory-size'
                    value={memorySize}
                    maxValue={nodeMaxMemory && convertToUnit(nodeMaxMemory, units.KiB, memorySizeUnit)}
                    initialUnit={memorySizeUnit}
                    onValueChange={e => onValueChanged('memorySize', e.target.value)}
                    onUnitChange={value => onValueChanged('memorySizeUnit', value)} />
                {nodeMaxMemory &&
                <HelpBlock>
                    {cockpit.format(
                        _("Up to $0 $1 available on the host"),
                        Math.round(convertToUnit(nodeMaxMemory, units.KiB, memorySizeUnit)),
                        memorySizeUnit,
                    )}
                </HelpBlock>}
            </FormGroup>
        </React.Fragment>
    );
};

const StorageRow = ({ storageSize, storageSizeUnit, onValueChanged, storagePoolName, storagePools, storageVolume, vms }) => {
    let volumeEntries;
    let isVolumeUsed = {};
    // Existing storage pool is chosen
    if (storagePoolName !== "NewVolume" && storagePoolName !== "NoStorage") {
        const storagePool = storagePools.find(pool => pool.name === storagePoolName);

        isVolumeUsed = getStorageVolumesUsage(vms, storagePool);
        volumeEntries = (
            storagePool.volumes.map(vol => <Select.SelectEntry data={vol.name} key={vol.name}>{vol.name}</Select.SelectEntry>)
        );
    }

    return (
        <React.Fragment>
            <label className="control-label" htmlFor="storage-pool-select">
                {_("Storage")}
            </label>
            <Select.Select id="storage-pool-select"
                           initial={storagePoolName}
                           onChange={e => onValueChanged('storagePool', e)}>
                <Select.SelectEntry data="NewVolume" key="NewVolume">{"Create New Volume"}</Select.SelectEntry>
                <Select.SelectEntry data="NoStorage" key="NoStorage">{"No Storage"}</Select.SelectEntry>
                <Select.SelectDivider />
                <optgroup key="Storage Pools" label="Storage Pools">
                    { storagePools.map(pool => <Select.SelectEntry data={pool.name} key={pool.name}>{pool.name}</Select.SelectEntry>)}
                </optgroup>
            </Select.Select>

            { storagePoolName !== "NewVolume" &&
            storagePoolName !== "NoStorage" &&
            <React.Fragment>
                <label className="control-label" htmlFor="storage-volume-select">
                    {_("Volume")}
                </label>
                <Select.Select id="storage-volume-select"
                               initial={storageVolume}
                               onChange={e => onValueChanged('storageVolume', e)}>
                    {volumeEntries}
                </Select.Select>

                { isVolumeUsed[storageVolume] && isVolumeUsed[storageVolume].length > 0 &&
                <HelpBlock>
                    <p className="text-warning">{_("This volume is already used by another VM.")}</p>
                </HelpBlock> }
            </React.Fragment> }

            { storagePoolName === "NewVolume" &&
            <React.Fragment>
                <label htmlFor='storage-size' className='control-label'>
                    {_("Size")}
                </label>
                <MemorySelectRow id={"storage-size"}
                    value={storageSize}
                    initialUnit={storageSizeUnit}
                    onValueChange={e => onValueChanged('storageSize', e.target.value)}
                    onUnitChange={value => onValueChanged('storageSizeUnit', value)} />
            </React.Fragment> }
        </React.Fragment>
    );
};

class CreateVmModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            inProgress: false,
            validate: false,
            vmName: '',
            connectionName: LIBVIRT_SYSTEM_CONNECTION,
            sourceType: LOCAL_INSTALL_MEDIA_SOURCE,
            source: '',
            vendor: NOT_SPECIFIED,
            vendors: prepareVendors(props.osInfoList),
            os: OTHER_OS_SHORT_ID,
            memorySize: convertToUnit(1024, units.MiB, units.GiB), // tied to Unit
            memorySizeUnit: units.GiB.name,
            storageSize: 10, // GiB
            storageSizeUnit: units.GiB.name,
            storagePool: 'NewVolume',
            storageVolume: '',
            startVm: false,
        };
        this.onCreateClicked = this.onCreateClicked.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
    }

    onValueChanged(key, value) {
        switch (key) {
        case 'vmName': {
            this.setState({ [key]: value });
            break;
        }
        case 'vendor': {
            const os = this.state.vendors.vendorMap[value][0].shortId;
            this.setState({
                [key]: value,
                os,
            });
            break;
        }
        case 'os':
            this.setState({ [key]: value });
            break;
        case 'source':
            this.setState({ [key]: value });

            if ((this.state.sourceType == URL_SOURCE || this.state.sourceType == LOCAL_INSTALL_MEDIA_SOURCE) && this.state.vendor == NOT_SPECIFIED && value != '' && value != undefined) {
                // Clears the previously set timer.
                clearTimeout(this.typingTimeout);

                const onOsAutodetect = (os) => {
                    autodetectOS(os)
                            .fail(ex => console.log("osinfo-detect command failed: ", ex.message))
                            .then(res => {
                                const osEntry = this.props.osInfoList.filter(osEntry => osEntry.id == res);

                                if (osEntry && osEntry[0]) {
                                    this.setState({
                                        vendor: osEntry[0].vendor,
                                        os: osEntry[0].shortId
                                    });
                                }
                            });
                };
                this.typingTimeout = setTimeout(() => onOsAutodetect(value), 250);
            }
            break;
        case 'sourceType':
            this.setState({ [key]: value });
            if (value == PXE_SOURCE) {
                let initialPXESource = getPXEInitialNetworkSource(this.props.nodeDevices.filter(nodeDevice => nodeDevice.connectionName == this.state.connectionName),
                                                                  this.props.networks.filter(network => network.connectionName == this.state.connectionName));
                this.setState({ source: initialPXESource });
            } else if (this.state.sourceType == PXE_SOURCE && value != PXE_SOURCE) {
                // Reset the source when the previous selection was PXE;
                // all the other choices are string set by the user
                this.setState({ source: '' });
            }
            break;
        case 'storagePool': {
            const storagePool = filterStoragePools(this.props.storagePools, this.state.connectionName).find(pool => pool.name === value);
            const storageVolumes = storagePool ? storagePool.volumes : undefined;
            const storageVolume = storageVolumes ? storageVolumes[0] : undefined;
            this.setState({
                [key]: value,
                storageVolume: storageVolume ? storageVolume.name : undefined,
            });
            break;
        }
        case 'storageVolume':
            this.setState({ [key]: value });
            break;
        case 'memorySize':
            value = Math.min(
                value,
                Math.round(convertToUnit(this.props.nodeMaxMemory, units.KiB, this.state.memorySizeUnit))
            );
            this.setState({ [key]: value });
            break;
        case 'storageSize':
            this.setState({ [key]: value });
            value = convertToUnit(value, this.state.storageSizeUnit, units.GiB);
            break;
        case 'memorySizeUnit':
            this.setState({ [key]: value });
            key = 'memorySize';
            value = convertToUnit(this.state.memorySize, this.state.memorySizeUnit, value);
            this.setState({ [key]: value });
            break;
        case 'storageSizeUnit':
            this.setState({ [key]: value });
            key = 'storageSize';
            value = convertToUnit(this.state.storageSize, this.state.storageSizeUnit, value);
            this.setState({ [key]: value });
            break;
        case 'startVm': {
            this.setState({ [key]: value });
            break;
        }
        case 'connectionName':
            this.setState({ [key]: value });
            if (this.state.sourceType == PXE_SOURCE) {
                // If the installation source mode is PXE refresh the list of available networks
                this.onValueChanged('sourceType', PXE_SOURCE);
            }

            // specific storage pool is selected
            if (this.state.storagePool !== "NewVolume" && this.state.storagePool !== "NoStorage") {
                // storage pools are different for each connection, so we set storagePool value to default (newVolume)
                this.setState({ storagePool: "NewVolume" });
            }
            break;
        default:
            break;
        }
    }

    onCreateClicked() {
        const { dispatch } = this.props;

        if (Object.getOwnPropertyNames(validateParams(this.state)).length > 0) {
            this.setState({ inProgress: false, validate: true });
        } else {
            // leave dialog open to show immediate errors from the backend
            // close the dialog after VMS_CONFIG.LeaveCreateVmDialogVisibleAfterSubmit
            // then show errors in the notification area
            this.setState({ inProgress: true });

            const vmParams = {
                connectionName: this.state.connectionName,
                vmName: this.state.vmName,
                source: this.state.source,
                sourceType: this.state.sourceType,
                os: this.state.os,
                memorySize: convertToUnit(this.state.memorySize, this.state.memorySizeUnit, units.MiB),
                storageSize: convertToUnit(this.state.storageSize, this.state.storageSizeUnit, units.GiB),
                storagePool: this.state.storagePool,
                storageVolume: this.state.storageVolume,
                startVm: this.state.startVm,
            };

            return timeoutedPromise(
                dispatch(createVm(vmParams)),
                VMS_CONFIG.LeaveCreateVmDialogVisibleAfterSubmit,
                () => this.props.close(),
                (exception) => {
                    this.props.onAddErrorNotification({
                        text: cockpit.format(_("Creation of VM $0 failed"), vmParams.vmName),
                        detail: exception.message,
                    });
                    this.props.close();
                });
        }
    }

    render() {
        const { nodeMaxMemory, nodeDevices, networks, osInfoList, loggedUser, providerName, storagePools, vms } = this.props;
        const validationFailed = this.state.validate && validateParams(this.state);
        const dialogBody = (
            <form className="ct-form-layout">
                <label className="control-label" htmlFor="connection">
                    {_("Connection")}
                </label>
                <MachinesConnectionSelector id='connection'
                    connectionName={this.state.connectionName}
                    onValueChanged={this.onValueChanged}
                    loggedUser={loggedUser} />

                <hr />

                <NameRow
                    vmName={this.state.vmName}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed} />

                <hr />

                <SourceRow
                    networks={networks.filter(network => network.connectionName == this.state.connectionName)}
                    nodeDevices={nodeDevices.filter(nodeDevice => nodeDevice.connectionName == this.state.connectionName)}
                    providerName={providerName}
                    source={this.state.source}
                    sourceType={this.state.sourceType}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed} />

                <hr />

                { this.state.sourceType != EXISTING_DISK_IMAGE_SOURCE &&
                <React.Fragment>
                    <StorageRow
                        storageSize={this.state.storageSize}
                        storageSizeUnit={this.state.storageSizeUnit}
                        onValueChanged={this.onValueChanged}
                        storagePoolName={this.state.storagePool}
                        storagePools={filterStoragePools(storagePools, this.state.connectionName)}
                        storageVolume={this.state.storageVolume}
                        vms={vms}
                    />
                    <hr />
                </React.Fragment>}

                <MemoryRow
                    memorySize={this.state.memorySize}
                    memorySizeUnit={this.state.memorySizeUnit}
                    nodeMaxMemory={nodeMaxMemory}
                    onValueChanged={this.onValueChanged}
                />

                <hr />

                <OSRow
                    vendor={this.state.vendor}
                    vendors={this.state.vendors}
                    os={this.state.os}
                    osInfoList={osInfoList}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed} />

                <hr />

                <label className="checkbox-inline">
                    <input id="start-vm" type="checkbox"
                        checked={this.state.startVm}
                        onChange={e => this.onValueChanged('startVm', e.target.checked)} />
                    {_("Immediately Start VM")}
                </label>
            </form>
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
                <Button disabled={this.props.systemInfo.osInfoList == null} className="pull-right" id="create-new-vm" bsStyle='default' onClick={this.open} >
                    {_("Create VM")}
                </Button>
                { this.state.showModal &&
                <CreateVmModal
                    providerName={this.props.providerName}
                    close={this.close} dispatch={this.props.dispatch}
                    networks={this.props.networks}
                    nodeDevices={this.props.nodeDevices}
                    nodeMaxMemory={this.props.nodeMaxMemory}
                    storagePools={this.props.storagePools}
                    vms={this.props.vms}
                    osInfoList={this.props.systemInfo.osInfoList}
                    onAddErrorNotification={this.props.onAddErrorNotification}
                    loggedUser={this.props.systemInfo.loggedUser} /> }
            </React.Fragment>
        );
    }
}

CreateVmAction.propTypes = {
    dispatch: PropTypes.func.isRequired,
    networks: PropTypes.array.isRequired,
    nodeDevices: PropTypes.array.isRequired,
    nodeMaxMemory: PropTypes.number,
    onAddErrorNotification: PropTypes.func.isRequired,
    providerName: PropTypes.string.isRequired,
    systemInfo: PropTypes.object.isRequired,
};
