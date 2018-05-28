import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import { show_modal_dialog } from 'cockpit-components-dialog.jsx';
import { setVCPUSettings } from "../../machines/actions/provider-actions.es6";
import InfoRecord from '../../machines/components/infoRecord.jsx';

const _ = cockpit.gettext;

class VCPUModalBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            sockets: props.cpu.topology.sockets || 1,
            threads: props.cpu.topology.threads || 1,
            cores: props.cpu.topology.cores || 1,
            count: (props.cpu.topology.sockets * props.cpu.topology.cores * props.cpu.topology.threads) || 1
        };

        this.handleChange = this.handleChange.bind(this);
        props.onChange(this.state);
    }

    componentWillUpdate (nextProps, nextState) {
        this.props.onChange(nextState);
    }

    handleChange (paramName) {
        return (e) => {
            let value = parseInt(e.target.value);
            if (!value) {
                value = 1;
            }

            let state = { sockets: this.state.sockets, threads: this.state.threads, cores: this.state.cores };
            state[paramName] = value;
            // Get values of topology and calculate product of multiplying
            state.count = Object.values(state).reduce((accumulator, currentValue) => accumulator * currentValue, 1);

            this.setState(state);
        };
    }

    render () {
        return (<div className="modal-body">
            <table className="vcpu-detail-modal-table">
                <tr>
                    <td>
                        <table className='form-table-ct'>
                            <InfoRecord
                                descr={_("vCPU Count")}
                                tooltip={_("Number of virtual CPUs that gonna be used.")}
                                value={<input id="machines-vcpu-count-field" type="number" className="form-control" value={this.state.count} disabled />}
                            />
                        </table>
                    </td>
                    <td>
                        <table className='form-table-ct vcpu-detail-modal-right'>
                            <InfoRecord descr={_("Sockets")} tooltip={_("Preferred number of sockets to expose to the guest.")} value={
                                <input id='socketsInput' value={this.state.sockets.toString()} onChange={this.handleChange("sockets")} disabled={this.props.isRunning} />
                            } />
                            <InfoRecord descr={_("Cores per socket")} value={
                                <input id='coresInput' value={this.state.cores.toString()} onChange={this.handleChange("cores")} disabled={this.props.isRunning} />
                            } />
                            <InfoRecord descr={_("Threads per cores")} value={
                                <input id='threadsInput' value={this.state.threads.toString()} onChange={this.handleChange("threads")} disabled={this.props.isRunning} />
                            } />
                        </table>
                    </td>
                </tr>
            </table>
        </div>);
    }
}

VCPUModalBody.propTypes = {
    cpu: PropTypes.shape({
        topology: PropTypes.object.isRequired
    }).isRequired,
    onChange: PropTypes.func.isRequired,
};

export default function ({ vm, dispatch }) {
    let state = {};
    const onStateChange = (st) => {
        state = Object.assign({}, st);
    };

    return show_modal_dialog(
        {
            title: cockpit.format(_("$0 vCPU Details"), vm.name),
            body: (<VCPUModalBody cpu={vm.cpu} onChange={onStateChange} isRunning={vm.state == 'running'} />),
            id: "machines-vcpu-modal-dialog"
        },
        { actions: [
            {
                caption: _("Apply"),
                style: 'primary',
                clicked: function () {
                    return dispatch(setVCPUSettings(vm, null, null, state.sockets, state.threads, state.cores));
                }
            }
        ]}
    );
}
