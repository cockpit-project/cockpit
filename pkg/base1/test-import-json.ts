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

import { JsonValue } from 'cockpit';
import {
    import_json_object, get, get_optional,
    import_string, import_number, import_boolean,
    import_array, import_record,
    validate
} from 'import-json';

import QUnit from 'qunit-tests';

// Hook into console.error

let console_errors: string[] = [];
const console_error = console.error;
console.error = function (msg) {
    console_errors.push(msg);
    console_error(msg);
};

QUnit.hooks.beforeEach(() => {
    console_errors = [];
});

QUnit.test("import_string", function(assert) {
    assert.equal(import_string("foo"), "foo", "string");
    assert.equal(import_string(""), "", "empty string");
    assert.throws(() => import_string(12), /JSON validation error for : Not a string: 12/, "not a string");
});

QUnit.test("import_number", function(assert) {
    assert.equal(import_number(12), 12, "number");
    assert.throws(
        () => import_number("foo"),
        /JSON validation error for : Not a number: "foo"/,
        "not a number");
});

QUnit.test("import_boolean", function(assert) {
    assert.equal(import_boolean(true), true, "boolean");
    assert.throws(
        () => import_boolean("foo"),
        /JSON validation error for : Not a boolean: "foo"/,
        "not a boolean");
});

QUnit.test("import_array", function(assert) {
    assert.deepEqual(import_array(["a", "b", "c"], import_string), ["a", "b", "c"], "array of strings");
    assert.deepEqual(import_array([1, 2, 3], import_number), [1, 2, 3], "array of numbers");
    assert.deepEqual(import_array([], import_number), [], "empty array");
    assert.throws(
        () => import_array([1, 2, "c"], import_number),
        /JSON validation error for \[2\]: Not a number: "c"/,
        "array of numbers with a string");
    assert.throws(
        () => import_array("foo", import_string),
        /JSON validation error for : Not an array: "foo"/,
        "not an array");
});

QUnit.test("import_record", function(assert) {
    assert.deepEqual(
        import_record({ a: "a", b: "b", c: "c" }, import_string),
        { a: "a", b: "b", c: "c" },
        "record of strings");
    assert.deepEqual(
        import_record({ a: 1, b: 2, c: 3 }, import_number),
        { a: 1, b: 2, c: 3 },
        "record of numbers");
    assert.throws(
        () => import_record({ a: 1, b: 2, c: "c" }, import_number),
        /JSON validation error for \.c: Not a number: "c"/,
        "record of numbers with a string");
    assert.throws(
        () => import_record("foo", import_string),
        /JSON validation error for : Not an object: "foo"/,
        "not a record");
});

QUnit.test("validate", function(assert) {
    assert.equal(validate("test input", "foo", import_string, "default"), "foo", "string");
    assert.equal(validate("test input", 12, import_string, "default"), "default", "not a string");
    assert.deepEqual(
        console_errors,
        [
            'JSON validation error for test input: Not a string: 12'
        ],
        "console errors"
    );
});

interface Player {
    name: string;
    age: number | undefined;
    position: string;
}

function import_Player(val: JsonValue): Player {
    const obj = import_json_object(val);
    return {
        name: get(obj, "name", import_string),
        age: get_optional(obj, "age", import_number),
        position: get(obj, "position", import_string, "unknown"),
    };
}

interface Team {
    name: string;
    players: Player[];
}

function import_Team(val: JsonValue): Team {
    const obj = import_json_object(val);
    return {
        name: get(obj, "name", import_string),
        players: get(obj, "players", v => import_array(v, import_Player)),
    };
}

interface Teams {
    [name: string]: Team;
}

function import_Teams(val: JsonValue): Teams {
    return import_record(val, import_Team);
}

QUnit.test("objects", function(assert) {
    const valid_checks: [JsonValue, Teams][] = [
        // "stadium" should be omitted
        [
            {
                MAC: {
                    name: "ManCity",
                    players: [
                        { name: "Haaland", age: 24, position: "striker" },
                        { name: "De Bruyne", age: 33, position: "midfield" }
                    ],
                    stadium: "City of Manchester Stadium"
                },
            },
            {
                MAC: {
                    name: "ManCity",
                    players: [
                        { name: "Haaland", age: 24, position: "striker" },
                        { name: "De Bruyne", age: 33, position: "midfield" }
                    ],
                },
            }

        ],

        // optional fields
        [
            {
                MAC: {
                    name: "ManCity",
                    players: [
                        { name: "Haaland", },
                        { name: "De Bruyne", age: 33 }
                    ],
                },
            },
            {
                MAC: {
                    name: "ManCity",
                    players: [
                        { name: "Haaland", age: undefined, position: "unknown" },
                        { name: "De Bruyne", age: 33, position: "unknown" }
                    ],
                },
            }

        ],
    ];

    const invalid_checks: [JsonValue, string][] = [
        // invalid optional field
        [
            {
                MAC: {
                    name: "ManCity",
                    players: [
                        { name: "Haaland", age: "unknown" },
                        { name: "De Bruyne", age: 33 }
                    ],
                },
            },
            'JSON validation error for test input.MAC.players[0].age: Not a number: "unknown"',
        ],

        // invalid mandatory field
        [
            {
                MAC: {
                    name: "ManCity",
                    players: [
                        { name: ["Erling", "Braut", "Haaland"] },
                        { name: "De Bruyne", age: 33 }
                    ],
                },
            },
            'JSON validation error for test input.MAC.players[0].name: Not a string: ["Erling","Braut","Haaland"]',
        ],

        // invalid mandatory array
        [
            {
                MAC: {
                    name: "ManCity",
                    players: "TBD",
                },
            },
            'JSON validation error for test input.MAC.players: Not an array: "TBD"',
        ],

        // invalid object
        [
            "...",
            'JSON validation error for test input: Not an object: "..."'
        ]
    ];

    for (let i = 0; i < valid_checks.length; i++) {
        assert.deepEqual(validate("test input", valid_checks[i][0], import_Teams, {}), valid_checks[i][1]);
    }

    for (let i = 0; i < invalid_checks.length; i++) {
        console_errors = [];
        assert.deepEqual(validate("test input", invalid_checks[i][0], import_Teams, {}), {});
        assert.deepEqual(console_errors, [invalid_checks[i][1]]);
    }
});

QUnit.start();
