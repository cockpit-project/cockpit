/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import cockpit from "cockpit";

import "page.css";

const _ = cockpit.gettext;

const textForUndefined = _("undefined");

/* React pattern component for a dropdown/select control
 * Entries should be child components of type SelectEntry (html <a>)
 *
 * User of this component should listen onChange and set selected prop of it
 *
 * Expected properties:
 *  - selected (optional) explicit data to select, default: first entry
 *  - onChange (optional) callback (parameter data) when the selection has changed
 *  - id (optional) html id of the top level node
 *  - enabled (optional) whether the component is enabled or not; defaults to true
 *  - extraClass (optional) CSS class name(s) to be added to the main <div> of the component
 */
export class StatelessSelect extends React.Component {
    constructor() {
        super();
        this.clickHandler = this.clickHandler.bind(this);

        this.state = {
            open: false,
            documentClickHandler: undefined,
        };
    }

    componentDidMount() {
        const handler = this.handleDocumentClick.bind(this, ReactDOM.findDOMNode(this));
        this.setState({ documentClickHandler: handler });
        document.addEventListener('click', handler, false);
    }

    componentWillUnmount() {
        document.removeEventListener('click', this.state.documentClickHandler, false);
    }

    handleDocumentClick(node, ev) {
        // clicking outside the select control should ensure it's closed
        if (!node.contains(ev.target))
            this.setState({ open: false });
    }

    clickHandler(ev) {
        // only consider clicks with the primary button
        if (ev && ev.button !== 0)
            return;

        if (ev.target.tagName === 'A') {
            const liElement = ev.target.offsetParent;
            if (liElement.className.indexOf("disabled") >= 0)
                return;
            let elementData;
            if ('data-data' in liElement.attributes)
                elementData = liElement.attributes['data-data'].value;

            this.setState({ open: false });
            // if the item didn't change, don't do anything
            if (elementData === this.props.selected)
                return;
            if (this.props.onChange)
                this.props.onChange(elementData);
        } else {
            this.setState({ open: !this.state.open });
        }
    }

    render() {
        const getItemData = (item) => (item && item.props && ('data' in item.props) ? item.props.data : undefined);
        const getItemValue = (item) => (item && item.props && (item.props.children !== undefined) ? item.props.children : textForUndefined);

        const entries = React.Children.toArray(this.props.children).filter(item => item && item.props && ('data' in item.props));

        let selectedEntries = entries.filter(item => this.props.selected === getItemData(item));

        let selectedEntry;
        if (selectedEntries.length > 0)
            selectedEntry = selectedEntries[0];
        else if (entries.length > 0)
            selectedEntry = entries[0]; // default to first item if selected item not found

        const currentValue = getItemValue(selectedEntry);

        let classes = "btn-group bootstrap-select dropdown";
        if (this.state.open)
            classes += " open";
        if (this.props.extraClass) {
            classes += " " + this.props.extraClass;
        }

        let buttonClasses = "btn btn-default dropdown-toggle";
        if (this.props.enabled === false)
            buttonClasses += " disabled";

        return (
            <div className={classes} onClick={this.clickHandler} id={this.props.id}>
                <button className={buttonClasses} type="button">
                    <span className="pull-left">{currentValue}</span>
                    <span className="caret" />
                </button>
                <ul className="dropdown-menu">
                    {this.props.children}
                </ul>
            </div>
        );
    }
}

StatelessSelect.propTypes = {
    selected: PropTypes.any,
    onChange: PropTypes.func,
    id: PropTypes.string,
    enabled: PropTypes.bool,
    extraClass: PropTypes.string,
};

export class Select extends React.Component {
    constructor(props) {
        super();
        this.onChange = this.onChange.bind(this);

        this.state = {
            currentData: props.initial,
        };
    }

    onChange(data) {
        this.setState({ currentData: data });
        if (typeof this.props.onChange === 'function')
            this.props.onChange(data);
    }

    componentWillReceiveProps(nextProps) {
        this.setState({ currentData: nextProps.initial });
    }

    render() {
        return (
            <StatelessSelect onChange={this.onChange}
                             selected={this.state.currentData}
                             id={this.props.id}
                             enabled={this.props.enabled}
                             extraClass={this.props.extraClass}>
                {this.props.children}
            </StatelessSelect>
        );
    }
}

Select.propTypes = {
    initial: PropTypes.any,
    onChange: PropTypes.func,
    id: PropTypes.string,
    enabled: PropTypes.bool,
    extraClass: PropTypes.string,
};

/* Entry class for the select component
 * Dynamic lists should make sure to also provide 'key' props for react to use
 * Expected properties:
 *  - data (required), will be passed to the select's onChange callback
 *  - disabled (optional): whether or not the entry is disabled.
 * Example: <SelectEntry data="foo">Some entry</SelectEntry>
 */
export class SelectEntry extends React.Component {
    render() {
        const value = (this.props.children !== undefined) ? this.props.children : textForUndefined;
        return (
            <li key={value} className={this.props.disabled ? "disabled" : ""}
                data-value={value} data-data={this.props.data}>
                <a>{value}</a>
            </li>
        );
    }
}

/* Divider
 * Example: <SelectDivider/>
 */
export const SelectDivider = () => <li role="separator" className="divider" />;

/* Header
 * Example: <SelectHeader>Some header</SelectHeader>
 */
export const SelectHeader = ({ children }) => {
    const value = (children !== undefined) ? children : textForUndefined;
    return (
        <li className="dropdown-header">{value}</li>
    );
};

SelectEntry.propTypes = {
    data: PropTypes.any.isRequired,
};
