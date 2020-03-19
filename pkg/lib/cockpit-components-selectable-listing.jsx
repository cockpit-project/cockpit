/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import PropTypes from 'prop-types';
import React from 'react';
import './listing.scss';
import '../../node_modules/@patternfly/patternfly/components/Check/check.scss';

/* Implements PF4-compatible listing with clickable rows
 * Intended for use in modal dialogs
 *
 * - rows {object}: with properties: name
 * - onRowToggle {function}: toggle handler which takes row name as an argument
 * - idPrefix {string}
 */
export const SelectableListing = ({ rows, onRowToggle, idPrefix }) => {
    return (
        <fieldset className="list-group dialog-list-ct pf-c-select" id={idPrefix + "-selectable-listing"}>
            {rows.map(row => {
                return (
                    <label className="pf-c-check pf-c-select__menu-item" htmlFor={idPrefix + "-" + row.id} key={row.id}>
                        <input className="pf-c-check__input"
                            name="select-checkbox-expanded-active"
                            onChange={() => onRowToggle(row.id)}
                            type="checkbox"
This conversation was marked as resolved by skobyda
                            id={idPrefix + "-" + row.id}
                            checked={row.selected} />
                        <span className="pf-c-check__label">{row.name}</span>
                    </label>);
            })}
        </fieldset>
    );
};

SelectableListing.propTypes = {
    rows: PropTypes.array,
    idPrefix: PropTypes.string,
    onRowToggle: PropTypes.func,
};
