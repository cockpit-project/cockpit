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
import { Button, FormGroup, HelpBlock, Modal, OverlayTrigger, Tooltip, TypeAheadSelect } from 'patternfly-react';

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
    LIBVIRT_SESSION_CONNECTION,
} from "../../helpers.js";
import {
    getPXEInitialNetworkSource,
    getPXENetworkRows,
    getVirtualNetworkByName,
    getVirtualNetworkPXESupport
} from './pxe-helpers.js';

import {
    autodetectOS,
    compareDates,
    correctSpecialCases,
    filterReleaseEolDates,
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

const permission = cockpit.permission({ admin: true });

/* Returns pool's available space
 * Pool needs to be referenced by it's name or path.
 *
 * @param {array} storagePools
 * @param {string} poolName
 * @param {string} poolPath
 * @param {string} connectionName
 * @returns {number}
 */
function getPoolSpaceAvailable({ storagePools, poolName, poolPath, connectionName }) {
    storagePools = storagePools.filter(pool => pool.connectionName === connectionName);

    let storagePool;
    if (poolName)
        storagePool = storagePools.find(pool => pool.name === poolName);
    else if (poolPath)
        storagePool = storagePools.find(pool => pool.target.path === poolPath);

    return storagePool ? storagePool.available : undefined;
}

/* Returns available space of default storage pool
 *
 * First it tries to find storage pool called "default"
 * If there is none, a pool with path "/var/lib/libvirt/images" (system connection)
 * or "~/.local/share/libvirt/images" (session connection)
 * If no default pool could be found, virt-install will create a pool named "default",
 * whose available space we cannot predict
 * see: virtinstall/storage.py - StoragePool.build_default_pool()
 *
 * @param {array} storagePools
 * @param {string} connectionName
 * @returns {number}
 */
function getSpaceAvailable(storagePools, connectionName) {
    let space = getPoolSpaceAvailable({ storagePools, poolName: "default", connectionName });

    if (!space) {
        let poolPath;
        if (connectionName === LIBVIRT_SYSTEM_CONNECTION)
            poolPath = "/var/lib/libvirt/images";
        else if (permission.user)
            poolPath = permission.user.home + "/.local/share/libvirt/images";

        space = getPoolSpaceAvailable({ storagePools, poolPath, connectionName });
    }

    return space;
}

function validateParams(vmParams) {
    let validationFailed = {};

    if (isEmpty(vmParams.vmName.trim())) {
        validationFailed['vmName'] = _("Name should not be empty");
    }

    // If we select installation media from URL force the user to select
    // OS, since virt-install will not detect the OS, in case we don't choose
    // to start the guest immediately.
    if (vmParams.os == undefined && vmParams.sourceType == URL_SOURCE && !vmParams.startVm)
        validationFailed['os'] = _("You need to select the most closely matching Operating System");

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

    if (vmParams.memorySize === 0) {
        validationFailed['memory'] = _("Memory must not be 0");
    } else {
        if (vmParams.os &&
            vmParams.os['minimumResources']['ram'] &&
            (convertToUnit(vmParams.memorySize, vmParams.memorySizeUnit, units.B) < vmParams.os['minimumResources']['ram'])) {
            validationFailed['memory'] = (
                cockpit.format(
                    _("The selected Operating System has minimum memory requirement of $0 $1"),
                    convertToUnit(vmParams.os['minimumResources']['ram'], units.B, vmParams.memorySizeUnit),
                    vmParams.memorySizeUnit)
            );
        }
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

const SourceRow = ({ connectionName, source, sourceType, networks, nodeDevices, providerName, onValueChanged, validationFailed }) => {
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
                superuser="try" />
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
                <Select.SelectEntry title={connectionName == 'session' ? _("Network Boot is available only when using System connection") : null}
                    disabled={connectionName == 'session'}
                    data={PXE_SOURCE}
                    key={PXE_SOURCE}>{_("Network Boot (PXE)")}
                </Select.SelectEntry>}
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

class OSRow extends React.Component {
    constructor(props) {
        super(props);
        const IGNORE_VENDORS = ['ALTLinux', 'Mandriva', 'GNOME Project'];
        const osInfoListExt = this.props.osInfoList
                .map(os => correctSpecialCases(os))
                .filter(os => filterReleaseEolDates(os) && !IGNORE_VENDORS.find(vendor => vendor == os.vendor))
                .sort((a, b) => {
                    if (a.vendor == b.vendor)
                        if (a.releaseDate || b.releaseDate)
                            return compareDates(a.releaseDate, b.releaseDate, true) > 0;
                        else
                            return a.version < b.version;
                    else
                        return getOSStringRepresentation(a).toLowerCase() > getOSStringRepresentation(b).toLowerCase();
                });

        this.state = {
            typeAheadKey: Math.random(),
            osEntries: osInfoListExt,
        };
    }

    render() {
        const { os, onValueChanged, isLoading, validationFailed } = this.props;
        const validationStateOS = validationFailed.os ? 'error' : undefined;
        const filterByFields = ['shortId', 'displayName'];

        return (
            <React.Fragment>
                <label className="control-label" htmlFor='os-select'>
                    {_("Operating System")}
                </label>
                <FormGroup validationState={validationStateOS} bsClass='form-group ct-validation-wrapper'>
                    <TypeAheadSelect
                        key={this.state.typeAheadKey}
                        id='os-select'
                        labelKey='displayName'
                        selected={os != undefined ? [getOSStringRepresentation(os)] : []}
                        isLoading={isLoading}
                        placeholder={_("Choose an operating system")}
                        paginate={false}
                        maxResults={500}
                        onKeyDown={ev => {
                            ev.persist();
                            ev.nativeEvent.stopImmediatePropagation();
                            ev.stopPropagation();
                        }}
                        onChange={value => value[0] && onValueChanged('os', this.state.osEntries.find(os => getOSStringRepresentation(os) == value[0].displayName))}
                        onBlur={() => {
                            if (!this.state.osEntries.find(os => getOSStringRepresentation(os) == os)) {
                                this.setState({ typeAheadKey: Math.random() });
                            }
                        }}
                        filterBy={filterByFields}
                        options={this.state.osEntries.map(os => ({ 'displayName': getOSStringRepresentation(os), 'shortId': os.shortId }))} />
                    { validationFailed.os && os == undefined &&
                    <HelpBlock>
                        <p className="text-danger">{validationFailed.os}</p>
                    </HelpBlock> }
                </FormGroup>
            </React.Fragment>
        );
    }
}

const MemoryRow = ({ memorySize, memorySizeUnit, nodeMaxMemory, recommendedMemory, onValueChanged, validationFailed }) => {
    const validationStateMemory = validationFailed.memory ? 'error' : undefined;
    let recommendedMemoryHelpBlock = null;
    if (recommendedMemory && recommendedMemory > memorySize) {
        recommendedMemoryHelpBlock = <p>{cockpit.format(
            "The selected Operating System has recommended memory $0 $1",
            recommendedMemory, memorySizeUnit)}</p>;
    }

    return (
        <React.Fragment>
            <label htmlFor='memory-size' className='control-label'>
                {_("Memory")}
            </label>
            <FormGroup validationState={validationStateMemory} bsClass='form-group ct-validation-wrapper' controlId='memory'>
                <MemorySelectRow id='memory-size'
                    value={memorySize}
                    maxValue={nodeMaxMemory && convertToUnit(nodeMaxMemory, units.KiB, memorySizeUnit)}
                    initialUnit={memorySizeUnit}
                    onValueChange={e => onValueChanged('memorySize', e.target.value)}
                    onUnitChange={value => onValueChanged('memorySizeUnit', value)} />
                <HelpBlock id="memory-size-helpblock">
                    {validationStateMemory === "error" && <p>{validationFailed.memory}</p>}
                    {recommendedMemoryHelpBlock}
                    {nodeMaxMemory && <p> {cockpit.format(
                        _("Up to $0 $1 available on the host"),
                        Math.floor(convertToUnit(nodeMaxMemory, units.KiB, memorySizeUnit)),
                        memorySizeUnit,
                    )}</p>}
                </HelpBlock>
            </FormGroup>
        </React.Fragment>
    );
};

const StorageRow = ({ connectionName, storageSize, storageSizeUnit, onValueChanged, storagePoolName, storagePools, storageVolume, vms }) => {
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

    const poolSpaceAvailable = getSpaceAvailable(storagePools, connectionName);

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
                    { storagePools.map(pool => {
                        if (pool.volumes && pool.volumes.length)
                            return <Select.SelectEntry data={pool.name} key={pool.name}>{pool.name}</Select.SelectEntry>;
                    })}
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
                <FormGroup bsClass='ct-validation-wrapper' controlId='storage'>
                    <MemorySelectRow id={"storage-size"}
                        value={storageSize}
                        maxValue={poolSpaceAvailable && convertToUnit(poolSpaceAvailable, units.B, storageSizeUnit)}
                        initialUnit={storageSizeUnit}
                        onValueChange={e => onValueChanged('storageSize', e.target.value)}
                        onUnitChange={value => onValueChanged('storageSizeUnit', value)} />
                    {poolSpaceAvailable &&
                    <HelpBlock id="storage-size-helpblock">
                        {cockpit.format(
                            _("Up to $0 $1 available in the default location"),
                            Math.floor(convertToUnit(poolSpaceAvailable, units.B, storageSizeUnit)),
                            storageSizeUnit,
                        )}
                    </HelpBlock>}
                </FormGroup>
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
            os: undefined,
            memorySize: Math.min(convertToUnit(1024, units.MiB, units.GiB), // tied to Unit
                                 Math.floor(convertToUnit(props.nodeMaxMemory, units.KiB, units.GiB))),
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
        case 'source':
            this.setState({ [key]: value });

            if ((this.state.sourceType == URL_SOURCE || this.state.sourceType == LOCAL_INSTALL_MEDIA_SOURCE) && value != '' && value != undefined) {
                // Clears the previously set timer.
                clearTimeout(this.typingTimeout);

                const onOsAutodetect = (os) => {
                    this.setState({ autodetectOSInProgress: true });
                    autodetectOS(os)
                            .then(res => {
                                const osEntry = this.props.osInfoList.filter(osEntry => osEntry.id == res);

                                if (osEntry && osEntry[0]) {
                                    this.setState({
                                        os: osEntry[0],
                                        autodetectOSInProgress: false,
                                    });
                                }
                            }, ex => {
                                console.log("osinfo-detect command failed: ", ex.message);
                                this.setState({
                                    autodetectOSInProgress: false,
                                });
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
            const storagePool = this.props.storagePools.filter(pool => pool.connectionName === this.state.connectionName).find(pool => pool.name === value);
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
                Math.floor(convertToUnit(this.props.nodeMaxMemory, units.KiB, this.state.memorySizeUnit))
            );
            this.setState({ [key]: value });
            break;
        case 'storageSize': {
            const storagePools = this.props.storagePools.filter(pool => pool.connectionName === this.state.connectionName);
            const spaceAvailable = getSpaceAvailable(storagePools, this.state.connectionName);
            if (spaceAvailable) {
                value = Math.min(
                    value,
                    Math.floor(convertToUnit(spaceAvailable, units.B, this.state.storageSizeUnit))
                );
            }
            this.setState({ [key]: value });
            value = convertToUnit(value, this.state.storageSizeUnit, units.GiB);
            break;
        }
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
            if (this.state.sourceType == PXE_SOURCE && value == LIBVIRT_SESSION_CONNECTION) {
                // When changing to session connection, reset media source
                this.onValueChanged('sourceType', LOCAL_INSTALL_MEDIA_SOURCE);
            }

            // specific storage pool is selected
            if (this.state.storagePool !== "NewVolume" && this.state.storagePool !== "NoStorage") {
                // storage pools are different for each connection, so we set storagePool value to default (newVolume)
                this.setState({ storagePool: "NewVolume" });
            }
            break;
        default:
            this.setState({ [key]: value });
            break;
        }
    }

    onCreateClicked() {
        const { dispatch } = this.props;

        if (Object.getOwnPropertyNames(validateParams({ ...this.state, osInfoList: this.props.osInfoList })).length > 0) {
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
                os: this.state.os ? this.state.os.shortId : 'auto',
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
        const validationFailed = this.state.validate && validateParams({ ...this.state, osInfoList });
        let recommendedMemory;
        if (this.state.os && this.state.os['recommendedResources']['ram'])
            recommendedMemory = convertToUnit(this.state.os['recommendedResources']['ram'], units.B, this.state.memorySizeUnit);

        const dialogBody = (
            <form className="ct-form">
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
                    connectionName={this.state.connectionName}
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
                        connectionName={this.state.connectionName}
                        storageSize={this.state.storageSize}
                        storageSizeUnit={this.state.storageSizeUnit}
                        onValueChanged={this.onValueChanged}
                        storagePoolName={this.state.storagePool}
                        storagePools={storagePools.filter(pool => pool.connectionName === this.state.connectionName)}
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
                    validationFailed={validationFailed}
                    recommendedMemory={recommendedMemory}
                />

                <hr />

                <OSRow
                    os={this.state.os}
                    osInfoList={this.props.osInfoList}
                    onValueChanged={this.onValueChanged}
                    isLoading={this.state.autodetectOSInProgress}
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
                    <Button bsStyle='primary'
                            disabled={Object.getOwnPropertyNames(validationFailed).length > 0}
                            onClick={this.onCreateClicked}>
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
        this.state = { virtInstallAvailable: undefined };
    }

    componentWillMount() {
        cockpit.spawn(['which', 'virt-install'], { err: 'message' })
                .then(() => this.setState({ virtInstallAvailable: true })
                    , () => this.setState({ virtInstallAvailable: false }));
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
        if (this.state.virtInstallAvailable == undefined)
            return null;

        let createButton = (
            <Button disabled={!this.props.systemInfo.osInfoList || !this.state.virtInstallAvailable} className="pull-right" id="create-new-vm" bsStyle='default' onClick={this.open} >
                {_("Create VM")}
            </Button>
        );
        if (!this.state.virtInstallAvailable)
            createButton = (
                <OverlayTrigger overlay={ <Tooltip id='virt-install-not-available-tooltip'>{ _("virt-install package needs to be installed on the system in order to create new VMs") }</Tooltip> } placement='top'>
                    {createButton}
                </OverlayTrigger>
            );

        return (
            <React.Fragment>
                { createButton }
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
CreateVmAction.defaultProps = {
    nodeMaxMemory: 1048576, // 1GiB
};
