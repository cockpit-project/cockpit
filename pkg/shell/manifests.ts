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
    import_optional, import_mandatory,
    validate,
} from "import-json";

export interface ManifestKeyword {
    matches: string[];
    goto: string | undefined;
    weight: number | undefined;
    translate: boolean | undefined;
}

function import_ManifestKeyword(val: JsonValue): ManifestKeyword {
    const obj = import_json_object(val);
    return {
        matches: import_mandatory(obj, "matches", v => import_array(v, import_string)),
        goto: import_optional(obj, "goto", import_string),
        weight: import_optional(obj, "weight", import_number),
        translate: import_optional(obj, "translate", import_boolean),
    };
}

export interface ManifestDocs {
    label: string;
    url: string;
}

function import_ManifestDocs(val: JsonValue): ManifestDocs {
    const obj = import_json_object(val);
    return {
        label: import_mandatory(obj, "label", import_string),
        url: import_mandatory(obj, "url", import_string),
    };
}

export interface ManifestEntry {
    path: string | undefined;
    label: string | undefined;
    order: number | undefined;
    docs: ManifestDocs[] | undefined;
    keywords: ManifestKeyword[] | undefined;
}

function import_ManifestEntry(val: JsonValue): ManifestEntry {
    const obj = import_json_object(val);
    return {
        path: import_optional(obj, "path", import_string),
        label: import_optional(obj, "label", import_string),
        order: import_optional(obj, "order", import_number),
        docs: import_optional(obj, "docs", v => import_array(v, import_ManifestDocs)),
        keywords: import_optional(obj, "keywords", v => import_array(v, import_ManifestKeyword)),
    };
}

export interface ManifestSection {
    [name: string]: ManifestEntry;
}

function import_ManifestSection(val: JsonValue): ManifestSection {
    return import_record(val, import_ManifestEntry);
}

export interface ManifestParentSection {
    component: string | undefined;
    docs: ManifestDocs[] | undefined;
}

function import_ManifestParentSection(val: JsonValue): ManifestParentSection {
    const obj = import_json_object(val);
    return {
        component: import_optional(obj, "component", import_string),
        docs: import_optional(obj, "docs", v => import_array(v, import_ManifestDocs))
    };
}

export interface Manifest {
    dashboard: ManifestSection | undefined;
    menu: ManifestSection | undefined;
    tools: ManifestSection | undefined;

    preload: string[] | undefined;
    parent: ManifestParentSection | undefined;
    ".checksum": string | undefined;
}

function import_Manifest(val: JsonValue): Manifest {
    const obj = import_json_object(val);
    return {
        dashboard: import_optional(obj, "dashboard", import_ManifestSection),
        menu: import_optional(obj, "menu", import_ManifestSection),
        tools: import_optional(obj, "tools", import_ManifestSection),
        preload: import_optional(obj, "preload", v => import_array(v, import_string)),
        parent: import_optional(obj, "parent", import_ManifestParentSection),
        ".checksum": import_optional(obj, ".checksum", import_string),
    };
}

export interface Manifests {
    [pkg: string]: Manifest;
}

export function import_Manifests(val: JsonValue): Manifests {
    const obj = import_json_object(val);
    const res: Manifests = { };
    for (const pkg in obj) {
        const m = validate("." + pkg, obj[pkg], import_Manifest, null);
        if (m)
            res[pkg] = m;
    }
    return res;
}

export interface ShellManifest {
    docs: ManifestDocs[] | undefined;
    locales: { [id: string]: string } | undefined;
}

export function import_ShellManifest(val: JsonValue): ShellManifest {
    const obj = import_json_object(val);
    return {
        docs: import_optional(obj, "docs", v => import_array(v, import_ManifestDocs)),
        locales: import_optional(obj, "locales", v => import_record(v, import_string)),
    };
}
