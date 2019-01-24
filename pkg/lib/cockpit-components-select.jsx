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
import PropTypes from 'prop-types';
import cockpit from "cockpit";

import "page.css";

const _ = cockpit.gettext;

const textForUndefined = _("undefined");

/* React pattern component for a dropdown/select control
 * Entries should be child components of type SelectEntry
 *
 * User of this component should listen onChange and set selected prop of it
 *
 * Expected properties:
 *  - selected (optional) explicit data to select, default: first entry
 *  - onChange (required) callback (parameter data) when the selection has changed
 *  - id (optional) html id of the top level node
 *  - enabled (optional) whether the component is enabled or not; defaults to true
 *  - extraClass (optional) CSS class name(s) to be added to the main <select> of the component
 */
export const StatelessSelect = ({ selected, onChange, id, enabled, extraClass, children }) => (
    <select className={ "ct-select " + (extraClass || "") }
            onChange={ ev => onChange(ev.target.value) }
            id={id} value={selected} disabled={enabled === false}>
        {children}
    </select>
);

export class Select extends React.Component {
    constructor(props) {
        super();
        this.onChange = this.onChange.bind(this);

        this.state = { value: props.initial,
        };
    }

    onChange(value) {
        this.setState({ value });
        if (typeof this.props.onChange === 'function')
            this.props.onChange(value);
    }

    componentWillReceiveProps(nextProps) {
        this.setState({ value: nextProps.initial });
    }

    render() {
        return (
            <StatelessSelect onChange={this.onChange}
                             selected={this.state.value}
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
            <option key={value} disabled={this.props.disabled}
                data-value={value} value={this.props.data}>
                {value}
            </option>
        );
    }
}

SelectEntry.propTypes = {
    data: PropTypes.any.isRequired,
};

/* Divider
 * Example: <SelectDivider/>
 */
/* HACK: dividers do not exist in HTML selects — people either use blank
 * space (which we probably want to do) or a disabled text, like these dashes */
export const SelectDivider = () => (
    <option role="separator" className="divider" disabled>
        ──────────
    </option>
);
