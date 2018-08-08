import React from 'react';
import PropTypes from 'prop-types';

import {
    setVisibilityFilter,
} from '../actions/store-actions.es6';
import {
    createVmAction
} from "./create-vm-dialog/createVmDialog.jsx";

import './hostvmscaption.css';

import cockpit from 'cockpit';
const _ = cockpit.gettext;

class HostVmsCaption extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            filterName: '',
            filterConnection: 'all',
            filterState: 'all',
        };

        this.getButtonClassNames = this.getButtonClassNames.bind(this);
        this.isButtonActive = this.isButtonActive.bind(this);
        this.onButtonClick = this.onButtonClick.bind(this);
        this.setActive = this.setActive.bind(this);
        this.updateTextFilterValue = this.updateTextFilterValue.bind(this);
    }

    filterAdded(key, value) {
        this.props.dispatch(setVisibilityFilter({filterType: key, filterValue: value}));
    }

    isButtonActive(buttonType, buttonId) {
        if (buttonId == this.state[buttonType])
            return true;
    }

    getButtonClassNames(buttonType, buttonId) {
        let defaultClasses = 'btn btn-default';

        if (this.isButtonActive(buttonType, buttonId))
            return defaultClasses + ' active';
        return defaultClasses;
    }

    onButtonClick(keyType, keyValue) {
        switch (keyType) {
        case 'filterConnection':
        case 'filterState':
            this.setActive(keyType, keyValue);
            break;
        }
        this.filterAdded(keyType, keyValue);
    }

    updateTextFilterValue(event) {
        this.setState({ filterName: event.target.value });
    }

    setActive(activeType, index) {
        this.setState({ [activeType]: index });
    }

    render() {
        const {dispatch, systemInfo} = this.props;

        return (
            <div className="container-fluid" id="filterBar">
                <div className="row">
                    <div className="col-md-8">
                        <div className="wrapper fill">
                            <div className="form-group" key="filterName">
                                <div className="input-group input-small" key="filterInputGroup">
                                    <input type="text"
                                           className="form-control"
                                           placeholder="Filter By Name..."
                                           onChange={(evt) => this.updateTextFilterValue(evt)} />
                                    <div className="input-group-btn">
                                        <button type="button"
                                                className="btn btn-default"
                                                onClick={() => this.onButtonClick('filterName', this.state.filterName)}> GO </button>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <span className="filter-title" translate>Connection: </span>
                                <div className="btn-group" id="filterConnection" role="tablist">
                                    <button className={this.getButtonClassNames('filterConnection', 'all')}
                                            role="tab" translatable="yes"
                                            aria-current={this.isButtonActive('filterConnection', 'all') ? "true" : "false"}
                                            onClick={() => this.onButtonClick('filterConnection', 'all')}> {_("All")} </button>
                                    <button className={this.getButtonClassNames('filterConnection', 'system')}
                                            role="tab" translatable="yes"
                                            aria-current={this.isButtonActive('filterConnection', 'system') ? "true" : "false"}
                                            onClick={() => this.onButtonClick('filterConnection', 'system')}> {_("System")} </button>
                                    <button className={this.getButtonClassNames('filterConnection', 'session')}
                                            role="tab" translatable="yes"
                                            aria-current={this.isButtonActive('filterConnection', 'session') ? "true" : "false"}
                                            onClick={() => this.onButtonClick('filterConnection', 'session')}> {_("Session")} </button>
                                </div>
                            </div>
                            <div>
                                <span className="filter-title" translate>State: </span>
                                <div className="btn-group" id="filterState" role="tablist">
                                    <button className={this.getButtonClassNames('filterState', 'all')}
                                            role="tab" translatable="yes"
                                            aria-current={this.isButtonActive('filterState', 'all') ? "true" : "false"}
                                            onClick={() => this.onButtonClick('filterState', 'all')}> {_("All")} </button>
                                    <button className={this.getButtonClassNames('filterState', 'shut off')}
                                            role="tab" translatable="yes"
                                            aria-current={this.isButtonActive('filterState', 'shut off') ? "true" : "false"}
                                            onClick={() => this.onButtonClick('filterState', 'shut off')}> {_("Shut off")} </button>
                                    <button className={this.getButtonClassNames('filterState', 'running')}
                                            role="tab" translatable="yes"
                                            aria-current={this.isButtonActive('filterState', 'running') ? "true" : "false"}
                                            onClick={() => this.onButtonClick('filterState', 'running')}> {_("Running")} </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-4 pull-right">
                        {createVmAction({dispatch, systemInfo})}
                    </div>
                </div>
            </div>
        );
    }
}

HostVmsCaption.propTypes = {
    dispatch: PropTypes.func.isRequired,
    systemInfo: PropTypes.object,
};

export default HostVmsCaption;
