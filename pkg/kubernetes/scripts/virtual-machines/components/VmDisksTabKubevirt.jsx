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

import React, { PropTypes } from 'react';
import cockpit from 'cockpit';

import type { Vm, PersistenVolume } from '../types.jsx';
import { vmIdPrefx, getValueOrDefault } from '../utils.jsx';
import VmDisksTab from '../../../../machines/components/vmDisksTab.jsx';

React;
const _ = cockpit.gettext;
/**
 * Finds matching PersistentVolume for the given VM disk.
 * @param volumeName - PersistentVolume identification from VM perspective; conforms vm.spec.domain.devices.disks[N].volumeName
 * @param pvs - all PersistentVolumes, conforms state.pvs
 * @param vm - a VM the volumeName is from, conforms state.vms[N]
 */
const getPersistentVolume = (volumeName, pvs, vm) => {
    const volumes = vm.spec.volumes;
    let volume;
    if (volumes) {
        volume = volumes.find(item => item.name === volumeName);
    }

    if (!volume || !volume.iscsi) {
        return null; // recently iSCSI is supported only
    }

    return pvs.find(item => {
        const iscsi = item.spec.iscsi;
        if (!iscsi) {
            return false;
        }

        return (iscsi.iqn === volume.iscsi.iqn && iscsi.lun === volume.iscsi.lun && iscsi.targetPortal === volume.iscsi.targetPortal);
    });
};

const prepareDiskData = (disk, vm, pvs, idPrefix) => {
    const pv = getPersistentVolume(disk.volumeName, pvs, vm);

    let onNavigate;
    let bus = _("N/A"); // recently only iSCSI is supported
    if (pv) {
        bus = _("iSCSI");
        onNavigate = () => cockpit.jump(`/kubernetes#/volumes/${pv.metadata.name}`);
    }
    const capacity = pv ? (pv.spec.capacity.storage) : undefined;

    return {
        used: undefined, // TODO: how to get this?
        capacity,

        device: disk.name,
        target: getValueOrDefault(() => disk.disk.dev, ''),
        bus,
        readonly: undefined, // access modes are more complex here, let's leave this for the detail page

        diskSourceCell: (<div id={`${idPrefix}-volume`}>{(pv && pv.metadata.name) || disk.volumeName}</div>),
        onNavigate,
    };
};

const VmDisksTabKubevirt = ({ vm, pvs }: { vm: Vm, pvs: Array<PersistenVolume> }) => {
    const idPrefix = `${vmIdPrefx(vm)}-disks`;

    const vmDisks = vm.spec.domain.devices.disks;

    let disks = [];
    if (vmDisks) {
        disks = vmDisks.map(disk => prepareDiskData(disk, vm, pvs, idPrefix));
    }

    return (
        <VmDisksTab idPrefix={idPrefix}
                    disks={disks}
                    renderCapacity={true}/>
    );
};

VmDisksTabKubevirt.propTypes = {
    vm: PropTypes.object.isRequired,
    pvs: PropTypes.object.isRequired,
};

export default VmDisksTabKubevirt;
