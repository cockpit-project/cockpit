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
import cockpit from 'cockpit';
import DialogPattern from 'cockpit-components-dialog.jsx';
import * as Select from "cockpit-components-select.jsx";
import FileAutoComplete from "cockpit-components-file-autocomplete.jsx";
import { createVm } from '../../actions/provider-actions.es6';
import { addErrorNotification } from '../../actions/store-actions.es6';
import {
    isEmpty,
    convertToUnit,
    timeoutedPromise,
    units,
    mouseClick,
} from "../../helpers.es6";

import {
    NOT_SPECIFIED,
    OTHER_OS_SHORT_ID,
    DIVIDER_FAMILY,
    prepareVendors,
    getOSStringRepresentation,
} from "./createVmDialogUtils.es6";
import MemorySelectRow from '../memorySelectRow.jsx';

import './createVmDialog.less';
import VMS_CONFIG from '../../config.es6';

const _ = cockpit.gettext;

const URL_SOURCE = 'url';
const COCKPIT_FILESYSTEM_SOURCE = 'file';

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
            startVm: props.vmParams.startVm
        };
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
            if (valueParams) {
                notifyValuesChanged('error', valueParams.error);
            } else {
                this.setState({ [key]: value });
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
        case 'startVm': {
            this.setState({ [key]: value });
            break;
        }
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
            vendorSelectEntries.push((<Select.SelectHeader key={family}>{family}</Select.SelectHeader>));

            vendors.forEach((vendor) => {
                vendorSelectEntries.push((
                    <Select.SelectEntry data={vendor} key={vendor}>{vendor}</Select.SelectEntry>));
            });
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
        switch (this.state.sourceType) {
        case COCKPIT_FILESYSTEM_SOURCE:
            installationSourceId = "source-file";
            installationSource = (
                <FileAutoComplete.FileAutoComplete id={installationSourceId}
                    placeholder={_("Path to ISO file on host's file system")}
                    onChange={this.onChangedValue.bind(this, 'source')} />
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

        return (
            <div className="modal-body modal-dialog-body-table">
                <table className="form-table-ct">
                    <tbody>
                        <tr>
                            <td className="top">
                                <label className="control-label" htmlFor="vm-name">
                                    {_("Name")}
                                </label>
                            </td>
                            <td>
                                <input id="vm-name" className="form-control" type="text" minLength={1}
                                       value={this.state.vmName}
                                       placeholder={_("Unique name")}
                                       onChange={this.onChangedEventValue.bind(this, 'vmName')} />
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
                                         onUnitChange={this.onChangedValue.bind(this, 'memorySizeUnit')} />
                        <MemorySelectRow label={_("Storage Size")}
                                         id={"storage-size"}
                                         value={this.state.storageSize}
                                         initialUnit={this.state.storageSizeUnit}
                                         onValueChange={this.onChangedEventValue.bind(this, 'storageSize')}
                                         onUnitChange={this.onChangedValue.bind(this, 'storageSizeUnit')} />
                        <tr>
                            <td className="top">
                                <label className="control-label" htmlFor="start-vm">
                                    {_("Immediately Start VM")}
                                </label>
                            </td>
                            <td>
                                <input id="start-vm" type="checkbox"
                                       checked={this.state.startVm}
                                       onChange={this.onChangedEventChecked.bind(this, 'startVm')} />
                            </td>
                        </tr>
                    </tbody>
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

    if (isEmpty(vmParams.source)) {
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
        'vmName': '',
        "sourceType": COCKPIT_FILESYSTEM_SOURCE,
        'source': '',
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
                  valuesChanged={changeParams} />
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
                        // leave dialog open to show immediate errors from the backend
                        // close the dialog after VMS_CONFIG.LeaveCreateVmDialogVisibleAfterSubmit
                        // then show errors in the notification area
                        return timeoutedPromise(
                            dispatch(createVm(vmParams)),
                            VMS_CONFIG.LeaveCreateVmDialogVisibleAfterSubmit,
                            null,
                            (exception) => {
                                dispatch(addErrorNotification({
                                    message: cockpit.format(_("Creation of vm $0 failed"), vmParams.vmName),
                                    description: exception,
                                }));
                            });
                    }
                },
                'caption': _("Create"),
                'style': 'primary',
            },
        ],
    };

    DialogPattern.show_modal_dialog(dialogProps, footerProps);
};

export function createVmAction({ dispatch, systemInfo }) {
    return (
        <a key='create-vm-action' className="card-pf-link-with-icon pull-right" id="create-new-vm"
            onClick={mouseClick(() => createVmDialog(dispatch, systemInfo.osInfoList))}>
            <span className="pficon pficon-add-circle-o" />{_("Create New VM")}
        </a>
    );
}
