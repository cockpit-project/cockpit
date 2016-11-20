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

(function() {
    "use strict";

    var cockpit = require("cockpit");
    var React = require("react");

    require("page.css");

    var _ = cockpit.gettext;

    var textForUndefined = _("undefined");

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
        handleDocumentClick: function(node, ev) {
            // clicking outside the select control should ensure it's closed
            if (!node.contains(ev.target))
                this.setState({ open: false });
        },
        componentDidMount: function() {
            var handler = this.handleDocumentClick.bind(this, React.findDOMNode(this));
            this.setState({ documentClickHandler: handler });
            document.addEventListener('click', handler, false);
        },
        componentWillUnmount: function() {
            document.removeEventListener('click', this.state.documentClickHandler, false);
        },
        getInitialState: function() {
            return {
                open: false,
                currentData: this.props.initial,
                documentClickHandler: undefined,
            };
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
                if (elementData === this.state.currentData)
                    return;
                this.setState({ currentData: elementData });
                if (this.props.onChange)
                    this.props.onChange(elementData);
            } else {
                this.setState({ open: !this.state.open });
            }
        },
        render: function() {
            var self = this;
            var currentValue;

            var listItems = React.Children.map(this.props.children, function(itm) {
                var data = ('data' in itm.props) ? itm.props.data : undefined;
                // we need to have some kind of value
                var value = (itm.props.children !== undefined) ? itm.props.children : textForUndefined;
                if (data === self.state.currentData)
                    currentValue = value;
                // if there's no initial value, use the first one
                else if (!self.props.initial && currentValue === undefined)
                    currentValue = value;
                return <li data-value={value} data-data={data}>{itm}</li>;
            });
            var classes = "btn-group bootstrap-select dropdown";
            if (this.state.open)
                classes += " open";

            return (
                <div className={classes} onClick={this.clickHandler} id={this.props.id}>
                    <button className="btn btn-default dropdown-toggle" type="button">
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
            var value = (this.props.children !== undefined) ? this.props.children : textForUndefined;
            return <a>{value}</a>;
        }
    });

    module.exports = {
        Select: Select,
        SelectEntry: SelectEntry,
    };
}());
