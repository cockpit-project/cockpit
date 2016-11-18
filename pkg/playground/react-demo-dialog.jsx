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
    var Select = require("cockpit-components-select.jsx");

    var _ = cockpit.gettext;

    /* Sample dialog body
     */
    var PatternDialogBody = React.createClass({
        selectChanged: function(value) {
            console.log("new value: " + value);
        },
        render: function() {
            return (
                <div className="modal-body">
                    <table className="form-table-ct">
                        <tr>
                            <td className="top">
                                <label className="control-label" for="control-1">
                                    Label
                                </label>
                            </td>
                            <td>
                                <input id="control-1" className="form-control" type="text"/>
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label">
                                    Select
                                </label>
                            </td>
                            <td>
                                <Select.Select onChange={this.selectChanged} id="primary-select">
                                    <Select.SelectEntry data='one'>One</Select.SelectEntry>
                                    <Select.SelectEntry data='two'>Two</Select.SelectEntry>
                                    <Select.SelectEntry data='three'>Three</Select.SelectEntry>
                                    <Select.SelectEntry data='four'></Select.SelectEntry>
                                </Select.Select>
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label">
                                    Preselected
                                </label>
                            </td>
                            <td>
                                <Select.Select initial="two">
                                    <Select.SelectEntry data="one">One</Select.SelectEntry>
                                    <Select.SelectEntry data="two">Two</Select.SelectEntry>
                                    <Select.SelectEntry data="three">Three</Select.SelectEntry>
                                </Select.Select>
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label">
                                    Empty Select
                                </label>
                            </td>
                            <td>
                                <Select.Select />
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label">
                                    Nested dialog
                                </label>
                            </td>
                            <td>
                                <button id="open-nested" onClick={ this.props.clickNested }>
                                    Try to nest dialog
                                </button>
                                <span>Doesn't open a dialog, only shows a warning in the console.</span>
                            </td>
                        </tr>
                    </table>
                </div>
            );
        }
    });

    module.exports = PatternDialogBody;
}());
