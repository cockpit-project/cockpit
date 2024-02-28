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
 * This component expects a list of (non-deprecated!) DropdownItem's, if you
 * require a separator between DropdownItem's use PatternFly's Divivder
 * component.
 */
export const KebabDropdown = ({ dropdownItems, position, isDisabled, props }) => {
    const [isKebabOpen, setKebabOpen] = useState(false);

    return (
        <Dropdown
            {...props}
            onOpenChange={isOpen => setKebabOpen(isOpen)}
            onSelect={() => setKebabOpen(!isKebabOpen)}
            toggle={(toggleRef) => (
                <MenuToggle
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
    position: PropTypes.oneOf(['right', 'left', 'center', 'start', 'end']),
};

KebabDropdown.defaultProps = {
    isDisabled: false,
    position: "end",
};
