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
import cockpit from 'cockpit';
import {
    ButtonGroup,
    Icon,
    Modal
} from 'patternfly-react';
import { Button } from '@patternfly/react-core';

import { SelectableListing } from 'cockpit-components-listing.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import {
    findHostNodeDevice,
    getSortedBootOrderDevices,
    rephraseUI,
    vmId
} from '../../helpers.js';
import {
    changeBootOrder,
    getVm
} from '../../actions/provider-actions.js';

import './bootOrderModal.css';

const _ = cockpit.gettext;

/**
 * Return an array of devices, which can assigned boot order, with added properties needed for UI.
 *
 * @param {object} vm
 * @returns {array}
 */
function getUIBootOrderDevices(vm) {
    const devices = getSortedBootOrderDevices(vm.inactiveXML);

    devices.forEach((dev, index) => {
        dev.selected = typeof dev.bootOrder !== 'undefined';
        dev.initialOrder = parseInt(dev.bootOrder);
        dev.index = index;
    });

    return devices;
}

const DeviceInfo = ({ descr, value }) => {
    return (
        <div className='ct-form'>
            <span className='control-label' htmlFor={value}>
                {descr}
            </span>
            <samp id={value}>
                {value}
            </samp>
        </div>
    );
};

const DeviceRow = ({ idPrefix, device, index, onToggle, upDisabled, downDisabled, moveUp, moveDown, nodeDevices }) => {
    let heading;
    const additionalInfo = [];

    const addOptional = (additionalInfo, value, descr) => {
        if (value) {
            additionalInfo.push(
                <DeviceInfo descr={descr} value={value} key={index + descr} />
            );
        }
    };

    switch (device.type) {
    case "disk": {
        heading = rephraseUI("bootableDisk", "disk");
        addOptional(additionalInfo, device.device.source.file, _("File"));
        addOptional(additionalInfo, device.device.source.dev, _("Device"));
        addOptional(additionalInfo, device.device.source.protocol, _("Protocol"));
        addOptional(additionalInfo, device.device.source.pool, _("Pool"));
        addOptional(additionalInfo, device.device.source.volume, _("Volume"));
        addOptional(additionalInfo, device.device.source.host.name, _("Host"));
        addOptional(additionalInfo, device.device.source.host.port, _("Port"));
        break;
    }
    case "network": {
        heading = rephraseUI("bootableDisk", "network");
        addOptional(additionalInfo, device.device.mac, _("MAC"));
        break;
    }
    case "redirdev": {
        heading = rephraseUI("bootableDisk", "redirdev");
        addOptional(additionalInfo, device.device.type, _("Type"));
        addOptional(additionalInfo, device.device.bus, _("Bus"));
        addOptional(additionalInfo, device.device.address.port, _("Port"));
        break;
    }
    case "hostdev": {
        heading = rephraseUI("bootableDisk", "hostdev");
        const nodeDev = findHostNodeDevice(device.device, nodeDevices);
        if (nodeDev) {
            switch (device.device.type) {
            case "usb": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, nodeDev.capability.vendor._value, _("Vendor"));
                addOptional(additionalInfo, nodeDev.capability.product._value, _("Product"));
                break;
            }
            case "pci": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, nodeDev.capability.vendor._value, _("Vendor"));
                addOptional(additionalInfo, nodeDev.capability.product._value, _("Product"));
                break;
            }
            case "scsi": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, device.device.source.address.bus, _("Bus"));
                addOptional(additionalInfo, device.device.source.address.target, _("Target"));
                addOptional(additionalInfo, device.device.source.address.unit, _("Unit"));
                break;
            }
            case "scsi_host": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, device.device.source.protocol, _("Protocol"));
                addOptional(additionalInfo, device.device.source.wwpn, _("WWPN"));
                break;
            }
            case "mdev": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, nodeDev.capability.type.id, _("Type ID"));
                break;
            }
            }
        }
        break;
    }
    }

    const upArrow = <Button isDisabled={upDisabled} variant="secondary" onClick={moveUp}><Icon id={`${idPrefix}-up`} type="fa" name="angle-up" /></Button>;
    const downArrow = <Button isDisabled={downDisabled} variant="secondary" onClick={moveDown}><Icon id={`${idPrefix}-down`} type="fa" name="angle-down" /></Button>;

    const actions = ((!upDisabled || !downDisabled) &&
        <ButtonGroup>
            {upArrow}
            {downArrow}
        </ButtonGroup>
    );

    return { name: heading, id: device.index, selected: device.selected, additionalInfo, actions };
};

export class BootOrderModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            devices: getUIBootOrderDevices(props.vm),
        };
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.close = props.close;
        this.save = this.save.bind(this);
        this.onToggleDevice = this.onToggleDevice.bind(this);
        this.moveUp = this.moveUp.bind(this);
        this.moveDown = this.moveDown.bind(this);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    save() {
        const { dispatch, vm } = this.props;
        const devices = this.state.devices.filter((device) => device.selected);

        dispatch(changeBootOrder({
            vm,
            devices,
        }))
                .fail(exc => this.dialogErrorSet(_("Boot order settings could not be saved"), exc.message))
                .then(() => {
                    dispatch(getVm({ connectionName: vm.connectionName, id: vm.id }));
                    this.close();
                });
    }

    onToggleDevice(index) {
        // create new array so we don't edit state
        const devices = [...this.state.devices];

        devices[devices.findIndex(dev => dev.index === index)].selected = !devices[devices.findIndex(dev => dev.index === index)].selected;

        this.setState({ devices: devices });
    }

    moveUp(device) {
        const direction = -1;
        // create new array so we don't edit state
        const devices = [...this.state.devices];

        const index = devices.indexOf(device);
        const tmp = devices[index + direction];
        devices[index + direction] = devices[index];
        devices[index] = tmp;

        this.setState({ devices: devices });
    }

    moveDown(device) {
        const direction = 1;
        // create new array so we don't edit state
        const devices = [...this.state.devices];

        const index = devices.indexOf(device);
        const tmp = devices[index + direction];
        devices[index + direction] = devices[index];
        devices[index] = tmp;

        this.setState({ devices: devices });
    }

    render() {
        const { nodeDevices, vm } = this.props;
        const idPrefix = vmId(vm.name) + '-order-modal';

        /**
         * Returns whetever state of device represented in UI has changed
         *
         * @param {object} device
         * @param {number} index order of device in list
         * @returns {boolean}
         */
        function deviceStateHasChanged(device, index) {
            // device was selected
            if (device.selected && !device.initialOrder)
                return true;

            // device was unselected
            if (!device.selected && device.initialOrder)
                return true;

            // device was moved in boot order list
            if (device.initialOrder && device.initialOrder !== index + 1)
                return true;

            return false;
        }

        const showFooterWarning = () => {
            if (vm.state === "running" &&
                this.state.devices.some((device, index) => deviceStateHasChanged(device, index))) {
                return (
                    <div className="idle-message">
                        <i className='pficon pficon-pending' />
                        <span id={`${idPrefix}-min-message`}>{_("Changes will take effect after shutting down the VM")}</span>
                    </div>
                );
            }
        };

        const rows = this.state.devices.map((device, index) => {
            const nextDevice = this.state.devices[index + 1];
            return DeviceRow({
                key: index,
                idPrefix: idPrefix,
                index: index,
                device: device,
                onClick: () => this.onToggleDevice(device.index),
                onToggle: () => this.onToggleDevice(device.index),
                upDisabled: !index || !device.selected,
                downDisabled: index + 1 == this.state.devices.length || !nextDevice.selected,
                moveUp: () => this.moveUp(device),
                moveDown: () => this.moveDown(device),
                nodeDevices: nodeDevices
            });
        });

        const defaultBody = (
            <div className="list-group dialog-list-ct">
                <SelectableListing rows={rows}
                    onRowToggle={this.onToggleDevice}
                    idPrefix={idPrefix} />
            </div>
        );

        const title = _("Boot Order");

        return (
            <Modal id={`${idPrefix}-window`} show onHide={this.close} className='boot-order'>
                <Modal.Header>
                    <Modal.CloseButton onClick={this.close} />
                    <Modal.Title> {`${vm.name} ${title}`} </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {defaultBody}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    {showFooterWarning()}
                    <Button id={`${idPrefix}-cancel`} variant='secondary' onClick={this.close}>
                        {_("Cancel")}
                    </Button>
                    <Button id={`${idPrefix}-save`} variant='primary' onClick={this.save}>
                        {_("Save")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

BootOrderModal.propTypes = {
    close: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
    vm: PropTypes.object.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default BootOrderModal;
