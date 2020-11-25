import React from 'react';
import { Button, Form, FormGroup, Modal } from '@patternfly/react-core';
import PropTypes from 'prop-types';

import cockpit from 'cockpit';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import {
    units,
    convertToUnit,
    vmId
} from '../../../helpers.js';
import MemorySelectRow from './memorySelectRow.jsx';
import {
    setMemory,
    setMaxMemory,
    getVm
} from '../../../actions/provider-actions.js';

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
            <Form isHorizontal id='memory-config-dialog'>
                <FormGroup fieldId={`${idPrefix}-memory`} label={_("Current allocation")}>
                    <MemorySelectRow id={`${idPrefix}-memory`}
                        value={Math.floor(convertToUnit(this.state.memory, 'KiB', this.state.memoryUnit))}
                        minValue={Math.floor(convertToUnit(this.state.minAllowedMemory, 'KiB', this.state.memoryUnit))}
                        maxValue={Math.floor(convertToUnit(this.state.maxMemory, 'KiB', this.state.memoryUnit))}
                        initialUnit={this.state.memoryUnit}
                        onValueChange={value => this.onValueChanged('memory', value)}
                        onUnitChange={value => this.onValueChanged('memoryUnit', value)} />
                </FormGroup>

                <FormGroup fieldId={`${idPrefix}-max-memory`} label={_("Maximum allocation")}>
                    <MemorySelectRow id={`${idPrefix}-max-memory`}
                        value={Math.floor(convertToUnit(this.state.maxMemory, 'KiB', this.state.maxMemoryUnit))}
                        minValue={Math.floor(convertToUnit(this.state.minAllowedMemory, 'KiB', this.state.maxMemoryUnit))}
                        maxValue={Math.floor(convertToUnit(this.state.nodeMaxMemory, 'KiB', this.state.maxMemoryUnit))}
                        initialUnit={this.state.maxMemoryUnit}
                        onValueChange={value => this.onValueChanged('maxMemory', value)}
                        onUnitChange={value => this.onValueChanged('maxMemoryUnit', value)}
                        helperText={vm.state === 'running' && _("Only editable when the guest is shut off")}
                        readOnly={vm.state != 'shut off'} />
                </FormGroup>
            </Form>
        );

        return (
            <Modal position="top" variant="medium" id='vm-memory-modal' isOpen onClose={this.close}
                   title={cockpit.format(_("$0 memory adjustment"), vm.name)}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button id={`${idPrefix}-save`} variant='primary' onClick={this.save}>
                               {_("Save")}
                           </Button>
                           <Button id={`${idPrefix}-cancel`} variant='link' onClick={this.close}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                {defaultBody}
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
