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
import { FormGroup, HelpBlock } from 'patternfly-react';
import {
    Modal,
    Select as PFSelect, SelectOption, SelectVariant,
    Button, Tooltip, TooltipPosition
} from '@patternfly/react-core';

import cockpit from 'cockpit';
import { MachinesConnectionSelector } from '../machinesConnectionSelector.jsx';
import * as CockpitSelect from "cockpit-components-select.jsx";
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
import { storagePoolRefresh } from '../../libvirt-dbus.js';
import { Password } from './password.jsx';

import './createVmDialog.scss';
import 'form-layout.scss';
import VMS_CONFIG from '../../config.js';

const _ = cockpit.gettext;

const URL_SOURCE = 'url';
const LOCAL_INSTALL_MEDIA_SOURCE = 'file';
const DOWNLOAD_AN_OS = 'os';
const EXISTING_DISK_IMAGE_SOURCE = 'disk_image';
const PXE_SOURCE = 'pxe';

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
        storagePool = storagePools.find(pool => pool.target && pool.target.path === poolPath);

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

let current_user = null;
cockpit.user().then(user => { current_user = user });

function getSpaceAvailable(storagePools, connectionName) {
    let space = getPoolSpaceAvailable({ storagePools, poolName: "default", connectionName });

    if (!space) {
        let poolPath;
        if (connectionName === LIBVIRT_SYSTEM_CONNECTION)
            poolPath = "/var/lib/libvirt/images";
        else if (current_user)
            poolPath = current_user.home + "/.local/share/libvirt/images";

        space = getPoolSpaceAvailable({ storagePools, poolPath, connectionName });
    }

    return space;
}

function validateParams(vmParams) {
    const validationFailed = {};

    if (isEmpty(vmParams.vmName.trim()))
        validationFailed.vmName = _("Name must not be empty");
    else if (vmParams.vms.some(vm => vm.name === vmParams.vmName))
        validationFailed.vmName = cockpit.format(_("VM $0 already exists"), vmParams.vmName);

    if (vmParams.os == undefined)
        validationFailed.os = _("You need to select the most closely matching operating system");

    const source = vmParams.source ? vmParams.source.trim() : null;

    if (!isEmpty(source)) {
        switch (vmParams.sourceType) {
        case PXE_SOURCE:
            break;
        case LOCAL_INSTALL_MEDIA_SOURCE:
        case EXISTING_DISK_IMAGE_SOURCE:
            if (!vmParams.source.startsWith("/")) {
                validationFailed.source = _("Invalid filename");
            }
            break;
        case URL_SOURCE:
        default:
            if (!vmParams.source.startsWith("http") &&
                !vmParams.source.startsWith("ftp") &&
                !vmParams.source.startsWith("nfs")) {
                validationFailed.source = _("Source should start with http, ftp or nfs protocol");
            }
            break;
        }
    } else if (vmParams.sourceType != DOWNLOAD_AN_OS) {
        validationFailed.source = _("Installation source must not be empty");
    }

    if (vmParams.memorySize === 0) {
        validationFailed.memory = _("Memory must not be 0");
    } else {
        if (vmParams.os &&
            vmParams.os.minimumResources.ram &&
            (convertToUnit(vmParams.memorySize, vmParams.memorySizeUnit, units.B) < vmParams.os.minimumResources.ram)) {
            validationFailed.memory = (
                cockpit.format(
                    _("The selected operating system has minimum memory requirement of $0 $1"),
                    convertToUnit(vmParams.os.minimumResources.ram, units.B, vmParams.memorySizeUnit),
                    vmParams.memorySizeUnit.name)
            );
        }
    }

    if (vmParams.sourceType != EXISTING_DISK_IMAGE_SOURCE && vmParams.storagePool === "NewVolume") {
        if (vmParams.storageSize === 0) {
            validationFailed.storage = _("Storage size must not be 0");
        } else if (vmParams.os &&
                   vmParams.os.minimumResources.storage &&
                   (convertToUnit(vmParams.storageSize, vmParams.storageSizeUnit, units.B) < vmParams.os.minimumResources.storage)) {
            validationFailed.storage = (
                cockpit.format(
                    _("The selected operating system has minimum storage size requirement of $0 $1"),
                    convertToUnit(vmParams.os.minimumResources.storage, units.B, vmParams.storageSizeUnit),
                    vmParams.storageSizeUnit.name)
            );
        }
    }
    if (vmParams.unattendedInstallation && !vmParams.rootPassword)
        validationFailed.password = _("Please set a root password");

    return validationFailed;
}

const NameRow = ({ vmName, onValueChanged, validationFailed }) => {
    const validationStateName = validationFailed.vmName ? 'error' : undefined;

    return (
        <>
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
        </>
    );
};

const SourceRow = ({ connectionName, source, sourceType, networks, nodeDevices, os, osInfoList, downloadOSSupported, onValueChanged, validationFailed }) => {
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
            const netObj = getVirtualNetworkByName(source.split('network=')[1],
                                                   networks);

            if (!netObj || !getVirtualNetworkPXESupport(netObj))
                installationSourceWarning = _("Network selection does not support PXE.");
        }

        installationSource = (
            <>
                <CockpitSelect.StatelessSelect id="network-select"
                    selected={source || 'no-resource'}
                    onChange={value => onValueChanged('source', value)}>
                    {getPXENetworkRows(nodeDevices, networks)}
                </CockpitSelect.StatelessSelect>

                {installationSourceWarning &&
                <HelpBlock>
                    <p className="text-warning">{installationSourceWarning}</p>
                </HelpBlock> }
            </>
        );
        break;
    case URL_SOURCE:
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
    default:
        break;
    }

    return (
        <>
            {sourceType != EXISTING_DISK_IMAGE_SOURCE &&
            <>
                <label className="control-label" htmlFor="source-type">
                    {_("Installation type")}
                </label>
                <CockpitSelect.Select id="source-type"
                    initial={sourceType}
                    onChange={value => onValueChanged('sourceType', value)}>
                    {downloadOSSupported ? <CockpitSelect.SelectEntry data={DOWNLOAD_AN_OS}
                        key={DOWNLOAD_AN_OS}>{_("Download an OS")}</CockpitSelect.SelectEntry> : null}
                    <CockpitSelect.SelectEntry data={LOCAL_INSTALL_MEDIA_SOURCE}
                        key={LOCAL_INSTALL_MEDIA_SOURCE}>{_("Local install media")}</CockpitSelect.SelectEntry>
                    <CockpitSelect.SelectEntry data={URL_SOURCE} key={URL_SOURCE}>{_("URL")}</CockpitSelect.SelectEntry>
                    <CockpitSelect.SelectEntry title={connectionName == 'session' ? _("Network boot is available only when using system connection") : null}
                        disabled={connectionName == 'session'}
                        data={PXE_SOURCE}
                        key={PXE_SOURCE}>{_("Network boot (PXE)")}
                    </CockpitSelect.SelectEntry>
                </CockpitSelect.Select>
            </>}

            {sourceType != DOWNLOAD_AN_OS
                ? <>
                    <label className="control-label" htmlFor={installationSourceId}>
                        {_("Installation source")}
                    </label>
                    <FormGroup validationState={validationStateSource} controlId='source'>
                        {installationSource}
                        { validationStateSource == 'error' &&
                        <HelpBlock>
                            <p className="text-danger">{validationFailed.source}</p>
                        </HelpBlock> }
                    </FormGroup>
                </>
                : <OSRow os={os}
                         osInfoList={osInfoList.filter(os => os.treeInstallable)}
                         onValueChanged={onValueChanged}
                         isLoading={false}
                         validationFailed={validationFailed} />}
        </>
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
        this.createValue = os => {
            return ({
                toString: function() { return this.displayName },
                compareTo: function(value) {
                    return value.shortId.toLowerCase().includes(this.shortId) || value.displayName.toLowerCase().includes(this.displayName);
                },
                ...os,
                displayName: getOSStringRepresentation(os),
            });
        };
    }

    render() {
        const { os, onValueChanged, isLoading, validationFailed } = this.props;
        const validationStateOS = validationFailed.os ? 'error' : undefined;

        return (
            <>
                <label className="control-label" htmlFor='os-select'>
                    {_("Operating system")}
                </label>
                <FormGroup validationState={validationStateOS} bsClass='form-group ct-validation-wrapper'>
                    <PFSelect
                        variant={SelectVariant.typeahead}
                        key={this.state.typeAheadKey}
                        id='os-select'
                        isDisabled={isLoading}
                        selections={os ? this.createValue(os) : null}
                        typeAheadAriaLabel={_("Choose an operating system")}
                        placeholderText={_("Choose an operating system")}
                        onSelect={(event, value) => {
                            this.setState({
                                isOpen: false
                            });
                            onValueChanged('os', value);
                        }}
                        onClear={() => {
                            this.setState({ isOpen: false });
                            onValueChanged('os', null);
                        }}
                        onToggle={isOpen => this.setState({ isOpen })}
                        isOpen={this.state.isOpen}
                        menuAppendTo="parent">
                        {this.state.osEntries.map(os => <SelectOption key={os.shortId}
                                                                      value={this.createValue(os)} />)}
                    </PFSelect>
                    { validationFailed.os && os == undefined &&
                    <HelpBlock>
                        <p className="text-danger">{validationFailed.os}</p>
                    </HelpBlock> }
                </FormGroup>
            </>
        );
    }
}

const UnattendedRow = ({ validationFailed, unattendedDisabled, unattendedInstallation, os, profile, onValueChanged }) => {
    const validationStatePassword = validationFailed.password ? 'error' : undefined;
    let unattendedInstallationCheckbox = (
        <label className="checkbox-inline">
            <input id="unattended-installation" type="checkbox"
                checked={unattendedInstallation}
                disabled={unattendedDisabled}
                onChange={e => onValueChanged('unattendedInstallation', e.target.checked)} />
            {_("Run unattended installation")}
        </label>
    );
    if (unattendedDisabled) {
        unattendedInstallationCheckbox = (
            <Tooltip id='os-unattended-installation-tooltip' content={_("The selected operating system does not support unattended installation")} position={TooltipPosition.left}>
                {unattendedInstallationCheckbox}
            </Tooltip>
        );
    }

    return (
        <>
            {unattendedInstallationCheckbox}
            {!unattendedDisabled && unattendedInstallation ? <>
                {os.profiles.length > 0 && <>
                    <label className="control-label" htmlFor="profile-select">
                        {_("Profile")}
                    </label>
                    <CockpitSelect.Select id="profile-select"
                        initial={os.profiles && os.profiles[0]}
                        onChange={e => onValueChanged('profile', e)}>
                        { (os.profiles || []).sort()
                                .reverse() // Let jeos (Server) appear always first on the list since in osinfo-db it's not consistent
                                .map(profile => {
                                    let profileName;
                                    if (profile == 'jeos')
                                        profileName = 'Server';
                                    else if (profile == 'desktop')
                                        profileName = 'Workstation';
                                    else
                                        profileName = profile;
                                    return <CockpitSelect.SelectEntry data={profile} key={profile}>{profileName}</CockpitSelect.SelectEntry>;
                                }) }
                    </CockpitSelect.Select>
                </>}
                <label htmlFor='root-password' className='control-label'>
                    {_("Root password")}
                </label>
                <FormGroup validationState={validationStatePassword} bsClass='form-group ct-validation-wrapper' controlId='root-password'>
                    <Password id='root-password' onValueChanged={(value) => onValueChanged('rootPassword', value)} />
                    <HelpBlock>
                        <p className="text-danger">{validationFailed.password}</p>
                        {profile == 'desktop' && <p className="text-info">{_("Leave the password blank if you do not wish to have a root account created")}</p>}
                    </HelpBlock>
                </FormGroup>
                <hr />
            </> : <span />}
        </>
    );
};

const MemoryRow = ({ memorySize, memorySizeUnit, nodeMaxMemory, recommendedMemory, minimumMemory, onValueChanged, validationFailed }) => {
    const validationStateMemory = validationFailed.memory ? 'error' : undefined;
    return (
        <>
            <label htmlFor='memory-size' className='control-label'>
                {_("Memory")}
            </label>
            <FormGroup validationState={validationStateMemory} bsClass='form-group ct-validation-wrapper' controlId='memory'>
                <MemorySelectRow id='memory-size'
                    value={Math.max(memorySize, Math.floor(convertToUnit(minimumMemory, units.B, memorySizeUnit)))}
                    maxValue={nodeMaxMemory && Math.floor(convertToUnit(nodeMaxMemory, units.KiB, memorySizeUnit))}
                    minValue={Math.floor(convertToUnit(minimumMemory, units.B, memorySizeUnit))}
                    initialUnit={memorySizeUnit}
                    onValueChange={value => onValueChanged('memorySize', value)}
                    onUnitChange={value => onValueChanged('memorySizeUnit', value)} />
                <HelpBlock id="memory-size-helpblock">
                    {validationStateMemory === "error" && <p>{validationFailed.memory}</p>}
                </HelpBlock>
            </FormGroup>
        </>
    );
};

const StorageRow = ({ connectionName, storageSize, storageSizeUnit, onValueChanged, recommendedStorage, minimumStorage, storagePoolName, storagePools, storageVolume, vms, validationFailed }) => {
    const validationStateStorage = validationFailed.storage ? 'error' : undefined;
    let volumeEntries;
    let isVolumeUsed = {};
    // Existing storage pool is chosen
    if (storagePoolName !== "NewVolume" && storagePoolName !== "NoStorage") {
        const storagePool = storagePools.find(pool => pool.name === storagePoolName);

        isVolumeUsed = getStorageVolumesUsage(vms, storagePool);
        volumeEntries = (
            storagePool.volumes.map(vol => <CockpitSelect.SelectEntry data={vol.name} key={vol.name}>{vol.name}</CockpitSelect.SelectEntry>)
        );
    }

    const poolSpaceAvailable = getSpaceAvailable(storagePools, connectionName);

    return (
        <>
            <label className="control-label" htmlFor="storage-pool-select">
                {_("Storage")}
            </label>
            <CockpitSelect.Select id="storage-pool-select"
                           initial={storagePoolName}
                           onChange={e => onValueChanged('storagePool', e)}>
                <CockpitSelect.SelectEntry data="NewVolume" key="NewVolume">{_("Create new volume")}</CockpitSelect.SelectEntry>
                <CockpitSelect.SelectEntry data="NoStorage" key="NoStorage">{_("No storage")}</CockpitSelect.SelectEntry>
                <CockpitSelect.SelectDivider />
                <optgroup key="Storage pools" label="Storage pools">
                    { storagePools.map(pool => {
                        if (pool.volumes && pool.volumes.length)
                            return <CockpitSelect.SelectEntry data={pool.name} key={pool.name}>{pool.name}</CockpitSelect.SelectEntry>;
                    })}
                </optgroup>
            </CockpitSelect.Select>

            { storagePoolName !== "NewVolume" &&
            storagePoolName !== "NoStorage" &&
            <>
                <label className="control-label" htmlFor="storage-volume-select">
                    {_("Volume")}
                </label>
                <CockpitSelect.Select id="storage-volume-select"
                               initial={storageVolume}
                               onChange={e => onValueChanged('storageVolume', e)}>
                    {volumeEntries}
                </CockpitSelect.Select>

                { isVolumeUsed[storageVolume] && isVolumeUsed[storageVolume].length > 0 &&
                <HelpBlock>
                    <p className="text-warning">{_("This volume is already used by another VM.")}</p>
                </HelpBlock> }
            </> }

            { storagePoolName === "NewVolume" &&
            <>
                <label htmlFor='storage-size' className='control-label'>
                    {_("Size")}
                </label>
                <FormGroup validationState={validationStateStorage} bsClass='form-group ct-validation-wrapper' controlId='storage'>
                    <MemorySelectRow id="storage-size"
                        value={Math.max(storageSize, Math.floor(convertToUnit(minimumStorage || 0, units.B, storageSizeUnit)))}
                        maxValue={poolSpaceAvailable && Math.floor(convertToUnit(poolSpaceAvailable, units.B, storageSizeUnit))}
                        minValue={minimumStorage && Math.floor(convertToUnit(minimumStorage, units.B, storageSizeUnit))}
                        initialUnit={storageSizeUnit}
                        onValueChange={value => onValueChanged('storageSize', value)}
                        onUnitChange={value => onValueChanged('storageSizeUnit', value)} />
                    {poolSpaceAvailable &&
                    <HelpBlock id="storage-size-helpblock">
                        {validationStateStorage === "error" && <p>{validationFailed.storage}</p>}
                    </HelpBlock>}
                </FormGroup>
            </> }
        </>
    );
};

class CreateVmModal extends React.Component {
    constructor(props) {
        let defaultSourceType;
        if (props.mode == 'create') {
            if (!props.downloadOSSupported)
                defaultSourceType = LOCAL_INSTALL_MEDIA_SOURCE;
            else
                defaultSourceType = DOWNLOAD_AN_OS;
        } else {
            defaultSourceType = EXISTING_DISK_IMAGE_SOURCE;
        }
        super(props);
        this.state = {
            inProgress: false,
            validate: false,
            vmName: '',
            connectionName: LIBVIRT_SYSTEM_CONNECTION,
            sourceType: defaultSourceType,
            unattendedInstallation: false,
            source: '',
            os: undefined,
            memorySize: Math.min(convertToUnit(1024, units.MiB, units.GiB), // tied to Unit
                                 Math.floor(convertToUnit(props.nodeMaxMemory, units.KiB, units.GiB))),
            memorySizeUnit: units.GiB.name,
            storageSize: Math.min(convertToUnit(10 * 1024, units.MiB, units.GiB), // tied to Unit
                                  Math.floor(convertToUnit(props.nodeMaxMemory, units.KiB, units.GiB))),
            storageSizeUnit: units.GiB.name,
            storagePool: 'NewVolume',
            storageVolume: '',
            startVm: true,
            recommendedMemory: undefined,
            minimumMemory: 0,
            recommendedStorage: undefined,
            minimumStorage: 0,
            rootPassword: '',
        };
        this.onCreateClicked = this.onCreateClicked.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
    }

    onValueChanged(key, value) {
        switch (key) {
        case 'vmName':
            this.setState({ [key]: value.split(" ").join("_") });
            break;
        case 'source':
            this.setState({ [key]: value });

            if ((this.state.sourceType == URL_SOURCE || this.state.sourceType == LOCAL_INSTALL_MEDIA_SOURCE) && value != '' && value != undefined) {
                // Clears the previously set timer.
                clearTimeout(this.typingTimeout);

                const onOsAutodetect = (os) => {
                    this.setState({ autodetectOSInProgress: true });
                    autodetectOS(os)
                            .then(resJSON => {
                                const res = JSON.parse(resJSON);
                                const osEntry = this.props.osInfoList.filter(osEntry => osEntry.id == res.os);

                                if (osEntry && osEntry[0]) {
                                    this.onValueChanged('os', osEntry[0]);
                                    this.onValueChanged('sourceMediaID', res.media);
                                }
                            }, ex => {
                                console.log("osinfo-detect command failed: ", ex.message);
                            })
                            .always(() => this.setState({ autodetectOSInProgress: false }));
                };
                this.typingTimeout = setTimeout(() => onOsAutodetect(value), 250);
            }
            break;
        case 'sourceType':
            this.setState({ [key]: value });
            if (value == PXE_SOURCE) {
                const initialPXESource = getPXEInitialNetworkSource(this.props.nodeDevices.filter(nodeDevice => nodeDevice.connectionName == this.state.connectionName),
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
        case 'os': {
            const stateDelta = { [key]: value };

            if (value && value.minimumResources.ram)
                stateDelta.minimumMemory = value.minimumResources.ram;

            if (value && value.profiles)
                stateDelta.profile = value.profiles.sort().reverse()[0];

            if (value && value.recommendedResources.ram) {
                stateDelta.recommendedMemory = value.recommendedResources.ram;
                const converted = convertToUnit(stateDelta.recommendedMemory, units.B, units.GiB);
                if (converted == 0 || converted % 1 !== 0) // If recommended memory is not a whole number in GiB, set value in MiB
                    this.setState({ memorySizeUnit: units.MiB }, () => this.onValueChanged("memorySize", Math.floor(convertToUnit(stateDelta.recommendedMemory, units.B, units.MiB))));
                else
                    this.setState({ memorySizeUnit: units.GiB }, () => this.onValueChanged("memorySize", converted));
            } else {
                stateDelta.recommendedMemory = undefined;
            }

            if (value && value.minimumResources.storage)
                stateDelta.minimumStorage = value.minimumResources.storage;

            if (value && value.recommendedResources.storage) {
                stateDelta.recommendedStorage = value.recommendedResources.storage;
                const converted = convertToUnit(stateDelta.recommendedStorage, units.B, this.state.storageSizeUnit);
                if (converted == 0 || converted % 1 !== 0) // If recommended storage is not a whole number in GiB, set value in MiB
                    this.setState({ storageSizeUnit: units.MiB }, () => this.onValueChanged("storageSize", Math.floor(convertToUnit(stateDelta.recommendedStorage, units.B, units.MiB))));
                else
                    this.setState({ storageSizeUnit: units.GiB }, () => this.onValueChanged("storageSize", converted));
            } else {
                stateDelta.recommendedStorage = undefined;
            }
            if (!value || !value.unattendedInstallable)
                this.onValueChanged('unattendedInstallation', false);
            this.setState(stateDelta);
            break;
        }
        case 'unattendedInstallation':
            this.setState({ unattendedInstallation: value, startVm: true });
            break;
        default:
            this.setState({ [key]: value });
            break;
        }
    }

    onCreateClicked() {
        const { dispatch, storagePools, close, onAddErrorNotification, osInfoList, vms } = this.props;

        const validation = validateParams({ ...this.state, osInfoList, vms: vms.filter(vm => vm.connectionName == this.state.connectionName) });
        if (Object.getOwnPropertyNames(validation).length > 0) {
            this.setState({ inProgress: false, validate: true });
        } else {
            // leave dialog open to show immediate errors from the backend
            // close the dialog after VMS_CONFIG.LeaveCreateVmDialogVisibleAfterSubmit
            // then show errors in the notification area
            this.setState({ inProgress: true, validate: false });

            const vmParams = {
                connectionName: this.state.connectionName,
                vmName: this.state.vmName,
                source: this.state.source,
                sourceType: this.state.sourceType,
                os: this.state.os ? this.state.os.shortId : 'auto',
                profile: this.state.profile,
                memorySize: convertToUnit(this.state.memorySize, this.state.memorySizeUnit, units.MiB),
                storageSize: convertToUnit(this.state.storageSize, this.state.storageSizeUnit, units.GiB),
                storagePool: this.state.storagePool,
                storageVolume: this.state.storageVolume,
                startVm: this.state.startVm,
                unattended: this.state.unattendedInstallation,
                rootPassword: this.state.rootPassword,
            };

            return timeoutedPromise(
                dispatch(createVm(vmParams)),
                VMS_CONFIG.LeaveCreateVmDialogVisibleAfterSubmit,
                () => {
                    close();

                    if (this.state.storagePool === "NewVolume") {
                        const storagePool = storagePools.find(pool => pool.connectionName === this.state.connectionName && pool.name === "default");
                        if (storagePool)
                            storagePoolRefresh(storagePool.connectionName, storagePool.id);
                    }
                },
                (exception) => {
                    onAddErrorNotification({
                        text: cockpit.format(_("Creation of VM $0 failed"), vmParams.vmName),
                        detail: exception.message,
                    });
                    close();
                });
        }
    }

    render() {
        const { nodeMaxMemory, nodeDevices, networks, osInfoList, loggedUser, storagePools, vms } = this.props;
        const validationFailed = this.state.validate && validateParams({ ...this.state, osInfoList, vms: vms.filter(vm => vm.connectionName == this.state.connectionName) });
        let startVmCheckbox = (
            <label className="checkbox-inline">
                <input id="start-vm" type="checkbox"
                    checked={this.state.startVm}
                    disabled={this.state.unattendedInstallation}
                    onChange={e => this.onValueChanged('startVm', e.target.checked)} />
                {_("Immediately start VM")}
            </label>
        );
        if (this.state.unattendedInstallation) {
            startVmCheckbox = (
                <Tooltip id='virt-install-not-available-tooltip'
                         position={TooltipPosition.left}
                         content={_("Setting the user passwords for unattended installation requires starting the VM when creating it")}>
                    {startVmCheckbox}
                </Tooltip>
            );
        }

        let unattendedDisabled = true;
        if ((this.state.sourceType == URL_SOURCE || this.state.sourceType == LOCAL_INSTALL_MEDIA_SOURCE) && this.state.os) {
            if (this.state.os.medias && this.state.sourceMediaID in this.state.os.medias)
                unattendedDisabled = !this.state.os.medias[this.state.sourceMediaID].unattendedInstallable;
            else
                unattendedDisabled = !this.state.os.unattendedInstallable;
        } else if (this.state.sourceType == DOWNLOAD_AN_OS) {
            unattendedDisabled = !this.state.os || !this.state.os.unattendedInstallable;
        }

        const dialogBody = (
            <form className="ct-form">
                <NameRow
                    vmName={this.state.vmName}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed} />

                <hr />

                <MachinesConnectionSelector id='connection'
                    connectionName={this.state.connectionName}
                    onValueChanged={this.onValueChanged}
                    loggedUser={loggedUser} />

                <hr />

                <SourceRow
                    connectionName={this.state.connectionName}
                    networks={networks.filter(network => network.connectionName == this.state.connectionName)}
                    nodeDevices={nodeDevices.filter(nodeDevice => nodeDevice.connectionName == this.state.connectionName)}
                    source={this.state.source}
                    sourceType={this.state.sourceType}
                    os={this.state.os}
                    osInfoList={this.props.osInfoList}
                    downloadOSSupported={this.props.downloadOSSupported}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed} />

                <hr />

                {this.state.sourceType != DOWNLOAD_AN_OS &&
                <>
                    <OSRow
                        os={this.state.os}
                        osInfoList={this.props.osInfoList}
                        onValueChanged={this.onValueChanged}
                        isLoading={this.state.autodetectOSInProgress}
                        validationFailed={validationFailed} />

                    <hr />
                </>}

                { this.state.sourceType != EXISTING_DISK_IMAGE_SOURCE &&
                <StorageRow
                    connectionName={this.state.connectionName}
                    storageSize={this.state.storageSize}
                    storageSizeUnit={this.state.storageSizeUnit}
                    onValueChanged={this.onValueChanged}
                    storagePoolName={this.state.storagePool}
                    storagePools={storagePools.filter(pool => pool.connectionName === this.state.connectionName)}
                    storageVolume={this.state.storageVolume}
                    vms={vms}
                    recommendedStorage={this.state.recommendedStorage}
                    minimumStorage={this.state.minimumStorage}
                    validationFailed={validationFailed}
                />}

                <MemoryRow
                    memorySize={this.state.memorySize}
                    memorySizeUnit={this.state.memorySizeUnit}
                    nodeMaxMemory={nodeMaxMemory}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed}
                    recommendedMemory={this.state.recommendedMemory}
                    minimumMemory={this.state.minimumMemory}
                />

                <hr />

                {this.state.sourceType != PXE_SOURCE &&
                 this.state.sourceType != EXISTING_DISK_IMAGE_SOURCE &&
                 this.props.unattendedSupported &&
                 <>
                     <UnattendedRow
                         validationFailed={validationFailed}
                         unattendedDisabled={unattendedDisabled}
                         unattendedInstallation={this.state.unattendedInstallation}
                         os={this.state.os}
                         profile={this.state.profile}
                         onValueChanged={this.onValueChanged} />
                     <hr />
                 </>}

                {startVmCheckbox}
            </form>
        );

        return (
            <Modal position="top" variant="medium" id='create-vm-dialog' isOpen onClose={ this.props.close }
                title={this.props.mode == 'create' ? _("Create new virtual machine") : _("Import a virtual machine")}
                actions={[
                    <Button variant="primary"
                            key="primary-button"
                            isLoading={this.state.inProgress}
                            isDisabled={this.state.inProgress || Object.getOwnPropertyNames(validationFailed).length > 0}
                            onClick={this.onCreateClicked}>
                        {this.props.mode == 'create' ? _("Create") : _("Import")}
                    </Button>,
                    <Button variant='link'
                            key="cancel-button"
                            className='btn-cancel' onClick={ this.props.close }>
                        {_("Cancel")}
                    </Button>
                ]}>
                {dialogBody}
            </Modal>
        );
    }
}

export class CreateVmAction extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            showModal: false,
            virtInstallAvailable: undefined,
            downloadOSSupported: undefined,
            unattendedSupported: undefined
        };
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
    }

    componentDidMount() {
        cockpit.spawn(['which', 'virt-install'], { err: 'ignore' })
                .then(() => {
                    this.setState({ virtInstallAvailable: true });
                    cockpit.spawn(['virt-install', '--install=?'], { err: 'ignore' })
                            .then(() => this.setState({ downloadOSSupported: true }),
                                  () => this.setState({ downloadOSSupported: false }));

                    cockpit.spawn(['virt-install', '--unattended=?'], { err: 'ignore' })
                            .then(() => this.setState({ unattendedSupported: true }),
                                  () => this.setState({ unattendedSupported: false }));
                },
                      () => this.setState({ virtInstallAvailable: false }));
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
        if (this.props.systemInfo.osInfoList == null)
            return null;

        let testdata;
        if (!this.props.systemInfo.osInfoList)
            testdata = "disabledOsInfo";
        else if (!this.state.virtInstallAvailable)
            testdata = "disabledVirtInstall";
        else if (this.state.downloadOSSupported === undefined || this.state.unattendedSupported === undefined)
            testdata = "disabledCheckingFeatures";
        let createButton = (
            <Button isDisabled={testdata !== undefined}
                    testdata={testdata}
                    id={this.props.mode == 'create' ? 'create-new-vm' : 'import-vm-disk'}
                    variant='secondary'
                    onClick={this.open}>
                {this.props.mode == 'create' ? _("Create VM") : _("Import VM")}
            </Button>
        );
        if (!this.state.virtInstallAvailable)
            createButton = (
                <Tooltip id='virt-install-not-available-tooltip'
                         content={_("virt-install package needs to be installed on the system in order to create new VMs")}>
                    <span>
                        {createButton}
                    </span>
                </Tooltip>
            );

        return (
            <>
                { createButton }
                { this.state.showModal &&
                <CreateVmModal
                    mode={this.props.mode}
                    close={this.close} dispatch={this.props.dispatch}
                    networks={this.props.networks}
                    nodeDevices={this.props.nodeDevices}
                    nodeMaxMemory={this.props.nodeMaxMemory}
                    // The initial resources fetching contains only ID - this will be immediately
                    // replaced with the whole resource object but there is enough time to cause a crash if parsed here
                    storagePools={this.props.storagePools.filter(pool => pool.name)}
                    vms={this.props.vms}
                    osInfoList={this.props.systemInfo.osInfoList}
                    onAddErrorNotification={this.props.onAddErrorNotification}
                    downloadOSSupported={this.state.downloadOSSupported}
                    unattendedSupported={this.state.unattendedSupported}
                    loggedUser={this.props.systemInfo.loggedUser} /> }
            </>
        );
    }
}

CreateVmAction.propTypes = {
    mode: PropTypes.string.isRequired,
    dispatch: PropTypes.func.isRequired,
    networks: PropTypes.array.isRequired,
    nodeDevices: PropTypes.array.isRequired,
    nodeMaxMemory: PropTypes.number,
    onAddErrorNotification: PropTypes.func.isRequired,
    systemInfo: PropTypes.object.isRequired,
};
CreateVmAction.defaultProps = {
    nodeMaxMemory: 1048576, // 1GiB
};
