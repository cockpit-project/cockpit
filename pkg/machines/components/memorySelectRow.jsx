/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import cockpit from 'cockpit';

import * as Select from "cockpit-components-select.jsx";

import { digitFilter, toFixedPrecision, units } from "../helpers.es6";

const _ = cockpit.gettext;

const MemorySelectRow = ({ label, id, value, initialUnit, onValueChange, onUnitChange }) => {
    return (
        <tr>
            <td className="top">
                <label className="control-label" htmlFor={id}>
                    {label}
                </label>
            </td>
            <td>
                <div className="thirty-five-spaced-table">
                    <span className="evenly-spaced-cell">
                        <div className="evenly-spaced-table">
                            <span className="evenly-spaced-cell">
                                <input id={id} className="form-control"
                                       type="number"
                                       value={toFixedPrecision(value)}
                                       onKeyPress={digitFilter}
                                       step={1}
                                       min={0}
                                       onChange={onValueChange} />
                            </span>
                            <span className="thirty-five-spaced-cell padding-left">
                                <Select.Select id={id + "-unit-select"}
                                               initial={initialUnit}
                                               onChange={onUnitChange}>
                                    <Select.SelectEntry data={units.MiB.name} key={units.MiB.name}>
                                        {_("MiB")}
                                    </Select.SelectEntry>
                                    <Select.SelectEntry data={units.GiB.name} key={units.GiB.name}>
                                        {_("GiB")}
                                    </Select.SelectEntry>
                                </Select.Select>
                            </span>
                        </div>
                    </span>
                </div>
            </td>
        </tr>
    );
};

export default MemorySelectRow;
