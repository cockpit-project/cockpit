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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import { Select, SelectOption } from "@patternfly/react-core/dist/esm/deprecated/components/Select/index.js";
import PropTypes from "prop-types";
import { debounce } from 'throttle-debounce';

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
        this.debouncedChange = debounce(300, this.onPathChange);
        this.onPathChange(this.state.value);
    }

    componentWillUnmount() {
        this.allowFilesUpdate = false;
    }

    onCreateOption(newValue) {
        this.setState(prevState => ({
            displayFiles: [...prevState.displayFiles, { type: "file", path: newValue }]
        }));
    }

    updateFiles(path) {
        if (this.state.directory == path)
            return;

        const channel = cockpit.channel({
            payload: "fslist1",
            path,
            superuser: this.props.superuser,
            watch: false,
        });
        const results = [];

        channel.addEventListener("ready", () => {
            this.finishUpdate(results, null, path);
        });

        channel.addEventListener("close", (ev, data) => {
            this.finishUpdate(results, data.message, path);
        });

        channel.addEventListener("message", (ev, data) => {
            const item = JSON.parse(data);
            if (item && item.path && item.event == 'present') {
                item.path = item.path + (item.type == 'directory' ? '/' : '');
                results.push(item);
            }
        });
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
    onChange: PropTypes.func,
    value: PropTypes.string,
};
FileAutoComplete.defaultProps = {
    isOptionCreatable: false,
    onChange: () => '',
};
