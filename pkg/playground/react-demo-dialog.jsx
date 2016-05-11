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
    "base1/cockpit-components-select",
], function(React, cockpit, Select) {

    "use strict";
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
                                    {_("Label")}
                                </label>
                            </td>
                            <td>
                                <input id="control-1" className="form-control" type="text"/>
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label">
                                    {_("Select")}
                                </label>
                            </td>
                            <td>
                                <Select.Select onChange={this.selectChanged} id="primary-select">
                                    <Select.SelectEntry data='one'>{_("One")}</Select.SelectEntry>
                                    <Select.SelectEntry data='two'>{_("Two")}</Select.SelectEntry>
                                    <Select.SelectEntry>{_("Three")}</Select.SelectEntry>
                                    <Select.SelectEntry data='four'></Select.SelectEntry>
                                    <Select.SelectEntry></Select.SelectEntry>
                                </Select.Select>
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label">
                                    {_("Preselected")}
                                </label>
                            </td>
                            <td>
                                <Select.Select initial={_("Two")}>
                                    <Select.SelectEntry>{_("One")}</Select.SelectEntry>
                                    <Select.SelectEntry>{_("Two")}</Select.SelectEntry>
                                    <Select.SelectEntry>{_("Three")}</Select.SelectEntry>
                                </Select.Select>
                            </td>
                        </tr>
                        <tr>
                            <td className="top">
                                <label className="control-label">
                                    {_("Empty Select")}
                                </label>
                            </td>
                            <td>
                                <Select.Select />
                            </td>
                        </tr>
                    </table>
                </div>
            );
        }
    });

    return PatternDialogBody;
});
