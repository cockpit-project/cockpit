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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import { Button, Modal } from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import * as Select from "cockpit-components-select.jsx";
import { setOSFirmware } from "../../libvirt-dbus.js";

const _ = cockpit.gettext;

export class FirmwareModal extends React.Component {
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
                <>
                    <Select.Select
                                   onChange={value => this.setState({ firmware: value })}
                                   initial={this.props.firmware == 'efi' ? this.props.firmware : 'bios' }
                                   extraClass='form-control'>
                        <Select.SelectEntry data='bios' key='bios'>
                            BIOS
                        </Select.SelectEntry>
                        <Select.SelectEntry data='efi' key='efi'>
                            UEFI
                        </Select.SelectEntry>
                    </Select.Select>
                </>
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

export default FirmwareModal;
