/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* NOTES

   [x] Keep dropdown open after select

   [x] Add footer with "Go up"

   [x] Add "Recent|Common|All"

   [x] Custom directory content for interesting pools

   [x] Close when selecting a file in non-location mode

   [ ] Add "location" mode with only dirs and "Create dir"

   [ ] Follow symlinks
 */

/* DESIGN

   The menu has a header that shows the current place where we are: current directory or pool name.

   The menu items is a list of children of that place.

   The menu has a footer with "Up" and "Recent | Common | All files | Pool"

   Hmm. (The dialog field itself is a text input that only gets updated when
   a "acceptable" item is selected. (leaf in the case of choosing
   files).  The user can still type into it and then whatever is in it
   will be used as the ...)
 */

import cockpit from "cockpit";
import React, { useState } from "react";

import { TreeSelect, TreeNode, TreeRoot } from "cockpit-components-tree-select.jsx";
import { FileChooser } from "cockpit-components-file-chooser.jsx";

interface FileNode extends TreeNode<FileNode> {
    type: string;
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

async function listFiles(nodes: FileNode[]): Promise<FileNode[]> {
    const path = join_path(nodes);
    if (!path.endsWith("/"))
        return [];

    return new Promise(resolve => {
        const channel = cockpit.channel({
            payload: "fslist1",
            path,
            superuser: "try",
            watch: false,
        });
        const results: FileNode[] = [];

        channel.addEventListener("close", (_ev, data) => {
            if (data.problem)
                console.log("PROBLEM", path, data.problem);
            results.sort((a, b) => a.name.localeCompare(b.name));
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

const fsys_root = {
    type: "directory",
    name: "/",
};

const recent_root: FileNode = {
    type: "list",
    name: "",
    children: [
        {
            type: "file",
            name: "/home/mvo/Downloads/alpine-virt-3.21.3-x86_64.iso",
            link: split_path("/home/mvo/Downloads/alpine-virt-3.21.3-x86_64.iso")
        },
        {
            type: "file",
            name: "/home/mvo/Downloads/Fedora-Server-Guest-Generic-44_Beta-1.2.x86_64.qcow2",
            link: split_path("/home/mvo/Downloads/Fedora-Server-Guest-Generic-44_Beta-1.2.x86_64.qcow2")
        },
    ]
};

const common_root: FileNode = {
    type: "list",
    name: "",
    children: [
        {
            type: "directory",
            name: "/home/mvo/Downloads/",
            link: split_path("/home/mvo/Downloads/"),
        },
        {
            type: "directory",
            name: "/var/lib/libvirt/boot/",
            link: split_path("/var/lib/libvirt/boot/"),
        },
        {
            type: "directory",
            name: "/var/lib/libvirt/images/",
            link: split_path("/var/lib/libvirt/images/"),
        },
    ]
};

const pools_root: FileNode = {
    type: "pools",
    name: "",
    children: [
        {
            type: "pool",
            name: "sda",
            children: [
                { type: "volume", name: "sda1" },
                { type: "volume", name: "sda2" },
                {
                    type: "pool",
                    name: "subpool",
                    children: [
                        { type: "volume", name: "lvol0" },
                        { type: "volume", name: "vmdisk-foo" },
                    ]
                }
            ]
        },
        {
            type: "pool",
            name: "vgroup0",
            children: [
                { type: "volume", name: "lvol0" },
                { type: "volume", name: "vmdisk-foo" },
            ]
        },
    ]
};

const file_filters = [
    {
        label: "all",
        filter: (_n: FileNode) => true,
    },
    {
        label: "qcow",
        filter: (n: FileNode) => n.type == "directory" || n.name.endsWith(".qcow2"),
    },
    {
        label: "iso",
        filter: (n: FileNode) => n.type == "directory" || n.name.endsWith(".iso"),
    },
];

const roots: TreeRoot<FileNode>[] = [
    {
        label: "Recent",
        root: recent_root,
        filters: file_filters,
    },
    {
        label: "Common",
        root: common_root,
        filters: file_filters,
    },
    {
        label: "All",
        root: fsys_root,
        filters: file_filters,
    },
    {
        label: "Pools",
        root: pools_root,
        filters: [],
    },
];

function formatHeader(path: FileNode[]): string {
    if (path.length == 1 && (path[0].type == "list" || path[0].type == "pools"))
        return "";
    else if (path.length > 1 && path[0].type == "pools")
        return "Pool " + join_path(path.slice(1));
    else
        return "Directory " + join_path(path);
}

export const FileChooserDemo = () => {
    const [value, setValue] = useState<string>("");

    return (
        <>
            <FileChooser
                value={value}
                onChange={setValue}
                listCommon={
                    async () => [
                        "/home/mvo/Downloads/",
                        "/var/lib/libvirt/images/"
                    ]
                }
                extensionFilters={["iso"]}
            />
        </>
    );
};
