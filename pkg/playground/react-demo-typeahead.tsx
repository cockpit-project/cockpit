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

import cockpit from "cockpit";

import React, { useState } from "react";
import { createRoot, Container } from 'react-dom/client';

import { Checkbox } from '@patternfly/react-core';
import { TypeaheadSelect, TypeaheadSelectOption } from "cockpit-components-typeahead-select";

const TypeaheadDemo = ({ options } : { options: TypeaheadSelectOption[] }) => {
    const [isCreatable, setIsCreatable] = useState(false);
    const [notFoundIsString, setNotFoundIsString] = useState(false);
    const [value, setValue] = useState<string | number | null>();
    const [toggles, setToggles] = useState(0);
    const [changes, setChanges] = useState(0);

    return (
        <div>
            <TypeaheadSelect
                id='typeahead-widget'
                placeholder="Select a state"
                isScrollable
                noOptionsFoundMessage={notFoundIsString ? "Not found" : val => cockpit.format("'$0' not found", val) }
                isCreatable={isCreatable}
                createOptionMessage={val => cockpit.format("Create $0", val)}
                onClearSelection={() => setValue(null)}
                selectOptions={options}
                selected={value}
                onSelect={(_, value) => setValue(value) }
                onToggle={() => setToggles(val => val + 1)}
                onInputChange={() => setChanges(val => val + 1)}
            />
            <div>Selected: <span id="value">{value || "-"}</span></div>
            <div>Toggles: <span id="toggles">{toggles}</span></div>
            <div>Changes: <span id="changes">{changes}</span></div>
            <Checkbox
                id="isCreatable"
                label="isCreatable"
                isChecked={isCreatable}
                onChange={(_event, checked) => setIsCreatable(checked)}
            />
            <Checkbox
                id="notFoundIsString"
                label="notFoundIsString"
                isChecked={notFoundIsString}
                onChange={(_event, checked) => setNotFoundIsString(checked)}
            />
        </div>
    );
};

export function showTypeaheadDemo(rootElement: Container) {
    const states: Record<string, string> = {
        AL: "Alabama",
        AK: "Alaska",
        AZ: "Arizona",
        AR: "Arkansas",
        CA: "California",
        CO: "Colorado",
        CT: "Connecticut",
        DE: "Delaware",
        FL: "Florida",
        GA: "Georgia",
        HI: "Hawaii",
        ID: "Idaho",
        IL: "Illinois",
        IN: "Indiana",
        IA: "Iowa",
        KS: "Kansas",
        KY: "Kentucky",
        LA: "Louisiana",
        ME: "Maine",
        MD: "Maryland",
        MA: "Massachusetts",
        MI: "Michigan",
        MN: "Minnesota",
        MS: "Mississippi",
        MO: "Missouri",
        MT: "Montana",
        NE: "Nebraska",
        NV: "Nevada",
        NH: "New Hampshire",
        NJ: "New Jersey",
        NM: "New Mexico",
        NY: "New York",
        NC: "North Carolina",
        ND: "North Dakota",
        OH: "Ohio",
        OK: "Oklahoma",
        OR: "Oregon",
        PA: "Pennsylvania",
        RI: "Rhode Island",
        SC: "South Carolina",
        SD: "South Dakota",
        TN: "Tennessee",
        TX: "Texas",
        UT: "Utah",
        VT: "Vermont",
        VA: "Virginia",
        WA: "Washington",
        WV: "West Virginia",
        WI: "Wisconsin",
        WY: "Wyoming",
    };

    const options: TypeaheadSelectOption[] = [];
    let last = "";

    options.push({ value: "start", content: "The Start" });

    for (const st of Object.keys(states).sort()) {
        if (st[0] != last) {
            options.push({ decorator: "divider", key: "_divider-" + st });
            options.push({
                decorator: "header",
                key: "_header-" + st,
                content: "Starting with " + st[0]
            });
            last = st[0];
        }
        options.push({ value: st, content: states[st] });
    }

    options.push({ decorator: "divider", key: "_divider-end" });
    options.push({ value: "end", content: "The End" });

    const root = createRoot(rootElement);
    root.render(<TypeaheadDemo options={options} />);
}
