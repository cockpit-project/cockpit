import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import { show_modal_dialog } from 'cockpit-components-dialog.jsx';
import * as SelectComponent from 'cockpit-components-select.jsx';
import InfoRecord from './infoRecord.jsx';
import { Alert } from './notification/inlineNotification.jsx';
import { setVCPUSettings } from "../actions/provider-actions.es6";

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
            <SelectComponent.SelectEntry data={t}>{t}</SelectComponent.SelectEntry>
        ))}
    </SelectComponent.Select>);
};

class VCPUModalBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            sockets: props.cpu.topology.sockets || 1,
            threads: props.cpu.topology.threads || 1,
            cores: props.cpu.topology.cores || 1,
            max: props.vcpus.max || 1,
            count: parseInt(props.vcpus.count) || 1
        };
        this.onMaxChange = this.onMaxChange.bind(this);
        this.onCountSelect = this.onCountSelect.bind(this);
        this.onSocketChange = this.onSocketChange.bind(this);
        this.onThreadsChange = this.onThreadsChange.bind(this);
        this.onCoresChange = this.onCoresChange.bind(this);
        props.onChange(this.state);
    }

    componentWillUpdate (nextProps, nextState) {
        this.props.onChange(nextState);
    }

    onMaxChange (e) {
        const maxHypervisor = parseInt(this.props.hypervisorMax);
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
        if (divs.indexOf(this.state.sockets) === -1 || (this.props.cpu.topology.sockets || 1) === this.state.sockets) {
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

    render () {
        let caution = null;

        if (this.props.isRunning) {
            caution = (
                <tr>
                    <td colSpan={2} className="machines-vcpu-caution">
                        <Alert text={_("All changes will take effect only after stopping and starting the VM.")} />
                    </td>
                </tr>);
        }

        return (<div className="modal-body">
            <table className="vcpu-detail-modal-table">
                <tr>
                    <td>
                        <table className='form-table-ct'>
                            <InfoRecord
                                descr={_("vCPU Count")}
                                tooltip={_("Fewer than the maximum number of virtual CPUs should be enabled.")}
                                value={<input id="machines-vcpu-count-field" type="number" className="form-control" value={this.state.count} onChange={this.onCountSelect} />}
                            />
                            <InfoRecord
                                descr={_("vCPU Maximum")}
                                tooltip={cockpit.format(_("Maximum number of virtual CPUs allocated for the guest OS, which must be between 1 and $0"), this.props.hypervisorMax)}
                                value={<input id="machines-vcpu-max-field" type="number" className="form-control" onChange={this.onMaxChange} value={this.state.max} />}
                            />
                        </table>
                    </td>
                    <td>
                        <table className='form-table-ct vcpu-detail-modal-right'>
                            <InfoRecord descr={_("Sockets")} tooltip={_("Preferred number of sockets to expose to the guest.")} value={
                                <Select id='socketsSelect' value={this.state.sockets.toString()} onChange={this.onSocketChange} items={dividers(this.state.max).map((t) => t.toString())} />
                            } />
                            <InfoRecord descr={_("Cores per socket")} value={
                                <Select id='coresSelect' value={this.state.cores.toString()} onChange={this.onCoresChange} items={dividers(this.state.max).map((t) => t.toString())} />
                            } />
                            <InfoRecord descr={_("Threads per cores")} value={
                                <Select id='threadsSelect' value={this.state.threads.toString()} onChange={this.onThreadsChange} items={dividers(this.state.max).map((t) => t.toString())} />
                            } />
                        </table>
                    </td>
                </tr>
                { caution }
            </table>
        </div>);
    }
}

VCPUModalBody.propTypes = {
    vcpus: PropTypes.object,
    cpu: PropTypes.shape({
        topology: PropTypes.object.isRequired
    }).isRequired,
    onChange: PropTypes.func.isRequired,
    hypervisorMax: PropTypes.number
};

export default function ({ vm, dispatch, config }) {
    let state = {};
    const onStateChange = (st) => {
        state = Object.assign({}, st);
    };
    return show_modal_dialog(
        {
            title: cockpit.format(_("$0 vCPU Details"), vm.name),
            body: (<VCPUModalBody vcpus={vm.vcpus} cpu={vm.cpu} onChange={onStateChange} isRunning={vm.state == 'running'} hypervisorMax={config.hypervisorMaxVCPU[vm.connectionName]} />),
            id: "machines-vcpu-modal-dialog"
        },
        { actions: [
            {
                caption: _("Apply"),
                style: 'primary',
                clicked: function () {
                    return dispatch(setVCPUSettings(vm, state.max, state.count, state.sockets, state.threads, state.cores));
                }
            }
        ]}
    );
}
