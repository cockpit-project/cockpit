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

export interface Location {
    host: string;
    path: string;
    hash: string;
}

export function encode_location(location: Location): string {
    const shell_embedded = window.location.pathname.indexOf(".html") !== -1;
    if (shell_embedded)
        return window.location.toString();

    const path = [];
    if (location.host && location.host !== "localhost")
        path.push("@" + location.host);
    if (location.path)
        path.push(...location.path.split("/"));
    let string = cockpit.location.encode(path, undefined, true);
    if (location.hash && location.hash !== "/")
        string += "#" + location.hash;
    return string;
}

/* Decodes navigate state from a string */
export function decode_location(string: string): Location {
    let hash = "";
    const pos = string.indexOf("#");
    if (pos !== -1) {
        hash = string.substring(pos + 1);
        string = string.substring(0, pos);
    }
    if (string[0] != '/')
        string = "/" + string;
    const path = cockpit.location.decode(string);
    let host;
    if (path[0] && path[0][0] == "@")
        host = (path.shift() as string).substring(1);
    else
        host = "localhost";
    if (path.length && path[path.length - 1] == "index")
        path.pop();
    return { host, path: path.join("/"), hash };
}

export function decode_window_location(): Location {
    const shell_embedded = window.location.pathname.indexOf(".html") !== -1;

    if (shell_embedded)
        return decode_location("/" + window.location.hash);
    else
        return decode_location(window.location.pathname + window.location.hash);
}

export function replace_window_location(location: Location): void {
    window.history.replaceState(null, "", encode_location(location));
}

export function push_window_location(location: Location): void {
    window.history.pushState(null, "", encode_location(location));
}

export interface ManifestItemKeyword {
    matches: string[];
    goto?: string;
    weight: number;
    translate: boolean;
}

export interface ManifestItemDocs {
    label: string;
    url: string;
}

export interface ManifestItem {
    path: string;
    hash: string;
    section: string;
    label: string;
    order: number;
    docs: ManifestItemDocs[] | undefined;
    keywords: ManifestItemKeyword[];
    keyword: unknown; // XXX - unused?
}

export interface ManifestMenuEntry {
    path?: string;
    label?: string;
    order?: number;
    docs?: ManifestItemDocs[];
    keywords?: ManifestItemKeyword[];
}

export interface ManifestSection {
    [name: string]: ManifestMenuEntry;
}

export interface Manifest {
    [section: string]: ManifestSection;
}

export interface Manifests {
    [pkg: string]: Manifest
}

class CompiledComponents {
    manifests: Manifests;
    items: Map<string, ManifestItem> = new Map();

    constructor(manifests: Manifests) {
        this.manifests = manifests;
    }

    load(section: string): void {
        Object.entries(this.manifests || { }).forEach(([name, manifest]) => {
            Object.entries(manifest[section] || { }).forEach(([prop, info]) => {
                const item: ManifestItem = {
                    path: "", // set below
                    hash: "", // set below
                    section,
                    label: info.label ? cockpit.gettext(info.label) : prop,
                    order: info.order === undefined ? 1000 : info.order,
                    docs: info.docs,
                    keywords: info.keywords || [{ matches: [], weight: 3, translate: true }],
                    keyword: { score: -1 }
                };

                // Always first keyword should be page name
                const page_name = item.label.toLowerCase();
                if (item.keywords[0].matches.indexOf(page_name) < 0)
                    item.keywords[0].matches.unshift(page_name);

                // Keywords from manifest have different defaults than are usual
                item.keywords.forEach(i => {
                    i.weight = i.weight || 3;
                    i.translate = i.translate === undefined ? true : i.translate;
                });

                if (info.path)
                    item.path = info.path.replace(/\.html$/, "");
                else
                    item.path = name + "/" + prop;

                /* Split out any hash in the path */
                const pos = item.path.indexOf("#");
                if (pos !== -1) {
                    item.hash = item.path.substring(pos + 1);
                    item.path = item.path.substring(0, pos);
                }

                /* Fix component for compatibility and normalize it */
                if (item.path.indexOf("/") === -1)
                    item.path = name + "/" + item.path;
                if (item.path.slice(-6) == "/index")
                    item.path = item.path.slice(0, -6);
                this.items.set(item.path, item);
            });
        });
    }

    ordered(section: string): ManifestItem[] {
        const list: ManifestItem[] = [];
        for (const item of this.items.values()) {
            if (!section || item.section === section)
                list.push(item);
        }
        list.sort(function(a, b) {
            let ret = a.order - b.order;
            if (ret === 0)
                ret = a.label.localeCompare(b.label);
            return ret;
        });
        return list;
    }

    find_path_item(path: string): ManifestItem {
        let component = path;
        if (this.items.has(path)) {
            let s = path;
            while (s && this.items.has(s))
                s = s.substring(0, s.lastIndexOf("/"));
            component = s;
        }

        // Still don't know where it comes from, check for parent
        if (!component && this.manifests) {
            const comp = this.manifests[path];
            if (comp && comp.parent && comp.parent.component)
                component = comp.parent.component as string;
        }

        const item = this.items.get(component);
        if (item)
            return item;

        // Return something that can be when the user navigates to a
        // URL for a non-existing component.

        return {
            path,
            label: path,
            section: "menu",
            hash: "",
            order: 3,
            keywords: [],
            keyword: null,
            docs: undefined
        };
    }

    find_path_manifest(path: string): Manifest {
        const parts = path.split("/");
        const pkg = parts[0];

        return (this.manifests && this.manifests[pkg]) || { };
    }
}

export function compile_manifests(manifests: { [pkg: string]: Manifest }): CompiledComponents {
    const compiled = new CompiledComponents(manifests);
    compiled.load("tools");
    compiled.load("dashboard");
    compiled.load("menu");
    return compiled;
}

export interface Machine {
    connection_string: string;
    address: string;
    manifests: Manifests;
    checksum: string;
}

function component_checksum(machine: Machine, path: string): string | undefined {
    const parts = path.split("/");
    const pkg = parts[0];
    if (machine.manifests && machine.manifests[pkg] && machine.manifests[pkg][".checksum"])
        return "$" + machine.manifests[pkg][".checksum"];
}

export function compute_frame_url(machine: Machine, path: string): string {
    let base, checksum;
    if (machine.manifests && machine.manifests[".checksum"])
        checksum = "$" + machine.manifests[".checksum"];
    else
        checksum = machine.checksum;

    if (checksum && checksum == component_checksum(machine, path)) {
        if (machine.connection_string === "localhost")
            base = "..";
        else
            base = "../../" + checksum;
    } else {
        /* If we don't have any checksums, or if the component specifies a different
           checksum than the machine, load it via a non-caching @<host> path.  This
           makes sure that we get the right files, and also that we don't poisen the
           cache with wrong files.

           We can't use a $<component-checksum> path since cockpit-ws only knows how to
           route the machine checksum.

           TODO - make it possible to use $<component-checksum>.
        */
        base = "../../@" + machine.connection_string;
    }

    let url = base + "/" + path;
    if (path.indexOf("/") === -1)
        url += "/index";
    url += ".html";

    return url;
}

export function generate_connection_string(
    user: string | null,
    port: string | null,
    addr: string
) {
    let address = addr;
    if (user)
        address = user + "@" + address;

    if (port)
        address = address + ":" + port;

    return address;
}

export function split_connection_string (conn_to: string) {
    let user_spot = -1;
    let port_spot = -1;
    let user;
    let port;

    if (conn_to) {
        if (conn_to.substring(0, 6) === "ssh://")
            conn_to = conn_to.substring(6);
        user_spot = conn_to.lastIndexOf('@');
        port_spot = conn_to.lastIndexOf(':');
    }

    if (user_spot > 0) {
        user = conn_to.substring(0, user_spot);
        conn_to = conn_to.substring(user_spot + 1);
        port_spot = conn_to.lastIndexOf(':');
    }

    if (port_spot > -1) {
        const p = parseInt(conn_to.substring(port_spot + 1), 10);
        if (!isNaN(p)) {
            port = p;
            conn_to = conn_to.substring(0, port_spot);
        }
    }

    return { address: conn_to, user, port };
}
