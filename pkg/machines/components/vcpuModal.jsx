import React from 'react';
import PropTypes from 'prop-types';
import { Button, Modal } from 'patternfly-react';
import cockpit from 'cockpit';

import { ModalError } from './notification/inlineNotification.jsx';
import * as SelectComponent from 'cockpit-components-select.jsx';
import InfoRecord from './infoRecord.jsx';
import { setVCPUSettings } from "../actions/provider-actions.js";

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

const Select = function ({ id, items, onChange, value }) {
    return (<SelectComponent.Select id={id} initial={value} onChange={onChange}>
        {items.map((t) => (
            <SelectComponent.SelectEntry key={t} data={t}>{t}</SelectComponent.SelectEntry>
        ))}
    </SelectComponent.Select>);
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

    onMaxChange (e) {
        const maxHypervisor = parseInt(this.props.config.hypervisorMaxVCPU[this.props.vm.connectionName]);
        let maxValue = parseInt(e.target.value);

        // Check new value for limits
        maxValue = clamp(maxValue, maxHypervisor, 1);

        // Recalculate new values for sockets, cores and threads according to new max value
        // Max value = Sockets * Cores * Threads
        let state = { max: maxValue, sockets: this.state.sockets, cores: this.state.cores };

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

    onCountSelect (e) {
        let value = parseInt(e.target.value);
        value = clamp(value, this.state.max, 1);
        this.setState({ count: parseInt(value) });
    }

    onSocketChange (value) {
        let state = { sockets: this.state.sockets, cores: this.state.cores };
        state.sockets = parseInt(value);

        // Get divisors of Max VCPU number divided by number of sockets
        let divs = dividers(this.state.max / state.sockets);

        // If current cores value is not in divisors array, then change it to max divisor
        if (divs.indexOf(this.state.cores) === -1) {
            state.cores = divs[divs.length - 1];
        }

        // Likewise: Max value = Sockets * Cores * Threads. Sockets = Max value / ( Threads * Cores )
        state.threads = (this.state.max / (state.sockets * state.cores));
        this.setState(state);
    }

    onThreadsChange (value) {
        let state = { sockets: this.state.sockets, threads: this.state.threads };
        state.threads = parseInt(value);
        let divs = dividers(this.state.max / state.threads);

        // If current sockets value is not in divisors array, then change it to max divisor
        if (divs.indexOf(state.sockets) === -1) {
            state.sockets = divs[divs.length - 1];
        }

        // Likewise: Max value = Sockets * Cores * Threads. Cores = Max value / ( Threads * Sockets )
        state.cores = (this.state.max / (state.sockets * state.threads));

        this.setState(state);
    }

    onCoresChange (value) {
        let state = { sockets: this.state.sockets, threads: this.state.threads };
        state.cores = parseInt(value);

        let divs = dividers(this.state.max / state.cores);

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
            caution = (
                <span className='idle-message'>
                    <i className='pficon pficon-pending' />
                    <span>{_("Changes will take effect after shutting down the VM")}</span>
                </span>
            );
        }

        const defaultBody = (
            <div className="modal-body">
                <table className="vcpu-detail-modal-table">
                    <tbody>
                        <tr>
                            <td>
                                <table className='form-table-ct'>
                                    <tbody>
                                        <InfoRecord
                                            descr={_("vCPU Count")}
                                            tooltip={_("Fewer than the maximum number of virtual CPUs should be enabled.")}
                                            value={<input id="machines-vcpu-count-field" type="number" className="form-control" value={this.state.count} onChange={this.onCountSelect} />}
                                        />
                                        <InfoRecord
                                            descr={_("vCPU Maximum")}
                                            tooltip={cockpit.format(
                                                _("Maximum number of virtual CPUs allocated for the guest OS, which must be between 1 and $0"),
                                                parseInt(this.props.config.hypervisorMaxVCPU[vm.connectionName])
                                            )}
                                            value={<input id="machines-vcpu-max-field" type="number" className="form-control" onChange={this.onMaxChange} value={this.state.max} />}
                                        />
                                    </tbody>
                                </table>
                            </td>
                            <td>
                                <table className='form-table-ct vcpu-detail-modal-right'>
                                    <tbody>
                                        <InfoRecord descr={_("Sockets")} tooltip={_("Preferred number of sockets to expose to the guest.")} value={
                                            <Select id='socketsSelect' value={this.state.sockets.toString()} onChange={this.onSocketChange} items={dividers(this.state.max).map((t) => t.toString())} />
                                        } />
                                        <InfoRecord descr={_("Cores per socket")} value={
                                            <Select id='coresSelect' value={this.state.cores.toString()} onChange={this.onCoresChange} items={dividers(this.state.max).map((t) => t.toString())} />
                                        } />
                                        <InfoRecord descr={_("Threads per core")} value={
                                            <Select id='threadsSelect' value={this.state.threads.toString()} onChange={this.onThreadsChange} items={dividers(this.state.max).map((t) => t.toString())} />
                                        } />
                                    </tbody>
                                </table>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        );

        return (
            <Modal id='machines-vcpu-modal-dialog' show onHide={this.props.close} >
                <Modal.Header>
                    <Modal.CloseButton onClick={this.props.close} />
                    <Modal.Title> {`${vm.name} VCPU details`} </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    { defaultBody }
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    { caution }
                    <Button id='machines-vcpu-modal-dialog-cancel' bsStyle='default' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                    <Button id='machines-vcpu-modal-dialog-apply' bsStyle='primary' onClick={this.save}>
                        {_("Apply")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}
VCPUModal.propTypes = {
    dispatch: PropTypes.func.isRequired,
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    close: PropTypes.func.isRequired,
};
