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

import React from "react";
import * as Select from "cockpit-components-select.jsx";

import "form-layout.scss";

/* Sample dialog body
 */
export class PatternDialogBody extends React.Component {
    selectChanged(value) {
        console.log("new value: " + value);
    }

    render() {
        return (
            <div className="modal-body">
                <form className="ct-form">
                    <label className="control-label" htmlFor="control-1">Label</label>
                    <input id="control-1" className="form-control" type="text" />

                    <label className="control-label" htmlFor="primary-select">Select</label>
                    <Select.Select onChange={this.selectChanged} id="primary-select">
                        <Select.SelectEntry data='one'>One</Select.SelectEntry>
                        <Select.SelectEntry data='two'>Two</Select.SelectEntry>
                        <Select.SelectEntry data='three'>Three</Select.SelectEntry>
                        <Select.SelectDivider />
                        <Select.SelectEntry data='four' />
                    </Select.Select>

                    <label className="control-label" htmlFor="preselected">Preselected</label>
                    <Select.Select initial="two" id="preselected">
                        <Select.SelectEntry data="one">One</Select.SelectEntry>
                        <Select.SelectEntry data="two">Two</Select.SelectEntry>
                        <Select.SelectEntry data="three">Three</Select.SelectEntry>
                    </Select.Select>

                    <label className="control-label" htmlFor="empty-select">Empty Select</label>
                    <Select.Select id="empty-select" />

                    <label className="control-label" htmlFor="nested">Nested dialog</label>
                    <div role="group" id="nested">
                        <button id="open-nested" onClick={ this.props.clickNested }>
                            Try to nest dialog
                        </button>
                        <span>Doesn't open a dialog, only shows a warning in the console.</span>
                    </div>
                </form>
            </div>
        );
    }
}
