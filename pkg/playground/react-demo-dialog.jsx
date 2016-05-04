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

/* React Pattern Component for a dropdown/select control
 * Expected properties:
 *  - items array of entries, each of type { value: 'value', data: 'key' }
 *  - initial (optional) initial index, default: 0
 *  - on_change callback when the selection has changed with parameters (value, data)
 *    value is displayed inside the dropdown <li><a></a></li> component
 */
var ReactPatternSelect = React.createClass({
    propTypes: {
        items: React.PropTypes.array.isRequired,
        initial: React.PropTypes.number,
        on_change: React.PropTypes.func.isRequired,
    },
    getInitialState: function() {
        return {
            open: false,
            current_index: ('initial' in this.props)?this.props.initial:0,
        };
    },
    clickHandler: function(ev) {
        // only consider clicks with the primary button
        if (ev && ev.button !== 0)
            return;
        if (ev.target.tagName == 'A') {
            var li_element = ev.target.offsetParent;
            var idx = li_element.attributes['data-index'].value;
            this.setState({ open: false });
            // if the item index didn't change, don't do anything
            if (idx === this.state.current_index)
                return;
            var itm = this.props.items[idx];
            var data = ('data' in itm)?itm['data']:null;
            this.setState({ current_index: idx });
            if (this.props.on_change)
                this.props.on_change(itm.value, data);
        } else {
            this.setState({ open: !this.state.open });
        }
    },
    render: function() {
        var self = this;
        var list_items = this.props.items.map(function(itm, index) {
            var data = ('data' in itm)?itm['data']:null;
          return (<li data-index={index}><a>{itm.value}</a></li>
            );
        });
        var classes = "btn-group bootstrap-select dropdown form-control";
        if (this.state.open)
            classes += " open";

        return (
            <div className={classes} onClick={this.clickHandler}>
                <button className="btn btn-default dropdown-toggle" type="button">
                    <span className="pull-left">{this.props.items[this.state.current_index].value}</span>
                    <span className="caret"></span>
                </button>
                <ul className="dropdown-menu">
                    { list_items }
                </ul>
            </div>
        );
    }
});

/* Sample dialog body
 */
var PatternDialogBody = React.createClass({
    select_change: function(value, data) {
        console.log("new value: " + value + " (data: " + data + ")");
    },
    render: function() {
        var dropdown_items = [ {value: _("One"), data: 'one'},
                               {value: _("Two"), data: 'two'}
                             ];
        return (
            <div className="modal-body">
                <table className="form-table-ct">
                    <tr>
                        <td className="top">
                            <label className="control-label" for="control-1">
                                {_("Label")}
                            </label>
                        </td>
                        <td>
                            <input id="control-1" className="form-control" type="text"/>
                        </td>
                    </tr>
                    <tr>
                        <td className="top">
                            <label className="control-label" for="control-2">
                                {_("Select")}
                            </label>
                        </td>
                        <td>
                            <ReactPatternSelect items={dropdown_items}
                                                on_change={this.select_change.bind(this)}/>
                        </td>
                    </tr>
                </table>
            </div>
        );
    }
});

return PatternDialogBody;
});
