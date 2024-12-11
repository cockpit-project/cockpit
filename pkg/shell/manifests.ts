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

export interface ManifestKeyword {
    matches: string[];
    goto?: string;
    weight?: number;
    translate?: boolean;
}

export interface ManifestDocs {
    label: string;
    url: string;
}

export interface ManifestEntry {
    path?: string;
    label?: string;
    order?: number;
    docs?: ManifestDocs[];
    keywords?: ManifestKeyword[];
}

export interface ManifestSection {
    [name: string]: ManifestEntry;
}

export interface ManifestParentSection {
    component?: string;
    docs?: ManifestDocs[];
}

export interface Manifest {
    dashboard?: ManifestSection;
    menu?: ManifestSection;
    tools?: ManifestSection;

    preload?: string[];
    parent?: ManifestParentSection;
    ".checksum"?: string;
}

export interface Manifests {
    [pkg: string]: Manifest;
}

export function import_Manifests(val: JsonValue): Manifests {
    // TODO - validate against schema
    return val as unknown as Manifests;
}

export interface ShellManifest {
    docs?: ManifestDocs[];
    locales?: { [id: string]: string };
}

export function import_ShellManifest(val: JsonValue): ShellManifest {
    // TODO - validate against schema
    return val as unknown as ShellManifest;
}
