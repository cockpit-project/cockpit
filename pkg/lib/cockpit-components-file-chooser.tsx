/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState, useEffect, useMemo } from "react";
import { useInit } from "hooks";

import { type ButtonProps } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { TextInputGroup, TextInputGroupMain, TextInputGroupUtilities } from '@patternfly/react-core/dist/esm/components/TextInputGroup/index.js';
import { FolderOpenIcon, OutlinedHddIcon, FolderIcon } from '@patternfly/react-icons';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { TreeSelectButton, TreeNode, TreeRoot, TreeFilter } from "cockpit-components-tree-select.jsx";
import { basename, dirname } from "cockpit-path";

const _ = cockpit.gettext;

/* A file chooser, based on the TreeSelect widget.

   This is experimental still.
 */

interface FileNode extends TreeNode<FileNode> {
    type: "list" | "directory" | "file";
    location?: string;
    collection?: FileChooserCollection;
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

async function file_info(path: string, superuser): Promise<React.ReactNode> {
    return (
        <Flex>
            <FlexItem>{path}</FlexItem>
            <FlexItem style={{ color: "grey" }}>{await cockpit.spawn(["file", "-b", "--", path], { superuser })}</FlexItem>
        </Flex>
    )
}

async function file_exists(path: string, superuser): Promise<boolean> {
    try {
        await cockpit.spawn(["test", "-e", path], { superuser });
        return true;
    } catch (ex) {
        return false;
    }
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

    if (nodes.length == 1 && nodes[0].type == "list" && nodes[0].collection) {
        const paths = nodes[0].collection.paths;
        return paths.filter(p => !(onlyDirectories && !p.endsWith("/"))).map(p => (
            {
                type: p.endsWith("/") ? "directory" : "file",
                name: p,
                link: split_path(p, onlyDirectories),
                isSelectable: onlyDirectories || !p.endsWith("/"),
                isLeaf: !p.endsWith("/"),
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
        return <OutlinedHddIcon
                   style={
                       {
                           blockSize: "var(--pf-t--global--font--size--lg)",
                           inlineSize: "auto",
                           verticalAlign: "middle",
                       }
                   }
        />;
    else
        return basename(node.name);
}

const FileIcon = () => {
    return (
        <svg
            height="14"
            width="14"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 1536 1792"
        >
            <path d="M1468 380c37 37 68 111 68 164v1152c0 53-43 96-96 96H96c-53 0-96-43-96-96V96C0 43 43 0 96 0h896c53 0 127 31 164 68zm-444-244v376h376c-6-17-15-34-22-41l-313-313c-7-7-24-16-41-22zm384 1528V640H992c-53 0-96-43-96-96V128H128v1536z"/>
        </svg>
    );
};

function formatIcon(node: FileNode): React.ReactNode {
    if (node.type == "file")
        return <FileIcon />;
    else if (node.type == "directory")
        return <FolderIcon />;
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

export interface FileChooserCollection {
    label: string,
    paths: string[],
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
    collections = [],
    filters = [],
    onlyDirectories = false,
    createFile = false,
    createDirectories = false,
    superuser,
    ...buttonProps
} : {
    title: string,
    initialLocation?: string,
    onSelect: (path: string) => Promise<void>,
    selectTitle: string,
    recentKey?: string,
    shortcuts?: FileChooserShortcut[],
    collections?: FileChooserCollection[],
    filters?: FileChooserFilter[],
    onlyDirectories?: boolean,
    createFile?: boolean,
    createDirectories?: boolean,
    superuser?: cockpit.SuperuserMode,
} & Omit<ButtonProps, 'onSelect'>) => {
    async function _onSelect(path: FileNode[], newNode: string) {
        let path_string = join_path(path);
        if (createFile) {
            if (!path_string.endsWith("/"))
                path_string += "/";
            path_string += newNode;
        } else
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
        });
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
        if (collections.length > 0) {
            roots.push(
                {
                    label: _("Pools"),
                }
            );
            collections.map(c => {
                roots.push(
                    {
                        label: c.label,
                        root: {
                            type: "list",
                            collection: c,
                            name: "",
                            isSelectable: false,
                            isLeaf: false,
                        },
                    }
                );
            });
        }

        return roots;
    });

    async function createDirectory(path: FileNode[], name: string): Promise<FileNode[]> {
        let newPath = join_path(path);
        if (!newPath.endsWith("/"))
            newPath += "/";
        newPath += name;
        console.log("CREATE", newPath);
        await cockpit.spawn(["mkdir", "-p", "--", newPath], { superuser });
        return split_path(newPath, onlyDirectories);
    }

    function enableCreate(path: FileNode[], name: string): boolean {
        return path.length > 0 && path[0].type != "list" && !!name;
    }

    return (
        <TreeSelectButton<FileNode>
            title={title}
            roots={roots}
            filters={treeFilters}
            formatHeader={formatHeader}
            formatIcon={formatIcon}
            formatExtraColumns={formatExtraColumns}
            formatSelected={async p => p[p.length - 1].type == "directory" ? join_path(p) : await file_info(join_path(p), superuser)}
            formatLocation={p => join_path(p)}
            checkExists={(p, n) => file_exists(join_path(p) + "/" + n, superuser)}
            listChildren={p => listFiles(p, recentKey, onlyDirectories, superuser)}
            initialPath={split_path(initialLocation, onlyDirectories)}
            onSelect={_onSelect}
            selectTitle={selectTitle}
            dangerSelectTitle={_("Replace")}
            emptyMessage={onlyDirectories ? "Directory has no sub-directories" : "Directory is empty"}
            createFolderAction={
                createDirectories
                    ?
                    {
                        label: _("Create directory"),
                        isDisabled: path => path.length == 0 || path[0].type == "list",
                        create: createDirectory
                    }
                    : undefined}
            enableCreate={createFile ? enableCreate : undefined}
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
    const [innerValue, _setInnerValue] = useState(value);
    const [hint, setHint] = useState("");

    async function setInnerValue(val: string): Promise<void> {
        _setInnerValue(val);
        let dir, base;
        if (val == "") {
            setHint("");
            return;
        }
        if (val.endsWith("/")) {
            dir = val;
            base = "";
        } else {
            dir = dirname(val);
            if (!dir.endsWith("/"))
                dir += "/";
            base = basename(val);
        }
        console.log("DIR", dir, "BASE", base);
        const files = await listFiles([{ type: "directory", name: dir, isLeaf: false, isSelectable: false }], "", false, undefined);
        console.log("FILES", files.map(n => n.name));
        const filtered = files.map(n => n.name).filter(n => n.startsWith(base)).sort();
        if (filtered.length >= 1) {
            const a = filtered[0];
            const b = filtered[filtered.length - 1];
            console.log("A", a, "B", b);
            let i = 0;
            while (i < Math.min(a.length, b.length) && a[i] == b[i])
                i++;
            const hint = dir + a.substring(0, i);
            console.log("C", i, hint);
            if (hint.startsWith(val) && hint != val)
                setHint(hint);
            else
                setHint("");
        } else
            setHint("");
    }

    useEffect(() => {
        setInnerValue(value);
    }, [value]);

    return (
        <TextInputGroup>
            <TextInputGroupMain
                value={innerValue}
                hint={hint}
                placeholder={placeholder}
                onChange={(_event, value) => setInnerValue(value)}
                autoComplete="off"
                onBlur={
                    () => {
                        onChange(innerValue);
                    }
                }
                onKeyDown={(event) => {
                    switch (event.key) {
                        case 'ArrowRight':
                            if (hint.startsWith(innerValue))
                                setInnerValue(hint);
                            break;
                    }
                }}
            />
            <TextInputGroupUtilities>
                <FileChooserButton
                    initialLocation={innerValue}
                    onSelect={async val => { setInnerValue(val); onChange(val); }}
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
