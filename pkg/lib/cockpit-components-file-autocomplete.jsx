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
import { Select, SelectVariant, SelectOption } from "@patternfly/react-core";
import PropTypes from "prop-types";
import { debounce } from 'throttle-debounce';

const _ = cockpit.gettext;

export class FileAutoComplete extends React.Component {
    constructor(props) {
        super(props);
        this.updateFiles(props.value || "/");
        this.state = {
            directory: '', // The current directory we list files/dirs from
            displayFiles: [],
            isOpen: false,
        };
        this.allowFilesUpdate = true;
        this.updateFiles = this.updateFiles.bind(this);
        this.finishUpdate = this.finishUpdate.bind(this);
        this.onFilter = this.onFilter.bind(this);
        this.onToggle = this.onToggle.bind(this);
        this.clearSelection = this.clearSelection.bind(this);

        this.debouncedChange = debounce(300, (value) => {
            const cb = (dirPath) => this.updateFiles(dirPath == '' ? '/' : dirPath);

            const parentDir = value.slice(0, value.lastIndexOf('/'));

            if (parentDir + '/' == this.state.directory) {
                // If the inserted string corresponds to a directory listed in the results
                // update the current directory and refetch results
                let path = value;
                if (value.lastIndexOf('/') == value.length - 1)
                    path = value.slice(0, value.length - 1);

                if (this.state.displayFiles
                        .filter(entry => entry.type == 'directory')
                        .find(entry => entry.path == path + '/')) {
                    this.setState({ directory: path + '/' });
                    cb(path);
                }
            } else {
                this.setState({ directory: parentDir + '/' });
                cb(parentDir);
            }
        });
    }

    componentWillUnmount() {
        this.allowFilesUpdate = false;
    }

    updateFiles(path) {
        var channel = cockpit.channel({
            payload: "fslist1",
            path,
            superuser: this.props.superuser
        });
        var results = [];
        var error = null;

        channel.addEventListener("ready", () => {
            this.finishUpdate(results, null);
        });

        channel.addEventListener("close", (ev, data) => {
            this.finishUpdate(results, error || cockpit.format(cockpit.message(data)));
        });

        channel.addEventListener("message", (ev, data) => {
            const item = JSON.parse(data);
            if (item && item.path && item.event == 'present') {
                item.path = item.path + (item.type == 'directory' ? '/' : '');
                results.push(item);
            }
        });
    }

    finishUpdate(results, error) {
        if (!this.allowFilesUpdate)
            return;
        results = results.sort((a, b) => a.path.localeCompare(b.path, { sensitivity: 'base' }));

        const listItems = results.map(file => ({
            type: file.type,
            path: (this.state.directory == '' ? '/' : this.state.directory) + file.path
        }));

        const currentDir = this.state.value && this.state.directory === this.state.value.path;
        if (this.state.directory && !error && !currentDir) {
            listItems.unshift({
                type: "directory",
                path: this.state.directory
            });
        }

        this.setState({
            displayFiles: listItems,
            error: error,
        });
    }

    onFilter(event) {
        if (event.target.value == "" || (event.target.value && event.target.value.slice(-1) == "/")) {
            this.setState({ directory: event.target.value || "/" });
            this.updateFiles(event.target.value || "/");
        }

        const res = event.target.value !== '' ? this.state.displayFiles.filter(file => file.path.startsWith(event.target.value)) : this.state.displayFiles;
        return res.map(option => (
            <SelectOption key={option.path}
                          className={option.type}
                          value={{
                              ...option,
                              toString: function() { return this.path },
                          }} />
        ));
    }

    onToggle(isOpen) {
        this.setState({ isOpen });
    }

    clearSelection() {
        this.updateFiles("/");
        this.setState({
            directory: "",
            value: null,
            isOpen: false
        });
    }

    render() {
        const placeholder = this.props.placeholder || _("Path to file");
        let noResultsFoundText = _("No such file or directory");
        if (this.state.value && this.state.value.type === 'directory') {
            if (this.state.displayFiles.length === 0)
                noResultsFoundText = _("This directory is empty");
            else
                noResultsFoundText = cockpit.format(_("No such file found in directory '$0'"), this.state.value.path);
        }

        return (
            <Select
                variant={SelectVariant.typeahead}
                id={this.props.id}
                placeholderText={placeholder}
                noResultsFoundText={noResultsFoundText}
                onFilter={this.onFilter}
                selections={this.state.value}
                onSelect={(event, value) => {
                    const stateDelta = { value };
                    if (value.type == 'file')
                        stateDelta.isOpen = false;
                    this.setState(stateDelta);
                    this.onFilter({ target: { value: value.path } });
                    this.props.onChange && this.props.onChange(value.path);
                }}
                onToggle={this.onToggle}
                onClear={this.clearSelection}
                isOpen={this.state.isOpen}>
                {this.state.displayFiles.map((option, index) => (
                    <SelectOption key={option.path}
                                  className={option.type}
                                  value={{
                                      ...option,
                                      toString: function() { return this.path },
                                  }} />
                ))}
            </Select>
        );
    }
}
FileAutoComplete.propTypes = {
    id: PropTypes.string,
    placeholder: PropTypes.string,
    superuser: PropTypes.string,
    onChange: PropTypes.func,
};
