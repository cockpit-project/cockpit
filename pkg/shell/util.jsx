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

/* Encode navigate state into a string If with_root is true the
 * configured url root will be added to the generated url. with_root
 * should be used when navigating to a new url or updating history,
 * but is not needed when simply generating a string for a link.
 */

function encode_location_raw(location, with_root) {
    const path = [];
    if (location.host && location.host !== "localhost")
        path.push("@" + location.host);
    if (location.path)
        path.push.apply(path, location.path.split("/"));
    let string = cockpit.location.encode(path, null, with_root);
    if (location.hash && location.hash !== "/")
        string += "#" + location.hash;
    return string;
}

/* Decodes navigate state from a string */
export function decode_location(string) {
    const location = { hash: "" };
    const pos = string.indexOf("#");
    if (pos !== -1) {
        location.hash = string.substring(pos + 1);
        string = string.substring(0, pos);
    }
    if (string[0] != '/')
        string = "/" + string;
    const path = cockpit.location.decode(string);
    if (path[0] && path[0][0] == "@") {
        location.host = path.shift().substring(1);
    } else {
        location.host = "localhost";
    }
    if (path.length && path[path.length - 1] == "index")
        path.pop();
    location.path = path.join("/");
    return location;
}

/* Build an href for use in an <a> */
export function build_href(location) {
    return encode_location_raw(location, false);
}

function encode_location(location) {
    const shell_embedded = window.location.pathname.indexOf(".html") !== -1;
    return shell_embedded ? window.location : encode_location_raw(location, true);
}

export function decode_window_location() {
    const shell_embedded = window.location.pathname.indexOf(".html") !== -1;

    if (shell_embedded)
        return decode_location("/" + window.location.hash);
    else
        return decode_location(window.location.pathname + window.location.hash);
}

export function replace_window_location(location) {
    window.history.replaceState(null, "", encode_location(location));
}

export function push_window_location(location) {
    window.history.pushState(null, "", encode_location(location));
}

export function CompiledComponents() {
    const self = this;
    self.items = {};

    self.load = function(manifests, section) {
        Object.entries(manifests || { }).forEach(([name, manifest]) => {
            Object.entries(manifest[section] || { }).forEach(([prop, info]) => {
                const item = {
                    section,
                    label: cockpit.gettext(info.label) || prop,
                    order: info.order === undefined ? 1000 : info.order,
                    docs: info.docs,
                    keywords: info.keywords || [{ matches: [] }],
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
                    item.hash = item.path.substr(pos + 1);
                    item.path = item.path.substr(0, pos);
                }

                /* Fix component for compatibility and normalize it */
                if (item.path.indexOf("/") === -1)
                    item.path = name + "/" + item.path;
                if (item.path.slice(-6) == "/index")
                    item.path = item.path.slice(0, -6);
                self.items[item.path] = item;
            });
        });
    };

    self.ordered = function(section) {
        const list = [];
        for (const x in self.items) {
            if (!section || self.items[x].section === section)
                list.push(self.items[x]);
        }
        list.sort(function(a, b) {
            let ret = a.order - b.order;
            if (ret === 0)
                ret = a.label.localeCompare(b.label);
            return ret;
        });
        return list;
    };

    self.search = function(prop, value) {
        for (const x in self.items) {
            if (self.items[x][prop] === value)
                return self.items[x];
        }
    };

    self.find_path_item = function(path) {
        let component = path;
        if (self.items[path] === undefined) {
            let s = path;
            while (s && self.items[s] === undefined)
                s = s.substring(0, s.lastIndexOf("/"));
            component = s;
        }

        // Still don't know where it comes from, check for parent
        if (!component) {
            const comp = cockpit.manifests[path];
            if (comp && comp.parent)
                component = comp.parent.component;
        }

        return self.items[component] || { path, label: path, section: "menu" };
    };
}

export function compile_manifests(manifests) {
    const compiled = new CompiledComponents();
    compiled.load(manifests, "tools");
    compiled.load(manifests, "dashboard");
    compiled.load(manifests, "menu");
    return compiled;
}

function component_checksum(machine, path) {
    const parts = path.split("/");
    const pkg = parts[0];
    if (machine.manifests && machine.manifests[pkg] && machine.manifests[pkg][".checksum"])
        return "$" + machine.manifests[pkg][".checksum"];
}

export function compute_frame_url(machine, path) {
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

export function generate_connection_string(user, port, addr) {
    let address = addr;
    if (user)
        address = user + "@" + address;

    if (port)
        address = address + ":" + port;

    return address;
}

export function split_connection_string (conn_to) {
    const parts = {};
    let user_spot = -1;
    let port_spot = -1;

    if (conn_to) {
        if (conn_to.substring(0, 6) === "ssh://")
            conn_to = conn_to.substring(6);
        user_spot = conn_to.lastIndexOf('@');
        port_spot = conn_to.lastIndexOf(':');
    }

    if (user_spot > 0) {
        parts.user = conn_to.substring(0, user_spot);
        conn_to = conn_to.substring(user_spot + 1);
        port_spot = conn_to.lastIndexOf(':');
    }

    if (port_spot > -1) {
        const port = parseInt(conn_to.substring(port_spot + 1), 10);
        if (!isNaN(port)) {
            parts.port = port;
            conn_to = conn_to.substring(0, port_spot);
        }
    }

    parts.address = conn_to;
    return parts;
}
