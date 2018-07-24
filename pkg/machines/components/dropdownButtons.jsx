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
import React, { PropTypes } from "react";
import { mouseClick } from '../helpers.es6';
import './dropdownButtons.css';

/**
 * Render group of buttons as a dropdown
 *
 * @param buttons array of objects [ {title, action, id, disabled}, ... ].
 *        At least one button is required. Button id is optional.
 * @returns {*}
 * @constructor
 */
const DropdownButtons = ({ buttons }) => {
    let firstButton;
    let firstButtonElem;

    if (buttons.length > 0) {
        firstButton = buttons[0];
        firstButtonElem = (
            <button className='btn btn-default btn-danger'
                    id={firstButton.id}
                    onClick={mouseClick(firstButton.action)}
                    disabled={firstButton.disabled}>
                {firstButton.title}
            </button>
        );
    }
    if (buttons.length > 1) { // do not display caret for single option
        const buttonsHtml = buttons
                .filter(button => firstButton.id === undefined || firstButton.id !== button.id)
                .map(button => {
                    return (<li className='presentation'>
                        <a role='menuitem' tabIndex="0" onClick={mouseClick(button.action)} id={button.id} className={button.disabled ? 'disabled' : null}>
                            {button.title}
                        </a>
                    </li>);
                });

        const caretId = firstButton.id ? `${firstButton.id}-caret` : undefined;
        return (<div className='btn-group dropdown-buttons-container'>
            {firstButtonElem}
            <button data-toggle='dropdown' className='btn btn-default dropdown-toggle'>
                <span className='caret' id={caretId} />
            </button>
            <ul role='menu' className='dropdown-menu'>
                {buttonsHtml}
            </ul>
        </div>);
    }

    return (<div className='btn-group'>
        {firstButtonElem}
    </div>);
};
DropdownButtons.propTypes = {
    buttons: PropTypes.array.isRequired
};

export default DropdownButtons;
