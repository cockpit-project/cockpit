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
import PropTypes from "prop-types";
import "./cockpit-components-file-autocomplete.css";

const _ = cockpit.gettext;

export class FileAutoComplete extends React.Component {
    constructor(props) {
        super(props);
        const value = props.value || "";
        this.updateFiles(value);
        this.state = {
            value: value,
            directory: '/',
            directoryFiles: null,
            displayFiles: [],
            open: false,
            error: null,
        };
        this.onChange = this.onChange.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onChangeCallback = this.onChangeCallback.bind(this);
        this.onBlur = this.onBlur.bind(this);
        this.updateFiles = this.updateFiles.bind(this);
        this.updateIfDirectoryChanged = this.updateIfDirectoryChanged.bind(this);
        this.finishUpdate = this.finishUpdate.bind(this);
        this.filterFiles = this.filterFiles.bind(this);
        this.showAllOptions = this.showAllOptions.bind(this);
        this.selectItem = this.selectItem.bind(this);
    }

    getDirectoryForValue(value) {
        var dir = "";
        var last;
        if (value) {
            value = value.trim();
            last = value.lastIndexOf("/");
            if (last > -1)
                dir = value.slice(0, last);
            dir += "/";
        }

        if (dir.indexOf("/") !== 0)
            dir = "/" + dir;

        return dir;
    }

    onChangeCallback(value, options) {
        if (this.props.onChange)
            this.props.onChange(value, options);
    }

    onMouseDown(ev) {
        // only consider clicks with the primary button
        if (ev && ev.button !== 0)
            return;

        if (ev.target.tagName == 'A') {
            this.setState({
                selecting: true,
            });
        }
    }

    onBlur() {
        if (this.state.selecting)
            return;

        if (this.timer)
            window.clearTimeout(this.timer);

        this.setState({
            open: false,
        });
    }

    onChange(ev) {
        var value = ev.currentTarget.value;

        if (value && value.indexOf("/") !== 0)
            value = "/" + value;

        if (this.timer)
            window.clearTimeout(this.timer);

        if (this.state.value !== value)
            this.timer = window.setTimeout(() => {
                this.timer = null;

                if (!this.updateIfDirectoryChanged(value)) {
                    var stateUpdate = this.filterFiles(value);
                    this.setState(stateUpdate);
                    this.onChangeCallback(value, { error: stateUpdate.error });
                }
            }, 250);

        this.setState({ value });
    }

    updateFiles(path) {
        var channel = cockpit.channel({ payload: "fslist1",
                                        path: path || "/",
                                        superuser: this.props.superuser });

        var results = [];
        var error = null;

        channel.addEventListener("ready", () => {
            this.finishUpdate(results, null);
        });

        channel.addEventListener("close", (ev, data) => {
            this.finishUpdate(results, error || cockpit.format(cockpit.message(data)));
        });

        channel.addEventListener("message", (ev, data) => {
            let item = JSON.parse(data);
            if (item && item.path && item.event == 'present') {
                if (item.type == "directory")
                    item.path = item.path + "/";
                results.push(item);
            }

            if (results.length > 5000) {
                error = _("Too many files found");
                channel.close();
            }
        });
    }

    updateIfDirectoryChanged(value) {
        const directory = this.getDirectoryForValue(value);
        const changed = directory !== this.state.directory;
        if (changed && this.state.directoryFiles !== null) {
            this.setState({
                displayFiles: [],
                directoryFiles: null,
                directory: directory,
                open: false,
            });
            this.updateFiles(directory);
        }
        return changed;
    }

    finishUpdate(results, error) {
        results = results.sort((a, b) => a.path.localeCompare(b.path, { sensitivity: 'base' }));

        this.onChangeCallback(this.state.value, {
            error,
        });

        this.setState({
            displayFiles: results,
            directoryFiles: results,
            error: error,
        });
    }

    filterFiles(value) {
        var inputValue = value.trim().toLowerCase();
        const dirLength = this.state.directory.length;
        var matches = [];

        inputValue = inputValue.slice(dirLength);
        const inputLength = inputValue.length;

        var error;

        if (this.state.directoryFiles !== null) {
            matches = this.state.directoryFiles.filter(v => v.path.toLowerCase().slice(0, inputLength) === inputValue);

            if (matches.length < 1)
                error = _("No matching files found");
        } else {
            error = this.state.error;
        }

        return {
            displayFiles: matches,
            open: true,
            error,
        };
    }

    showAllOptions(ev) {
        // only consider clicks with the primary button
        if (ev && ev.button !== 0)
            return;

        this.setState({
            open: !this.state.open,
            displayFiles: this.state.directoryFiles || [],
        });
    }

    selectItem(ev) {
        // only consider clicks with the primary button
        if (ev && ev.button !== 0)
            return;

        if (ev.target.tagName == 'A') {
            var value = ev.target.innerText;
            var directory = this.state.directory || "/";

            if (directory.charAt(directory.length - 1) !== '/')
                directory = directory + "/";

            value = directory + value;
            this.setState({
                open: false,
                value: value,
                selecting: false,
            });

            this.onChangeCallback(value, {
                error: this.state.error,
            });

            this.refs.input.focus();
            this.updateIfDirectoryChanged(value);
        }
    }

    renderError(error) {
        return (
            <li key="error" className="alert alert-warning">
                {error}
            </li>
        );
    }

    render() {
        const placeholder = this.props.placeholder || _("Path to file");
        var controlClasses = "form-control-feedback ";
        var classes = "input-group";
        if (this.state.open)
            classes += " open";

        if (this.state.directoryFiles === null)
            controlClasses += "spinner spinner-xs spinner-inline";
        else
            controlClasses += "caret";

        var listItems;

        if (this.state.error) {
            listItems = [this.renderError(this.state.error)];
            classes += " error";
        } else {
            listItems = this.state.displayFiles.map(file => (
                <li className={file.type} key={file.path}>
                    <a tabIndex="0" data-type={file.type}>{file.path}</a>
                </li>
            ));
        }

        return (
            <div className="combobox-container file-autocomplete-ct" id={this.props.id}>
                <div className={classes}>
                    <input ref="input" autoComplete="false" placeholder={placeholder} className="combobox form-control" type="text" onChange={this.onChange} value={this.state.value} onBlur={this.onBlur} />
                    <span onClick={this.showAllOptions} className={controlClasses} />
                    <ul onMouseDown={this.onMouseDown} onClick={this.selectItem} className="typeahead typeahead-long dropdown-menu">
                        {listItems}
                    </ul>
                </div>
            </div>
        );
    }
}
FileAutoComplete.propTypes = {
    id: PropTypes.string,
    placeholder: PropTypes.string,
    value: PropTypes.string,
    superuser: PropTypes.string,
    onChange: PropTypes.func,
};
