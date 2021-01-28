import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import {
    Alert, Button,
    Form, FormGroup,
    FormSelect, FormSelectOption,
    Modal, Popover, TextInput
} from '@patternfly/react-core';
import { InfoAltIcon } from '@patternfly/react-icons';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { setVCPUSettings } from "../../../actions/provider-actions.js";
import { digitFilter } from "../../../helpers.js";

import './vcpuModal.css';

const _ = cockpit.gettext;

const dividers = (num) => {
    const divs = [1];

    for (let i = 2; i < num; i++) {
        if (num % i === 0) {
            divs.push(i);
        }
    }

    if (num > 1) {
        divs.push(num);
    }

    return divs;
};

const clamp = (value, max, min) => {
    return value < min || isNaN(value) ? min : (value > max ? max : value);
};

export class VCPUModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dialogError: undefined,
            dialogErrorDetail: undefined,
            sockets: props.vm.cpu.topology.sockets || 1,
            threads: props.vm.cpu.topology.threads || 1,
            cores: props.vm.cpu.topology.cores || 1,
            max: props.vm.vcpus.max || 1,
            count: parseInt(props.vm.vcpus.count) || 1
        };
        this.onMaxChange = this.onMaxChange.bind(this);
        this.onCountSelect = this.onCountSelect.bind(this);
        this.onSocketChange = this.onSocketChange.bind(this);
        this.onThreadsChange = this.onThreadsChange.bind(this);
        this.onCoresChange = this.onCoresChange.bind(this);

        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.save = this.save.bind(this);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    onMaxChange (value) {
        const maxHypervisor = parseInt(this.props.maxVcpu);
        let maxValue = parseInt(value);

        // Check new value for limits
        maxValue = clamp(maxValue, maxHypervisor, 1);

        // Recalculate new values for sockets, cores and threads according to new max value
        // Max value = Sockets * Cores * Threads
        const state = { max: maxValue, sockets: this.state.sockets, cores: this.state.cores };

        // If count of used VCPU greater then new max value, then change it to new max value
        if (maxValue < this.state.count) {
            state.count = maxValue;
        }

        // Recalculate sockets first, and get array of all divisors of new max values
        let divs = dividers(state.max);

        // If current sockets value is not in divisors array, then change it to max divisor
        if (divs.indexOf(this.state.sockets) === -1 || (this.props.vm.cpu.topology.sockets || 1) === this.state.sockets) {
            state.sockets = divs[divs.length - 1];
        }

        // Get next divisors
        divs = dividers(state.max / state.sockets);
        if (divs.indexOf(this.state.cores) === -1) {
            state.cores = divs[divs.length - 1];
        }

        // According to: Max value = Sockets * Cores * Threads. Threads = Max value / ( Sockets * Cores )
        state.threads = state.max / (state.cores * state.sockets);
        this.setState(state);
    }

    onCountSelect (value) {
        const newValue = clamp(value, this.state.max, 1);
        this.setState({ count: parseInt(newValue) });
    }

    onSocketChange (value) {
        const state = { sockets: this.state.sockets, cores: this.state.cores };
        state.sockets = parseInt(value);

        // Get divisors of Max VCPU number divided by number of sockets
        const divs = dividers(this.state.max / state.sockets);

        // If current cores value is not in divisors array, then change it to max divisor
        if (divs.indexOf(this.state.cores) === -1) {
            state.cores = divs[divs.length - 1];
        }

        // Likewise: Max value = Sockets * Cores * Threads. Sockets = Max value / ( Threads * Cores )
        state.threads = (this.state.max / (state.sockets * state.cores));
        this.setState(state);
    }

    onThreadsChange (value) {
        const state = { sockets: this.state.sockets, threads: this.state.threads };
        state.threads = parseInt(value);
        const divs = dividers(this.state.max / state.threads);

        // If current sockets value is not in divisors array, then change it to max divisor
        if (divs.indexOf(state.sockets) === -1) {
            state.sockets = divs[divs.length - 1];
        }

        // Likewise: Max value = Sockets * Cores * Threads. Cores = Max value / ( Threads * Sockets )
        state.cores = (this.state.max / (state.sockets * state.threads));

        this.setState(state);
    }

    onCoresChange (value) {
        const state = { sockets: this.state.sockets, threads: this.state.threads };
        state.cores = parseInt(value);

        const divs = dividers(this.state.max / state.cores);

        // If current sockets value is not in divisors array, then change it to max divisor
        if (divs.indexOf(state.sockets) === -1) {
            state.sockets = divs[divs.length - 1];
        }

        // Likewise: Max value = Sockets * Cores * Threads. Threads = Max value / ( Cores * Sockets )
        state.threads = (this.state.max / (state.sockets * state.cores));
        this.setState(state);
    }

    save() {
        const { close, dispatch, vm } = this.props;

        return dispatch(setVCPUSettings(vm, this.state.max, this.state.count, this.state.sockets, this.state.threads, this.state.cores))
                .fail((exc) => {
                    this.dialogErrorSet(_("VCPU settings could not be saved"), exc.message);
                })
                .then(close);
    }

    render() {
        const { vm } = this.props;
        let caution = null;

        if (vm.state === 'running' && (
            this.state.sockets != (vm.cpu.topology.sockets || 1) ||
            this.state.threads != (vm.cpu.topology.threads || 1) ||
            this.state.cores != (vm.cpu.topology.cores || 1) ||
            this.state.max != vm.vcpus.max ||
            this.state.count != vm.vcpus.count)
        ) {
            caution = <Alert isInline variant='warning' title={_("Changes will take effect after shutting down the VM")} />;
        }

        const defaultBody = (
            <div className="vcpu-modal-grid">
                <Form isHorizontal>
                    <FormGroup fieldId="machines-vcpu-count-field" label={_("vCPU count")}
                               labelIcon={
                                   <Popover bodyContent={_("Fewer than the maximum number of virtual CPUs should be enabled.")}>
                                       <button onClick={e => e.preventDefault()} className="pf-c-form__group-label-help">
                                           <InfoAltIcon noVerticalAlign />
                                       </button>
                                   </Popover>}>
                        <TextInput id="machines-vcpu-count-field"
                                   type="number" inputMode="numeric" pattern="[0-9]*" value={this.state.count}
                                   onKeyPress={digitFilter}
                                   onChange={this.onCountSelect} />
                    </FormGroup>

                    <FormGroup fieldId="machines-vcpu-max-field" label={_("vCPU maximum")}
                               labelIcon={
                                   <Popover bodyContent={this.props.maxVcpu
                                       ? cockpit.format(_("Maximum number of virtual CPUs allocated for the guest OS, which must be between 1 and $0"), parseInt(this.props.maxVcpu))
                                       : _("Maximum number of virtual CPUs allocated for the guest OS")}>
                                       <button onClick={e => e.preventDefault()} className="pf-c-form__group-label-help">
                                           <InfoAltIcon noVerticalAlign />
                                       </button>
                                   </Popover>}>
                        <TextInput id="machines-vcpu-max-field"
                                   type="number" inputMode="numeric" pattern="[0-9]*"
                                   onKeyPress={digitFilter}
                                   onChange={this.onMaxChange} value={this.state.max} />
                    </FormGroup>
                </Form>
                <Form isHorizontal>
                    <FormGroup fieldId="sockets" label={_("Sockets")}
                               labelIcon={
                                   <Popover bodyContent={_("Preferred number of sockets to expose to the guest.")}>
                                       <button onClick={e => e.preventDefault()} className="pf-c-form__group-label-help">
                                           <InfoAltIcon noVerticalAlign />
                                       </button>
                                   </Popover>}>
                        <FormSelect id="socketsSelect"
                                    value={this.state.sockets.toString()}
                                    onChange={this.onSocketChange}>
                            {dividers(this.state.max).map((t) => <FormSelectOption key={t.toString()} value={t.toString()} label={t.toString()} />)}
                        </FormSelect>
                    </FormGroup>

                    <FormGroup fieldId="coresSelect" label={_("Cores per socket")}>
                        <FormSelect id="coresSelect"
                                    value={this.state.cores.toString()}
                                    onChange={this.onCoresChange}>
                            {dividers(this.state.max).map((t) => <FormSelectOption key={t.toString()} value={t.toString()} label={t.toString()} />)}
                        </FormSelect>
                    </FormGroup>

                    <FormGroup fieldId="threadsSelect" label={_("Threads per core")}>
                        <FormSelect id="threadsSelect"
                                    value={this.state.threads.toString()}
                                    onChange={this.onThreadsChange}>
                            {dividers(this.state.max).map((t) => <FormSelectOption key={t.toString()} value={t.toString()} label={t.toString()} />)}
                        </FormSelect>
                    </FormGroup>
                </Form>
            </div>
        );

        return (
            <Modal position="top" variant="medium" id='machines-vcpu-modal-dialog' isOpen onClose={this.props.close}
                   title={cockpit.format(_("$0 vCPU details"), vm.name)}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button id='machines-vcpu-modal-dialog-apply' variant='primary' onClick={this.save}>
                               {_("Apply")}
                           </Button>
                           <Button id='machines-vcpu-modal-dialog-cancel' variant='link' className='btn-cancel' onClick={this.props.close}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                <>
                    { caution }
                    { defaultBody }
                </>
            </Modal>
        );
    }
}
VCPUModal.propTypes = {
    dispatch: PropTypes.func.isRequired,
    vm: PropTypes.object.isRequired,
    maxVcpu: PropTypes.number.isRequired,
    close: PropTypes.func.isRequired,
};
