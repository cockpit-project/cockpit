/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState } from "react";
import { useInit } from "hooks";

import { TreeSelect, TreeNode, TreeRoot, TreeFilter } from "cockpit-components-tree-select.jsx";
import { basename, dirname } from "cockpit-path";

const _ = cockpit.gettext;

/* A simple file chooser, based on the TreeSelect widget.
 */

interface FileNode extends TreeNode<FileNode> {
    type: "list" | "directory" | "file";
}

function join_path(path: FileNode[]): string {
    let res = "";

    for (const n of path) {
        if (res == "" || n.name.startsWith("/"))
            res = n.name;
        else if (res.endsWith("/"))
            res = res + n.name;
        else
            res = res + "/" + n.name;
    }

    return res;
}

function split_path(path: string): FileNode[] {
    let res: FileNode[] = [];
    for (const p of path.split("/"))
        res.push({ type: "directory", name: p + "/" });
    const last = res[res.length - 1];
    if (last.name == "/")
        res = res.slice(0, res.length - 1);
    else {
        last.type = "file";
        last.name = last.name.substring(0, last.name.length - 1);
    }
    return res;
}

async function listFiles(nodes: FileNode[], recentKey: string, listCommon: null | (() => Promise<string[]>)): Promise<FileNode[]> {
    if (nodes.length == 1 && nodes[0].type == "list" && nodes[0].name == "recent") {
        const recent = JSON.parse(window.localStorage.getItem(recentKey) || "[]");
        console.log("RECENT", recent);
        if (Array.isArray(recent)) {
            return recent.filter(r => typeof r == "string").map(r => (
                {
                    type: r.endsWith("/") ? "directory" : "file",
                    name: basename(r),
                    link: split_path(r)
                }
            ));
        }
        return [];
    }

    if (nodes.length == 1 && nodes[0].type == "list" && nodes[0].name == "common") {
        if (!listCommon)
            return [];
        return (await listCommon()).map(c => (
            {
                type: c.endsWith("/") ? "directory" : "file",
                name: c,
                link: split_path(c)
            }
        ));
    }

    const path = join_path(nodes);
    if (!path.endsWith("/"))
        return [];

    return new Promise((resolve, reject) => {
        const channel = cockpit.channel({
            payload: "fslist1",
            path,
            superuser: "try",
            watch: false,
        });
        const results: FileNode[] = [];

        channel.addEventListener("close", (_ev, data) => {
            if (data.problem)
                reject(new Error(String(data.message || data.problem)));
            results.sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
            resolve(results);
        });

        channel.addEventListener("message", (_ev, data) => {
            const item = JSON.parse(data);
            if (item && item.path && item.event == 'present') {
                if (item.type == "directory") {
                    results.push({
                        type: "directory",
                        name: item.path + "/",
                    });
                } else {
                    results.push({
                        type: "file",
                        name: item.path,
                    });
                }
            }
        });
    });
}

function formatHeader(path: FileNode[]): string {
    if (path.length == 0)
        return "";
    if (path[0].type == "list")
        return "";
    else
        return "Directory " + join_path(path);
}

export const FileChooser = ({
    value,
    onChange,
    recentKey = "recent-files",
    listCommon = null,
    extensionFilters = [],
} : {
    value: string,
    onChange: (path: string) => void,
    recentKey?: string,
    listCommon?: null | (() => Promise<string[]>),
    extensionFilters: string[],
}) => {
    const [lastFilterPathText, setLastFilterPathText] = useState("");
    const [lastFilterPath, setLastFilterPath] = useState<FileNode[]>([]);

    function _onChange(path: FileNode[]): boolean {
        const cur = path[path.length - 1];
        if (cur.type == "file") {
            const path_string = join_path(path);
            onChange(path_string);
            rememberRecent(path_string, recentKey);
            return true;
        } else
            return false;
    }

    function parseTextInput(value: string): [null | FileNode[], string] {
        let filter = value;
        if (!value.startsWith("/"))
            return [null, filter];
        if (!value.endsWith("/")) {
            filter = basename(value);
            value = dirname(value);
            if (!value.endsWith("/"))
                value += "/";
        } else
            filter = "";

        // Avoid re-listing if the path doesn't change
        if (value == lastFilterPathText)
            return [lastFilterPath, filter];

        const path = split_path(value);
        setLastFilterPathText(value);
        setLastFilterPath(path);
        return [path, filter];
    }

    const filters: TreeFilter<FileNode>[] = extensionFilters.map(ext => {
        return {
            label: ext,
            filter: n => n.type == "directory" || n.name.endsWith("." + ext),
        };
    });

    if (filters.length > 0)
        filters.push({
            label: _("all"),
            filter: _n => true,
        });

    const roots: TreeRoot<FileNode>[] = useInit(() => {
        const roots: TreeRoot<FileNode>[] = [];
        roots.push(
            {
                label: _("Recent"),
                root: {
                    type: "list",
                    name: "recent",
                },
                filters,
            }
        );
        if (listCommon) {
            roots.push(
                {
                    label: _("Common"),
                    root: {
                        type: "list",
                        name: "common",
                    },
                    filters,
                }
            );
        }
        roots.push(
            {
                label: _("All"),
                root: {
                    type: "directory",
                    name: "/",
                },
                filters,
            }
        );
        return roots;
    });

    return (
        <TreeSelect
            roots={roots}
            formatHeader={formatHeader}
            listChildren={p => listFiles(p, recentKey, listCommon)}
            value={value}
            placeholder={_("Path to file")}
            onChange={_onChange}
            parseTextInput={parseTextInput}
        />
    );
};

export function rememberRecent(path: string, recentKey: string = "recent-files") {
    let recent: string[] = [];
    const value: unknown = JSON.parse(window.localStorage.getItem(recentKey) || "[]");
    if (Array.isArray(value))
        recent = value.filter(r => typeof r == "string");

    recent = recent.filter(r => r != path);
    recent.unshift(path);

    window.localStorage.setItem(recentKey, JSON.stringify(recent));
}
