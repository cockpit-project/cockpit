/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

import cockpit from 'cockpit';

/* Parse an ini-style config file
 * and monitor it for changes
 */
export class ConfigFile {
    constructor(filename, superuser = false) {
        this.filename = filename;
        this._rawContent = undefined;
        this._lines = [];
        this._originalSettings = { };
        this._dataAvailable = new Promise(resolve => { this._dataAvailableResolve = resolve });
        this.settings = { };

        cockpit.event_target(this);

        this._fileHandle = cockpit.file(filename, { superuser: superuser });
        this._fileHandle.watch((rawContent) => {
            this._parseText(rawContent);
        });
    }

    close() {
        if (this._fileHandle) {
            this._fileHandle.close();
            this._fileHandle = undefined;
        }
    }

    // wait for data to have been read at least once
    wait() {
        return this._dataAvailable;
    }

    /* parse lines of the config file
     * if a line has a valid config key, use that as key
     * and also store original line, line index, value and whether the line contains a comment
     * we care about the comment since we don't want to overwrite a user comment when changing a value
     * e.g. for line "someKey foo # comment"
     * outputObject["someKey"] = { index: 0, value: "foo", origLine: "someKey foo # comment", hasComment: true }
     * skipNotify: Don't notify about changes, e.g.to avoid multiple updates when writing a file
     */
    _parseText(rawContent, skipNotify = false) {
        this._dataAvailableResolve();

        // if nothing changed, don't bother parsing the content
        // do proceed if the content is empty, it might be our initial read
        if (!rawContent) {
            this._originalSettings = null;
            this.settings = null;
            if (!skipNotify)
                this.dispatchEvent("alarmsConfigFileChanged", this.settings);
            return;
        }

        if (rawContent == this._rawContent)
            return;

        this._rawContent = rawContent;
        // parse the config file
        this._lines = rawContent.split(/\r?\n/);

        // this is the format expected by the UI
        this.settings = {
            _internal: {},
        };
        this._lines.forEach((line, index) => {
            const trimmed = line.trim();
            // if the line is empty or only a comment, skip
            if (trimmed.indexOf("#") === 0 || trimmed.length === 0)
                return;

            // we need to have a space between key and value
            const separatorIndex = trimmed.indexOf(" ");
            if (separatorIndex === -1)
                return;
            const key = trimmed.substring(0, separatorIndex);
            let value = trimmed.substring(separatorIndex + 1).trim();

            // value might have a comment at the end
            const commentIndex = value.indexOf("#");
            let comment;
            if (commentIndex !== -1) {
                comment = value.substring(commentIndex).trim();
                value = value.substring(0, commentIndex).trim();
            }
            this.settings._internal[key] = {
                index: index,
                value: value,
                origLine: line,
                comment: comment
            };
        });

        // make sure we copy the original keys so we overwrite the correct lines when saving
        this._originalSettings = { };
        Object.keys(this.settings._internal).forEach((key) => {
            this._originalSettings[key] = { ...this.settings._internal[key] };
        });
        // console.log(this.settings._internal);
        if (!skipNotify)
            this.dispatchEvent("alarmsConfigFileChanged", this.settings);
    }

    /* update the config file from raw text and settings
     */
    _updateConfigFile(settings) {
        const lines = this._lines.slice(0);

        // we take the lines from our last read operation and modify them with the new settings
        Object.keys(settings).forEach((key) => {
            const entry = settings[key];
            const line = key + " " + entry.value;
            // this might be a new entry
            if (key in this._originalSettings) {
                // update the configuration in memory data
                const origEntry = this._originalSettings[key];
                lines[origEntry.index] = line;
                // lines.push(line);
            }
        });

        return lines.join("\n") + "\n";
    }

    getConfig() {
        return this.settings;
    }

    /* write settings back to file
     * new settings that don't have a corresponding entry already have an undefined or null index
     * returns a promise for the file operation (cockpit File)
     */
    write(settings) {
        return this._fileHandle.modify((oldContent) => {
            this._parseText(oldContent, true);
            return this._updateConfigFile(settings);
        });
    }
}
