import React from 'react';
import {
    Button,
    HelpBlock,
    Modal,
} from 'patternfly-react';
import PropTypes from 'prop-types';

import cockpit from 'cockpit';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import {
    units,
    convertToUnit,
    vmId
} from '../../helpers.js';
import MemorySelectRow from '../memorySelectRow.jsx';
import {
    setMemory,
    setMaxMemory,
    getVm
} from '../../actions/provider-actions.js';

import 'form-layout.scss';

const _ = cockpit.gettext;

export class MemoryModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            memory: props.vm.currentMemory, // Stored always in KiB to ease checks; the conversions to the user presented values happen inside the render
            memoryUnit: units.MiB.name,
            maxMemory: props.vm.memory, // Stored always in KiB to ease checks; the conversions to the user presented values happen inside the render
            maxMemoryUnit: units.MiB.name,
            nodeMaxMemory: props.config.nodeMaxMemory,
            minAllowedMemory: convertToUnit(128, 'MiB', 'KiB'),
        };
        this.close = props.close;
        this.save = this.save.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    onValueChanged(key, value) {
        let stateDelta = {};

        if (key == 'memory') {
            const memoryKiB = convertToUnit(value, this.state.memoryUnit, 'KiB');

            if (memoryKiB <= this.state.maxMemory) {
                stateDelta.memory = Math.max(memoryKiB, this.state.minAllowedMemory);
            } else if (memoryKiB > this.state.maxMemory && this.props.vm.state != 'running') {
                stateDelta.memory = Math.min(memoryKiB, this.state.nodeMaxMemory);
                stateDelta.maxMemory = Math.min(memoryKiB, this.state.nodeMaxMemory);
            }
        } else if (key == 'maxMemory') {
            const maxMemoryKiB = convertToUnit(value, this.state.maxMemoryUnit, 'KiB');

            if (maxMemoryKiB < this.state.nodeMaxMemory) {
                stateDelta.maxMemory = Math.max(maxMemoryKiB, this.state.minAllowedMemory);
            } else {
                stateDelta.maxMemory = this.state.nodeMaxMemory;
            }
            if (maxMemoryKiB < this.state.memory) {
                stateDelta.memory = Math.max(maxMemoryKiB, this.state.minAllowedMemory);
            }
        } else if (key == 'memoryUnit' || key == 'maxMemoryUnit')
            stateDelta = { [key]: value };

        this.setState(stateDelta);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    save() {
        const { dispatch, vm } = this.props;

        if (vm.memory !== this.state.maxMemory) {
            dispatch(setMaxMemory(vm, this.state.maxMemory))
                    .fail(exc => this.dialogErrorSet(_("Maximum memory could not be saved"), exc.message))
                    .then(() => {
                        if (vm.currentMemory !== this.state.maxMemory) {
                            dispatch(setMemory(vm, this.state.memory))
                                    .fail(exc => this.dialogErrorSet(_("Memory could not be saved"), exc.message))
                                    .then(() => {
                                        if (vm.state !== 'running')
                                            dispatch(getVm({ connectionName: vm.connectionName, id: vm.id }));
                                        this.close();
                                    });
                        }
                    });
        } else if (vm.currentMemory !== this.state.memory) {
            dispatch(setMemory(vm, this.state.memory))
                    .fail(exc => this.dialogErrorSet(_("Memory could not be saved"), exc.message))
                    .then(() => {
                        if (vm.state !== 'running')
                            dispatch(getVm({ connectionName: vm.connectionName, id: vm.id }));
                        this.close();
                    });
        } else {
            this.close();
        }
    }

    render() {
        const vm = this.props.vm;
        const idPrefix = vmId(vm.name) + '-memory-modal';
        const defaultBody = (
            <div id='memory-config-dialog' className='ct-form'>
                <label className='control-label'>
                    {_("Current Allocation")}
                </label>
                <MemorySelectRow id={`${idPrefix}-memory`}
                    value={Math.floor(convertToUnit(this.state.memory, 'KiB', this.state.memoryUnit))}
                    minValue={Math.floor(convertToUnit(this.state.minAllowedMemory, 'KiB', this.state.memoryUnit))}
                    maxValue={Math.floor(convertToUnit(this.state.maxMemory, 'KiB', this.state.memoryUnit))}
                    initialUnit={this.state.memoryUnit}
                    onValueChange={value => this.onValueChanged('memory', value)}
                    onUnitChange={value => this.onValueChanged('memoryUnit', value)} />
                <hr />

                <label className='control-label'>
                    {_("Maximum Allocation")}
                </label>
                <div className='form-group ct-validation-wrapper'>
                    <MemorySelectRow id={`${idPrefix}-max-memory`}
                        value={Math.floor(convertToUnit(this.state.maxMemory, 'KiB', this.state.maxMemoryUnit))}
                        minValue={Math.floor(convertToUnit(this.state.minAllowedMemory, 'KiB', this.state.maxMemoryUnit))}
                        maxValue={Math.floor(convertToUnit(this.state.nodeMaxMemory, 'KiB', this.state.maxMemoryUnit))}
                        initialUnit={this.state.maxMemoryUnit}
                        onValueChange={value => this.onValueChanged('maxMemory', value)}
                        onUnitChange={value => this.onValueChanged('maxMemoryUnit', value)}
                        readOnly={vm.state != 'shut off'} />
                    {vm.state === 'running' && <HelpBlock>
                        {_("Only editable when the guest is shut off")}
                    </HelpBlock>}
                </div>
            </div>
        );

        return (
            <Modal id='vm-memory-modal' show onHide={this.close}>
                <Modal.Header>
                    <Modal.CloseButton onClick={this.close} />
                    <Modal.Title> {`${vm.name} Memory Adjustment`} </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {defaultBody}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    <Button id={`${idPrefix}-cancel`} bsStyle='default' onClick={this.close}>
                        {_("Cancel")}
                    </Button>
                    <Button id={`${idPrefix}-save`} bsStyle='primary' onClick={this.save}>
                        {_("Save")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

MemoryModal.propTypes = {
    dispatch: PropTypes.func.isRequired,
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    close: PropTypes.func.isRequired,
};

export default MemoryModal;
