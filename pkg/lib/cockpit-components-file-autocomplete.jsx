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

"use strict";

var cockpit = require("cockpit");
var React = require("react");
var _ = cockpit.gettext;
require("./cockpit-components-file-autocomplete.css");

var FileAutoComplete = React.createClass({
    getInitialState () {
        var value = this.props.value || "";
        this.updateFiles(value);
        return {
            value: value,
            directory: '/',
            directoryFiles: null,
            displayFiles: [],
            open: false,
            error: null,
        };
    },

    getDirectoryForValue: function(value) {
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
    },

    onChange: function(value) {
        if (value && value.indexOf("/") !== 0)
            value = "/" + value;

        if (!this.updateIfDirectoryChanged(value));
            this.filterFiles(value);

        this.setState({
            value: value,
        });
    },

    delayedOnChange: function(ev) {
        var self = this;
        var value = ev.currentTarget.value;
        if (this.timer)
            window.clearTimeout(this.timer);

        this.timer = window.setTimeout(function () {
            self.onChange(value);
            self.timer = null;
        }, 250);
    },

    updateFiles: function(path) {
        var self = this;
        var channel = cockpit.channel({ payload: "fslist1",
                                        path: path || "/",
                                        superuser: this.props.superuser });

        var results = [];
        var error = null;

        channel.addEventListener("ready", function () {
            self.finishUpdate(results, null);
        });

        channel.addEventListener("close", function (ev, data) {
            self.finishUpdate(results, error || data);
        });

        channel.addEventListener("message", function (ev, data) {
            var item = JSON.parse(data);
            if (item && item.path) {
                if (item.type == "directory")
                    item.path = item.path + "/";
                results.push(item);
            }


            if (results.length > 5000) {
                error = _("Too many files found");
                channel.close();
            }
        });
    },

    updateIfDirectoryChanged: function(value) {
        var directory = this.getDirectoryForValue(value);
        var changed = directory !== this.state.directory;
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
    },

    finishUpdate: function(result, error) {
        result = result.sort(function(a, b) {
            return a.path.localeCompare(b.path,
                                        { sensitivity: 'base'});
        });

        this.setState({
            displayFiles: result,
            directoryFiles: result,
            error: error,
        });
    },

    filterFiles: function(value) {
        var inputValue = value.trim().toLowerCase();
        var dirLength = this.state.directory.length;
        var matches = [];
        var inputLength;

        inputValue = inputValue.slice(dirLength);
        inputLength = inputValue.length;

        if (this.state.directoryFiles !== null) {
            matches = this.state.directoryFiles.filter(function (v) {
                return v.path.toLowerCase().slice(0, inputLength) === inputValue;
            });
        }

        this.setState({
            displayFiles: matches,
            open: true,
        });
    },

    showAllOptions: function (ev) {
        // only consider clicks with the primary button
        if (ev && ev.button !== 0)
            return;

        this.setState({
            open: !this.state.open,
            displayFiles: this.state.directoryFiles || [],
        });
    },

    selectItem: function (ev) {
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
                value: value
            });
            this.updateIfDirectoryChanged(value);
        }
    },

    renderError: function(error) {
        return (
            <li className="alert alert-warning">
                {error}
            </li>
        );
    },

    render: function() {
        var placeholder = this.props.placeholder || _("Path to file");
        var controlClasses = "form-control-feedback ";
        var classes = "input-group";
        if (this.state.open)
            classes += " open";

        if (this.state.directoryFiles === null)
            controlClasses += "spinner spinner-xs spinner-inline";
        else
            controlClasses += "caret";

        var listItems, error;
        if (this.state.error)
            error = cockpit.format(cockpit.message(this.state.error));
        else if (this.state.directoryFiles && this.state.displayFiles.length < 1)
            error = _("No matching files found");

        if (error) {
            listItems = [this.renderError(error)];
            classes += " error"
        } else {
            listItems = React.Children.map(this.state.displayFiles, function(file) {
                return <li className={file.type}><a data-type={file.type}>{file.path}</a></li>;
            });
        }

        return (
            <div className="combobox-container" id={this.props.id}>
                <div className={classes}>
                    <input autocomplete="false" placeholder={placeholder} className="combobox form-control" type="text" onChange={this.delayedOnChange} value={this.state.value} />
                    <span onClick={this.showAllOptions} className={controlClasses}></span>
                    <ul onClick={this.selectItem} className="typeahead typeahead-long dropdown-menu">
                        {listItems}
                    </ul>
                </div>
            </div>
        );
    }
});

module.exports = {
    FileAutoComplete: FileAutoComplete,
};
