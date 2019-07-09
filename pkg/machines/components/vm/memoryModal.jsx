import React from 'react';
import {
    Button,
    HelpBlock,
    Modal,
} from 'patternfly-react';
import PropTypes from 'prop-types';

import cockpit from 'cockpit';
import * as Select from 'cockpit-components-select.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import {
    units,
    convertToUnit,
    toFixedPrecision,
    vmId
} from '../../helpers.js';
import {
    setMemory,
    setMaxMemory,
    getVm
} from '../../actions/provider-actions.js';

import './memoryModal.css';
import 'form-layout.less';

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
            let memoryKiB = convertToUnit(value, this.state.memoryUnit, 'KiB');

            if (memoryKiB <= this.state.maxMemory) {
                stateDelta['memory'] = memoryKiB;
            } else if (memoryKiB > this.state.maxMemory && this.props.vm.state != 'running') {
                stateDelta['memory'] = memoryKiB;
                stateDelta['maxMemory'] = memoryKiB;
            }
        } else if (key == 'maxMemory') {
            let maxMemoryKiB = convertToUnit(value, this.state.maxMemoryUnit, 'KiB');

            if (maxMemoryKiB < this.state.nodeMaxMemory) {
                stateDelta['maxMemory'] = maxMemoryKiB;
            }
        } else if (key == 'memoryUnit' || key == 'maxMemoryUnit')
            stateDelta = { [key]: value };

        this.setState(stateDelta);
    }

    onValueBlurred(key, value) {
        // When input field get unfocused perform checks for lower limits
        let stateDelta = {};

        if (key == 'memory') {
            let memoryKiB = convertToUnit(value, this.state.memoryUnit, 'KiB');

            stateDelta['memory'] = Math.max(memoryKiB, this.state.minAllowedMemory);
        } else if (key == 'maxMemory') {
            let maxMemoryKiB = convertToUnit(value, this.state.maxMemoryUnit, 'KiB');

            stateDelta['maxMemory'] = Math.max(maxMemoryKiB, this.state.minAllowedMemory);
            if (maxMemoryKiB < this.state.memory) {
                stateDelta['memory'] = Math.max(maxMemoryKiB, this.state.minAllowedMemory);
            }
        }

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
                <div className='form-group ct-validation-wrapper'>
                    <div role='group'>
                        <input id={`${idPrefix}-memory`}
                            className='form-control'
                            type='number'
                            value={toFixedPrecision(convertToUnit(this.state.memory, 'KiB', this.state.memoryUnit))}
                            min={toFixedPrecision(convertToUnit(128, 'MiB', this.state.memoryUnit))}
                            step={1}
                            onChange={e => this.onValueChanged('memory', e.target.value)}
                            onClick={e => { // releasing arrows does not trigger a seperate on blur event
                                this.onValueChanged('memory', e.target.value);
                                this.onValueBlurred('memory', e.target.value);
                            }}
                            onBlur={e => this.onValueBlurred('memory', e.target.value)} />
                        <Select.Select id={`${idPrefix}-memory-unit`}
                            initial={this.state.memoryUnit}
                            onChange={value => this.onValueChanged('memoryUnit', value)}>
                            <Select.SelectEntry data={units.MiB.name} key={units.MiB.name}>
                                {_("MiB")}
                            </Select.SelectEntry>
                            <Select.SelectEntry data={units.GiB.name} key={units.GiB.name}>
                                {_("GiB")}
                            </Select.SelectEntry>
                        </Select.Select>
                    </div>
                    <HelpBlock>
                        {_("Memory size between 128 MiB and the maximum allocation")}
                    </HelpBlock>
                </div>

                <hr />

                <label className='control-label'>
                    {_("Maximum Allocation")}
                </label>
                <div className='form-group ct-validation-wrapper'>
                    <div role='group'>
                        <input id={`${idPrefix}-max-memory`}
                            className='form-control ct-form-split'
                            type='number'
                            value={toFixedPrecision(convertToUnit(this.state.maxMemory, 'KiB', this.state.maxMemoryUnit))}
                            min={toFixedPrecision(convertToUnit(128, 'MiB', this.state.memoryUnit))}
                            step={1}
                            onChange={e => this.onValueChanged('maxMemory', e.target.value)}
                            onClick={e => { // onInput does not trigger a seperate on blur event
                                this.onValueChanged('maxMemory', e.target.value);
                                this.onValueBlurred('maxMemory', e.target.value);
                            }}
                            onBlur={e => this.onValueBlurred('maxMemory', e.target.value)}
                            readOnly={vm.state != 'shut off'} />
                        <Select.Select id={`${idPrefix}-max-memory-unit`}
                            className='ct-form-split'
                            initial={this.state.maxMemoryUnit}
                            onChange={value => this.onValueChanged('maxMemoryUnit', value)}
                            enabled={vm.state !== 'running'}>
                            <Select.SelectEntry data={units.MiB.name} key={units.MiB.name}>
                                {_("MiB")}
                            </Select.SelectEntry>
                            <Select.SelectEntry data={units.GiB.name} key={units.GiB.name}>
                                {_("GiB")}
                            </Select.SelectEntry>
                        </Select.Select>
                    </div>
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
