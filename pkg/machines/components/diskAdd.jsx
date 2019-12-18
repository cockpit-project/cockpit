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
import { Button, Modal } from 'patternfly-react';
import cockpit from 'cockpit';

import * as Select from "cockpit-components-select.jsx";
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { units, convertToUnit, getDefaultVolumeFormat, getStorageVolumesUsage, getStorageVolumeDiskTarget } from '../helpers.js';
import { volumeCreateAndAttach, attachDisk, getVm } from '../actions/provider-actions.js';
import { VolumeCreateBody } from './storagePools/storageVolumeCreateBody.jsx';
import { changeDiskAccessPolicy } from '../libvirt-dbus.js';

import 'form-layout.less';
import './diskAdd.css';

const _ = cockpit.gettext;

const CREATE_NEW = 'create-new';
const USE_EXISTING = 'use-existing';

function getNextAvailableTarget(vm) {
    const existingTargets = Object.getOwnPropertyNames(vm.disks);
    const targets = [];
    let i = 0;
    while (i < 26 && targets.length < 5) {
        const target = `vd${String.fromCharCode(97 + i)}`;
        if (!existingTargets.includes(target))
            return target;
        i++;
    }
}

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
                <Select.SelectEntry data={volume.name} key={volume.name}>
                    {volume.name}
                </Select.SelectEntry>
            );
        });
        initiallySelected = existingVolumeName;
    } else {
        content = (
            <Select.SelectEntry data="empty" key="empty-list">
                {_("The pool is empty")}
            </Select.SelectEntry>
        );
        initiallySelected = "empty";
    }

    return (
        <>
            <label className='control-label' htmlFor={`${idPrefix}-select-volume`}>
                {_("Volume")}
            </label>
            <Select.Select id={`${idPrefix}-select-volume`}
                           onChange={value => onValueChanged('existingVolumeName', value)}
                           initial={initiallySelected}
                           enabled={filteredVolumes.length > 0}
                           extraClass='form-control'>
                {content}
            </Select.Select>
        </>
    );
};

const PermanentChange = ({ idPrefix, onValueChanged, permanent, provider, vm }) => {
    // By default for a running VM, the disk is attached until shut down only. Enable permanent change of the domain.xml
    if (!provider.isRunning(vm.state)) {
        return null;
    }

    return (
        <>
            <label className="control-label"> {_("Persistence")} </label>
            <label className='checkbox-inline'>
                <input id={`${idPrefix}-permanent`}
                       type="checkbox"
                       checked={permanent}
                       onChange={e => onValueChanged('permanent', e.target.checked)} />
                {_("Always attach")}
            </label>
        </>
    );
};

const PoolRow = ({ idPrefix, onValueChanged, storagePoolName, vmStoragePools }) => {
    return (
        <>
            <label className='control-label' htmlFor={`${idPrefix}-select-pool`}>
                {_("Pool")}
            </label>
            <Select.Select id={`${idPrefix}-select-pool`}
                           enabled={vmStoragePools.length > 0}
                           onChange={value => onValueChanged('storagePoolName', value)}
                           initial={storagePoolName || _("No Storage Pools available")}
                           extraClass="form-control">
                {vmStoragePools.length > 0 ? vmStoragePools
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(pool => {
                            return (
                                <Select.SelectEntry disabled={pool.disabled} title={pool.disabled ? _("This pool type does not support Storage Volume creation") : null} data={pool.name} key={pool.name}>
                                    {pool.name}
                                </Select.SelectEntry>
                            );
                        })
                    : [<Select.SelectEntry data='no-resource' key='no-resource'>
                        {_("No Storage Pools available")}
                    </Select.SelectEntry>]}
            </Select.Select>
        </>
    );
};

class PerformanceOptions extends React.Component {
    constructor(props) {
        super(props);
        this.state = { expanded: false };
    }

    render() {
        const cacheModes = ['default', 'none', 'writethrough', 'writeback', 'directsync', 'unsafe'];

        return (
            <>
                <div className='expand-collapse-pf' id='expand-collapse-button'>
                    <div className='expand-collapse-pf-link-container'>
                        <button className='btn btn-link' onClick={() => this.setState({ expanded: !this.state.expanded })}>
                            { this.state.expanded ? <span className='fa fa-angle-down' /> : <span className='fa fa-angle-right' /> }
                            { this.state.expanded ? _("Hide Performance Options") : _("Show Performance Options")}
                        </button>
                        <span className="expand-collapse-pf-separator bordered" />
                    </div>
                </div>

                {this.state.expanded && <>
                    <label className='control-label' htmlFor='cache-mode'>
                        {_("Cache")}
                    </label>
                    <Select.Select id='cache-mode'
                        onChange={value => this.props.onValueChanged('cacheMode', value)}
                        initial={this.props.cacheMode}
                        extraClass='form-control ct-form-split'>
                        {cacheModes.map(cacheMode => {
                            return (
                                <Select.SelectEntry data={cacheMode} key={cacheMode}>
                                    {cacheMode}
                                </Select.SelectEntry>
                            );
                        })}
                    </Select.Select>
                </>}
            </>
        );
    }
}

const CreateNewDisk = ({ idPrefix, onValueChanged, dialogValues, vmStoragePools, provider, vm }) => {
    const storagePool = vmStoragePools.find(pool => pool.name == dialogValues.storagePoolName);
    const poolTypesNotSupportingVolumeCreation = ['iscsi', 'iscsi-direct', 'gluster', 'mpath'];

    return (
        <>
            <hr />
            <PoolRow idPrefix={idPrefix}
                     storagePoolName={dialogValues.storagePoolName}
                     onValueChanged={onValueChanged}
                     vmStoragePools={vmStoragePools.map(pool => ({ ...pool, disabled: poolTypesNotSupportingVolumeCreation.includes(pool.type) }))} />
            {storagePool &&
            <>
                <hr />
                <VolumeCreateBody idPrefix={idPrefix}
                                  storagePool={storagePool}
                                  dialogValues={dialogValues}
                                  onValueChanged={onValueChanged} />
                <hr />
                <PermanentChange idPrefix={idPrefix}
                                 permanent={dialogValues.permanent}
                                 onValueChanged={onValueChanged}
                                 provider={provider}
                                 vm={vm} />
                {provider.name == 'LibvirtDBus' && <PerformanceOptions cacheMode={dialogValues.cacheMode}
                                    onValueChanged={onValueChanged} />}
            </>}
        </>
    );
};

const ChangeShareable = ({ idPrefix, vms, storagePool, volumeName, onValueChanged, providerName }) => {
    const isVolumeUsed = getStorageVolumesUsage(vms, storagePool);
    const volume = storagePool.volumes.find(vol => vol.name === volumeName);

    if (!isVolumeUsed[volumeName] || (isVolumeUsed[volumeName].length === 0))
        return null;

    const vmsUsing = isVolumeUsed[volumeName].join(', ') + '.';
    let text = _("This volume is already used by: ") + vmsUsing;
    if (providerName == 'LibvirtDBus' && volume.format === "raw")
        text += _(" Attaching it will make this disk shareable for every VM using it.");

    return (<>
        <span id={`${idPrefix}-vms-usage`} className='idle-message'>
            <i className='pficon pficon-warning-triangle-o' />
            <span>{text}</span>
        </span>
    </>);
};

const UseExistingDisk = ({ idPrefix, onValueChanged, dialogValues, vmStoragePools, provider, vm, vms }) => {
    return (
        <>
            <hr />
            <PoolRow idPrefix={idPrefix}
                     storagePoolName={dialogValues.storagePoolName}
                     onValueChanged={onValueChanged}
                     vmStoragePools={vmStoragePools} />
            <hr />
            {vmStoragePools.length > 0 &&
            <>
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
                    onValueChanged={onValueChanged}
                    providerName={provider.name} />
                <hr />
                <PermanentChange idPrefix={idPrefix}
                                 permanent={dialogValues.PermanentChange}
                                 onValueChanged={onValueChanged}
                                 provider={provider}
                                 vm={vm} />
                {provider.name == 'LibvirtDBus' && <PerformanceOptions cacheMode={dialogValues.cacheMode}
                                    onValueChanged={onValueChanged} />}
            </>}
        </>
    );
};

export class AddDiskModalBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = this.initialState;
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.onAddClicked = this.onAddClicked.bind(this);
        this.getDefaultVolumeName = this.getDefaultVolumeName.bind(this);
    }

    get initialState() {
        const { vm, storagePools, provider } = this.props;
        const availableTarget = getNextAvailableTarget(vm);
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
            permanent: !provider.isRunning(vm.state), // default true for a down VM; for a running domain, the disk is attached tentatively only
            hotplug: provider.isRunning(vm.state), // must be kept false for a down VM; the value is not being changed by user
            addDiskInProgress: false,
            cacheMode: 'default',
            updateDisks: false,
        };
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
            if ((currentPool.type == 'disk' && prevPool.type != 'disk') || (currentPool.type != 'disk' && prevPool.type == 'disk'))
                this.onValueChanged('format', getDefaultVolumeFormat(value));

            if (this.state.mode === USE_EXISTING) { // user changed pool
                this.onValueChanged('existingVolumeName', this.getDefaultVolumeName(value));
            }
            break;
        }
        case 'existingVolumeName': {
            stateDelta.existingVolumeName = value;
            this.setState(prevState => { // to prevent asynchronous for recursive call with existingVolumeName as a key
                const pool = storagePools.find(pool => pool.name === prevState.storagePoolName && pool.connectionName === vm.connectionName);
                stateDelta.format = getDefaultVolumeFormat(pool);
                if (['dir', 'fs', 'netfs', 'gluster', 'vstorage'].indexOf(pool.type) > -1) {
                    const volume = pool.volumes.find(vol => vol.name === value);
                    if (volume && volume.format)
                        stateDelta.format = volume.format;
                }
                return stateDelta;
            });
            break;
        }
        case 'mode': {
            stateDelta = this.initialState;
            if (value === USE_EXISTING) { // user moved to USE_EXISTING subtab
                stateDelta.mode = value;
                const poolName = this.state.storagePoolName;
                if (poolName)
                    stateDelta.existingVolumeName = this.getDefaultVolumeName(poolName);
            }
            this.setState(stateDelta);
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
        const { vm, dispatch, provider, close, vms, storagePools } = this.props;

        if (this.state.mode === CREATE_NEW) {
            // validate
            if (!this.state.volumeName) {
                return this.dialogErrorSet(_("Please enter new volume name"));
            }
            if (!(this.state.size > 0)) { // must be positive number
                return this.dialogErrorSet(_("Please enter new volume size"));
            }

            this.setState({ addDiskInProgress: true });
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
                cacheMode: this.state.cacheMode
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
            shareable: provider.name == 'LibvirtDBus' && volume.format === "raw" && isVolumeUsed[this.state.existingVolumeName],
        }))
                .fail(exc => {
                    this.setState({ addDiskInProgress: false });
                    this.dialogErrorSet(_("Disk failed to be attached"), exc.message);
                })
                .then(() => { // force reload of VM data, events are not reliable (i.e. for a down VM)
                    const promises = [];

                    if (provider.name == 'LibvirtDBus' && volume.format === "raw" && isVolumeUsed[this.state.existingVolumeName]) {
                        isVolumeUsed[this.state.existingVolumeName].forEach(vmName => {
                            const vm = vms.find(vm => vm.name === vmName);
                            const diskTarget = getStorageVolumeDiskTarget(vm, storagePool, this.state.existingVolumeName);
                            promises.push(
                                changeDiskAccessPolicy(vm.connectionName, vm.id, diskTarget, false, true) // readonly - false, shareable - true
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
        const { vm, storagePools, provider, vms } = this.props;
        const idPrefix = `${this.props.idPrefix}-adddisk`;

        const defaultBody = (
            <div className='ct-form'>
                <label className='control-label' htmlFor={`${idPrefix}-source`}>
                    {_("Source")}
                </label>
                <fieldset className='form-inline'>
                    <div className='radio'>
                        <label>
                            <input id={`${idPrefix}-createnew`}
                                   type="radio"
                                   name="source"
                                   checked={this.state.mode === CREATE_NEW}
                                   onChange={e => this.onValueChanged('mode', CREATE_NEW)}
                                   className={this.state.mode === CREATE_NEW ? "active" : ''} />
                            {_("Create New")}
                        </label>
                        <label>
                            <input id={`${idPrefix}-useexisting`}
                                   type="radio"
                                   name="source"
                                   checked={this.state.mode === USE_EXISTING}
                                   onChange={e => this.onValueChanged('mode', USE_EXISTING)}
                                   className={this.state.mode === USE_EXISTING ? "active" : ''} />
                            {_("Use Existing")}
                        </label>
                    </div>
                </fieldset>
                {this.state.mode === CREATE_NEW && (
                    <CreateNewDisk idPrefix={`${idPrefix}-new`}
                                   onValueChanged={this.onValueChanged}
                                   dialogValues={this.state}
                                   vmStoragePools={storagePools}
                                   provider={provider}
                                   vm={vm} />
                )}
                {this.state.mode === USE_EXISTING && (
                    <UseExistingDisk idPrefix={`${idPrefix}-existing`}
                                     onValueChanged={this.onValueChanged}
                                     dialogValues={this.state}
                                     vmStoragePools={storagePools}
                                     provider={provider}
                                     vms={vms}
                                     vm={vm} />
                )}
            </div>
        );

        return (
            <Modal id={`${idPrefix}-dialog-modal-window`} show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.CloseButton onClick={this.props.close} />
                    <Modal.Title>{_("Add Disk")}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {defaultBody}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    {this.state.addDiskInProgress && <div className="spinner spinner-sm pull-left" />}
                    <Button id={`${idPrefix}-dialog-cancel`} bsStyle='default' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                    <Button id={`${idPrefix}-dialog-add`} bsStyle='primary' disabled={this.state.addDiskInProgress || storagePools.length == 0} onClick={this.onAddClicked}>
                        {_("Add")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}
