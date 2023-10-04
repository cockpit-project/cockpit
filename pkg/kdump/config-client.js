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

const deprecatedKeys = ["net", "options", "link_delay", "disk_timeout", "debug_mem_level", "blacklist"];
const knownKeys = [
    "raw", "nfs", "ssh", "sshkey", "path", "core_collector", "kdump_post", "kdump_pre", "extra_bins", "extra_modules",
    "default", "force_rebuild", "override_resettable", "dracut_args", "fence_kdump_args", "fence_kdump_nodes"
];
// man kdump.conf suggests this as default configuration
const defaultCoreCollector = "makedumpfile -l --message-level 7 -d 31";

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

        this._fileHandle = cockpit.file(filename, { superuser });
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
                this.dispatchEvent("kdumpConfigChanged", this.settings);
            return;
        }

        if (rawContent == this._rawContent)
            return;

        // if (skipNotify === undefined)
        //    skipNotify = false;

        this._rawContent = rawContent;
        // parse the config file
        this._lines = rawContent.split(/\r?\n/);

        // this is the format expected by the UI
        this.settings = {
            _internal: {},
            targets: {},
            compression: { enabled: false, allowed: false, },
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
                index,
                value,
                origLine: line,
                comment
            };
        });

        // make sure we copy the original keys so we overwrite the correct lines when saving
        this._originalSettings = { };
        Object.keys(this.settings._internal).forEach((key) => {
            this._originalSettings[key] = { ...this.settings._internal[key] };
        });

        this._extractSettings();

        if (!skipNotify)
            this.dispatchEvent("kdumpConfigChanged", this.settings);
    }

    /* extract settings managed by cockpit from _internal into platform independent model
     */
    _extractSettings() {
        // "path" applies to all targets
        const path = this.settings._internal.path || { value: "" };

        Object.keys(this.settings._internal).forEach((key) => {
            if (key === "nfs") {
                // split nfs line into server and export parts
                const parts = this.settings._internal.nfs.value.match(/^([^[][^:]+|\[[^\]]+\]):(.*)$/);
                if (!parts)
                    return;
                this.settings.targets.nfs = {
                    type: key,
                    path: path.value,
                    server: parts[1],
                    export: parts[2],
                };
            } else if (key === "ssh") {
                this.settings.targets.ssh = {
                    type: key,
                    path: path.value,
                    server: this.settings._internal.ssh.value,
                };
                if ("sshkey" in this.settings._internal)
                    this.settings.targets.ssh.sshkey = this.settings._internal.sshkey.value;
            } else if (key === "raw") {
                this.settings.targets.raw = {
                    type: key,
                    partition: this.settings._internal.raw.value
                };
            } else {
                // probably local, but we might also have a mount
                // check against known keys, the ones left over may be a mount target
                // if the key is empty or known, we don't care about it here
                if (!key || key in knownKeys || key in deprecatedKeys)
                    return;
                // if we have a UUID, LABEL or /dev in the value, we can be pretty sure it's a mount option
                const value = JSON.stringify(this.settings._internal[key]).toLowerCase();
                if (value.indexOf("uuid") > -1 || value.indexOf("label") > -1 || value.indexOf("/dev") > -1) {
                    this.settings.targets.mount = {
                        type: "mount",
                        path: path.value,
                        fsType: key,
                        partition: this.settings._internal[key].value,
                    };
                } else {
                    // TODO: check for know filesystem types here
                }
            }
        });

        // default to local if no target configured
        if (Object.keys(this.settings.targets).length === 0)
            this.settings.targets.local = { type: "local", path: path.value };

        // only allow compression if there is no core collector set or it's set to makedumpfile
        this.settings.compression.allowed = (
            !("core_collector" in this.settings._internal) ||
            (this.settings._internal.core_collector.value.trim().indexOf("makedumpfile") === 0)
        );
        // compression is enabled if we have a core_collector command with the "-c" parameter
        this.settings.compression.enabled = (
            ("core_collector" in this.settings._internal) &&
            this.settings._internal.core_collector.value &&
            (this.settings._internal.core_collector.value.split(" ").indexOf("-c") != -1)
        );
    }

    /* update single _internal setting to given value
     * make sure setting exists if value is not empty
     */
    _updateSetting(settings, key, value) {
        if (key in settings._internal) {
            if (value)
                settings._internal[key].value = value;
            else
                delete settings._internal[key];
        } else {
            if (value)
                settings._internal[key] = { value };
        }
    }

    /* transform settings from model back to _internal format
     * this.settings = current state from file
     * settings = in-memory state from UI
     */
    _persistSettings(settings) {
        // target
        if (Object.keys(settings.targets).length > 0) {
            const target = Object.values(settings.targets)[0];
            this._updateSetting(settings, "path", target.path);

            // wipe old target settings
            for (const key in this.settings.targets) {
                const oldTarget = this.settings.targets[key];
                if (oldTarget.type == "mount") {
                    delete settings._internal[oldTarget.fsType];
                } else if (oldTarget.type == "ssh") {
                    delete settings._internal.ssh;
                    delete settings._internal.sshkey;
                } else {
                    delete settings._internal[key];
                }
            }

            if (target.type === "nfs") {
                this._updateSetting(settings, "nfs", [target.server, target.export].join(":"));
            } else if (target.type === "ssh") {
                this._updateSetting(settings, "ssh", target.server);
                if ("sshkey" in target)
                    this._updateSetting(settings, "sshkey", target.sshkey);
            } else if (target.type === "raw") {
                this._updateSetting(settings, "raw", target.partition);
            } else if (target.type === "mount") {
                this._updateSetting(settings, target.fsType, target.partition);
            }

            /* ssh target needs a flattened vmcore for transport */
            if ("core_collector" in settings._internal &&
                settings._internal.core_collector.value.includes("makedumpfile")) {
                if (target.type === "ssh" && !settings._internal.core_collector.value.includes("-F"))
                    settings._internal.core_collector.value += " -F";
                else if (settings._internal.core_collector.value.includes("-F"))
                    settings._internal.core_collector.value =
                        settings._internal.core_collector.value
                                .split(" ")
                                .filter(e => e != "-F")
                                .join(" ");
            } else {
                settings._internal.core_collector = { value: defaultCoreCollector };
                if (target.type === "ssh") {
                    settings._internal.core_collector.value += " -F";
                }
            }
        }
        // compression
        if (this.settings.compression.enabled != settings.compression.enabled) {
            if (settings.compression.enabled) {
                // enable compression
                if ("core_collector" in settings._internal)
                    settings._internal.core_collector.value = settings._internal.core_collector.value + " -c";
                else
                    settings._internal.core_collector = { value: defaultCoreCollector };
            } else {
                // disable compression
                if ("core_collector" in this.settings._internal) {
                    // just remove all "-c" parameters
                    settings._internal.core_collector.value =
                        settings._internal.core_collector.value
                                .split(" ")
                                .filter((e) => { return (e != "-c") })
                                .join(" ");
                } else {
                    // if we don't have anything on this in the original settings,
                    // we can get rid of the entry altogether
                    delete settings._internal.core_collector;
                }
            }
        }
        return settings;
    }

    /* generate the config file from raw text and settings
     */
    _generateConfig(settings) {
        settings = this._persistSettings(settings);

        const lines = this._lines.slice(0);
        const linesToDelete = [];
        // first find the settings lines that have been disabled/deleted
        Object.keys(this._originalSettings).forEach((key) => {
            if (!(key in settings._internal) || !(key in settings._internal && settings._internal[key].value)) {
                const origEntry = this._originalSettings[key];
                // if the line had a comment, keep it, otherwise delete
                if (origEntry.comment !== undefined)
                    lines[origEntry.index] = "#" + origEntry.origLine;
                else
                    linesToDelete.push(origEntry.index);
            }
        });

        // we take the lines from our last read operation and modify them with the new settings
        Object.keys(settings._internal).forEach((key) => {
            const entry = settings._internal[key];
            let line = key + " " + entry.value;
            if (entry.comment)
                line = line + " " + entry.comment;
            // this might be a new entry
            if (!(key in this._originalSettings)) {
                lines.push(line);
                return;
            }
            // otherwise edit the old line
            const origEntry = this._originalSettings[key];
            lines[origEntry.index] = line;
        });
        // now delete the rows we want to delete
        linesToDelete.sort().reverse()
                .forEach((lineIndex) => {
                    lines.splice(lineIndex, 1);
                });

        return lines.join("\n") + "\n";
    }

    /* write settings back to file
     * new settings that don't have a corresponding entry already have an undefined or null index
     * returns a promise for the file operation (cockpit File)
     */
    write(settings) {
        return this._fileHandle.modify((oldContent) => {
            this._parseText(oldContent, true);
            return this._generateConfig(settings);
        });
    }
}
