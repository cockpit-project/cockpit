/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* This is a file chooser dialog that can be used with "Dialogs.show",
   plus a text input for files that can be used in dialogs.

   It only implements things that are actually needed right now in
   Cockpit and it will be extened as those needs grow.

   Here is a list of notable features that are not implemented yet but
   have been prototyped elsewhere:

   - Creating new files in a "Save as" scenario.

   - Autocompletion in the FileChooserInput.
 */

import cockpit from "cockpit";
import React, { useState, useRef, useEffect } from "react";

import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { Table, Caption, Tbody, Tr, Td } from '@patternfly/react-table';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { EmptyState, EmptyStateActions, EmptyStateProps } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { FolderIcon, FolderOpenIcon, OutlinedHddIcon, SearchIcon } from '@patternfly/react-icons';
import {
    TextInputGroup, TextInputGroupMain, TextInputGroupUtilities
} from '@patternfly/react-core/dist/esm/components/TextInputGroup/index.js';
import { ToggleGroup, ToggleGroupItem } from '@patternfly/react-core/dist/esm/components/ToggleGroup/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { DropdownItem } from "@patternfly/react-core/dist/esm/components/Dropdown";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider";
import { Bullseye } from "@patternfly/react-core/dist/esm/layouts/Bullseye";

import { KebabDropdown } from "cockpit-components-dropdown";

import { useDialogs, WithDialogs } from 'dialogs';
import { FsInfoClient, fsinfo } from "cockpit/fsinfo";
import { basename, dirname } from "cockpit-path";

import {
    useDialogState_async,
    DialogState,
    DialogField,
    DialogErrorMessage,
    DialogHelperText,
    OptionalFormGroup,
    DialogActionButton,
} from 'cockpit/dialog';

import "./FileChooser.css";

const _ = cockpit.gettext;

async function getHomeDir(): Promise<string> {
    if (!cockpit.info.user)
        await cockpit.init();
    return cockpit.info.user.home;
}

async function getDownloadDir(): Promise<string | null> {
    try {
        return (await cockpit.spawn(["xdg-user-dir", "DOWNLOAD"], { err: "message" })).trim();
    } catch (ex) {
        console.warn("Can't determine downloads directory", String(ex));
        return null;
    }
}

async function stdShortcuts(shortcuts: FileChooserShortcut[] = []): Promise<FileChooserShortcut[]> {
    const home = await getHomeDir();
    const dd = await getDownloadDir();

    return [
        { label: _("Home"), path: home },
        ...(dd && dd != home ? [{ label: _("Downloads"), path: dd }] : []),
        ...shortcuts,
    ];
}

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

class FileError {
    message: string;

    constructor(message: string) {
        this.message = message;
    }
}

function watchFiles(
    path: string,
    onlyDirectories: boolean,
    superuser: cockpit.SuperuserMode,
    callback: (files: FileError | FileInfo[]) => void,
): FsInfoClient {
    const client = new FsInfoClient(
        path,
        ["type", "entries", "target", "targets"],
        {
            follow: true,
            ...(superuser ? { superuser } : { })
        }
    );

    client.on("close", message => {
        if ("message" in message && typeof message.message == "string")
            callback(new FileError(message.message));
    });

    client.on("change", state => {
        if (state.error) {
            callback(new FileError(state.error.message));
            return;
        }

        if (!state.info)
            return;

        const info = state.info;

        if (!(info.type && info.entries && info.targets)) {
            callback(new FileError(_("Permission denied")));
            return;
        }

        if (info.type != "dir") {
            callback(new FileError(_("Not a directory")));
            return;
        }

        const result: FileInfo[] = [];
        for (const name in info.entries) {
            let entry = info.entries[name];
            if (entry.type == "lnk" && entry.target)
                entry = info.entries[entry.target] || info.targets[entry.target];

            cockpit.assert(entry.type);
            if (!onlyDirectories || entry.type == "dir")
                result.push({ type: entry.type, name });
        }

        result.sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
        callback(result);
    });

    return client;
}

async function getFileInfos(
    paths: string[],
    onlyDirectories: boolean,
    superuser: cockpit.SuperuserMode,
): Promise<FileInfo[]> {
    const res: FileInfo[] = [];

    for (const p of paths) {
        try {
            const info = await fsinfo(p, ["type"], superuser ? { superuser } : { });
            if (info.type && (!onlyDirectories || info.type == "dir"))
                res.push({ name: p, type: info.type });
        } catch (ex) {
            if (!(ex && typeof ex == "object" && "problem" in ex && ex.problem != "not-found"))
                console.error("Failed to get file type:", p);
        }
    }

    return res;
}

async function listRecent(recentKey: string): Promise<string[]> {
    const recent = JSON.parse(window.localStorage.getItem(recentKey) || "[]");
    if (Array.isArray(recent)) {
        return recent.filter(r => typeof r == "string");
    } else {
        return [];
    }
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

export interface FileChooserShortcut {
    label: string;
    path: string;
}

export interface FileChooserCollection {
    label: string;
    emptyLabel: string;
    list: () => Promise<string[]>;
}

export interface FileChooserProps {
    title: string;
    shortcuts?: undefined | FileChooserShortcut[] | (() => Promise<FileChooserShortcut[]>);
    filters?: undefined | FileChooserFilter[];
    collections?: undefined | FileChooserCollection[] | (() => Promise<FileChooserCollection[]>);
    onlyDirectories?: undefined | boolean;
    superuser?: cockpit.SuperuserMode;
    recentKey?: undefined | string;
    actionLabel?: string;
}

interface FileChooserValues {
    path: string;
    collection: null | FileChooserCollection;
    files: null | FileError | FileInfo[];
    selected: null | FileInfo;
    textFilter: string;
    filters: FileChooserFilter[];
    filter: FileChooserFilter;
    recent_collection: FileChooserCollection;
    shortcuts: FileChooserShortcut[];
    collections: FileChooserCollection[];
    showHidden: boolean;
}

export const FileChooser = ({
    title,
    shortcuts = [],
    filters = [],
    collections = [],
    onlyDirectories = false,
    superuser,
    recentKey = "recent-files",
    actionLabel,
    path = "",
    action,
} : {
    path?: string,
    action: (path: string) => Promise<void>,
} & FileChooserProps) => {
    const Dialogs = useDialogs();
    const textInputRef = useRef<HTMLInputElement>(null);
    const fsInfoClientRef = useRef<FsInfoClient | null>(null);

    function focusFilter() {
        textInputRef.current?.focus();
    }

    useEffect(() => {
        textInputRef.current?.focus();
    }, []);

    async function init(): Promise<FileChooserValues> {
        const all_filters = filters.concat([{ label: _("All files"), filter: _n => true }]);

        const recent_collection = {
            label: _("Recent"),
            emptyLabel: onlyDirectories ? _("No recent directories") : _("No recent files"),
            list: () => listRecent(recentKey)
        };

        const shortcuts_list = Array.isArray(shortcuts) ? shortcuts : await shortcuts();
        const collections_list = Array.isArray(collections) ? collections : await collections();

        return {
            path,
            collection: path == "" ? recent_collection : null,
            files: null,
            selected: null,
            textFilter: "",
            filters: all_filters,
            filter: all_filters[0],
            recent_collection,
            shortcuts: await stdShortcuts(shortcuts_list),
            collections: collections_list,
            showHidden: false,
        };
    }

    const dlg = useDialogState_async(init);
    useEffect(() => {
        if (dlg instanceof DialogState) {
            if (dlg.values.collection)
                setCollection(dlg, dlg.values.collection);
            else
                setPath(dlg, dlg.values.path)
        }
    }, [dlg]);

    function setPath(dlg: DialogState<FileChooserValues>, path: string) {
        dlg.field("path").set(path);
        dlg.field("collection").set(null);
        dlg.field("selected").set(null);
        dlg.field("files").set(null);

        if (fsInfoClientRef.current)
            fsInfoClientRef.current.close();

        fsInfoClientRef.current = watchFiles(
            path,
            onlyDirectories,
            superuser,
            files => {
                dlg.field("files").set(files);
            }
        );
    }

    function setCollection(dlg: DialogState<FileChooserValues>, collection: FileChooserCollection) {
        dlg.field("path").set("");
        dlg.field("collection").set(collection);
        dlg.field("selected").set(null);
        dlg.field("files").set(null);

        if (fsInfoClientRef.current)
            fsInfoClientRef.current.close();

        fsInfoClientRef.current = null;
        dlg.field("files").set_async(0, async () => await getFileInfos(await collection.list(), onlyDirectories, superuser));
    }

    function full_path(path: string, selected: string) {
        if (path == "")
            return selected;
        else
            return path_join(path, selected);
    }

    function selected_path(): string | null {
        if (!(dlg instanceof DialogState))
            return null;

        const { selected, path } = dlg.values;

        if (onlyDirectories) {
            if (!selected && path != "")
                return path;
            else if (selected && selected.type == "dir")
                return full_path(path, selected.name);
        } else {
            if (selected && selected.type != "dir")
                return full_path(path, selected.name);
        }

        return null;
    }

    async function onAction() {
        const full = selected_path();
        cockpit.assert(full);
        rememberRecent(full, recentKey);
        await action(full);
    }

    function breadcrumbs(dlg: DialogState<FileChooserValues>) {
        const { path } = dlg.values;

        if (path == "") {
            // Collection
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
                                setPath(dlg, path);
                                event.preventDefault();
                            }
                        }
                        isActive={i == dirs.length - 1}
                    >
                        { d == "/" ? <OutlinedHddIcon className="breadcrumb-hdd-icon" /> : d }
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

    function header(dlg: DialogState<FileChooserValues>) {
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
                    onClick={() => setPath(dlg, sc.path)}
                    className="file-chooser-hide-on-wide"
                >
                    {sc.label}
                </DropdownItem>
            );
        }

        function collection(cl: FileChooserCollection) {
            return (
                <DropdownItem
                    key={cl.label}
                    onClick={() => setCollection(dlg, cl)}
                    className="file-chooser-hide-on-wide"
                >
                    {cl.label}
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
                                <DropdownItem
                                    key="jump"
                                    onClick={
                                        () => {
                                            cockpit.jump("files#" + cockpit.location.encode([], { path: dlg.values.path }));
                                        }
                                    }
                                    isDisabled={dlg.values.path === ""}
                                >
                                    {_("Open in file browser")}
                                </DropdownItem>,
                                <DropdownItem
                                    key="showhide"
                                    onClick={
                                        () => {
                                            dlg.field("showHidden").set(!dlg.values.showHidden);
                                        }
                                    }
                                >
                                    {dlg.values.showHidden ? _("Hide hidden files") : _("Show hidden files")}
                                </DropdownItem>,
                                <Divider key="divider" className="file-chooser-hide-on-wide"/>,
                                collection(dlg.values.recent_collection),
                                ...dlg.values.shortcuts.map(shortcut),
                                shortcut({ label: _("Filesystem"), path: "/" }),
                                ...dlg.values.collections.map(collection)
                            ]
                        }
                    />
                </FlexItem>
            </Flex>
        );
    }

    function formatIcon(f: FileInfo): React.ReactNode {
        if (f.type == "dir")
            return <FolderIcon />;
        else
            return <FileIcon />;
    }

    function sidebar(dlg: DialogState<FileChooserValues>) {
        function shortcut(sc: FileChooserShortcut) {
            return (
                <Tr
                    key={sc.label}
                    isClickable
                    isSelectable
                    isRowSelected={dlg.values.path == sc.path}
                    onRowClick={
                        () => {
                            setPath(dlg, sc.path);
                            focusFilter();
                        }
                    }
                >
                    <Td>{sc.label}</Td>
                </Tr>
            );
        }

        function collection(col: FileChooserCollection) {
            return (
                <Tr
                    key={col.label}
                    isClickable
                    isSelectable
                    isRowSelected={dlg.values.collection == col}
                    onRowClick={
                        () => {
                            setCollection(dlg, col);
                            focusFilter();
                        }
                    }
                >
                    <Td>{col.label}</Td>
                </Tr>
            );
        }

        return (
            <Table variant="compact" borders={false}>
                <Tbody>
                    { collection(dlg.values.recent_collection) }
                    { dlg.values.shortcuts.map(shortcut) }
                    { shortcut({ label: _("Filesystem"), path: "/" }) }
                    { dlg.values.collections.map(collection) }
                </Tbody>
            </Table>
        );
    }

    function listing(dlg: DialogState<FileChooserValues>) {

        function emptyState(content: string, icon: NonNullable<EmptyStateProps["icon"]>, clearFilters: number = 0) {
            return (
                <Caption>
                    <EmptyState
                        titleText={content}
                        icon={icon}
                    >
                        { (clearFilters > 0) &&
                            <EmptyStateActions>
                                <Button
                                    variant="link"
                                    onClick={() => {
                                        if (clearFilters == 3) {
                                            dlg.field("showHidden").set(true);
                                        } else {
                                            dlg.field("textFilter").set("");
                                            if (clearFilters > 1)
                                                dlg.field("filter").set(dlg.values.filters[dlg.values.filters.length - 1]);
                                        }
                                        focusFilter();
                                    }}
                                >
                                    {clearFilters == 3 ? _("Show hidden files") : _("Clear filters")}
                                </Button>
                            </EmptyStateActions>
                        }
                    </EmptyState>
                </Caption>
            );
        }

        function listingBody() {
            const files = dlg.values.files;

            if (files == null)
                return emptyState("", Spinner);

            if (files instanceof FileError)
                return emptyState(files.message, FolderIcon);

            if (files.length == 0) {
                if (dlg.values.collection) {
                    return emptyState(dlg.values.collection.emptyLabel, FolderIcon);
                } else if (!onlyDirectories) {
                    return emptyState(_("Directory is empty"), FolderIcon);
                } else {
                    return emptyState(_("Directory has no sub-directories"), FolderIcon);
                }
            }

            const withoutHidden = dlg.values.showHidden ? files : files.filter(f => f.name[0] !== ".");
            if (withoutHidden.length == 0)
                return emptyState(_("This directory contains only hidden files"), SearchIcon, 3);

            const preFiltered = withoutHidden.filter(
                f => (!onlyDirectories && f.type == "dir") || dlg.values.filter.filter(f.name, f.type)
            );
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
                                        data-name={name}
                                        onRowClick={
                                            () => {
                                                dlg.field("selected").set(f);
                                                focusFilter();
                                            }
                                        }
                                        onDoubleClick={
                                            event => {
                                                event.preventDefault();
                                                if (f.type == "dir")
                                                    setPath(dlg, full_path(dlg.values.path, f.name));
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
                    <div className="file-chooser-sidebar file-chooser-hide-on-narrow">
                        {
                            dlg instanceof DialogState
                                ? sidebar(dlg)
                                : <Bullseye><Spinner /></Bullseye>
                        }
                    </div>
                    <div className="file-chooser-listing-header">
                        { dlg instanceof DialogState && header(dlg) }
                    </div>
                    <div className="file-chooser-listing-breadcrumbs">
                        { dlg instanceof DialogState && breadcrumbs(dlg) }
                    </div>
                    <div className="file-chooser-listing-body">
                        { dlg instanceof DialogState && listing(dlg) }
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <DialogActionButton
                    dialog={dlg}
                    isAriaDisabled={selected_path() === null}
                    action={onAction}
                    onClose={Dialogs.close}
                >
                    {actionLabel || _("Select")}
                </DialogActionButton>
            </ModalFooter>
        </Modal>
    );
};

const FileChooserButton = ({
    value,
    onChoose,
    props,
} : {
    value: string,
    onChoose: (path: string) => void,
    props: FileChooserProps,
}) => {
    const Dialogs = useDialogs();

    return (
        <Button
            variant="plain"
            icon={<FolderOpenIcon />}
            onClick={
                async () => {
                    Dialogs.show(
                        <FileChooser
                            path={value[0] == "/" ? dirname(value) : ""}
                            action={async path => onChoose(path)}
                            {...props}
                        />
                    );
                }
            }
        />
    );
};

export const FileChooserInput = ({
    ouiaId,
    placeholder = "",
    value,
    onChange,
    isDisabled = false,
    fileChooserProps,
} : {
    ouiaId?: undefined | string;
    placeholder?: string,
    value: string,
    onChange: (path: string) => void,
    isDisabled?: boolean,
    fileChooserProps: FileChooserProps,
}) => {
    return (
        <TextInputGroup
            isDisabled={isDisabled}
            data-ouia-component-id={ouiaId}
        >
            <TextInputGroupMain
                value={value}
                placeholder={placeholder}
                onChange={(_event, value) => onChange(value)}
                autoComplete="off"
            />
            <TextInputGroupUtilities>
                <WithDialogs>
                    <FileChooserButton
                        value={value}
                        onChoose={onChange}
                        props={fileChooserProps}
                    />
                </WithDialogs>
            </TextInputGroupUtilities>
        </TextInputGroup>
    );
};

export const DialogFileChooserInput = ({
    field,
    label,
    placeholder = "",
    explanation,
    warning,
    excuse,
    fileChooserProps,
} : {
    field: DialogField<string>,
    label: string,
    placeholder?: string,
    explanation?: React.ReactNode,
    warning?: React.ReactNode,
    excuse?: string | null | undefined | false,
    fileChooserProps: FileChooserProps,
}) => {
    return (
        <OptionalFormGroup
            label={label}
        >
            <FileChooserInput
                ouiaId={field.ouia_id()}
                placeholder={placeholder}
                value={field.get()}
                onChange={val => field.set(val)}
                isDisabled={!!excuse}
                fileChooserProps={fileChooserProps}
            />
            <DialogHelperText field={field} explanation={explanation} warning={warning} excuse={excuse} />
        </OptionalFormGroup>
    );
};

export function rememberRecent(name: string, recentKey: string = "recent-files") {
    const value = JSON.parse(window.localStorage.getItem(recentKey) || "[]");
    if (Array.isArray(value)) {
        const recent = value.filter(r => typeof r == "string" && r != name);
        recent.unshift(name);
        window.localStorage.setItem(recentKey, JSON.stringify(recent.slice(0, 20)));
    }
}
