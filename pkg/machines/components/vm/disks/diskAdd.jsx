/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import {
    Alert, Button, Checkbox,
    ExpandableSection, Form, FormGroup, FormSection,
    FormSelect, FormSelectOption,
    Modal, Radio, Spinner,
} from '@patternfly/react-core';
import cockpit from 'cockpit';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { units, convertToUnit, getDefaultVolumeFormat, getNextAvailableTarget, getStorageVolumesUsage, getStorageVolumeDiskTarget } from '../../../helpers.js';
import { volumeCreateAndAttach, attachDisk, getVm, getAllStoragePools } from '../../../actions/provider-actions.js';
import { VolumeCreateBody } from '../../storagePools/storageVolumeCreateBody.jsx';
import LibvirtDBus, { updateDiskAttributes } from '../../../libvirt-dbus.js';

import 'form-layout.scss';
import './diskAdd.css';

const _ = cockpit.gettext;

const CREATE_NEW = 'create-new';
const USE_EXISTING = 'use-existing';

function getFilteredVolumes(vmStoragePool, disks) {
    const usedDiskPaths = Object.getOwnPropertyNames(disks)
            .filter(target => disks[target].source && (disks[target].source.file || disks[target].source.volume))
            .map(target => (disks[target].source && (disks[target].source.file || disks[target].source.volume)));

    const filteredVolumes = vmStoragePool.volumes.filter(volume => !usedDiskPaths.includes(volume.path) && !usedDiskPaths.includes(volume.name));

    const filteredVolumesSorted = filteredVolumes.sort(function(a, b) {
        return a.name.localeCompare(b.name);
    });

    return filteredVolumesSorted;
}

const SelectExistingVolume = ({ idPrefix, storagePoolName, existingVolumeName, onValueChanged, vmStoragePools, vmDisks }) => {
    const vmStoragePool = vmStoragePools.find(pool => pool.name == storagePoolName);
    const filteredVolumes = getFilteredVolumes(vmStoragePool, vmDisks);

    let initiallySelected;
    let content;
    if (filteredVolumes.length > 0) {
        content = filteredVolumes.map(volume => {
            return (
                <FormSelectOption value={volume.name} key={volume.name}
                                  label={volume.name} />
            );
        });
        initiallySelected = existingVolumeName;
    } else {
        content = (
            <FormSelectOption value="empty" key="empty-list"
                              label={_("The pool is empty")} />
        );
        initiallySelected = "empty";
    }

    return (
        <FormGroup fieldId={`${idPrefix}-select-volume`} label={_("Volume")}>
            <FormSelect id={`${idPrefix}-select-volume`}
                        onChange={value => onValueChanged('existingVolumeName', value)}
                        value={initiallySelected}
                        isDisabled={!filteredVolumes.length}>
                {content}
            </FormSelect>
        </FormGroup>
    );
};

const PermanentChange = ({ idPrefix, onValueChanged, permanent, vm }) => {
    // By default for a running VM, the disk is attached until shut down only. Enable permanent change of the domain.xml
    if (!LibvirtDBus.isRunning(vm.state)) {
        return null;
    }

    return (
        <FormGroup fieldId={`${idPrefix}-permanent`} label={_("Persistence")} isInline>
            <Checkbox id={`${idPrefix}-permanent`}
                      isChecked={permanent}
                      label={_("Always attach")}
                      onChange={checked => onValueChanged('permanent', checked)} />
        </FormGroup>
    );
};

const PoolRow = ({ idPrefix, onValueChanged, storagePoolName, vmStoragePools }) => {
    return (
        <FormGroup fieldId={`${idPrefix}-select-pool`}
                   label={_("Pool")}>
            <FormSelect id={`${idPrefix}-select-pool`}
                           isDisabled={!vmStoragePools.length || !vmStoragePools.every(pool => pool.volumes !== undefined)}
                           onChange={value => onValueChanged('storagePoolName', value)}
                           value={storagePoolName || 'no-resource'}>
                {vmStoragePools.length > 0 ? vmStoragePools
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(pool => {
                            return (
                                <FormSelectOption isDisabled={pool.disabled} value={pool.name} key={pool.name}
                                                  label={pool.name} />
                            );
                        })
                    : [<FormSelectOption value='no-resource' key='no-resource'
                                         label={_("No storage pools available")} />]}
            </FormSelect>
        </FormGroup>
    );
};

class AdditionalOptions extends React.Component {
    constructor(props) {
        super(props);
        this.state = { expanded: false };
    }

    render() {
        const cacheModes = ['default', 'none', 'writethrough', 'writeback', 'directsync', 'unsafe'];
        const busTypes = ['sata', 'scsi', 'usb', 'virtio'];

        return (
            <ExpandableSection toggleText={ this.state.expanded ? _("Hide additional options") : _("Show additional options")}
                               onToggle={() => this.setState({ expanded: !this.state.expanded })} isExpanded={this.state.expanded} className="add-disk-additional-options">
                <FormSection className="ct-form-split">
                    <FormGroup fieldId='cache-mode' label={_("Cache")}>
                        <FormSelect id='cache-mode'
                            onChange={value => this.props.onValueChanged('cacheMode', value)}
                            value={this.props.cacheMode}
                            className='ct-form-split'>
                            {cacheModes.map(cacheMode => {
                                return (
                                    <FormSelectOption value={cacheMode} key={cacheMode}
                                                      label={cacheMode} />
                                );
                            })}
                        </FormSelect>
                    </FormGroup>

                    <FormGroup fieldId='bus-type' label={_("Bus")}>
                        <FormSelect id='bus-type'
                            onChange={value => this.props.onValueChanged('busType', value)}
                            value={this.props.busType}
                            className='ct-form-split'>
                            {busTypes.map(busType => {
                                return (
                                    <FormSelectOption value={busType} key={busType}
                                                      label={busType} />
                                );
                            })}
                        </FormSelect>
                    </FormGroup>
                </FormSection>
            </ExpandableSection>
        );
    }
}

const CreateNewDisk = ({ idPrefix, onValueChanged, validationFailed, dialogValues, vmStoragePools, vm }) => {
    const storagePool = vmStoragePools.find(pool => pool.name == dialogValues.storagePoolName);
    const poolTypesNotSupportingVolumeCreation = ['iscsi', 'iscsi-direct', 'gluster', 'mpath'];

    return (
        <>
            <PoolRow idPrefix={idPrefix}
                     storagePoolName={dialogValues.storagePoolName}
                     validationFailed={validationFailed}
                     onValueChanged={onValueChanged}
                     vmStoragePools={vmStoragePools.map(pool => ({ ...pool, disabled: poolTypesNotSupportingVolumeCreation.includes(pool.type) }))} />
            {storagePool &&
            <VolumeCreateBody idPrefix={idPrefix}
                              storagePool={storagePool}
                              validationFailed={validationFailed}
                              dialogValues={dialogValues}
                              onValueChanged={onValueChanged} />}
        </>
    );
};

const ChangeShareable = ({ idPrefix, vms, storagePool, volumeName, onValueChanged }) => {
    const isVolumeUsed = getStorageVolumesUsage(vms, storagePool);
    const volume = storagePool.volumes.find(vol => vol.name === volumeName);

    if (!isVolumeUsed[volumeName] || (isVolumeUsed[volumeName].length === 0))
        return null;

    const vmsUsing = isVolumeUsed[volumeName].join(', ') + '.';
    let text = _("This volume is already used by: ") + vmsUsing;
    if (volume.format === "raw")
        text += _("Attaching it will make this disk shareable for every VM using it.");

    return <Alert isInline variant='warning' id={`${idPrefix}-vms-usage`} title={text} />;
};

const UseExistingDisk = ({ idPrefix, onValueChanged, validationFailed, dialogValues, vmStoragePools, vm, vms }) => {
    return (
        <>
            <PoolRow idPrefix={idPrefix}
                     storagePoolName={dialogValues.storagePoolName}
                     validationFailed={validationFailed}
                     onValueChanged={onValueChanged}
                     vmStoragePools={vmStoragePools} />
            {vmStoragePools.length > 0 && <>
                <SelectExistingVolume idPrefix={idPrefix}
                                      storagePoolName={dialogValues.storagePoolName}
                                      existingVolumeName={dialogValues.existingVolumeName}
                                      onValueChanged={onValueChanged}
                                      vmStoragePools={vmStoragePools}
                                      vmDisks={vm.disks} />
                <ChangeShareable idPrefix={idPrefix}
                    vms={vms}
                    storagePool={vmStoragePools.find(pool => pool.name === dialogValues.storagePoolName)}
                    volumeName={dialogValues.existingVolumeName}
                    onValueChanged={onValueChanged} />
            </>}
        </>
    );
};

export class AddDiskModalBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            ...this.initialState,
            validate: false,
            dialogLoading: true
        };
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.onAddClicked = this.onAddClicked.bind(this);
        this.getDefaultVolumeName = this.getDefaultVolumeName.bind(this);
        this.existingVolumeNameDelta = this.existingVolumeNameDelta.bind(this);
        this.validateParams = this.validateParams.bind(this);
    }

    get initialState() {
        const { vm, storagePools } = this.props;
        const defaultBus = 'virtio';
        const existingTargets = Object.getOwnPropertyNames(vm.disks);
        const availableTarget = getNextAvailableTarget(existingTargets, defaultBus);
        const sortFunction = (poolA, poolB) => poolA.name.localeCompare(poolB.name);
        let defaultPool;
        if (storagePools.length > 0)
            defaultPool = storagePools
                    .map(pool => ({ name: pool.name, type: pool.type }))
                    .sort(sortFunction)[0];

        return {
            storagePoolName: defaultPool && defaultPool.name,
            mode: CREATE_NEW,
            volumeName: undefined,
            existingVolumeName: undefined,
            size: 1,
            unit: units.GiB.name,
            format: defaultPool && getDefaultVolumeFormat(defaultPool),
            target: availableTarget,
            permanent: !LibvirtDBus.isRunning(vm.state), // default true for a down VM; for a running domain, the disk is attached tentatively only
            hotplug: LibvirtDBus.isRunning(vm.state), // must be kept false for a down VM; the value is not being changed by user
            addDiskInProgress: false,
            cacheMode: 'default',
            busType: defaultBus,
            updateDisks: false,
        };
    }

    componentDidMount() {
        // Refresh storage volume list before displaying the dialog.
        // There are recently no Libvirt events for storage volumes and polling is ugly.
        // https://bugzilla.redhat.com/show_bug.cgi?id=1578836
        this.props.dispatch(getAllStoragePools(this.props.vm.connectionName))
                .fail(exc => this.dialogErrorSet(_("Disk settings could not be saved"), exc.message))
                .then(() => this.setState({ dialogLoading: false }));
    }

    validateParams() {
        const validationFailed = {};

        if (!this.state.storagePoolName)
            validationFailed.storagePool = _("Please choose a storage pool");

        if (this.state.mode === CREATE_NEW) {
            if (!this.state.volumeName) {
                validationFailed.volumeName = _("Please enter new volume name");
            }
            const poolCapacity = parseFloat(convertToUnit(this.props.storagePools.find(pool => pool.name == this.state.storagePoolName).capacity, units.B, this.state.unit));
            if (this.state.size > poolCapacity) {
                validationFailed.size = cockpit.format(_("Storage volume size must not exceed the storage pool's capacity ($0 $1)"), poolCapacity.toFixed(2), this.state.unit);
            }
        } else if (this.state.mode === USE_EXISTING) {
            if (!this.state.existingVolumeName)
                validationFailed.existingVolumeName = _("Please choose a volume");
        }

        return validationFailed;
    }

    existingVolumeNameDelta(value, poolName) {
        const { storagePools, vm } = this.props;
        const stateDelta = { existingVolumeName: value };
        const pool = storagePools.find(pool => pool.name === poolName && pool.connectionName === vm.connectionName);
        stateDelta.format = getDefaultVolumeFormat(pool);
        if (['dir', 'fs', 'netfs', 'gluster', 'vstorage'].indexOf(pool.type) > -1) {
            const volume = pool.volumes.find(vol => vol.name === value);
            if (volume && volume.format)
                stateDelta.format = volume.format;
        }
        return stateDelta;
    }

    getDefaultVolumeName(poolName) {
        const { storagePools, vm } = this.props;
        const vmStoragePool = storagePools.find(pool => pool.name == poolName);
        const filteredVolumes = getFilteredVolumes(vmStoragePool, vm.disks);
        return filteredVolumes[0] && filteredVolumes[0].name;
    }

    onValueChanged(key, value) {
        let stateDelta = {};
        const { storagePools, vm } = this.props;

        switch (key) {
        case 'storagePoolName': {
            const currentPool = storagePools.find(pool => pool.name === value && pool.connectionName === vm.connectionName);
            const prevPool = storagePools.find(pool => pool.name === this.state.storagePoolName && pool.connectionName === vm.connectionName);
            this.setState({ storagePoolName: value });
            // Reset the format only when the Format selection dropdown changes entries - otherwise just keep the old selection
            // All pool types apart from 'disk' have either 'raw' or 'qcow2' format
            if (currentPool && prevPool && ((currentPool.type == 'disk' && prevPool.type != 'disk') || (currentPool.type != 'disk' && prevPool.type == 'disk')))
                this.onValueChanged('format', getDefaultVolumeFormat(value));

            if (this.state.mode === USE_EXISTING) { // user changed pool
                this.onValueChanged('existingVolumeName', this.getDefaultVolumeName(value));
            }
            break;
        }
        case 'existingVolumeName': {
            stateDelta.existingVolumeName = value;
            this.setState(prevState => { // to prevent asynchronous for recursive call with existingVolumeName as a key
                return this.existingVolumeNameDelta(value, prevState.storagePoolName);
            });
            break;
        }
        case 'mode': {
            this.setState(prevState => { // to prevent asynchronous for recursive call with existingVolumeName as a key
                stateDelta = this.initialState;
                if (value === USE_EXISTING) { // user moved to USE_EXISTING subtab
                    stateDelta.mode = value;
                    const poolName = stateDelta.storagePoolName;
                    if (poolName)
                        stateDelta = { ...stateDelta, ...this.existingVolumeNameDelta(this.getDefaultVolumeName(poolName), prevState.storagePoolName) };
                }

                return stateDelta;
            });

            break;
        }
        case 'busType': {
            const existingTargets = Object.getOwnPropertyNames(this.props.vm.disks);
            const availableTarget = getNextAvailableTarget(existingTargets, value);
            this.onValueChanged('target', availableTarget);
            this.setState({ busType: value });
            break;
        }
        default:
            this.setState({ [key]: value });
        }
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    onAddClicked() {
        const { vm, dispatch, close, vms, storagePools } = this.props;

        const validation = this.validateParams();
        if (Object.getOwnPropertyNames(validation).length > 0)
            return this.setState({ addDiskInProgress: false, validate: true });

        if (this.state.mode === CREATE_NEW) {
            this.setState({ addDiskInProgress: true, validate: false });
            // create new disk
            return dispatch(volumeCreateAndAttach({
                connectionName: vm.connectionName,
                poolName: this.state.storagePoolName,
                volumeName: this.state.volumeName,
                size: convertToUnit(this.state.size, this.state.unit, 'MiB'),
                format: this.state.format,
                target: this.state.target,
                permanent: this.state.permanent,
                hotplug: this.state.hotplug,
                vmName: vm.name,
                vmId: vm.id,
                cacheMode: this.state.cacheMode,
                busType: this.state.busType
            }))
                    .fail(exc => {
                        this.setState({ addDiskInProgress: false });
                        this.dialogErrorSet(_("Disk failed to be created"), exc.message);
                    })
                    .then(() => { // force reload of VM data, events are not reliable (i.e. for a down VM)
                        close();
                        return dispatch(getVm({ connectionName: vm.connectionName, name: vm.name, id: vm.id }));
                    });
        }

        // use existing volume
        const storagePool = storagePools.find(pool => pool.name === this.state.storagePoolName);
        const volume = storagePool.volumes.find(vol => vol.name === this.state.existingVolumeName);
        const isVolumeUsed = getStorageVolumesUsage(vms, storagePool);

        return dispatch(attachDisk({
            connectionName: vm.connectionName,
            poolName: this.state.storagePoolName,
            volumeName: this.state.existingVolumeName,
            format: this.state.format,
            target: this.state.target,
            permanent: this.state.permanent,
            hotplug: this.state.hotplug,
            vmName: vm.name,
            vmId: vm.id,
            cacheMode: this.state.cacheMode,
            shareable: volume && volume.format === "raw" && isVolumeUsed[this.state.existingVolumeName],
            busType: this.state.busType
        }))
                .fail(exc => {
                    this.setState({ addDiskInProgress: false });
                    this.dialogErrorSet(_("Disk failed to be attached"), exc.message);
                })
                .then(() => { // force reload of VM data, events are not reliable (i.e. for a down VM)
                    const promises = [];
                    if (volume.format === "raw" && isVolumeUsed[this.state.existingVolumeName]) {
                        isVolumeUsed[this.state.existingVolumeName].forEach(vmName => {
                            const vm = vms.find(vm => vm.name === vmName);
                            const diskTarget = getStorageVolumeDiskTarget(vm, storagePool, this.state.existingVolumeName);

                            promises.push(
                                updateDiskAttributes({ connectionName: vm.connectionName, objPath: vm.id, readonly: false, shareable: true, target: diskTarget })
                                        .fail(exc => this.dialogErrorSet(_("Disk settings could not be saved"), exc.message))
                            );
                        });

                        Promise.all(promises)
                                .then(() => close());
                    } else {
                        close();
                    }

                    return dispatch(getVm({ connectionName: vm.connectionName, name: vm.name, id: vm.id }));
                });
    }

    render() {
        const { vm, storagePools, vms } = this.props;
        const idPrefix = `${this.props.idPrefix}-adddisk`;
        const validationFailed = this.state.validate ? this.validateParams() : {};

        let defaultBody;
        if (this.state.dialogLoading) {
            defaultBody = <Spinner />;
        } else {
            defaultBody = (
                <Form isHorizontal>
                    <FormGroup fieldId={`${idPrefix}-source`}
                               label={_("Source")} isInline>
                        <Radio id={`${idPrefix}-createnew`}
                               name="source"
                               label={_("Create new")}
                               isChecked={this.state.mode === CREATE_NEW}
                               onChange={() => this.onValueChanged('mode', CREATE_NEW)} />
                        <Radio id={`${idPrefix}-useexisting`}
                               name="source"
                               label={_("Use existing")}
                               isChecked={this.state.mode === USE_EXISTING}
                               onChange={e => this.onValueChanged('mode', USE_EXISTING)} />
                    </FormGroup>
                    {this.state.mode === CREATE_NEW && (
                        <CreateNewDisk idPrefix={`${idPrefix}-new`}
                                       onValueChanged={this.onValueChanged}
                                       dialogValues={this.state}
                                       validationFailed={validationFailed}
                                       vmStoragePools={storagePools}
                                       vm={vm} />
                    )}
                    {this.state.mode === USE_EXISTING && (
                        <UseExistingDisk idPrefix={`${idPrefix}-existing`}
                                         onValueChanged={this.onValueChanged}
                                         dialogValues={this.state}
                                         validationFailed={validationFailed}
                                         vmStoragePools={storagePools}
                                         vms={vms}
                                         vm={vm} />
                    )}
                    {vm.persistent &&
                    <PermanentChange idPrefix={idPrefix}
                                     permanent={this.state.permanent}
                                     onValueChanged={this.onValueChanged}
                                     vm={vm} />}
                    <AdditionalOptions cacheMode={this.state.cacheMode}
                                       onValueChanged={this.onValueChanged}
                                       busType={this.state.busType} />
                </Form>
            );
        }

        return (
            <Modal position="top" variant="medium" id={`${idPrefix}-dialog-modal-window`} isOpen onClose={this.props.close}
                   title={_("Add disk")}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button id={`${idPrefix}-dialog-add`} variant='primary' isLoading={this.state.addDiskInProgress} isDisabled={this.state.addDiskInProgress || storagePools.length == 0} onClick={this.onAddClicked}>
                               {_("Add")}
                           </Button>
                           <Button id={`${idPrefix}-dialog-cancel`} variant='link' className='btn-cancel' onClick={this.props.close}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                {defaultBody}
            </Modal>
        );
    }
}
