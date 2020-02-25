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
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Dropdown, DropdownToggle, DropdownToggleAction, DropdownItem } from '@patternfly/react-core';

import { mouseClick } from '../helpers.js';
import './dropdownButtons.css';

/**
 * Render group of buttons as a dropdown
 *
 * @param buttons array of objects [ {title, action, id}, ... ].
 *        At least one button is required. Button id is optional.
 * @returns {*}
 * @constructor
 */
export function DropdownButtons({ buttons }) {
    const [isActionOpen, setIsActionOpen] = useState(false);
    const dropdownItems = buttons.map(button => {
        return (
            <DropdownItem key={button.id} id={button.id} onClick={mouseClick(button.action)}>
                {button.title}
            </DropdownItem>
        );
    });
    const dropdownId = buttons[0].id ? `${buttons[0].id}-caret` : undefined;
    return (
        <Dropdown key={dropdownId}
            onSelect={() => setIsActionOpen(!isActionOpen)}
            toggle={
                <DropdownToggle
                    id={dropdownId}
                    splitButtonItems={[
                        <DropdownToggleAction key={buttons[0].id} id={buttons[0].id} onClick={buttons[0].action}>
                            {buttons[0].title}
                        </DropdownToggleAction>
                    ]}
                    splitButtonVariant="action"
                    onToggle={isOpen => setIsActionOpen(isOpen)}
                />
            }
            isOpen={isActionOpen}
            dropdownItems={dropdownItems}
        />
    );
}
DropdownButtons.propTypes = {
    buttons: PropTypes.array.isRequired
};
