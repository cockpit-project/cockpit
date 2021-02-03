/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import {
    Button,
    Form, FormGroup, FormSelect, FormSelectOption,
    Modal, Tooltip
} from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import LibvirtDBus, { setOSFirmware } from "../../../libvirt-dbus.js";
import { supportsUefiXml, labelForFirmwarePath } from './helpers.js';

const _ = cockpit.gettext;

class FirmwareModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dialogError:  null,
            firmware: props.firmware == 'efi' ? props.firmware : 'bios',
        };
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.close = props.close;
        this.save = this.save.bind(this);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    save() {
        setOSFirmware(this.props.connectionName, this.props.vmId, this.state.firmware)
                .then(this.close, exc => this.dialogErrorSet(_("Failed to change firmware"), exc.message));
    }

    render() {
        return (
            <Modal position="top" variant="medium" isOpen onClose={this.close}
                   title={_("Change firmware")}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button variant='primary' id="firmware-dialog-apply" onClick={this.save}>
                               {_("Save")}
                           </Button>
                           <Button variant='link' onClick={this.close}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                <Form isHorizontal>
                    <FormGroup label={_("Firmware")} fieldId="firmware-dialog-select">
                        <FormSelect onChange={value => this.setState({ firmware: value })}
                                    id='firmware-dialog-select'
                                    value={this.state.firmware }>
                            <FormSelectOption value='bios' key='bios'
                                              label='BIOS' />
                            <FormSelectOption value='efi' key='efi'
                                              label='UEFI' />
                        </FormSelect>
                    </FormGroup>
                </Form>
            </Modal>
        );
    }
}

FirmwareModal.propTypes = {
    close: PropTypes.func.isRequired,
    connectionName: PropTypes.string.isRequired,
    vmId: PropTypes.string.isRequired,
    firmware: PropTypes.string,
};

export const FirmwareLink = ({ vm, loaderElems, idPrefix }) => {
    const [firmwareShow, setFirmwareShow] = useState(false);

    function getOVMFBinariesOnHost(loaderElems) {
        return Array.prototype.map.call(loaderElems, loader => {
            const valueElem = loader.getElementsByTagName('value');

            if (valueElem && valueElem[0].parentNode == loader)
                return valueElem[0].textContent;
        });
    }

    let firmwareLinkWrapper;
    const hasInstallPhase = vm.metadata && vm.metadata.hasInstallPhase;
    const labelForFirmware = labelForFirmwarePath(vm.loader, vm.arch);
    let currentFirmware;

    if (vm.firmware == "efi" || labelForFirmware == "efi")
        currentFirmware = "UEFI";
    else if (labelForFirmware == "custom")
        currentFirmware = cockpit.format(_("Custom firmware: $0"), vm.loader);
    else if (labelForFirmware == "unknown")
        currentFirmware = _("Unknown firmware");
    else
        currentFirmware = "BIOS";

    /* If the VM hasn't an install phase then don't show a link, just the text  */
    if (!LibvirtDBus.canInstall(vm.state, hasInstallPhase)) {
        firmwareLinkWrapper = <div id={`${idPrefix}-firmware`}>{currentFirmware}</div>;
    } else {
        const uefiPaths = getOVMFBinariesOnHost(loaderElems).filter(elem => elem !== undefined);
        const firmwareLink = disabled => {
            return (
                <span id={`${idPrefix}-firmware-tooltip`}>
                    <Button variant="link" isInline id={`${idPrefix}-firmware`} isDisabled={disabled} onClick={() => setFirmwareShow(true)}>
                        {currentFirmware}
                    </Button>
                </span>
            );
        };

        if (vm.state != "shut off") {
            if (vm.persistent) {
                firmwareLinkWrapper = (
                    <Tooltip id='firmware-edit-disabled-on-running' content={_("Shut off the VM in order to edit firmware configuration")}>
                        {firmwareLink(true)}
                    </Tooltip>
                );
            } else {
                firmwareLinkWrapper = (
                    <Tooltip id='firmware-edit-disabled-on-transient' content={_("Transient VMs don't support editing firmware configuration")}>
                        {firmwareLink(true)}
                    </Tooltip>
                );
            }
        } else if (!supportsUefiXml(loaderElems[0])) {
            firmwareLinkWrapper = (
                <Tooltip id='missing-uefi-support' content={_("Libvirt or hypervisor does not support UEFI")}>
                    {firmwareLink(true)}
                </Tooltip>
            );
        } else if (uefiPaths.length == 0) {
            firmwareLinkWrapper = (
                <Tooltip id='missing-uefi-images' content={_("Libvirt did not detect any UEFI/OVMF firmware image installed on the host")}>
                    {firmwareLink(true)}
                </Tooltip>
            );
        } else {
            firmwareLinkWrapper = firmwareLink(false);
        }
    }

    return (
        <>
            { firmwareShow && <FirmwareModal close={() => setFirmwareShow(false)} connectionName={vm.connectionName} vmId={vm.id} firmware={vm.firmware} /> }
            {firmwareLinkWrapper}
        </>
    );
};
