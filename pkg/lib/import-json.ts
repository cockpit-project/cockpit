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

import { JsonValue, JsonObject } from "cockpit";

/* GENERIC VALIDATION MACHINERY

   This module helps with turning arbitrary user provided JSON blobs
   into well-typed objects.

   The basic idea is that for a TypeScript interface "Foo" you will
   write a importer function with this signature:

      function import_Foo(val: JsonValue): Foo;

   This function will either return a valid Foo, or throw a
   ValidationError.

   When needing to convert a JSON blob into a Foo, you can call this
   function directly. You might need to catch the potential
   ValidationError.

   Alternatively, you can also use the "validate" wrapper like so

      const foo = validate("config.foo", config.foo, import_Foo, {});

   This will include "config.foo" in the error messages to give a
   better clue where the invalid data is actually coming from, and
   will catch the ValidationError and return a fallback value.

   Validation is generally lenient: If a validation error occurs deep
   inside a nested structure, only the affected part of the structure
   is omitted.  More conretely, if an element of an array is invalid,
   this element is omitted from the array. If a optional field of an
   object is invalid, it will be omitted. This doesn't happen
   silently, of course. In all cases, errors are written to the
   browser console.

   For example, given these declarations

       interface Player {
          name: string;
          age?: number;
       }

       interface Team {
          name: string;
          players: Player[];
       }

       function import_Team(val: JsonObject): Team;

   the following inputs behave as shown:

       {
         "name": "ManCity",
         "players": [
            { "name": "Haaland", "age": 24 },
            { "name": "De Bruyne", "age", 33 }
         ],
         "stadium": "City of Manchester Stadium"
       }

    This is a fully valid Team and import_Team will return it without
    any errors or exceptions. However, the result will not contain the
    "stadium" field since Team objects don't have that.

       {
         "name": "ManCity",
         "players": [
            { "name": "Haaland", "age": "unknown" },
            { "name": "De Bruyne", "age", 33 }
         ]
       }

    The "age" field of Haaland is not a number, but it is
    optional. The import_Team function will log an error and will omit
    the "age" field from the Player object for Håland.

       {
         "name": "ManCity",
         "players": [
            { "name": [ "Erling", "Braut", "Haaland" ], "age": 24 },
            { "name": "De Bruyne", "age", 33 }
         ]
       }

    The "name" field for Håland is not a string, and it is
    mandatory. An error will be logged and the whole Håland entry is
    omitted from "players".

      {
         "name": "ManCity",
         "players": "TBD"
       }

    The "players" field is not an array, and it is mandatory. The
    import_Team function will raise a ValidationError exception.
 */

/* WRITING IMPORTER FUNCTIONS

   The process of writing a importer function for a given TypeScript
   interface is pretty mechanic, and could well be automated.

   For example, these are the functions for the Player and Team
   interfaces from above.

       interface Player {
          name: string;
          age?: number;
       }

       function import_Player(val: JsonValue): Player {
           const obj = import_json_object(val);
           const res: Player = {
               name: import_mandatory(obj, "name", import_string),
           };
           import_optional(res, obj, "age", import_number);
           return res;
       }

       interface Team {
          name: string;
          players: Player[];
       }

       function import_Team(val: JsonValue): Team {
           const obj = import_json_object(val);
           const res: Team = {
               name: import_mandatory(obj, "name", import_string),
               players: import_mandatory(obj, "players", v => import_array(v, import_Player))
           };
           return res;
       }

   More examples can be found in "pkg/shell/manifests.ts".
 */

class ValidationError extends Error { }

const validation_path: string[] = [];

function with_validation_path<T>(p: string, func: () => T): T {
    validation_path.push(p);
    try {
        return func();
    } finally {
        validation_path.pop();
    }
}

function validation_error(msg: string): never {
    console.error(`JSON validation error for ${validation_path.join("")}: ${msg}`);
    throw new ValidationError();
}

export function import_string(val: JsonValue): string {
    if (typeof val == "string")
        return val;
    validation_error(`Not a string: ${JSON.stringify(val)}`);
}

export function import_number(val: JsonValue): number {
    if (typeof val == "number")
        return val;
    validation_error(`Not a number: ${JSON.stringify(val)}`);
}

export function import_boolean(val: JsonValue): boolean {
    if (typeof val == "boolean")
        return val;
    validation_error(`Not a boolean: ${JSON.stringify(val)}`);
}

export function import_json_object(val: JsonValue): JsonObject {
    if (!!val && typeof val == "object" && val.length === undefined)
        return val as JsonObject;
    validation_error(`Not an object: ${JSON.stringify(val)}`);
}

export function import_json_array(val: JsonValue): JsonValue[] {
    if (!!val && typeof val == "object" && val.length !== undefined)
        return val as JsonValue[];
    validation_error(`Not an array: ${JSON.stringify(val)}`);
}

export function import_record<T>(val: JsonValue, importer: (val: JsonValue) => T): Record<string, T> {
    const obj = import_json_object(val);
    const res: Record<string, T> = {};
    for (const key of Object.keys(obj)) {
        try {
            with_validation_path(`.${key}`, () => { res[key] = importer(obj[key]) });
        } catch (e) {
            if (!(e instanceof ValidationError))
                throw e;
        }
    }
    return res;
}

export function import_array<T>(val: JsonValue, importer: (val: JsonValue) => T): Array<T> {
    const arr = import_json_array(val);
    const res: Array<T> = [];
    for (let i = 0; i < arr.length; i++) {
        try {
            with_validation_path(`[${i}]`, () => { res.push(importer(arr[i])) });
        } catch (e) {
            if (!(e instanceof ValidationError))
                throw e;
        }
    }
    return res;
}

export function import_optional<T, F extends keyof T>(res: T, obj: JsonObject, field: F, importer: (val: JsonValue) => T[F]): void {
    if (obj[field as string] === undefined)
        return;

    try {
        with_validation_path(`.${String(field)}`, () => { res[field] = importer(obj[field]) });
    } catch (e) {
        if (!(e instanceof ValidationError))
            throw e;
    }
}

export function import_mandatory<T>(obj: JsonObject, field: string, importer: (val: JsonValue) => T): T {
    if (obj[field as string] === undefined) {
        validation_error(`Field "${String(field)}" is missing`);
    }
    return with_validation_path(`.${String(field)}`, () => importer(obj[field]));
}

export function validate<T>(path: string, val: JsonValue | undefined, importer: (val: JsonValue) => T, fallback: T): T {
    if (val === undefined)
        return fallback;

    try {
        return with_validation_path(path, () => importer(val));
    } catch (e) {
        if (!(e instanceof ValidationError))
            throw e;
        return fallback;
    }
}
