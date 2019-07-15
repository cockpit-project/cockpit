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
import { FormGroup, HelpBlock, TypeAheadSelect } from "patternfly-react";
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
            error: null,
            hasFocus: false,
            value: '',
        };
        this.allowFilesUpdate = true;
        this.updateFiles = this.updateFiles.bind(this);
        this.finishUpdate = this.finishUpdate.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.onInputChanged = this.onInputChanged.bind(this);

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

        this.setState({
            displayFiles: listItems,
            error: error,
        });
    }

    onValueChanged(value) {
        if (value.length == 0)
            return;

        if (this.props.onChange)
            this.props.onChange(value[0].path);

        this.setState({ value: value[0].path });

        if (value[0].type == 'directory') {
            this.setState({ directory: value[0].path });
            this.updateFiles(value[0].path);
        }
    }

    onInputChanged(value) {
        if (this.props.onChange)
            this.props.onChange(value);

        this.setState({ value });

        this.debouncedChange(value);
    }

    render() {
        const placeholder = this.props.placeholder || _("Path to file");

        return (
            <FormGroup validationState={this.state.error && !this.state.hasFocus ? 'error' : undefined}>
                <TypeAheadSelect
                    id={this.props.id}
                    labelKey='path'
                    placeholder={placeholder}
                    paginate={false}
                    onChange={this.onValueChanged}
                    onInputChange={this.onInputChanged}
                    options={this.state.displayFiles}
                    onKeyDown={ev => { // Capture ESC event
                        if (ev.keyCode == 27) {
                            ev.persist();
                            ev.nativeEvent.stopImmediatePropagation();
                            ev.stopPropagation();
                        }
                    }}
                    renderMenu={(results, menuProps) => {
                        // Hide the menu when there are no results.
                        if (!results.length) {
                            return null;
                        }
                        return <TypeAheadSelect.TypeaheadMenu {...menuProps} labelKey='path' options={results} />;
                    }}
                    onFocus={() => this.setState({ hasFocus: true, error: undefined })}
                    onBlur={() => {
                        let value = this.state.value;

                        if (value.lastIndexOf('/') == value.length - 1)
                            value = value.slice(0, value.length - 1);

                        if (value && (value + '/') != this.state.directory &&
                            !this.state.displayFiles.find(file => (file.type == 'directory' ? (this.state.value + '/') : this.state.value) == file.path)) {
                            if (!this.state.error)
                                this.setState({ error: cockpit.format("No such file or directory '$0'", this.state.value) });
                        }
                        this.setState({ hasFocus: false });
                    }}
                    open={this.state.hasFocus}
                />
                { this.state.error && !this.state.hasFocus &&
                <HelpBlock>
                    <p className="text-danger">{this.state.error}</p>
                </HelpBlock> }
            </FormGroup>
        );
    }
}
FileAutoComplete.propTypes = {
    id: PropTypes.string,
    placeholder: PropTypes.string,
    superuser: PropTypes.string,
    onChange: PropTypes.func,
};
