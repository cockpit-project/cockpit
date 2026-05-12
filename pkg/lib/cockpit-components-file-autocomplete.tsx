/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from "react";
import { debounce } from 'throttle-debounce';
import { TypeaheadSelect } from "cockpit-components-typeahead-select";

const _ = cockpit.gettext;

interface FileEntry {
    type: "file" | "directory" | "link" | "special";
    path: string;
}

interface FileAutoCompleteProps {
    id?: string;
    placeholder?: string;
    superuser?: cockpit.SuperuserMode;
    isOptionCreatable: boolean;
    onlyDirectories: boolean;
    onChange: (value: string, error?: string | null) => void;
    value?: string;
}

interface FileAutoCompleteState {
    directory: string;
    displayFiles: FileEntry[];
    value: string | null;
    error?: string | null;
}

export class FileAutoComplete extends React.Component<FileAutoCompleteProps, FileAutoCompleteState> {
    static defaultProps: Partial<FileAutoCompleteProps> = {
        isOptionCreatable: false,
        onlyDirectories: false,
        onChange: () => '',
    };

    allowFilesUpdate: boolean;
    debouncedChange: (value: string) => void;

    constructor(props: FileAutoCompleteProps) {
        super(props);
        this.state = {
            directory: '', // The current directory we list files/dirs from
            displayFiles: [],
            value: this.props.value || null,
        };

        this.allowFilesUpdate = true;
        this.clearSelection = this.clearSelection.bind(this);

        this.debouncedChange = debounce(300, this.onPathChange);
    }

    onPathChange = (value: string) => {
        if (!value) {
            this.clearSelection();
            return;
        }

        const cb = (dirPath: string) => this.updateFiles(dirPath == '' ? '/' : dirPath);

        let path = value;
        if (value.lastIndexOf('/') == value.length - 1)
            path = value.slice(0, value.length - 1);

        const match = this.state.displayFiles
                .find(entry => (entry.type == 'directory' && entry.path == path + '/') || (entry.type == 'file' && entry.path == path));

        if (match) {
            // If match file path is a prefix of another file, do not update current directory,
            // since we cannot tell file/directory user wants to select
            // https://bugzilla.redhat.com/show_bug.cgi?id=2097662
            const isPrefix = this.state.displayFiles.filter(entry => entry.path.startsWith(value)).length > 1;
            // If the inserted string corresponds to a directory listed in the results
            // update the current directory and refetch results
            if (match.type == 'directory' && !isPrefix)
                cb(match.path);
            else
                this.setState({ value: match.path });
        } else {
            // If the inserted string's parent directory is not matching the `directory`
            // in the state object we need to update the parent directory and recreate the displayFiles
            const parentDir = value.slice(0, value.lastIndexOf('/'));

            if (parentDir + '/' != this.state.directory) {
                return this.updateFiles(parentDir + '/');
            }
        }
    };

    componentDidMount() {
        this.onPathChange(this.state.value || '');
    }

    componentWillUnmount() {
        this.allowFilesUpdate = false;
    }

    updateFiles(path: string) {
        if (this.state.directory == path)
            return;

        const channel = cockpit.channel({
            payload: "fslist1",
            path,
            superuser: this.props.superuser,
            watch: false,
        });
        const results: FileEntry[] = [];

        channel.addEventListener("ready", () => {
            this.finishUpdate(results, null, path);
        });

        channel.addEventListener("close", (_ev, data) => {
            this.finishUpdate(results, data.message as string | null, path);
        });

        channel.addEventListener("message", (_ev, data) => {
            const item = JSON.parse(data);
            if (item && item.path && item.event == 'present' &&
                (!this.props.onlyDirectories || item.type == 'directory')) {
                item.path = item.path + (item.type == 'directory' ? '/' : '');
                results.push(item);
            }
        });
    }

    finishUpdate(results: FileEntry[], error: string | null, directory: string) {
        if (!this.allowFilesUpdate)
            return;
        results = results.sort((a, b) => a.path.localeCompare(b.path));

        const listItems: FileEntry[] = results.map(file => ({
            type: file.type,
            path: (directory == '' ? '/' : directory) + file.path
        }));

        if (directory) {
            listItems.unshift({
                type: "directory",
                path: directory
            });
        }

        if (error || !this.state.value)
            this.props.onChange('', error);

        if (!error)
            this.setState({ displayFiles: listItems, directory });
        this.setState({
            error,
        });
    }

    clearSelection() {
        this.updateFiles("/");
        this.setState({ value: null });
        this.props.onChange('', null);
    }

    render() {
        const placeholder = this.props.placeholder || _("Path to file");

        const selectOptions = this.state.displayFiles
                .map(option => ({ value: option.path, content: option.path, className: option.type }));

        return (
            <TypeaheadSelect toggleProps={{ id: this.props.id }}
                             isScrollable
                             onInputChange={this.debouncedChange}
                             placeholder={placeholder}
                             noOptionsAvailableMessage={this.state.error || _("No such file or directory")}
                             noOptionsFoundMessage={this.state.error || _("No such file or directory")}
                             onToggle={isOpen => {
                                 // Try to list again when
                                 // opening. Calling onPathChange here
                                 // usually does nothing, except when
                                 // there was an error earlier.
                                 if (isOpen)
                                     this.onPathChange(this.state.value || '');
                             }}
                             selected={this.state.value}
                             selectedIsTrusted
                             onSelect={(_, value) => {
                                 const path = String(value);
                                 this.setState({ value: path });
                                 this.onPathChange(path);
                                 this.props.onChange(path, null);
                             }}
                             onClearSelection={this.clearSelection}
                             isCreatable={this.props.isOptionCreatable}
                             createOptionMessage={val => cockpit.format(_("Create $0"), val)}
                             selectOptions={selectOptions} />
        );
    }
}
