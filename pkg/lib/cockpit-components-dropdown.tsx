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
 *
 * This component also supports DrilldownMenus. You have to follow these rules:
 *
 * - "containsDrilldown" must be true
 * - "id" must be given, and all DrilldownMenus also must have "id"s.
 * - The MenuItems that navigate between the drilldows (i.e. the ones
 *   with a "direction" attribute) must have a itemId that starts with
 *   "drilldown:", and no other MenuItem must have a itemId that
 *   starts with "drilldown:".
 */
export const KebabDropdown = ({ dropdownItems, position = "end", popperProps, isDisabled = false, toggleButtonId, id, isOpen, setIsOpen, containsDrilldown = false } : {
    dropdownItems: React.ReactNode,
    position?: DropdownPopperProps['position'],
    popperProps?: DropdownPopperProps,
    isDisabled?: boolean,
    toggleButtonId?: string,
    id?: string,
    isOpen?: boolean, setIsOpen?: React.Dispatch<React.SetStateAction<boolean>>,
    containsDrilldown?: boolean,
}) => {
    const [isKebabOpenInternal, setKebabOpenInternal] = useState(false);
    const isKebabOpen = isOpen ?? isKebabOpenInternal;
    const setKebabOpen = setIsOpen ?? setKebabOpenInternal;

    const [drilledInMenus, setDrilledInMenus] = React.useState<string[]>([]);
    const [drilldownItemPath, setDrilldownItemPath] = React.useState<string[]>([]);
    const [menuHeights, setMenuHeights] = React.useState<{[id: string]: number}>({});
    const [activeMenu, setActiveMenu] = React.useState<string>(id || "");

    function onDrillIn(_event: React.KeyboardEvent | React.MouseEvent, fromId: string, toId: string, pathId: string) {
        setDrilledInMenus([...drilledInMenus, fromId]);
        setDrilldownItemPath([...drilldownItemPath, pathId]);
        setActiveMenu(toId);
    }

    function onDrillOut(_event: React.KeyboardEvent | React.MouseEvent, toId: string) {
        const drilledInMenusSansLast = drilledInMenus.slice(0, drilledInMenus.length - 1);
        const pathSansLast = drilldownItemPath.slice(0, drilldownItemPath.length - 1);
        setDrilledInMenus(drilledInMenusSansLast);
        setDrilldownItemPath(pathSansLast);
        setActiveMenu(toId);
    }

    function resetDrilldown() {
        setDrilledInMenus([]);
        setDrilldownItemPath([]);
        setActiveMenu(id || "");
    }

    function onGetMenuHeight(menuId: string, height: number) {
        if (menuHeights[menuId] === undefined || (menuId !== id && menuHeights[menuId] !== height)) {
            setMenuHeights({ ...menuHeights, [menuId]: height });
        }
    }

    function onSelect(_event: React.MouseEvent<Element, MouseEvent> | undefined, itemId: string | number | undefined) {
        if (!itemId || typeof itemId == "number" || !itemId.startsWith("drilldown:")) {
            setKebabOpen(false);
            resetDrilldown();
        }
    }

    return (
        <Dropdown
            {...id && { id }}
            onOpenChange={isOpen => setKebabOpen(isOpen)}
            onSelect={onSelect}
            toggle={(toggleRef) => (
                <MenuToggle
                    id={toggleButtonId}
                    isDisabled={isDisabled}
                    ref={toggleRef}
                    variant="plain"
                    onClick={() => {
                        setKebabOpen(!isKebabOpen);
                        resetDrilldown();
                    }}
                    isExpanded={isKebabOpen}
                >
                    <EllipsisVIcon />
                </MenuToggle>
            )}
            isOpen={isKebabOpen}
            popperProps={{ position, ...popperProps }}
            {... (containsDrilldown
                ? {
                    containsDrilldown: true,
                    drilldownItemPath,
                    drilledInMenus,
                    onDrillIn,
                    onDrillOut,
                    activeMenu,
                    onGetMenuHeight,
                    menuHeight: `${menuHeights[activeMenu]}px`,
                    // Setting menuHeight forces isScrollable to be true, but we don't
                    // want that so we compensate by setting maxMenuHeight to "infinitiy".
                    maxMenuHeight: "10000px",
                }
                : { })
            }
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
    popperProps: PropTypes.object,
    isOpen: PropTypes.bool,
    setIsOpen: PropTypes.func,
    containsDrilldown: PropTypes.bool,
};
