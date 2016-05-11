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
define([
    "base1/react",
    "base1/cockpit",
], function(React, cockpit) {

    "use strict";
    var _ = cockpit.gettext;

    var textForUndefined = _('undefined');

    /* React pattern component for a dropdown/select control
     * Entries should be child components of type SelectEntry (html <a>)
     * Expected properties:
     *  - initial (optional) initial value to display, default: first entry
     *  - onChange (optional) callback (parameter data) when the selection has changed
     *  - id (optional) html id of the top level node
     */
    var Select = React.createClass({
        propTypes: {
            initial: React.PropTypes.string,
            onChange: React.PropTypes.func,
            id: React.PropTypes.string,
        },
        getInitialState: function() {
            return {
                open: false,
                currentData: undefined,
                currentValue: undefined,
            };
        },
        loseFocus: function(ev) {
            this.setState({ open: false });
        },
        clickHandler: function(ev) {
            // only consider clicks with the primary button
            if (ev && ev.button !== 0)
                return;
            if (ev.target.tagName == 'A') {
                var liElement = ev.target.offsetParent;
                var elementValue = liElement.attributes['data-value'].value;
                var elementData;
                if ('data-data' in liElement.attributes)
                    elementData = liElement.attributes['data-data'].value;

                this.setState({ open: false });
                // if the item didn't change, don't do anything
                if (elementValue === this.state.currentValue && elementData === this.state.currentData)
                    return;
                this.setState({ currentValue: elementValue, currentData: elementData });
                if (this.props.onChange)
                    this.props.onChange(elementData);
            } else {
                this.setState({ open: !this.state.open });
            }
        },
        render: function() {
            var self = this;
            var currentValue = this.state.currentValue;
            if (currentValue === undefined && 'initial' in this.props)
                currentValue = this.props.initial;

            var listItems;
            if (this.props.children) {
                listItems = this.props.children.map(function(itm) {
                    var data = ('data' in itm.props)?itm.props.data:undefined;
                    // we need to have some kind of value
                    var value = (itm.props.children !== undefined)?itm.props.children:textForUndefined;
                    // if we don't have anything selected, take the first item
                    if (currentValue === undefined) {
                        currentValue = value;
                        self.setState({ currentValue: currentValue, currentData: data });
                        self.props.onChange(data);
                    }
                    return <li data-value={value} data-data={data}>{itm}</li>;
                });
            }
            var classes = "btn-group bootstrap-select dropdown form-control";
            if (this.state.open)
                classes += " open";

            // use onMouseDown here instead of onClick so we catch a click on the items before we lose focus and close
            return (
                <div className={classes} onMouseDown={this.clickHandler} id={this.props.id}>
                    <button className="btn btn-default dropdown-toggle" type="button" onBlur={this.loseFocus}>
                        <span className="pull-left">{currentValue}</span>
                        <span className="caret"></span>
                    </button>
                    <ul className="dropdown-menu">
                        { listItems }
                    </ul>
                </div>
            );
        }
    });

    /* Entry class for the select component
     * Dynamic lists should make sure to also provide 'key' props for react to use
     * Expected properties:
     *  - data optional, will be passed to the select's onChange callback
     * Example: <SelectEntry data="foo">Some entry</SelectEntry>
     */
    var SelectEntry = React.createClass({
        propTypes: {
            data: React.PropTypes.string.isRequired,
        },
        render: function() {
            var value = (this.props.children !== undefined)?this.props.children:textForUndefined;
            return <a>{value}</a>;
        }
    });

    return {
        Select: Select,
        SelectEntry: SelectEntry,
    };

});
