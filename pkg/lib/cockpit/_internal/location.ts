/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * This is the "cockpit.location" API converted to TypeScript and moved out of
 * cockpit.js. In the future a new Location API should be designed to replace
 * the "cockpit.location" one and become importable from pkg/lib/cockpit as ESM module.
 */

import { url_root, calculate_application } from './location-utils';

type Options = { [name: string]: string | Array<string> };
type Path = string | string[] | Location;

export class Location {
    path: string[];
    href: string;
    url_root: string;
    options: Options;
    #hash_changed: boolean = false;

    constructor() {
        const application = calculate_application();
        this.url_root = url_root || "";

        if (window.mock?.url_root)
            this.url_root = window.mock.url_root;

        if (application.indexOf("cockpit+=") === 0) {
            if (this.url_root)
                this.url_root += '/';
            this.url_root = this.url_root + application.replace("cockpit+", '');
        }

        this.href = window.location.hash.slice(1);
        this.options = {};
        this.path = this.decode(this.href, this.options);
    }

    #resolve_path_dots(parts: string[]): string[] {
        const out = [];
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part === "" || part == ".") {
                continue;
            } else if (part == "..") {
                if (out.length === 0)
                    return [];
                out.pop();
            } else {
                out.push(part);
            }
        }
        return out;
    }

    #href_for_go_or_replace(path: Path, options?: Options): string {
        options = options || {};
        if (typeof path === "string") {
            return this.encode(this.decode(path, options), options);
        } else if (path instanceof Location) {
            return path.href;
        } else {
            return this.encode(path, options);
        }
    }

    #decode_path(input: string): string[] {
        let result, i;
        let pre_parts: string[] = [];
        const parts = input.split('/').map(decodeURIComponent);

        if (this.url_root)
            pre_parts = this.url_root.split('/').map(decodeURIComponent);

        if (input && input[0] !== "/" && this.path !== undefined) {
            result = [...this.path];
            result.pop();
            result = result.concat(parts);
        } else {
            result = parts;
        }

        result = this.#resolve_path_dots(result);
        for (i = 0; i < pre_parts.length; i++) {
            if (pre_parts[i] !== result[i])
                break;
        }
        if (i == pre_parts.length)
            result.splice(0, pre_parts.length);

        return result;
    }

    encode(path: string | string[], options: Options, with_root: boolean = false): string {
        if (typeof path == "string")
            path = this.#decode_path(path);

        let href = "/" + path.map(encodeURIComponent).join("/");
        if (with_root && this.url_root && href.indexOf("/" + this.url_root + "/") !== 0)
            href = "/" + this.url_root + href;

        /* Undo unnecessary encoding of these */
        href = href.replaceAll("%40", "@");
        href = href.replaceAll("%3D", "=");
        href = href.replaceAll("%2B", "+");
        href = href.replaceAll("%23", "#");

        const query: string[] = [];
        if (options) {
            for (const opt in options) {
                let value = options[opt];
                if (!Array.isArray(value))
                    value = [value];
                value.forEach(function(v: string) {
                    query.push(encodeURIComponent(opt) + "=" + encodeURIComponent(v));
                });
            }
            if (query.length > 0)
                href += "?" + query.join("&");
        }
        return href;
    }

    // NOTE: The options argument is modified in place
    decode(href: string, options: Options): string[] {
        if (href[0] == '#')
            href = href.substring(1);

        const pos = href.indexOf('?');
        const first = (pos === -1) ? href : href.substring(0, pos);
        const path = this.#decode_path(first);
        if (pos !== -1 && options) {
            href.substring(pos + 1).split("&")
                    .forEach(function(opt) {
                        const parts = opt.split('=');
                        const name = decodeURIComponent(parts[0]);
                        const value = decodeURIComponent(parts[1]);
                        if (options[name]) {
                            let last = options[name];
                            if (!Array.isArray(last))
                                last = options[name] = [last];
                            last.push(value);
                        } else {
                            options[name] = value;
                        }
                    });
        }

        return path;
    }

    replace(path: Path, options?: Options) {
        if (this.#hash_changed)
            return;
        const href = this.#href_for_go_or_replace(path, options);
        window.location.replace(window.location.pathname + '#' + href);
    }

    go(path: Path, options?: Options) {
        if (this.#hash_changed)
            return;
        const href = this.#href_for_go_or_replace(path, options);
        window.location.hash = '#' + href;
    }

    invalidate() {
        this.#hash_changed = true;
    }

    toString() {
        return this.href;
    }
}
