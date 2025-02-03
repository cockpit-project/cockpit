/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
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

import React, { useState } from "react";
import { createRoot, Container } from 'react-dom/client';

import { KebabDropdown } from "cockpit-components-dropdown";
import { DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { DrilldownMenu } from "@patternfly/react-core/dist/esm/components/Menu";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider";

const KebabDrilldownDemo = () => {
    const [last, setLast] = useState("");

    function DDI(label: string) {
        return <DropdownItem onClick={() => setLast(label)}>{label}</DropdownItem>;
    }

    return (
        <div>
            <KebabDropdown
                id="kebab-drilldown-root"
                position="left"
                containsDrilldown
                dropdownItems={
                    <>
                        {DDI("Settings")}
                        <DropdownItem
                            direction="down"
                            itemId="drilldown:moretools"
                            drilldownMenu={
                                <DrilldownMenu id="kebab-drilldown-moretools">
                                    <DropdownItem itemId="drilldown:moretools_back" direction="up">More tools</DropdownItem>
                                    <Divider />
                                    {DDI("Show source")}
                                    {DDI("File bug")}
                                </DrilldownMenu>
                            }>More tools</DropdownItem>
                        <Divider />
                        {DDI("Quit")}
                    </>} />
            <div>Last action: {last}</div>
        </div>
    );
};

export function showKebabDrilldownDemo(rootElement: Container) {
    const root = createRoot(rootElement);
    root.render(<KebabDrilldownDemo />);
}
