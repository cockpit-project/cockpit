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

import { digitFilter, toFixedPrecision, units } from "../helpers.js";

const _ = cockpit.gettext;

const MemorySelectRow = ({ id, value, maxValue, initialUnit, onValueChange, onUnitChange }) => {
    return (
        <div role="group">
            <input id={id} className="form-control"
                   type="number"
                   value={toFixedPrecision(value)}
                   onKeyPress={digitFilter}
                   step={1}
                   min={0}
                   max={maxValue}
                   onChange={onValueChange} />
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
        </div>
    );
};

export default MemorySelectRow;
