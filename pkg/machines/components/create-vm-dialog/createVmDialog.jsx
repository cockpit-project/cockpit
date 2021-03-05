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

import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { debounce } from 'throttle-debounce';
import {
    Checkbox,
    Form, FormGroup,
    FormSelect, FormSelectOption, FormSelectOptionGroup,
    InputGroup,
    Modal,
    Select as PFSelect, SelectOption, SelectVariant,
    TextInput,
    Button, Tooltip, TooltipPosition
} from '@patternfly/react-core';

import cockpit from 'cockpit';
import { MachinesConnectionSelector } from '../common/machinesConnectionSelector.jsx';
import { FileAutoComplete } from "cockpit-components-file-autocomplete.jsx";
import { createVm } from '../../actions/provider-actions.js';
import {
    isEmpty,
    digitFilter,
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
import { storagePoolRefresh } from '../../libvirt-dbus.js';
import { PasswordFormFields, password_quality } from 'cockpit-components-password.jsx';

import './createVmDialog.scss';
import VMS_CONFIG from '../../config.js';

const _ = cockpit.gettext;

const URL_SOURCE = 'url';
const LOCAL_INSTALL_MEDIA_SOURCE = 'file';
const CLOUD_IMAGE = 'cloud';
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
        case CLOUD_IMAGE:
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
    }

    if (vmParams.storagePool == 'NewVolume' && vmParams.storageSize === 0) {
        validationFailed.storage = _("Storage size must not be 0");
    }

    if (vmParams.nodeMaxMemory && vmParams.memorySize > Math.floor(convertToUnit(vmParams.nodeMaxMemory, units.KiB, vmParams.memorySizeUnit))) {
        validationFailed.memory = cockpit.format(
            _("Up to $0 $1 available on the host"),
            Math.floor(convertToUnit(vmParams.nodeMaxMemory, units.KiB, vmParams.memorySizeUnit)),
            vmParams.memorySizeUnit
        );
    }
    if (vmParams.unattendedInstallation && !vmParams.userPassword && vmParams.userLogin) {
        validationFailed.userPassword = _("User password must not be empty when user login is set");
    }
    if (vmParams.unattendedInstallation && vmParams.userPassword && !vmParams.userLogin) {
        validationFailed.userLogin = _("User login must not be empty when user password is set");
    }

    return validationFailed;
}

const NameRow = ({ vmName, onValueChanged, validationFailed }) => {
    const validationStateName = validationFailed.vmName ? 'error' : 'default';

    return (
        <FormGroup label={_("Name")} fieldId="vm-name"
                   id="vm-name-group"
                   helperTextInvalid={validationFailed.vmName}
                   validated={validationStateName}>
            <TextInput id='vm-name'
                       validated={validationStateName}
                       minLength={1}
                       value={vmName || ''}
                       placeholder={_("Unique name")}
                       onChange={value => onValueChanged('vmName', value)} />
        </FormGroup>
    );
};

const SourceRow = ({ connectionName, source, sourceType, networks, nodeDevices, os, osInfoList, cloudInitSupported, downloadOSSupported, onValueChanged, validationFailed }) => {
    let installationSource;
    let installationSourceId;
    let installationSourceWarning;
    let validationStateSource = validationFailed.source ? 'error' : 'default';

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
    case CLOUD_IMAGE:
        installationSourceId = "source-file";
        installationSource = (
            <FileAutoComplete id={installationSourceId}
                placeholder={_("Path to cloud image file on host's file system")}
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
            if (validationStateSource !== 'error')
                validationStateSource = 'warning';
        } else if (source && source.includes('network=')) {
            const netObj = getVirtualNetworkByName(source.split('network=')[1],
                                                   networks);

            if (!netObj || !getVirtualNetworkPXESupport(netObj)) {
                installationSourceWarning = _("Network selection does not support PXE.");
                if (validationStateSource !== 'error')
                    validationStateSource = 'warning';
            }
        }

        installationSource = (
            <FormSelect id="network-select"
                        validated={validationStateSource}
                        value={source || 'no-resource'}
                        onChange={value => onValueChanged('source', value)}>
                {getPXENetworkRows(nodeDevices, networks)}
            </FormSelect>
        );
        break;
    case URL_SOURCE:
        installationSourceId = "source-url";
        installationSource = (
            <TextInput id={installationSourceId}
                       validated={validationStateSource}
                       minLength={1}
                       placeholder={_("Remote URL")}
                       value={source}
                       onChange={value => onValueChanged('source', value)} />
        );
        break;
    default:
        break;
    }

    return (
        <>
            {sourceType != EXISTING_DISK_IMAGE_SOURCE &&
            <FormGroup label={_("Installation type")}
                       id="source-type-group"
                       fieldId="source-type">
                <FormSelect id="source-type"
                            value={sourceType}
                            onChange={value => onValueChanged('sourceType', value)}>
                    {downloadOSSupported
                        ? <FormSelectOption value={DOWNLOAD_AN_OS}
                                            label={_("Download an OS")} /> : null}
                    {cloudInitSupported ? <FormSelectOption value={CLOUD_IMAGE}
                                      label={_("Cloud base image")} /> : null}
                    <FormSelectOption value={LOCAL_INSTALL_MEDIA_SOURCE}
                                      label={_("Local install media")} />
                    <FormSelectOption value={URL_SOURCE}
                                      label={_("URL")} />
                    {connectionName == 'system' &&
                    <FormSelectOption value={PXE_SOURCE}
                                      label={_("Network boot (PXE)")} />}
                </FormSelect>
            </FormGroup>}

            {sourceType != DOWNLOAD_AN_OS
                ? <FormGroup label={_("Installation source")} id={installationSourceId + "-group"} fieldId={installationSourceId}
                             helperText={installationSourceWarning}
                             helperTextInvalid={validationFailed.source}
                             validated={validationStateSource}>
                    {installationSource}
                </FormGroup>
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
                    if (typeof value == "string")
                        return this.shortId.toLowerCase().includes(value.toLowerCase()) || this.displayName.toLowerCase().includes(value.toLowerCase());
                    else
                        return this.shortId == value.shortId;
                },
                ...os,
                displayName: getOSStringRepresentation(os),
            });
        };
    }

    render() {
        const { os, onValueChanged, isLoading, validationFailed } = this.props;
        const validationStateOS = validationFailed.os ? 'error' : 'default';

        return (
            <FormGroup fieldId='os-select'
                       id="os-select-group"
                       validated={validationStateOS}
                       helperTextInvalid={validationFailed.os}
                       label={_("Operating system")}>
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
            </FormGroup>
        );
    }
}

const UnattendedRow = ({
    onValueChanged,
    os, profile,
    rootPassword,
    unattendedDisabled,
    unattendedInstallation,
    unattendedUserLogin,
    userLogin, userPassword,
    validationFailed,
}) => {
    let unattendedInstallationCheckbox = (
        <Checkbox id="unattended-installation"
                  isChecked={unattendedInstallation}
                  isDisabled={unattendedDisabled}
                  onChange={checked => onValueChanged('unattendedInstallation', checked)}
                  label={_("Run unattended installation")} />
    );
    if (unattendedDisabled) {
        unattendedInstallationCheckbox = (
            <Tooltip id='os-unattended-installation-tooltip' content={_("The selected operating system does not support unattended installation")} position={TooltipPosition.left}>
                {unattendedInstallationCheckbox}
            </Tooltip>
        );
    }

    return (
        <FormGroup fieldId="unattended-installation">
            {unattendedInstallationCheckbox}
            {!unattendedDisabled && unattendedInstallation && <>
                {os.profiles.length > 0 &&
                <FormGroup fieldId="profile-select"
                           label={_("Profile")}>
                    <FormSelect id="profile-select"
                                value={profile || (os.profiles && os.profiles[0])}
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
                                    return <FormSelectOption value={profile}
                                                             key={profile}
                                                             label={profileName} />;
                                }) }
                    </FormSelect>
                </FormGroup>}
                <UsersConfigurationRow rootPassword={rootPassword}
                                       rootPasswordLabelInfo={_("Leave the password blank if you do not wish to have a root account created")}
                                       showUserFields={unattendedUserLogin}
                                       userLogin={userLogin}
                                       userPassword={userPassword}
                                       validationFailed={validationFailed}
                                       onValueChanged={onValueChanged} />
            </>}
        </FormGroup>
    );
};

const UsersConfigurationRow = ({
    rootPassword,
    rootPasswordLabelInfo,
    showUserFields,
    userLogin, userPassword,
    onValueChanged,
    validationFailed,
}) => {
    const [root_pwd_strength, setRootPasswordStrength] = useState('');
    const [root_pwd_message, setRootPasswordMessage] = useState('');
    const [root_pwd_errors, setRootPasswordErrors] = useState({});

    const [user_pwd_strength, setUserPasswordStrength] = useState('');
    const [user_pwd_message, setUserPasswordMessage] = useState('');
    const [user_pwd_errors, setUserPasswordErrors] = useState({});

    useEffect(() => {
        if (rootPassword) {
            password_quality(rootPassword)
                    .then(strength => {
                        setRootPasswordErrors({});
                        setRootPasswordStrength(strength.value);
                        setRootPasswordMessage(strength.message || '');
                    })
                    .catch(ex => {
                        if (validationFailed !== undefined) {
                            const errors = {};
                            errors.password = (ex.message || ex.toString()).replace("\n", " ");
                            setRootPasswordErrors(errors);
                        }
                        setRootPasswordStrength(0);
                        setRootPasswordMessage('');
                    });
        } else {
            setRootPasswordStrength('');
        }
    }, [rootPassword, validationFailed]);

    useEffect(() => {
        if (userPassword) {
            password_quality(userPassword)
                    .then(strength => {
                        setUserPasswordErrors({});
                        setUserPasswordStrength(strength.value);
                        setUserPasswordMessage(strength.message || '');
                    })
                    .catch(ex => {
                        if (validationFailed !== undefined) {
                            const errors = {};
                            errors.password = (ex.message || ex.toString()).replace("\n", " ");
                            setUserPasswordErrors(errors);
                        }
                        setUserPasswordStrength(0);
                        setUserPasswordMessage('');
                    });
        } else {
            setUserPasswordStrength('');
        }
    }, [userPassword, validationFailed]);

    return (
        <>
            <PasswordFormFields password={rootPassword}
                                password_label={_("Root password")}
                                password_strength={root_pwd_strength}
                                idPrefix="create-vm-dialog-root-password"
                                password_message={root_pwd_message}
                                password_label_info={rootPasswordLabelInfo}
                                error_password={validationFailed && root_pwd_errors.password}
                                change={(_, value) => onValueChanged('rootPassword', value)} />
            {showUserFields &&
            <>
                <FormGroup fieldId="user-login"
                           helperTextInvalid={validationFailed.userLogin}
                           validated={validationFailed.userLogin ? "error" : "default"}
                           label={_("User login")}>
                    <TextInput id='user-login'
                               validated={validationFailed.userLogin ? "error" : "default"}
                               value={userLogin || ''}
                               onChange={value => onValueChanged('userLogin', value)} />
                </FormGroup>
                <PasswordFormFields password={userPassword}
                                    password_label={_("User password")}
                                    password_strength={user_pwd_strength}
                                    idPrefix="create-vm-dialog-user-password"
                                    password_message={user_pwd_message}
                                    password_label_info={_("Leave the password blank if you do not wish to have a user account created")}
                                    error_password={validationFailed && (validationFailed.userLogin ? validationFailed.userLogin : user_pwd_errors.password)}
                                    change={(_, value) => onValueChanged('userPassword', value)} />
            </>}
        </>
    );
};

const CloudInitOptionsRow = ({
    useCloudInit,
    onValueChanged,
    rootPassword,
    userLogin, userPassword,
    validationFailed,
}) => {
    return (
        <FormGroup fieldId="cloud-init-checkbox">
            <Checkbox id="cloud-init-checkbox"
                      isChecked={useCloudInit}
                      onChange={checked => onValueChanged('useCloudInit', checked)}
                      label={_("Cloud init parameters")} />
            {useCloudInit && <UsersConfigurationRow rootPassword={rootPassword}
                                                    rootPasswordLabelInfo={_("Leave the password blank if you do not wish to set a root password")}
                                                    showUserFields
                                                    userLogin={userLogin}
                                                    userPassword={userPassword}
                                                    validationFailed={validationFailed}
                                                    onValueChanged={onValueChanged} />}
        </FormGroup>
    );
};

const MemoryRow = ({ memorySize, memorySizeUnit, nodeMaxMemory, minimumMemory, onValueChanged, validationFailed }) => {
    let validationStateMemory = validationFailed.memory ? 'error' : 'default';
    let helperText = (
        nodeMaxMemory
            ? cockpit.format(
                _("Up to $0 $1 available on the host"),
                Math.floor(convertToUnit(nodeMaxMemory, units.KiB, memorySizeUnit)),
                memorySizeUnit
            ) : ""
    );

    if (validationStateMemory != 'error' && minimumMemory && convertToUnit(memorySize, memorySizeUnit, units.B) < minimumMemory) {
        validationStateMemory = 'warning';
        helperText = (
            cockpit.format(
                _("The selected operating system has minimum memory requirement of $0 $1"),
                convertToUnit(minimumMemory, units.B, memorySizeUnit),
                memorySizeUnit)
        );
    }

    return (
        <>
            <FormGroup label={_("Memory")} validated={validationStateMemory}
                       helperText={helperText}
                       helperTextInvalid={validationFailed.memory}
                       fieldId='memory-size' id='memory-group'>
                <InputGroup>
                    <TextInput id='memory-size' value={memorySize}
                               className="size-input"
                               onKeyPress={digitFilter}
                               onChange={value => onValueChanged('memorySize', Number(value))} />
                    <FormSelect id="memory-size-unit-select"
                                className="unit-select"
                                value={memorySizeUnit}
                                onChange={value => onValueChanged('memorySizeUnit', value)}>
                        <FormSelectOption value={units.MiB.name} key={units.MiB.name}
                                          label={_("MiB")} />
                        <FormSelectOption value={units.GiB.name} key={units.GiB.name}
                                          label={_("GiB")} />
                    </FormSelect>
                </InputGroup>
            </FormGroup>
        </>
    );
};

const StorageRow = ({ connectionName, allowNoDisk, storageSize, storageSizeUnit, onValueChanged, minimumStorage, storagePoolName, storagePools, storageVolume, vms, validationFailed }) => {
    let validationStateStorage = validationFailed.storage ? 'error' : 'default';
    const poolSpaceAvailable = getSpaceAvailable(storagePools, connectionName);
    let helperTextNewVolume = (
        poolSpaceAvailable
            ? cockpit.format(
                _("Up to $0 $1 available on the default location"),
                Math.floor(convertToUnit(poolSpaceAvailable, units.B, storageSizeUnit)),
                storageSizeUnit
            )
            : ""
    );

    if (validationStateStorage != 'error' && minimumStorage && convertToUnit(storageSize, storageSizeUnit, units.B) < minimumStorage) {
        validationStateStorage = 'warning';
        helperTextNewVolume = (
            cockpit.format(
                _("The selected operating system has minimum storage size requirement of $0 $1"),
                convertToUnit(minimumStorage, units.B, storageSizeUnit),
                storageSizeUnit)
        );
    }

    let volumeEntries;
    let isVolumeUsed = {};
    // Existing storage pool is chosen
    if (storagePoolName !== "NewVolume" && storagePoolName !== "NoStorage") {
        const storagePool = storagePools.find(pool => pool.name === storagePoolName);

        isVolumeUsed = getStorageVolumesUsage(vms, storagePool);
        volumeEntries = (
            storagePool.volumes.map(vol => <FormSelectOption value={vol.name}
                                                             key={vol.name}
                                                             label={vol.name} />)
        );
    }

    return (
        <>
            <FormGroup label={_("Storage")} fieldId="storage-pool-select">
                <FormSelect id="storage-pool-select"
                            value={storagePoolName}
                            onChange={e => onValueChanged('storagePool', e)}>
                    <FormSelectOption value="NewVolume" key="NewVolume" label={_("Create new volume")} />
                    { allowNoDisk && <FormSelectOption value="NoStorage" key="NoStorage" label={_("No storage")} />}
                    <FormSelectOptionGroup key="Storage pools" label={_("Storage pools")}>
                        { storagePools.map(pool => {
                            if (pool.volumes && pool.volumes.length)
                                return <FormSelectOption value={pool.name} key={pool.name} label={pool.name} />;
                        })}
                    </FormSelectOptionGroup>
                </FormSelect>
            </FormGroup>

            { storagePoolName !== "NewVolume" &&
            storagePoolName !== "NoStorage" &&
            <FormGroup label={_("Volume")}
                       fieldId="storage-volume-select"
                       helperText={(isVolumeUsed[storageVolume] && isVolumeUsed[storageVolume].length > 0) && _("This volume is already used by another VM.")}
                       validated={(isVolumeUsed[storageVolume] && isVolumeUsed[storageVolume].length > 0) ? "warning" : "default"}>
                <FormSelect id="storage-volume-select"
                            value={storageVolume}
                            validated={(isVolumeUsed[storageVolume] && isVolumeUsed[storageVolume].length > 0) ? "warning" : "default"}
                            onChange={value => onValueChanged('storageVolume', value)}>
                    {volumeEntries}
                </FormSelect>
            </FormGroup>}

            { storagePoolName === "NewVolume" &&
            <>
                <FormGroup label={_("Size")} fieldId='storage-size'
                           id='storage-group'
                           validated={validationStateStorage}
                           helperText={helperTextNewVolume}
                           helperTextInvalid={validationFailed.storage}>
                    <InputGroup>
                        <TextInput id='storage-size' value={storageSize}
                                   className="size-input"
                                   onKeyPress={digitFilter}
                                   onChange={value => onValueChanged('storageSize', Number(value))} />
                        <FormSelect id="storage-size-unit-select"
                                    className="unit-select"
                                    value={storageSizeUnit}
                                    onChange={value => onValueChanged('storageSizeUnit', value)}>
                            <FormSelectOption value={units.MiB.name} key={units.MiB.name}
                                               label={_("MiB")} />
                            <FormSelectOption value={units.GiB.name} key={units.GiB.name}
                                               label={_("GiB")} />
                        </FormSelect>
                    </InputGroup>
                </FormGroup>
            </>}
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
            useCloudInit: false,
            source: '',
            os: undefined,
            memorySize: Math.min(convertToUnit(1024, units.MiB, units.GiB), // tied to Unit
                                 Math.floor(convertToUnit(props.nodeMaxMemory, units.KiB, units.GiB))),
            memorySizeUnit: units.GiB.name,
            storageSize: convertToUnit(10 * 1024, units.MiB, units.GiB), // tied to Unit
            storageSizeUnit: units.GiB.name,
            storagePool: 'NewVolume',
            storageVolume: '',
            startVm: true,
            minimumMemory: 0,
            minimumStorage: 0,

            // Unattended installation or cloud init options for cloud images
            userPassword: '',
            rootPassword: '',
            userLogin: '',
        };
        this.onCreateClicked = this.onCreateClicked.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.onOsAutodetect = debounce(250, (installMedia) => {
            this.setState({ autodetectOSInProgress: true });
            if (this.autodetectOSPromise)
                this.autodetectOSPromise.close("cancelled");

            this.autodetectOSPromise = autodetectOS(installMedia);
            this.autodetectOSPromise.then(resJSON => {
                const res = JSON.parse(resJSON.trim());
                const osEntry = this.props.osInfoList.filter(osEntry => osEntry.id == res.os);

                if (osEntry && osEntry[0]) {
                    this.onValueChanged('os', osEntry[0]);
                    this.onValueChanged('sourceMediaID', res.media);
                }
                this.setState({ autodetectOSInProgress: false });
                this.autodetectOSPromise = null;
            });
            this.autodetectOSPromise.catch(ex => {
                if (ex.problem == "cancelled")
                    return;

                this.setState({ autodetectOSInProgress: false });
                this.autodetectOSPromise = null;
                console.log("osinfo-detect command failed: ", ex.message);
            });
        });
    }

    onValueChanged(key, value) {
        switch (key) {
        case 'vmName':
            this.setState({ [key]: value.split(" ").join("_") });
            break;
        case 'source':
            this.setState({ [key]: value });
            if ((this.state.sourceType == URL_SOURCE || this.state.sourceType == LOCAL_INSTALL_MEDIA_SOURCE) && value != '' && value != undefined)
                this.onOsAutodetect(value);
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
        case 'memorySizeUnit':
            this.setState({ [key]: value });
            key = 'memorySize';
            value = Math.round(convertToUnit(this.state.memorySize, this.state.memorySizeUnit, value));
            this.setState({ [key]: value });
            break;
        case 'storageSizeUnit':
            this.setState({ [key]: value });
            key = 'storageSize';
            value = Math.round(convertToUnit(this.state.storageSize, this.state.storageSizeUnit, value));
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

            if (value && value.profiles)
                stateDelta.profile = value.profiles.sort().reverse()[0];

            if (value && value.minimumResources.ram) {
                stateDelta.minimumMemory = value.minimumResources.ram;

                const converted = convertToUnit(stateDelta.minimumMemory, units.B, units.GiB);
                if (converted == 0 || converted % 1 !== 0) // If minimum memory is not a whole number in GiB, set value in MiB
                    this.setState({ memorySizeUnit: units.MiB.name }, () => this.onValueChanged("memorySize", Math.floor(convertToUnit(stateDelta.minimumMemory, units.B, units.MiB))));
                else
                    this.setState({ memorySizeUnit: units.GiB.name }, () => this.onValueChanged("memorySize", converted));
            }

            if (value && value.minimumResources.storage) {
                stateDelta.minimumStorage = value.minimumResources.storage;

                const converted = convertToUnit(stateDelta.minimumStorage, units.B, this.state.storageSizeUnit);
                if (converted == 0 || converted % 1 !== 0) // If minimum storage is not a whole number in GiB, set value in MiB
                    this.setState({ storageSizeUnit: units.MiB.name }, () => this.onValueChanged("storageSize", Math.floor(convertToUnit(stateDelta.minimumStorage, units.B, units.MiB))));
                else
                    this.setState({ storageSizeUnit: units.GiB.name }, () => this.onValueChanged("storageSize", converted));
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
        const { dispatch, storagePools, close, onAddErrorNotification, osInfoList, nodeMaxMemory, vms } = this.props;

        const validation = validateParams({ ...this.state, osInfoList, nodeMaxMemory, vms: vms.filter(vm => vm.connectionName == this.state.connectionName) });
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
                userPassword: this.state.userPassword,
                rootPassword: this.state.rootPassword,
                userLogin: this.state.userLogin,
                useCloudInit: this.state.useCloudInit,
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
        const validationFailed = this.state.validate && validateParams({ ...this.state, osInfoList, nodeMaxMemory, vms: vms.filter(vm => vm.connectionName == this.state.connectionName) });
        let startVmCheckbox = (
            <FormGroup fieldId="start-vm">
                <Checkbox id="start-vm"
                    isChecked={this.state.startVm}
                    isDisabled={this.state.unattendedInstallation}
                    label={_("Immediately start VM")}
                    onChange={checked => this.onValueChanged('startVm', checked)} />
            </FormGroup>
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
            <Form isHorizontal>
                <NameRow
                    vmName={this.state.vmName}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed} />

                <MachinesConnectionSelector id='connection'
                    connectionName={this.state.connectionName}
                    onValueChanged={this.onValueChanged}
                    loggedUser={loggedUser} />

                <SourceRow
                    connectionName={this.state.connectionName}
                    networks={networks.filter(network => network.connectionName == this.state.connectionName)}
                    nodeDevices={nodeDevices.filter(nodeDevice => nodeDevice.connectionName == this.state.connectionName)}
                    source={this.state.source}
                    sourceType={this.state.sourceType}
                    os={this.state.os}
                    osInfoList={this.props.osInfoList}
                    cloudInitSupported={this.props.cloudInitSupported}
                    downloadOSSupported={this.props.downloadOSSupported}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed} />

                {this.state.sourceType != DOWNLOAD_AN_OS &&
                <>
                    <OSRow
                        os={this.state.os}
                        osInfoList={this.props.osInfoList}
                        onValueChanged={this.onValueChanged}
                        isLoading={this.state.autodetectOSInProgress}
                        validationFailed={validationFailed} />

                </>}

                { this.state.sourceType != EXISTING_DISK_IMAGE_SOURCE &&
                <StorageRow
                    allowNoDisk={this.state.sourceType !== CLOUD_IMAGE}
                    connectionName={this.state.connectionName}
                    storageSize={this.state.storageSize}
                    storageSizeUnit={this.state.storageSizeUnit}
                    onValueChanged={this.onValueChanged}
                    storagePoolName={this.state.storagePool}
                    storagePools={storagePools.filter(pool => pool.connectionName === this.state.connectionName)}
                    storageVolume={this.state.storageVolume}
                    vms={vms}
                    minimumStorage={this.state.minimumStorage}
                    validationFailed={validationFailed}
                />}

                <MemoryRow
                    memorySize={this.state.memorySize}
                    memorySizeUnit={this.state.memorySizeUnit}
                    nodeMaxMemory={nodeMaxMemory}
                    onValueChanged={this.onValueChanged}
                    validationFailed={validationFailed}
                    minimumMemory={this.state.minimumMemory}
                />

                {this.state.sourceType != PXE_SOURCE &&
                 this.state.sourceType != EXISTING_DISK_IMAGE_SOURCE &&
                 this.state.sourceType != CLOUD_IMAGE &&
                 this.props.unattendedSupported &&
                 <>
                     <UnattendedRow
                         validationFailed={validationFailed}
                         rootPassword={this.state.rootPassword}
                         userLogin={this.state.userLogin}
                         userPassword={this.state.userPassword}
                         unattendedDisabled={unattendedDisabled}
                         unattendedInstallation={this.state.unattendedInstallation}
                         unattendedUserLogin={this.props.unattendedUserLogin}
                         os={this.state.os}
                         profile={this.state.profile}
                         onValueChanged={this.onValueChanged} />
                 </>}

                {this.state.sourceType == CLOUD_IMAGE &&
                 this.props.cloudInitSupported &&
                 <CloudInitOptionsRow validationFailed={validationFailed}
                                      rootPassword={this.state.rootPassword}
                                      userLogin={this.state.userLogin}
                                      userPassword={this.state.userPassword}
                                      useCloudInit={this.state.useCloudInit}
                                      onValueChanged={this.onValueChanged} />}

                {this.state.sourceType !== CLOUD_IMAGE && startVmCheckbox}
            </Form>
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
            cloudInitSupported: undefined,
            downloadOSSupported: undefined,
            unattendedSupported: undefined,
            unattendedUserLogin: undefined,
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

                    cockpit.spawn(['virt-install', '--cloud-init=?'], { err: 'ignore' })
                            .then(() => this.setState({ cloudInitSupported: true }),
                                  () => this.setState({ cloudInitSupported: false }));

                    cockpit.spawn(['virt-install', '--unattended=?'], { err: 'ignore' })
                            .then(options => this.setState({ unattendedSupported: true, unattendedUserLogin: options.includes('user-login') }),
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
                    cloudInitSupported={this.state.cloudInitSupported}
                    downloadOSSupported={this.state.downloadOSSupported}
                    unattendedSupported={this.state.unattendedSupported}
                    unattendedUserLogin={this.state.unattendedUserLogin}
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
