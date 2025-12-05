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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useState } from 'react';
import PropTypes from "prop-types";

import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle";
import { Dropdown, DropdownList, DropdownPopperProps } from "@patternfly/react-core/dist/esm/components/Dropdown";

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
export const KebabDropdown = ({ dropdownItems, position = "end", isDisabled = false, toggleButtonId, isOpen, setIsOpen } : {
    dropdownItems: React.ReactNode,
    position?: DropdownPopperProps['position'],
    isDisabled?: boolean,
    toggleButtonId?: string;
    isOpen?: boolean, setIsOpen?: React.Dispatch<React.SetStateAction<boolean>>,
}) => {
    const [isKebabOpenInternal, setKebabOpenInternal] = useState(false);
    const isKebabOpen = isOpen ?? isKebabOpenInternal;
    const setKebabOpen = setIsOpen ?? setKebabOpenInternal;

    /**
     * Try to find parent Page section to append dropdown to. If we can't find it, use the default `document.body`.
     * This is a temporary workaround to fix scrolling within iframes whenever the dropdown itself expands past the
     * page content.
     *
     * To reproduce behavior:
     *   1. Open a page with a dropdown button near the bottom of the page, like Users.
     *   2. Resize window to make the page content height constrained.
     *   3. Open dropdown actions for bottom user and scroll up and down.
     *   4. Dropdown should move to be above and below the button, you should be able to scroll to see all actions.
     *
     * Remove once Patternfly makes it possible to use PopperJS offset function prop.
     * @link https://github.com/patternfly/patternfly-react/issues/11987
     * */
    const appendTo: HTMLElement = document.querySelector(".pf-v6-c-page__main-section") || document.body;

    return (
        <Dropdown
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
            popperProps={{ position, appendTo }}
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
