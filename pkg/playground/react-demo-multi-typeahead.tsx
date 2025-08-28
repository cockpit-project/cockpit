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

import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { MultiTypeaheadSelect, MultiTypeaheadSelectOption } from "cockpit-components-multi-typeahead-select";

const MultiTypeaheadDemo = ({ options } : { options: MultiTypeaheadSelectOption[] }) => {
    const [notFoundIsString, setNotFoundIsString] = useState(false);
    const [selected, setSelected] = useState<(string | number)[]>([]);
    const [toggles, setToggles] = useState(0);
    const [changes, setChanges] = useState(0);

    function add(val: string | number) {
        setSelected(selected.concat([val]));
    }

    function rem(val: string | number) {
        setSelected(selected.filter(v => v != val));
    }

    return (
        <div>
            <MultiTypeaheadSelect
                id='multi-typeahead-widget'
                placeholder="Select flavors"
                isScrollable
                noOptionsFoundMessage={notFoundIsString ? "Not found" : val => cockpit.format("'$0' not found", val) }
                options={options}
                selected={selected}
                onAdd={add}
                onRemove={rem}
                onToggle={() => setToggles(val => val + 1)}
                onInputChange={() => setChanges(val => val + 1)}
            />
            <div>Selected: <span id="multi-value">{JSON.stringify(selected)}</span></div>
            <div>Toggles: <span id="multi-toggles">{toggles}</span></div>
            <div>Changes: <span id="multi-changes">{changes}</span></div>
            <Checkbox
                id="notFoundIsStringMulti"
                label="notFoundIsString"
                isChecked={notFoundIsString}
                onChange={(_event, checked) => setNotFoundIsString(checked)}
            />
        </div>
    );
};

export function showMultiTypeaheadDemo(rootElement: Container) {
    const flavors: string[] = [
        "Alumni Swirl",
        "Apple Cobbler Crunch",
        "Arboretum Breeze",
        "August Pie",
        "Autumn Delight",
        "Bavarian Raspberry Crunch",
        "Berkey Brickle",
        "Birthday Bash",
        "Bittersweet Mint",
        "Black Cow",
        "Black Raspberry",
        "Blueberry Cheesecake",
        "Butter Pecan",
        "Candy Bar/Snickers",
        "Caramel Critters",
        "Centennial Vanilla Bean",
        "Cherry Cheesecake",
        "Cherry Chip",
        "Cherry Quist",
        "Cherry Sherbet",
        "Chocolate",
        "Chocolate Cherry Cordia",
        "Chocolate Chip",
        "Chocolate Chip Cheesecake",
        "Chocolate Chip Cookie Dough",
        "Chocolate Chocolate Nut",
        "Chocolate Marble",
        "Chocolate Marshmallow",
        "Chocolate Pretzel Crunch",
        "Chunky Chocolate",
        "Chunky Chocolate- Vanilla",
        "Coconut Chip",
        "Coffee Mocha Fudge",
        "Coffee w/Cream and Sugar",
        "Crazy Charlie Sundae Swirl",
        "Death By Chocolate",
        "Egg Nog",
        "Espresso Fudge Pie",
        "German Chocolate Cake",
        "Golden Chocolate Pecan",
        "Goo Goo Cluster",
        "Grape Sherbet",
        "Happy Happy Joy Joy",
        "Heath Bar Candy",
        "Just Fudge",
        "Kenney Beany Chocolate",
        "Lion Tracks",
        "LionS'more",
        "Mallo Cup",
        "Maple Nut",
        "Mint Nittany",
        "Monster Mash",
        "Orange Vanilla Sundae",
        "Palmer Mousseum With Almonds",
        "Peachy Paterno",
        "Peanut Butter Cup",
        "Peanut Butter Fudge Cluster",
        "Peanut Butter Marshmallow",
        "Peanut Butter Swirl",
        "Pecan Apple Danish",
        "Peppermint Stick",
        "Pistachio",
        "Pralines N Cream",
        "Pumpkin Pie",
        "Raspberry Fudge Torte",
        "Raspberry Parfait",
        "Rum Raisin",
        "Russ 'Digs' Roseberry",
        "Santa Fe Banana",
        "Scholar's Chip",
        "Sea Salt Chocolate Caramel",
        "Somerset Shortcake",
        "Southern Chocolate Pie",
        "Southern Pecan Cheesecake",
        "Strawberry",
        "Strawberry Cheesecake",
        "Teaberry",
        "Tin Roof Sundae",
        "Toasted Almond",
        "Toasted Almond Fudge",
        "Turtle Creek",
        "Vanilla",
        "White House",
        "Wicked Caramel Sundae",
        "WPSU Coffee Break",
    ];

    const options: MultiTypeaheadSelectOption[] = flavors.map((f, i) => ({ value: i + 1, content: f }));

    const root = createRoot(rootElement);
    root.render(<MultiTypeaheadDemo options={options} />);
}
