/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import {
    FormGroup, FormSection,
    FormSelect, FormSelectOption,
    InputGroup, TextInput
} from "@patternfly/react-core";

import { convertToUnit, units, digitFilter } from '../../helpers.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

const VolumeName = ({ idPrefix, volumeName, validationFailed, onValueChanged }) => {
    const validationStateName = validationFailed.volumeName ? 'error' : 'default';
    return (
        <FormGroup fieldId={`${idPrefix}-name`}
                   validated={validationStateName}
                   helperTextInvalid={validationFailed.volumeName}
                   label={_("Name")}>
            <TextInput id={`${idPrefix}-name`}
                        minLength={1}
                        placeholder={_("New volume name")}
                        value={volumeName || ""}
                        validated={validationStateName}
                        onChange={value => onValueChanged('volumeName', value)} />
        </FormGroup>
    );
};

const VolumeDetails = ({ idPrefix, size, unit, format, storagePoolCapacity, storagePoolType, validationFailed, onValueChanged }) => {
    // TODO: Use slider
    let formatRow;
    let validVolumeFormats;
    const volumeMaxSize = parseFloat(convertToUnit(storagePoolCapacity, units.B, unit).toFixed(2));
    const validationStateSize = validationFailed.size ? 'error' : 'default';

    // For the valid volume format types for different pool types see https://libvirt.org/storage.html
    if (['disk'].indexOf(storagePoolType) > -1) {
        validVolumeFormats = [
            'none', 'linux', 'fat16', 'fat32', 'linux-swap', 'linux-lvm',
            'linux-raid', 'extended'
        ];
    } else if (['dir', 'fs', 'netfs', 'gluster', 'vstorage'].indexOf(storagePoolType) > -1) {
        validVolumeFormats = ['qcow2', 'raw'];
    }

    if (validVolumeFormats) {
        formatRow = (
            <FormGroup fieldId={`${idPrefix}-fileformat`} label={_("Format")}>
                <FormSelect id={`${idPrefix}-format`}
                    onChange={value => onValueChanged('format', value)}
                    value={format}
                    classname='ct-form-split'>
                    { validVolumeFormats.map(format => <FormSelectOption value={format} key={format} label={format} />) }
                </FormSelect>
            </FormGroup>
        );
    }

    return (
        <FormSection className="ct-form-split">
            <FormGroup fieldId={`${idPrefix}-size`}
                       id={`${idPrefix}-size-group`}
                       validated={validationStateSize}
                       helperTextInvalid={validationFailed.size}
                       label={_("Size")}>
                <InputGroup>
                    <TextInput id={`${idPrefix}-size`}
                               type="number" inputMode='numeric' pattern="[0-9]*"
                               value={parseFloat(size).toFixed(0)}
                               onKeyPress={digitFilter}
                               step={1}
                               min={0}
                               max={volumeMaxSize}
                               validated={validationStateSize}
                               onChange={value => onValueChanged('size', value)} />
                    <FormSelect id={`${idPrefix}-unit`}
                                className="ct-machines-select-unit"
                                value={unit}
                                onChange={value => onValueChanged('unit', value)}>
                        <FormSelectOption value={units.MiB.name} key={units.MiB.name}
                                          label={_("MiB")} />
                        <FormSelectOption value={units.GiB.name} key={units.GiB.name}
                                          label={_("GiB")} />
                    </FormSelect>
                </InputGroup>
            </FormGroup>
            {formatRow}
        </FormSection>
    );
};

export const VolumeCreateBody = ({ idPrefix, storagePool, validationFailed, onValueChanged, dialogValues }) => {
    return (
        <>
            <VolumeName idPrefix={idPrefix}
                        volumeName={dialogValues.volumeName}
                        validationFailed={validationFailed}
                        onValueChanged={onValueChanged} />
            <VolumeDetails idPrefix={idPrefix}
                           size={dialogValues.size}
                           unit={dialogValues.unit}
                           format={dialogValues.format}
                           storagePoolCapacity={storagePool.capacity}
                           storagePoolType={storagePool.type}
                           validationFailed={validationFailed}
                           onValueChanged={onValueChanged} />
        </>
    );
};

VolumeCreateBody.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    storagePool: PropTypes.object.isRequired,
    onValueChanged: PropTypes.func.isRequired,
    dialogValues: PropTypes.object.isRequired,
};
