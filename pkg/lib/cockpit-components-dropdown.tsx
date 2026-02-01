/*
 * Copyright (C) 2024 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
