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
    "react",
    "base1/cockpit",
], function(React, cockpit) {

"use strict";
var _ = cockpit.gettext;

/* Sample dialog body
 */
var PatternDialogBody = React.createClass({
    render: function() {
        return (
            <div className="modal-body">
                <table className="cockpit-form-table">
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
                            <div className="btn-group bootstrap-select dropdown form-control" id="control-2">
                                <button className="btn btn-default dropdown-toggle" type="button"
                                    data-toggle="dropdown">
                                    <span className="pull-left">{_("One")}</span>
                                    <span className="caret"></span>
                                </button>
                                <ul className="dropdown-menu">
                                    <li value="one"><a>{_("One")}</a></li>
                                    <li value="two"><a>{_("Two")}</a></li>
                                </ul>
                            </div>
                        </td>
                    </tr>
                </table>
            </div>
        );
    }
});

return PatternDialogBody;
});
