/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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
import PropTypes from "prop-types";

import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle";
import { Dropdown, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown";

import { EllipsisVIcon } from '@patternfly/react-icons';

/*
 * A dropdown with a Kebab button, commonly used in Cockpit pages provided as
 * component so not all pages have to re-invent the wheel.
 *
 * isOpen/setIsOpen are optional -- you need to handle the state externally if you render the KebabDropdown in an
 * "unstable" environment such as a dynamic list. When not given, the dropdown will manage its own state.
 *
 * This component expects a list of (non-deprecated!) DropdownItem's, if you
 * require a separator between DropdownItem's use PatternFly's Divivder
 * component.
 */
export const KebabDropdown = ({ dropdownItems, position, isDisabled, toggleButtonId, isOpen, setIsOpen, props }) => {
    const [isKebabOpenInternal, setKebabOpenInternal] = useState(false);
    const isKebabOpen = isOpen ?? isKebabOpenInternal;
    const setKebabOpen = setIsOpen ?? setKebabOpenInternal;

    return (
        <Dropdown
            {...props}
            onOpenChange={isOpen => setKebabOpen(isOpen)}
            onSelect={() => setKebabOpen(false)}
            toggle={(toggleRef) => (
                <MenuToggle
                    id={toggleButtonId}
                    isDisabled={isDisabled}
                    ref={toggleRef}
                    variant="plain"
                    onClick={() => setKebabOpen(!isKebabOpen)}
                    isExpanded={isKebabOpen}
                >
                    <EllipsisVIcon />
                </MenuToggle>
            )}
            isOpen={isKebabOpen}
            popperProps={{ position }}
        >
            <DropdownList>
                {dropdownItems}
            </DropdownList>
        </Dropdown>
    );
};

KebabDropdown.propTypes = {
    dropdownItems: PropTypes.array.isRequired,
    isDisabled: PropTypes.bool,
    toggleButtonId: PropTypes.string,
    position: PropTypes.oneOf(['right', 'left', 'center', 'start', 'end']),
    isOpen: PropTypes.bool,
    setIsOpen: PropTypes.func,
};

KebabDropdown.defaultProps = {
    isDisabled: false,
    position: "end",
};
