/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState, useEffect, useMemo } from "react";
import { useInit } from "hooks";

import { type ButtonProps } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { TextInputGroup, TextInputGroupMain, TextInputGroupUtilities } from '@patternfly/react-core/dist/esm/components/TextInputGroup/index.js';
import { FolderOpenIcon, DesktopIcon } from '@patternfly/react-icons';

import { TreeSelectButton, TreeNode, TreeRoot, TreeFilter } from "cockpit-components-tree-select.jsx";
import { basename, dirname } from "cockpit-path";

const _ = cockpit.gettext;

/* A file chooser, based on the TreeSelect widget.

   This is experimental still.
 */

interface FileNode extends TreeNode<FileNode> {
    type: "list" | "directory" | "file";
    location?: string;
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

function split_path(path: string, onlyDirectories: boolean): FileNode[] {
    let res: FileNode[] = [];
    for (const p of path.split("/"))
        res.push({ type: "directory", name: p + "/", isSelectable: onlyDirectories, isLeaf: false });
    const last = res[res.length - 1];
    if (last.name == "/")
        res = res.slice(0, res.length - 1);
    else {
        last.type = "file";
        last.name = last.name.substring(0, last.name.length - 1);
        last.isSelectable = true;
        last.isLeaf = true;
    }
    return res;
}

async function file_info(path: string, superuser): Promise<string> {
    return cockpit.spawn(["file", "--", path], { superuser });
}

async function listFiles(
    nodes: FileNode[],
    recentKey: string,
    onlyDirectories: boolean,
    superuser: cockpit.SuperuserMode,
): Promise<FileNode[]> {
    if (nodes.length == 1 && nodes[0].type == "list" && nodes[0].name == "recent") {
        const recent = JSON.parse(window.localStorage.getItem(recentKey) || "[]");
        if (Array.isArray(recent)) {
            return recent.filter(r => typeof r == "string" && !(onlyDirectories && !r.endsWith("/"))).map(r => (
                {
                    type: r.endsWith("/") ? "directory" : "file",
                    name: basename(r),
                    location: dirname(r),
                    link: split_path(r, onlyDirectories),
                    isSelectable: onlyDirectories || !r.endsWith("/"),
                    isLeaf: !r.endsWith("/"),
                }
            ));
        }
        return [];
    }

    const path = join_path(nodes);
    if (!path.endsWith("/"))
        return [];

    return new Promise((resolve, reject) => {
        const channel = cockpit.channel({
            payload: "fslist1",
            path,
            superuser,
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
                        isSelectable: onlyDirectories,
                        isLeaf: false,
                    });
                } else if (!onlyDirectories) {
                    results.push({
                        type: "file",
                        name: item.path,
                        isSelectable: true,
                        isLeaf: true,
                    });
                }
            }
        });
    });
}

function formatHeader(node: FileNode): React.ReactNode {
    if (node.type == "list")
        return null;
    if (node.name == "/")
        return <DesktopIcon />;
    else
        return basename(node.name);
}

function formatExtraColumns(node: FileNode): React.ReactNode[] {
    if (node.location)
        return [node.location];
    return [];
}

export interface FileChooserShortcut {
    label: string,
    path: string,
}

export interface FileChooserFilter {
    label: string,
    regex: string,
}

export const FileChooserButton = ({
    title,
    initialLocation = "",
    onSelect,
    selectTitle,
    recentKey = "recent-files",
    shortcuts = [],
    filters = [],
    onlyDirectories = false,
    superuser,
    ...buttonProps
} : {
    title: string,
    initialLocation?: string,
    onSelect: (path: string) => Promise<void>,
    selectTitle: string,
    recentKey?: string,
    shortcuts?: FileChooserShortcut[],
    filters?: FileChooserFilter[],
    onlyDirectories?: boolean,
    superuser?: cockpit.SuperuserMode,
} & Omit<ButtonProps, 'onSelect'>) => {
    async function _onSelect(path: FileNode[]) {
        const path_string = join_path(path);
        rememberRecent(path_string, recentKey);
        await onSelect(path_string);
    }

    const treeFilters: TreeFilter<FileNode>[] = useMemo(() => {
        const res = filters.map(f => {
            return {
                label: f.label,
                filter: n => (n.type == "directory" && !(n.location || onlyDirectories)) || !!n.name.match(f.regex),
            };
        });

        if (res.length > 0)
            res.push({
                label: _("All files"),
                filter: _n => true,
            });
        return res;
    }, []);

    const roots: TreeRoot<FileNode>[] = useInit(() => {
        const roots: TreeRoot<FileNode>[] = [];
        roots.push(
            {
                label: _("Recent"),
                root: {
                    type: "list",
                    name: "recent",
                    isSelectable: false,
                    isLeaf: false,
                },
            }
        );
        {
            shortcuts.map(s => {
                roots.push(
                    {
                        label: s.label,
                        root: {
                            type: "directory",
                            name: "",
                            isSelectable: onlyDirectories,
                            link: split_path(s.path, onlyDirectories),
                            isLeaf: false,
                        },
                    }
                );
            })
        }
        roots.push(
            {
                label: _("All"),
                root: {
                    type: "directory",
                    name: "all",
                    isSelectable: onlyDirectories,
                    link: split_path("/", onlyDirectories),
                    isLeaf: false,
                },
            }
        );
        return roots;
    });

    return (
        <TreeSelectButton<FileNode>
            title={title}
            roots={roots}
            filters={treeFilters}
            formatHeader={formatHeader}
            formatExtraColumns={formatExtraColumns}
            formatSelected={p => file_info(join_path(p), superuser)}
            listChildren={p => listFiles(p, recentKey, onlyDirectories, superuser)}
            initialPath={split_path(initialLocation, onlyDirectories)}
            onSelect={_onSelect}
            selectTitle={selectTitle}
            {...buttonProps}
        />
    );
};

export type FileChooserButtonProps = Parameters<typeof FileChooserButton>[0];

export const FileChooserInput = ({
    placeholder,
    value,
    onChange,
    ...buttonProps
} : {
    placeholder: string,
    value: string,
    onChange: (path: string) => void,
} & Omit<FileChooserButtonProps, 'initialLocation' | 'onChange' | 'onSelect' | 'selectTitle'>) => {
    const [innerValue, setInnerValue] = useState(value);

    useEffect(() => {
        setInnerValue(value);
    }, [value]);

    return (
        <TextInputGroup>
            <TextInputGroupMain
                value={innerValue}
                placeholder={placeholder}
                onChange={(_event, value) => setInnerValue(value)}
                autoComplete="off"
                onBlur={
                    () => {
                        onChange(innerValue);
                    }
                }
            />
            <TextInputGroupUtilities>
                <FileChooserButton
                    initialLocation={innerValue}
                    onSelect={async val => { onChange(val); }}
                    selectTitle={_("Select")}
                    variant="plain"
                    icon={<FolderOpenIcon />}
                    {...buttonProps}
                />
            </TextInputGroupUtilities>
        </TextInputGroup>
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
