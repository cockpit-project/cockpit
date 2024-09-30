/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
import React from "react";
import { Select, SelectOption } from "@patternfly/react-core/dist/esm/deprecated/components/Select/index.js";
import PropTypes from "prop-types";
import { debounce } from 'throttle-debounce';

import { fsinfo } from "cockpit/fsinfo";

const _ = cockpit.gettext;

export class FileAutoComplete extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            directory: '', // The current directory we list files/dirs from
            displayFiles: [],
            isOpen: false,
            value: this.props.value || null,
        };

        this.typeaheadInputValue = "";
        this.allowFilesUpdate = true;
        this.updateFiles = this.updateFiles.bind(this);
        this.finishUpdate = this.finishUpdate.bind(this);
        this.onToggle = this.onToggle.bind(this);
        this.clearSelection = this.clearSelection.bind(this);
        this.onCreateOption = this.onCreateOption.bind(this);

        this.onPathChange = (value) => {
            if (!value) {
                this.clearSelection();
                return;
            }

            this.typeaheadInputValue = value;

            const cb = (dirPath) => this.updateFiles(dirPath == '' ? '/' : dirPath);

            let path = value;
            if (value.lastIndexOf('/') == value.length - 1)
                path = value.slice(0, value.length - 1);

            const match = this.state.displayFiles
                    .find(entry => (entry.type == 'dir' && entry.path == path + '/') || (entry.type == 'reg' && entry.path == path));

            if (match) {
                // If match file path is a prefix of another file, do not update current directory,
                // since we cannot tell file/directory user wants to select
                // https://bugzilla.redhat.com/show_bug.cgi?id=2097662
                const isPrefix = this.state.displayFiles.filter(entry => entry.path.startsWith(value)).length > 1;
                // If the inserted string corresponds to a directory listed in the results
                // update the current directory and refetch results
                if (match.type == 'dir' && !isPrefix)
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
        this.debouncedChange = debounce(300, this.onPathChange);
        this.onPathChange(this.state.value);
    }

    componentWillUnmount() {
        this.allowFilesUpdate = false;
    }

    onCreateOption(newValue) {
        this.setState(prevState => ({
            displayFiles: [...prevState.displayFiles, { type: "reg", path: newValue }]
        }));
    }

    updateFiles(path) {
        if (this.state.directory == path)
            return;

        fsinfo(path, ['type', 'entries'], { superuser: this.props.superuser })
                .then(info => {
                    const results = [];
                    for (const name in info.entries ?? {}) {
                        const type = info.entries[name].type;
                        if (!this.props.onlyDirectories || type == 'dir')
                            results.push({ type, path: name + (type == 'dir' ? '/' : '') });
                    }
                    this.finishUpdate(results, null, path);
                })
                .catch(error => this.finishUpdate([], error.message, path));
    }

    finishUpdate(results, error, directory) {
        if (!this.allowFilesUpdate)
            return;
        results = results.sort((a, b) => a.path.localeCompare(b.path, { sensitivity: 'base' }));

        const listItems = results.map(file => ({
            type: file.type,
            path: (directory == '' ? '/' : directory) + file.path
        }));

        if (directory) {
            listItems.unshift({
                type: "dir",
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

    onToggle(_, isOpen) {
        this.setState({ isOpen });
    }

    clearSelection() {
        this.typeaheadInputValue = "";
        this.updateFiles("/");
        this.setState({
            value: null,
            isOpen: false
        });
        this.props.onChange('', null);
    }

    render() {
        const placeholder = this.props.placeholder || _("Path to file");

        const selectOptions = this.state.displayFiles
                .map(option => <SelectOption key={option.path}
                                             className={option.type}
                                             value={option.path} />);
        return (
            <Select
                variant="typeahead"
                id={this.props.id}
                isInputValuePersisted
                onTypeaheadInputChanged={this.debouncedChange}
                placeholderText={placeholder}
                noResultsFoundText={this.state.error || _("No such file or directory")}
                selections={this.state.value}
                onSelect={(_, value) => {
                    this.setState({ value, isOpen: false });
                    this.debouncedChange(value);
                    this.props.onChange(value || '', null);
                }}
                onToggle={this.onToggle}
                onClear={this.clearSelection}
                isOpen={this.state.isOpen}
                isCreatable={this.props.isOptionCreatable}
                createText={_("Create")}
                onCreateOption={this.onCreateOption}
                menuAppendTo="parent">
                {selectOptions}
            </Select>
        );
    }
}
FileAutoComplete.propTypes = {
    id: PropTypes.string,
    placeholder: PropTypes.string,
    superuser: PropTypes.string,
    isOptionCreatable: PropTypes.bool,
    onlyDirectories: PropTypes.bool,
    onChange: PropTypes.func,
    value: PropTypes.string,
};
FileAutoComplete.defaultProps = {
    isOptionCreatable: false,
    onlyDirectories: false,
    onChange: () => '',
};
