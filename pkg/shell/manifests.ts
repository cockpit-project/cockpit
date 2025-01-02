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

import { JsonValue } from "cockpit";

import {
    import_json_object,
    import_string, import_number, import_boolean, import_record, import_array,
    import_optional, import_mandatory
} from "import-json";

export interface ManifestKeyword {
    matches: string[];
    goto?: string;
    weight?: number;
    translate?: boolean;
}

function import_ManifestKeyword(val: JsonValue): ManifestKeyword {
    const obj = import_json_object(val);
    const res: ManifestKeyword = {
        matches: import_mandatory(obj, "matches", v => import_array(v, import_string)),
    };
    import_optional(res, obj, "goto", import_string);
    import_optional(res, obj, "weight", import_number);
    import_optional(res, obj, "translate", import_boolean);
    return res;
}

export interface ManifestDocs {
    label: string;
    url: string;
}

function import_ManifestDocs(val: JsonValue): ManifestDocs {
    const obj = import_json_object(val);
    const res: ManifestDocs = {
        label: import_mandatory(obj, "label", import_string),
        url: import_mandatory(obj, "url", import_string),
    };
    return res;
}

export interface ManifestEntry {
    path?: string;
    label?: string;
    order?: number;
    docs?: ManifestDocs[];
    keywords?: ManifestKeyword[];
}

function import_ManifestEntry(val: JsonValue): ManifestEntry {
    const obj = import_json_object(val);
    const res: ManifestEntry = { };
    import_optional(res, obj, "path", import_string);
    import_optional(res, obj, "label", import_string);
    import_optional(res, obj, "order", import_number);
    import_optional(res, obj, "docs", v => import_array(v, import_ManifestDocs));
    import_optional(res, obj, "keywords", v => import_array(v, import_ManifestKeyword));
    return res;
}

export interface ManifestSection {
    [name: string]: ManifestEntry;
}

function import_ManifestSection(val: JsonValue): ManifestSection {
    return import_record(val, import_ManifestEntry);
}

export interface ManifestParentSection {
    component?: string;
    docs?: ManifestDocs[];
}

function import_ManifestParentSection(val: JsonValue): ManifestParentSection {
    const obj = import_json_object(val);
    const res: ManifestParentSection = { };
    import_optional(res, obj, "component", import_string);
    import_optional(res, obj, "docs", v => import_array(v, import_ManifestDocs));
    return res;
}

export interface Manifest {
    dashboard?: ManifestSection;
    menu?: ManifestSection;
    tools?: ManifestSection;

    preload?: string[];
    parent?: ManifestParentSection;
    ".checksum"?: string;
}

function import_Manifest(val: JsonValue): Manifest {
    const obj = import_json_object(val);
    const res: Manifest = { };
    import_optional(res, obj, "dashboard", import_ManifestSection);
    import_optional(res, obj, "menu", import_ManifestSection);
    import_optional(res, obj, "tools", import_ManifestSection);
    import_optional(res, obj, "preload", v => import_array(v, import_string));
    import_optional(res, obj, "parent", import_ManifestParentSection);
    import_optional(res, obj, ".checksum", import_string);
    return res;
}

export interface Manifests {
    [pkg: string]: Manifest;
}

export function import_Manifests(val: JsonValue): Manifests {
    return import_record(val, import_Manifest);
}

export interface ShellManifest {
    docs?: ManifestDocs[];
    locales?: { [id: string]: string };
}

export function import_ShellManifest(val: JsonValue): ShellManifest {
    const obj = import_json_object(val);
    const res: ShellManifest = { };
    import_optional(res, obj, "docs", v => import_array(v, import_ManifestDocs));
    import_optional(res, obj, "locales", v => import_record(v, import_string));
    return res;
}
