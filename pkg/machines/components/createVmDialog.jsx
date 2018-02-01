/*jshint esversion: 6 */
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

import cockpit from 'cockpit';
import React, { PropTypes } from "react";
import DialogPattern from 'cockpit-components-dialog.jsx';
import Select from "cockpit-components-select.jsx";
import FileAutoComplete from "../../lib/cockpit-components-file-autocomplete.jsx";
import { createVm } from '../actions.es6';
import {
    digitFilter,
    toFixedPrecision,
    isEmpty,
    convertToUnit,
    timeoutedPromise,
    units,
} from "../helpers.es6";

import {
    NOT_SPECIFIED,
    OTHER_OS_SHORT_ID,
    DIVIDER_FAMILY,
    prepareVendors,
    getOSStringRepresentation,
} from "./createVmDialogUtils.es6";

import './createVmDialog.less';

const _ = cockpit.gettext;

const URL_SOURCE = 'url';
const COCKPIT_FILESYSTEM_SOURCE = 'file';

const WAIT_IF_SCRIPT_FAILS_WITH_ERROR = 3000; // 3s

const MemorySelectRow = ({ label, id, value, initialUnit, onValueChange, onUnitChange }) => {
    return (
        <tr>
            <td className="top">
                <label className="control-label" htmlFor={id}>
                    {label}
                </label>
            </td>
            <td>
                <div className="thirty-five-spaced-table">
                    <span className="evenly-spaced-cell">
                        <div className="evenly-spaced-table">
                            <span className="evenly-spaced-cell">
                                <input id={id} className="form-control"
                                       type="number"
                                       value={toFixedPrecision(value)}
                                       onKeyPress={digitFilter}
                                       step={1}
                                       min={0}
                                       onChange={onValueChange}/>
                            </span>
                            <span className="thirty-five-spaced-cell padding-left">
                                <Select.Select id={id + "-unit-select"}
                                               initial={initialUnit}
                                               onChange={onUnitChange}>
                                    <Select.SelectEntry data={units.MiB.name} key={units.MiB.name}>
                                        {_("MiB")}
                                    </Select.SelectEntry>
                                    <Select.SelectEntry data={units.GiB.name} key={units.GiB.name}>
                                        {_("GiB")}
                                    </Select.SelectEntry>
                                </Select.Select>
                            </span>
                        </div>
                     </span>
                </div>
            </td>
        </tr>
    );
};


/* Create a virtual machine
 * props:
 *  - valuesChanged callback for changed values with the signature (key, value)
 */
class CreateVM extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            vendor: props.vmParams.vendor,
            os: props.vmParams.os,
            memorySize: convertToUnit(props.vmParams.memorySize, units.MiB, units.GiB), // tied to Unit
            memorySizeUnit: units.GiB.name,
            storageSize: props.vmParams.storageSize, // tied to Unit
            storageSizeUnit: units.GiB.name,
            sourceType: props.vmParams.sourceType,
        };
    }

    onChangedEventValue(key, e) {
        if (e && e.target && typeof(e.target.value) !== 'undefined') {
            this.onChangedValue(key, e.target.value);
        }
    }

    onChangedEventChecked(key, e) {
        if (e && e.target && typeof(e.target.checked) === "boolean") {
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
                if (valueParams) {
                    notifyValuesChanged('error', valueParams.error);
                }
                break;
            case 'sourceType':
                this.setState({ [key]: value });
                notifyValuesChanged('source', null);
                notifyValuesChanged('error', null);
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
            vendorSelectEntries.push((<Select.SelectDivider/>));
        }

        this.props.familyList.forEach(({ family, vendors }) => {
            if (family === DIVIDER_FAMILY) {
                return;
            }
            vendorSelectEntries.push((<Select.SelectHeader>{family}</Select.SelectHeader>));

            vendors.forEach((vendor) => {
                vendorSelectEntries.push((
                    <Select.SelectEntry data={vendor} key={vendor}>{vendor}</Select.SelectEntry>));
            });
        });

        const osEntries = (
            this.props.vendorMap[this.state.vendor]
                .map(os => (<Select.SelectEntry data={os.shortId}
                                                key={os.shortId}>{getOSStringRepresentation(os)}</Select.SelectEntry>))
        );

        let installationSource;
        let installationSourceId;
        switch (this.state.sourceType) {
            case COCKPIT_FILESYSTEM_SOURCE:
                installationSourceId="source-file";
                installationSource = (
                    <FileAutoComplete.FileAutoComplete id={installationSourceId}
                                                       placeholder={_("Path to ISO file on host's file system")}
                                                       onChange={this.onChangedValue.bind(this, 'source')}/>
                );
                break;
            case URL_SOURCE:
            default:
                installationSourceId="source-url";
                installationSource = (
                    <input id={installationSourceId} className="form-control"
                           type="text"
                           minLength={1}
                           placeholder={_("Remote URL")}
                           value={this.props.vmParams.source}
                           onChange={this.onChangedEventValue.bind(this, 'source')}/>
                );
                break;
        }


        return (
            <div className="modal-body modal-dialog-body-table">
                <table className="form-table-ct">
                    <tr>
                        <td className="top">
                            <label className="control-label" htmlFor="vm-name">
                                {_("Name")}
                            </label>
                        </td>
                        <td>
                            <input id="vm-name" className="form-control" type="text" minLength={1}
                                   value={this.props.vmParams.vmName}
                                   onChange={this.onChangedEventValue.bind(this, 'vmName')}/>
                        </td>
                    </tr>
                    <tr>
                        <td className="top">
                            <label className="control-label" htmlFor="source-type">
                                {_("Installation Source Type")}
                            </label>
                        </td>
                        <td>
                            <Select.Select id="source-type"
                                           initial={this.state.sourceType}
                                           onChange={this.onChangedValue.bind(this, 'sourceType')}>
                                <Select.SelectEntry data={COCKPIT_FILESYSTEM_SOURCE}
                                                    key={COCKPIT_FILESYSTEM_SOURCE}>{_("Filesystem")}</Select.SelectEntry>
                                <Select.SelectEntry data={URL_SOURCE} key={URL_SOURCE}>{_("URL")}</Select.SelectEntry>
                            </Select.Select>
                        </td>
                    </tr>
                    <tr>
                        <td className="top">
                            <label className="control-label" htmlFor={installationSourceId}>
                                {_("Installation Source")}
                            </label>
                        </td>
                        <td>
                            {installationSource}
                        </td>
                    </tr>
                    <tr>
                        <td className="top">
                            <label className="control-label" htmlFor="vendor-select">
                                {_("OS Vendor")}
                            </label>
                        </td>
                        <td>
                            <Select.Select id="vendor-select"
                                           initial={this.state.vendor}
                                           onChange={this.onChangedValue.bind(this, 'vendor')}>
                                {vendorSelectEntries}
                            </Select.Select>
                        </td>
                    </tr>
                    <tr>
                        <td className="top">
                            <label className="control-label" htmlFor="vendor-select">
                                {_("Operating System")}
                            </label>
                        </td>
                        <td>
                            <Select.StatelessSelect id="system-select"
                                                    selected={this.state.os}
                                                    onChange={this.onChangedValue.bind(this, 'os')}>
                                {osEntries}
                            </Select.StatelessSelect>
                        </td>
                    </tr>
                    <MemorySelectRow label={_("Memory")}
                                     id={"memory-size"}
                                     value={this.state.memorySize}
                                     initialUnit={this.state.memorySizeUnit}
                                     onValueChange={this.onChangedEventValue.bind(this, 'memorySize')}
                                     onUnitChange={this.onChangedValue.bind(this, 'memorySizeUnit')}/>
                    <MemorySelectRow label={_("Storage Size")}
                                     id={"storage-size"}
                                     value={this.state.storageSize}
                                     initialUnit={this.state.storageSizeUnit}
                                     onValueChange={this.onChangedEventValue.bind(this, 'storageSize')}
                                     onUnitChange={this.onChangedValue.bind(this, 'storageSizeUnit')}/>
                    <tr>
                        <td className="top">
                            <label className="control-label" htmlFor="start-vm">
                                {_("Immediately Start VM")}
                            </label>
                        </td>
                        <td>
                            <input id="start-vm" className="form-control dialog-checkbox" type="checkbox"
                                   checked={this.props.vmParams.startVm}
                                   onChange={this.onChangedEventChecked.bind(this, 'startVm')}/>
                        </td>
                    </tr>
                </table>
            </div>
        );
    }
}

CreateVM.propTypes = {
    valuesChanged: PropTypes.func.isRequired,
    vmParams: PropTypes.object.isRequired,
    vendorMap: PropTypes.object.isRequired,
    familyMap: PropTypes.object.isRequired,
    familyList: PropTypes.array.isRequired,
};

function validateParams(vmParams) {
    if (isEmpty(vmParams.vmName)) {
        return _("Name should not be empty");
    }

    vmParams.vmName = vmParams.vmName.trim();
    if (isEmpty(vmParams.vmName)) {
        return _("Name should not consist of empty characters only");
    }

    if (vmParams.error) {
        return vmParams.error;
    }

    vmParams.source = vmParams.source ? vmParams.source.trim() : null;
    if (!isEmpty(vmParams.source)) {
        switch (vmParams.sourceType) {
            case COCKPIT_FILESYSTEM_SOURCE:
                if (!vmParams.source.startsWith("/")) {
                    return _("Invalid filename");
                }
                break;
            case URL_SOURCE:
            default:
                if (!vmParams.source.startsWith("http") &&
                    !vmParams.source.startsWith("ftp") &&
                    !vmParams.source.startsWith("nfs")) {
                    return _("Source should start with http, ftp or nfs protocol");
                }
                break;
        }
        if (vmParams.source === "/") {
            vmParams.source = null;
        }
    }

    if (isEmpty(vmParams.source)){
      return _("Installation Source should not be empty");
    }

    if (vmParams.memorySize <= 0) {
        return _("Memory should be positive number");
    }

    if (vmParams.storageSize < 0) {
        return _("Storage Size should not be negative number");
    }
}

export const createVmDialog = (dispatch, osInfoList) => {
    const vmParams = {
        'vmName': null,
        "sourceType": COCKPIT_FILESYSTEM_SOURCE,
        'source': null,
        'vendor': NOT_SPECIFIED,
        "os": OTHER_OS_SHORT_ID,
        'memorySize': 1024, // MiB
        'storageSize': 10, // GiB
        'startVm': false,
        'error': null,
    };

    const changeParams = (key, value) => {
        vmParams[key] = value;
    };

    const vendors = prepareVendors(osInfoList);

    const dialogBody = (
        <CreateVM vmParams={vmParams}
                  familyList={vendors.familyList}
                  familyMap={vendors.familyMap}
                  vendorMap={vendors.vendorMap}
                  valuesChanged={changeParams}/>
    );

    const dialogProps = {
        'title': _("Create New Virtual Machine"),
        'body': dialogBody,
    };

    // also test modifying properties in subsequent render calls
    const footerProps = {
        'actions': [
            {
                'clicked': () => {
                    const error = validateParams(vmParams);
                    if (error) {
                        return cockpit.defer().reject(error).promise;
                    } else {
                        return timeoutedPromise(dispatch(createVm(vmParams)), WAIT_IF_SCRIPT_FAILS_WITH_ERROR);
                    }
                },
                'caption': _("Create"),
                'style': 'primary',
            },
        ],
    };

    DialogPattern.show_modal_dialog(dialogProps, footerProps);
};
