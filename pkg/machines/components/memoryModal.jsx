import React from 'react';
import cockpit from 'cockpit';

import { show_modal_dialog } from 'cockpit-components-dialog.jsx';
import InfoRecord from './infoRecord.jsx';
import { toKiloBytes } from '../helpers.es6'
import SelectComponent from 'cockpit-components-select.jsx';

import { changeMemory } from "../actions.es6";

React;

const _ = cockpit.gettext;

class BytesField extends React.Component {
    constructor(props) {
        super(props);
        this.state = { value: props.value, measure: props.measure };
        this.onValueChange = this.onValueChange.bind(this);      
        this.onMeasureChange = this.onMeasureChange.bind(this);      
    }

    componentWillReceiveProps(nextProps) {
        this.setState({ value: nextProps.value, measure: nextProps.measure});
    }

    onValueChange(e) {
        let value = parseInt(e.target.value);

        if (value < 0) {
            value = 1;
        }


        this.setState({ value });

        this.props.onChange(toKiloBytes(value, this.state.measure));
    }

    onMeasureChange(measure) {
        this.setState({ measure });
        this.props.onChange(toKiloBytes(this.state.value, measure));
    }

    render() {
        const { valueId, measureId } = this.props;
        return (
            <div className="bytes-field-block">
                <input id={valueId} type="number" className="form-control" value={this.state.value} onChange={this.onValueChange} />
                <SelectComponent.Select id={measureId} initial={this.state.measure} onChange={this.onMeasureChange}>
                    <SelectComponent.SelectEntry data='MiB'>MiB</SelectComponent.SelectEntry>
                    <SelectComponent.SelectEntry data='GiB'>GiB</SelectComponent.SelectEntry>
                    <SelectComponent.SelectEntry data='TiB'>TiB</SelectComponent.SelectEntry>
                </SelectComponent.Select>
            </div>
            )
    }
}

class MemoryModalBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            newDeviceSize: 0,
            max: props.memory.maxMemory,
            memory: props.memory.memory,
            current: props.memory.currentMemory
        };
        this.handleSizeFieldChange = this.handleSizeFieldChange.bind(this);
        this.onCurrentChange = this.onCurrentChange.bind(this);
    }

    componentWillUpdate (nextProps, nextState) {
        this.props.onChange(nextState);
    }

    handleSizeFieldChange(value) {
        this.setState({ newDeviceSize: value });
    }

    componentWillReceiveProps(nextProps) {
        const newState = {
            max: nextProps.memory.maxMemory,
            memory: nextProps.memory.memory,
            current: nextProps.memory.currentMemory
        };
        this.setState(newState);
    }

    onCurrentChange(current) {
        const state = { current }
        
        if (state.current > this.state.max) {
            state.current = this.state.max;
        }

        if (state.current < 1) {
            state.current = 1;
        }

        this.setState(state);
    }

    render () {
        const { memory, onMemoryAdd, onMemoryRemove, vmState } = this.props;

        const addHandler = () => {
            if ((this.state.newDeviceSize / 1024) % 128 === 0) {
                onMemoryAdd(this.state.newDeviceSize);
            }
        }

        const removeHandler = (size) => {
            return () => onMemoryRemove(size);
        }

        const maxFormated = cockpit.format_bytes((this.state.max ? this.state.max : 0) * 1024, 1024, true);
        const memoryFormated = cockpit.format_bytes((this.state.memory ? this.state.memory : 0) * 1024, 1024, true);
        const currentFormated = cockpit.format_bytes((this.state.current ? this.state.current : 0) * 1024, 1024, true);
        const newDeviceSizeFormated = cockpit.format_bytes((this.state.newDeviceSize ? this.state.newDeviceSize : 0) * 1024, 1024, true);
        const memoryMap = {
            max: {
                value: maxFormated[0],
                measure: maxFormated[1]
            },
            memory: {
                value: memoryFormated[0],
                measure: memoryFormated[1]
            },
            current: {
                value: currentFormated[0],
                measure: currentFormated[1]
            },
            newDeviceSize: {
                value: newDeviceSizeFormated[0],
                measure: newDeviceSizeFormated[1] || 'MiB'
            }
        };

        return (<div className="modal-body">
            <table className="memory-detail-modal-table">
                <tr>
                    <td>
                        <table className='form-table-ct'>
                            <InfoRecord
                                id="machines-memory-max-value"
                                descr={_("Max Memory")}
                                value={`${memoryMap.max.value} ${memoryMap.max.measure}`}
                            />
                            <InfoRecord
                                id="machines-memory-value"
                                descr={_("Memory")}
                                value={`${memoryMap.memory.value} ${memoryMap.memory.measure}`}
                            />
                            <InfoRecord
                                descr={_("Current Memory")}
                                value={<BytesField valueId="machines-memory-current-value" measureId="machines-memory-max-measure" value={memoryMap.current.value} measure={memoryMap.current.measure} onChange={this.onCurrentChange} />}
                            />
                        </table>
                    </td>
                    <td className='memory-devices-column'>
                        <label className='control-label'>
                            Memory devices:
                        </label>
                        <div className='memory-devices-list'>
                            {memory.memoryDevices.map((device) => (
                                <div className='memory-device-item'>
                                    <div className='memory-device-item-body'>
                                        <table className='form-table-ct'>
                                            <InfoRecord
                                                descr={_("Target size")}
                                                value={cockpit.format_bytes((device.target.size ? device.target.size : 0) * 1024)}
                                                valueClass="memory-device-item-target-size" />
                                            <InfoRecord
                                                descr={_("Source page size")}
                                                value={cockpit.format_bytes((device.source.pagesize ? device.source.pagesize : 0) * 1024)}
                                                valueClass="memory-device-item-source-size" />
                                        </table>
                                    </div>
                                    <div>
                                        <button className="btn btn-danger" onClick={removeHandler(device.xml)}>-</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className='memory-device-item'>
                            <div className='memory-device-item-body'>
                                <BytesField valueId="machines-add-memory-device-value" measureId="machines-add-memory-device-measure" value={memoryMap.newDeviceSize.value} measure={memoryMap.newDeviceSize.measure} onChange={this.handleSizeFieldChange} />
                            </div>
                            <div>
                                <button id="machines-memory-add-memory-device-button" className="btn btn-primary" onClick={addHandler} disabled={vmState !== 'running'}>+</button>
                            </div>
                        </div>
                    </td>
                </tr>
            </table>
        </div>);
    }
}

export default function ({ vm, dispatch, onMemoryAdd, onMemoryRemove }) {

    const vmName = vm.name;
    const memory = vm.memory;
    const vmState = vm.state;

    let state = { memory: vm.memory.memory, current: vm.memory.currentMemory };
    const onStateChange = (st) => {
        state = Object.assign({}, st);
    }

    let dlg = show_modal_dialog(
        {
            title: cockpit.format(_("$0 Memory Detail"), vmName),
            body: (<MemoryModalBody memory={memory} vmState={vmState} onMemoryAdd={onMemoryAdd} onChange={onStateChange} onMemoryRemove={onMemoryRemove} />)
        },
        { actions: [
            {
                caption: _("Apply"),
                style: 'primary',
                clicked: function () {
                    return dispatch(changeMemory(vm, state.current));
                }
            }
        ]}
    );
    dlg.render();

    return {
        reload: ({ vmName, vmState, memory, onMemoryAdd, onMemoryRemove }) => 
            dlg.setProps({
                title: cockpit.format(_("$0 Memory Detail"), vmName),
                body: (<MemoryModalBody memory={memory} vmState={vmState} onMemoryAdd={onMemoryAdd} onChange={onStateChange} onMemoryRemove={onMemoryRemove} />)
            })
    };
}