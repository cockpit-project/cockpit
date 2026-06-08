/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* This is a file chooser dialog that can be used with "Dialogs.show".

   It only implements things that are actually needed right now in
   Cockpit and it will be extened as those needs grow.

   Here is a list of notable features that are not implemented yet but
   have been prototyped elsewhere:

   - Configurable shortcuts instead of the currently hard-coded "Home"
     and "Downloads" ones.

   - Selecting a directory instead of a regular file (or device file
     etc).

   - Support for arbitrary collections in addition to the special
     "Recent" one.

   - Support for using the dialog stand-alone without the
     FileChooserInput widget.  This includes running arbitrary actions
     right in the dialog and displaying their errors.

   - Creating new files in a "Save as" scenario.

   - Autocompletion in the FileChooserInput.
 */

import cockpit from "cockpit";
import React, { useRef, useEffect } from "react";

import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { Table, Caption, Tbody, Tr, Td } from '@patternfly/react-table';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { EmptyState, EmptyStateActions, EmptyStateProps } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { FolderIcon, FolderOpenIcon, DesktopIcon, SearchIcon } from '@patternfly/react-icons';
import {
    TextInputGroup, TextInputGroupMain, TextInputGroupUtilities
} from '@patternfly/react-core/dist/esm/components/TextInputGroup/index.js';
import { ToggleGroup, ToggleGroupItem } from '@patternfly/react-core/dist/esm/components/ToggleGroup/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { DropdownItem } from "@patternfly/react-core/dist/esm/components/Dropdown";

import { KebabDropdown } from "cockpit-components-dropdown";

import { useDialogs, WithDialogs } from 'dialogs';
import { useInit } from "hooks";
import { fsinfo, FsInfoError } from "cockpit/fsinfo";
import { basename, dirname } from "cockpit-path";

import {
    useDialogState,
    DialogField,
    DialogErrorMessage,
    OptionalFormGroup,
    DialogActionButton,
} from 'cockpit/dialog';

import "./file-chooser.css";

const _ = cockpit.gettext;

const FileIcon = () => {
    return (
        <svg
            height="1em"
            width="1em"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 1536 1792"
            fill="currentColor"
        >
            <path d="M1468 380c37 37 68 111 68 164v1152c0 53-43 96-96 96H96c-53 0-96-43-96-96V96C0 43 43 0 96 0h896c53 0 127 31 164 68zm-444-244v376h376c-6-17-15-34-22-41l-313-313c-7-7-24-16-41-22zm384 1528V640H992c-53 0-96-43-96-96V128H128v1536z" />
        </svg>
    );
};

function path_join(dir: string, base: string) {
    return (dir == "/" ? "" : dir) + "/" + base;
}

interface FileInfo {
    type: string;
    name: string;
}

function is_FileInfo(obj: unknown): obj is FileInfo {
    return (
        !!obj &&
            typeof obj == "object" &&
            "name" in obj &&
            typeof obj.name == "string" &&
            "type" in obj &&
            typeof obj.type == "string"
    );
}

class FileError {
    message: string;

    constructor(message: string) {
        this.message = message;
    }
}

async function listFiles(path: string, superuser: cockpit.SuperuserMode, recentKey: string): Promise<FileError | FileInfo[]> {
    if (path == "") {
        // Recent
        const recent = JSON.parse(window.localStorage.getItem(recentKey) || "[]");
        if (Array.isArray(recent))
            return recent.filter(is_FileInfo);
        else
            return [];
    }

    let info;
    try {
        info = await fsinfo(
            path,
            ["type", "entries", "target", "targets"],
            {
                follow: true,
                ...(superuser ? { superuser } : { })
            }
        );
    } catch (ex) {
        return new FileError((ex as FsInfoError).message);
    }

    if (!(info.type && info.entries && info.targets)) {
        return new FileError(_("Access denied"));
    }

    if (info.type != "dir") {
        return new FileError(_("Not a directory"));
    }

    const result: FileInfo[] = [];
    for (const name in info.entries) {
        let entry = info.entries[name];
        if (entry.type == "lnk" && entry.target)
            entry = info.entries[entry.target] || info.targets[entry.target];

        cockpit.assert(entry.type);
        result.push({ type: entry.type, name });
    }

    result.sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
    return result;
}

function boldify(name: string, filterText: string): React.ReactNode {
    if (!filterText)
        return name;
    const parts: React.ReactNode[] = [];
    let pos;
    while ((pos = name.indexOf(filterText)) >= 0) {
        parts.push(name.substring(0, pos));
        parts.push(<u key={pos}>{name.substring(pos, pos + filterText.length)}</u>);
        name = name.substring(pos + filterText.length);
    }
    if (name)
        parts.push(name);
    return parts;
}

export interface FileChooserFilter {
    label: string;
    filter: (name: string, type: string) => boolean,
}

export function regexFilter(label: string, regex: string): FileChooserFilter {
    return {
        label,
        filter: n => !!n.match(regex),
    };
}

interface FileChooserShortcut {
    label: string;
    path: string;
}

interface FileChooserModalValues {
    path: string;
    files: null | FileError | FileInfo[];
    selected: null | FileInfo;
    textFilter: string;
    filters: FileChooserFilter[];
    filter: FileChooserFilter;
}

const FileChooserModal = ({
    title,
    path = "",
    shortcuts = [],
    filters = [],
    superuser,
    recentKey = "recent-files",
    onChoose,
} : {
    title: React.ReactNode,
    path?: string,
    shortcuts?: FileChooserShortcut[],
    filters?: FileChooserFilter[],
    superuser?: cockpit.SuperuserMode,
    recentKey?: string,
    onChoose: (path: string) => void,
}) => {
    const Dialogs = useDialogs();
    const textInputRef = useRef<HTMLInputElement>(null);

    function focusFilter() {
        textInputRef.current?.focus();
    }

    useEffect(() => {
        textInputRef.current?.focus();
    }, []);

    function init(): FileChooserModalValues {
        return {
            path,
            files: null,
            selected: null,
            textFilter: "",
            filters: filters.concat([{ label: _("All files"), filter: _n => true }]),
            filter: filters[0],
        };
    }

    const dlg = useDialogState(init);
    useInit(() => { setPath(dlg.values.path) });

    function full_path(path: string, selected: string) {
        if (path == "")
            return selected;
        else
            return path_join(path, selected);
    }

    async function onAction(values: FileChooserModalValues) {
        cockpit.assert(values.selected);
        const full = full_path(values.path, values.selected.name);
        rememberRecent(full, values.selected.type, recentKey);
        onChoose(full);
    }

    function onSelect(f: FileInfo) {
        dlg.field("selected").set(f);
    }

    function setPath(path: string) {
        dlg.field("path").set(path);
        dlg.field("selected").set(null);
        dlg.field("files").set(null);
        dlg.field("files").set_async(0, () => listFiles(path, superuser, recentKey));
    }

    function onNavigate(f: FileInfo) {
        if (f.type == "dir") {
            setPath(full_path(dlg.values.path, f.name));
        }
    }

    function breadcrumbs() {
        const { path } = dlg.values;

        if (path == "") {
            // Recent
            return null;
        } else {
            const dirs = ["/"].concat(path.split("/").filter(d => !!d));
            const crumbs: React.ReactNode[] = [];
            let full = "/";
            dirs.forEach((d, i) => {
                if (d != "/")
                    full = path_join(full, d);
                const path = full;
                crumbs.push(
                    <BreadcrumbItem
                        key={i}
                        to="#"
                        onClick={
                            (event) => {
                                setPath(path);
                                event.preventDefault();
                            }
                        }
                        isActive={i == dirs.length - 1}
                    >
                        { d == "/" ? <DesktopIcon /> : d }
                    </BreadcrumbItem>
                );
            });

            if (crumbs.length > 0) {
                return (
                    <Breadcrumb>
                        {crumbs}
                    </Breadcrumb>
                );
            }
        }
    }

    function header() {
        const preparedFilters = (
            dlg.values.filters.length > 1 &&
                <ToggleGroup>
                    {
                        dlg.values.filters.map(f => {
                            return (
                                <ToggleGroupItem
                                    key={f.label}
                                    isSelected={f == dlg.values.filter}
                                    onChange={() => {
                                        dlg.field("filter").set(f);
                                        focusFilter();
                                    }}
                                    text={f.label}
                                />
                            );
                        })
                    }
                </ToggleGroup>
        );

        const textFilter = (
            <TextInput
                ref={textInputRef}
                placeholder={_("Type to filter")}
                value={dlg.values.textFilter}
                onChange={(_event, value) => dlg.field("textFilter").set(value)}
            />
        );

        function shortcut(sc: FileChooserShortcut) {
            return (
                <DropdownItem
                    key={sc.label}
                    onClick={() => setPath(sc.path)}
                >
                    {sc.label}
                </DropdownItem>
            );
        }

        return (
            <Flex>
                <FlexItem>
                    {textFilter}
                </FlexItem>
                <FlexItem>
                    {preparedFilters}
                </FlexItem>
                <FlexItem className="file-chooser-kebab" align={{ default: 'alignRight' }}>
                    <KebabDropdown
                        dropdownItems={
                            [
                                shortcut({ label: _("Recent"), path: "" }),
                                ...shortcuts.map(shortcut),
                                shortcut({ label: _("Filesystem"), path: "/" }),
                            ]
                        }
                    />
                </FlexItem>
            </Flex>
        );
    }

    function emptyState(content: string, icon: EmptyStateProps["icon"], clearFilters: number = 0) {
        return (
            <Caption>
                <EmptyState
                    titleText={content}
                    {...icon ? { icon } : {}}
                >
                    { (clearFilters > 0) &&
                        <EmptyStateActions>
                            <Button
                                variant="link"
                                onClick={() => {
                                    dlg.field("textFilter").set("");
                                    if (clearFilters > 1)
                                        dlg.field("filter").set(dlg.values.filters[dlg.values.filters.length - 1]);
                                    focusFilter();
                                }}
                            >
                                {_("Clear filters")}
                            </Button>
                        </EmptyStateActions>
                    }
                </EmptyState>
            </Caption>
        );
    }

    function formatIcon(f: FileInfo): React.ReactNode {
        // XXX - icons for device files and others?
        if (f.type == "dir")
            return <FolderIcon />;
        else
            return <FileIcon />;
    }

    function sidebar() {
        function shortcut(sc: FileChooserShortcut) {
            return (
                <Tr
                    key={sc.label}
                    isClickable
                    isSelectable
                    isRowSelected={dlg.values.path == sc.path}
                    onRowClick={
                        () => {
                            setPath(sc.path);
                            focusFilter();
                        }
                    }
                >
                    <Td>{sc.label}</Td>
                </Tr>
            );
        }

        return (
            <Table variant="compact" borders={false}>
                <Tbody>
                    { shortcut({ label: _("Recent"), path: "" }) }
                    { shortcuts.map(shortcut) }
                    { shortcut({ label: _("Filesystem"), path: "/" }) }
                </Tbody>
            </Table>
        );
    }

    function listing() {
        function listingBody() {
            const files = dlg.values.files;

            if (files == null)
                return emptyState("", Spinner);

            if (files instanceof FileError)
                return emptyState(files.message, FolderIcon);

            if (files.length == 0) {
                if (dlg.values.path == "")
                    return emptyState(_("No recent files"), FolderIcon);
                else
                    return emptyState(_("Folder is empty"), FolderIcon);
            }

            const preFiltered = files.filter(f => f.type == "dir" || dlg.values.filter.filter(f.name, f.type));
            if (preFiltered.length == 0)
                return emptyState(_("No matching results"), SearchIcon, 2);

            const filtered = preFiltered.filter(f => f.name.includes(dlg.values.textFilter));
            if (filtered.length == 0)
                return emptyState(_("No matching results"), SearchIcon, 1);

            return (
                <Tbody>
                    {
                        filtered.map(
                            (f, idx) => {
                                let name, location;
                                if (dlg.values.path == "") {
                                    name = basename(f.name);
                                    location = dirname(f.name);
                                } else {
                                    name = f.name;
                                }
                                return (
                                    <Tr
                                        className={f.name == dlg.values.selected?.name ? "file-chooser-selected" : ""}
                                        key={idx}
                                        onRowClick={
                                            () => {
                                                onSelect(f);
                                                focusFilter();
                                            }
                                        }
                                        onDoubleClick={
                                            event => {
                                                event.preventDefault();
                                                onNavigate(f);
                                                dlg.field("textFilter").set("");
                                                focusFilter();
                                            }
                                        }
                                        isClickable
                                    >
                                        <Td>
                                            {formatIcon(f)}
                                            &nbsp;&nbsp;
                                            {boldify(name, dlg.values.textFilter)}
                                        </Td>
                                        { location && <Td>{location}</Td> }
                                    </Tr>
                                );
                            }
                        )
                    }
                </Tbody>
            );
        }

        return (
            <Table variant="compact" borders={false}>
                { listingBody() }
            </Table>
        );
    }

    return (
        <Modal
            isOpen
            variant="large"
            position="top"
            onClose={Dialogs.close}
            className="file-chooser"
        >
            <ModalHeader
                title={title}
                description={<DialogErrorMessage dialog={dlg} />}
            />
            <ModalBody>
                <div className="file-chooser-body">
                    <div className="file-chooser-sidebar">
                        { sidebar() }
                    </div>
                    <div className="file-chooser-listing-header">
                        { header() }
                    </div>
                    <div className="file-chooser-listing-breadcrumbs">
                        { breadcrumbs() }
                    </div>
                    <div className="file-chooser-listing-body">
                        { listing() }
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <DialogActionButton
                    dialog={dlg}
                    isAriaDisabled={!dlg.values.selected || dlg.values.selected.type == "dir"}
                    action={onAction}
                    onClose={Dialogs.close}
                >
                    {_("Select")}
                </DialogActionButton>
            </ModalFooter>
        </Modal>
    );
};

async function getHomeDir(): Promise<string> {
    if (!cockpit.info.user)
        await cockpit.init();
    return cockpit.info.user.home;
}

async function getDownloadDir(): Promise<string | null> {
    try {
        return (await cockpit.spawn(["xdg-user-dir", "DOWNLOAD"])).trim();
    } catch (ex) {
        console.warn("Can't determine downloads directory", String(ex));
        return null;
    }
}

const FileChooserButton = ({
    title,
    filters,
    value,
    onChoose,
} : {
    title: string,
    filters: FileChooserFilter[],
    value: string,
    onChoose: (path: string) => void,
}) => {
    const Dialogs = useDialogs();

    return (
        <Button
            variant="plain"
            icon={<FolderOpenIcon />}
            onClick={
                async () => {
                    const home = await getHomeDir();
                    const dd = await getDownloadDir();
                    Dialogs.show(
                        <FileChooserModal
                            title={title}
                            filters={filters}
                            shortcuts={
                                [
                                    { label: _("Home"), path: home },
                                    ...(dd && dd != home ? [{ label: _("Downloads"), path: dd }] : []),
                                ]
                            }
                            path={value ? dirname(value) : ""}
                            onChoose={onChoose}
                        />
                    );
                }
            }
        />
    );
};

export const FileChooserInput = ({
    id,
    title,
    placeholder = "",
    filters = [],
    value,
    onChange,
} : {
    id?: undefined | string;
    title: string,
    placeholder?: string,
    filters?: FileChooserFilter[],
    value: string,
    onChange: (path: string) => void,
}) => {
    return (
        <TextInputGroup id={id}>
            <TextInputGroupMain
                value={value}
                placeholder={placeholder}
                onChange={(_event, value) => onChange(value)}
                autoComplete="off"
            />
            <TextInputGroupUtilities>
                <WithDialogs>
                    <FileChooserButton title={title} filters={filters} value={value} onChoose={onChange} />
                </WithDialogs>
            </TextInputGroupUtilities>
        </TextInputGroup>
    );
};


export const DialogFileChooser = ({
    field,
    label,
    dialogTitle,
    placeholder = "",
    filters = [],
} : {
    field: DialogField<string>,
    label: string,
    dialogTitle: string
    placeholder?: string,
    filters?: FileChooserFilter[],
}) => {
    return (
        <OptionalFormGroup
            label={label}
        >
            <FileChooserInput
                id={field.id()}
                title={dialogTitle}
                placeholder={placeholder}
                filters={filters}
                value={field.get()}
                onChange={val => field.set(val)}
            />
        </OptionalFormGroup>
    );
}

export function rememberRecent(name: string, type: string, recentKey: string = "recent-files") {
    const value = JSON.parse(window.localStorage.getItem(recentKey) || "[]");
    if (Array.isArray(value)) {
        const recent = value.filter(is_FileInfo).filter(f => f.name != name);
        recent.unshift({ name, type });
        window.localStorage.setItem(recentKey, JSON.stringify(recent.slice(0, 20)));
    }
}
