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

   Validation is strict: If a validation error occurs deep inside a
   nested structure, the whole structure is rejected.
 */

/* WRITING IMPORTER FUNCTIONS

   The process of writing a importer function for a given TypeScript
   interface is pretty mechanic, and could well be automated.

   For example, here are the functions for Player and Team interfaces:

       interface Player {
          name: string;
          age: number | undefined;
       }

       function import_Player(val: JsonValue): Player {
           const obj = import_json_object(val);
           return {
               name: get(obj, "name", import_string),
               age: get_optional(obj, "age", import_number),
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
           }
       }

   This way, TypeScript will check that the returned values are indeed
   valid for their type declaration. You can't get that wrong. What is
   not checked is that you use the right field names when accessing
   input JsonObjects. But we could write a linter function for that.

   More examples can be found in "pkg/shell/manifests.ts".
 */

class ValidationError extends Error {
    msg: string;
    path: string;
    constructor(msg?: string, parent?: ValidationError, path?: string) {
        let this_msg = "";
        let this_path = "";
        if (msg) {
            this_msg = msg;
            this_path = "";
        } else if (parent && path) {
            this_msg = parent.msg;
            this_path = path + parent.path;
        }
        super(`JSON validation error for ${this_path}: ${this_msg}`);
        this.msg = this_msg;
        this.path = this_path;
    }
}

function with_validation_path<T>(p: string, func: () => T): T {
    try {
        return func();
    } catch (e) {
        if (e instanceof ValidationError)
            throw new ValidationError(undefined, e, p);
        else
            throw e;
    }
}

function validation_error(msg: string): never {
    throw new ValidationError(msg);
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

function is_json_object(val: JsonValue): val is JsonObject {
    return !!val && typeof val == "object" && !Array.isArray(val);
}

export function import_json_object(val: JsonValue): JsonObject {
    if (is_json_object(val))
        return val;
    validation_error(`Not an object: ${JSON.stringify(val)}`);
}

function is_json_array(val: JsonValue): val is JsonValue[] {
    return Array.isArray(val);
}

export function import_json_array(val: JsonValue): JsonValue[] {
    if (is_json_array(val))
        return val;
    validation_error(`Not an array: ${JSON.stringify(val)}`);
}

export function import_record<T>(val: JsonValue, importer: (val: JsonValue) => T): Record<string, T> {
    const obj = import_json_object(val);
    return Object.fromEntries(Object.entries(obj).map(
        ([k, v]) => [k, with_validation_path(`.${k}`, () => importer(v))]));
}

export function import_array<T>(val: JsonValue, importer: (val: JsonValue) => T): Array<T> {
    const arr = import_json_array(val);
    return arr.map((elt, i) => with_validation_path(`[${i}]`, () => importer(elt)));
}

export function get<T>(obj: JsonObject, field: string, importer: (val: JsonValue) => T, fallback?: T): T {
    if (field in obj)
        return with_validation_path(`.${String(field)}`, () => importer(obj[field]));
    else if (fallback !== undefined)
        return fallback;
    else
        validation_error(`Field "${String(field)}" is missing`);
}

export function get_optional<T>(obj: JsonObject, field: string, importer: (val: JsonValue) => T): T | undefined {
    if (field in obj)
        return with_validation_path(`.${String(field)}`, () => importer(obj[field]));
    return undefined;
}

export function validate<T>(path: string, val: JsonValue | undefined, importer: (val: JsonValue) => T, fallback: T): T {
    if (val === undefined)
        return fallback;

    try {
        return with_validation_path(path, () => importer(val));
    } catch (e) {
        // When the input is invalid, we report this and return the
        // fallback. All other errors, like programming errors in the
        // importer, are passed on.
        if (e instanceof ValidationError) {
            console.error(e.message);
            return fallback;
        } else
            throw e;
    }
}
