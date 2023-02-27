/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 SUSE LLC
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

import { ConfigFile } from './config-client.js';

/* Parse an dotenv-style config file
 * and monitor it for changes
 */
export class ConfigFileSUSE extends ConfigFile {
    /* parse lines of the config file
     * if a line has a valid key=value format, use the key in _internal structure
     * and also store original line, line index, value and optional line suffix / comment
     * if value was quoted it will be stripped of quotes in `value` and `quoted` flag will
     * be used when writing the file to keep original formatting
     * e.g. for line 'someKey="foo" # comment'
     * outputObject._internal["someKey"] = {
     *      index: 0,
     *      value: "foo",
     *      quoted: true,
     *      origLine: 'someKey="foo" # comment',
     *      suffix: "# comment"
     * }
     * skipNotify: Don't notify about changes, e.g.to avoid multiple updates when writing a file
     */
    _parseText(rawContent, skipNotify = false) {
        this._dataAvailableResolve();

        // clear settings if file is empty/missing
        if (!rawContent) {
            this._originalSettings = null;
            this.settings = null;
            if (!skipNotify)
                this.dispatchEvent("kdumpConfigChanged", this.settings);
            return;
        }

        // if nothing changed, don't bother parsing the content
        if (rawContent == this._rawContent)
            return;

        this._rawContent = rawContent;

        // this is the format expected by the UI
        this.settings = {
            _internal: {},
            targets: {},
            compression: { enabled: false, allowed: true },
        };

        this._lines = rawContent.split(/\r?\n/);
        this._lines.forEach((line, index) => {
            const trimmed = line.trim();
            // if the line is empty or only a comment, skip
            if (trimmed.indexOf("#") === 0 || trimmed.length === 0)
                return;

            // parse KEY=value or KEY="value" line
            let parts = trimmed.match(/^([A-Z_]+)\s*=\s*(.*)$/);
            if (parts === null) {
                console.warn("Malformed kdump config line:", trimmed, "in", this.filename);
                return;
            }
            const key = parts[1];
            let value = parts[2];

            // value might be quoted
            let quoted = false;
            if (value.startsWith('"')) {
                quoted = true;
                parts = value.match(/^"([^"]*)"\s*(.*)$/);
                // malformed line, no ending quote?
                if (parts === null) {
                    console.warn("Incorrectly quoted value in kdump config line:", line, "in", this.filename);
                    return;
                }
            } else {
                // not quoted should be simple value but grab everything and quote on write
                parts = value.match(/^([^#]+?)\s*(#.*)?$/);
                if (parts === null)
                    parts = ["", ""];
            }
            value = parts[1];
            const suffix = (parts[2] || "").trim();

            this.settings._internal[key] = {
                index,
                value,
                origLine: line,
                quoted,
                suffix
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
        // generate target(s) from KDUMP_SAVEDIR
        if ("KDUMP_SAVEDIR" in this.settings._internal && this.settings._internal.KDUMP_SAVEDIR.value) {
            let savedir = this.settings._internal.KDUMP_SAVEDIR.value;
            // handle legacy "file" without prefix
            if (savedir.startsWith("/"))
                savedir = "file://" + savedir;
            // server includes "username:password@" and can be empty for file://
            const parts = savedir.match(/^(.*):\/\/([^/]*)(\/.*)$/);
            // malformed KDUMP_SAVEDIR
            if (parts === null) {
                console.warn("Malformed KDUMP_SAVEDIR entry:", savedir, "in", this.filename);
                return;
            }
            const [, scheme, server, path] = parts;
            if (scheme === "file") {
                this.settings.targets.local = {
                    type: "local",
                    path,
                };
            } else if (scheme === "nfs") {
                this.settings.targets.nfs = {
                    type: scheme,
                    // on read full path is used as export
                    export: path,
                    server,
                };
            } else {
                this.settings.targets[scheme] = {
                    type: scheme,
                    path,
                    server,
                };
                // sshkey is used by ssh and sftp/scp
                if ("KDUMP_SSH_IDENTITY" in this.settings._internal) {
                    this.settings.targets[scheme].sshkey =
                        this.settings._internal.KDUMP_SSH_IDENTITY.value;
                }
            }
        }

        // default to local if no target configured
        if (Object.keys(this.settings.targets).length === 0)
            this.settings.targets.local = { type: "local" };

        this.settings.compression.enabled = (
            !("KDUMP_DUMPFORMAT" in this.settings._internal) ||
            // TODO: what about other compression formats (lzo, snappy)?
            this.settings._internal.KDUMP_DUMPFORMAT.value === "compressed"
        );
    }

    /* update single _internal setting to given value
     * make sure setting exists if value is not empty
     * don't delete existing settings
     */
    _updateSetting(settings, key, value) {
        if (key in settings._internal) {
            settings._internal[key].value = value;
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

            if ("sshkey" in target)
                this._updateSetting(settings, "KDUMP_SSH_IDENTITY", target.sshkey);

            let savedir;
            // default for empty path (except nfs, see below)
            let path = target.path || "/var/crash";
            if (path && !path.startsWith("/"))
                path = "/" + path;
            if (target.type === "local") {
                savedir = "file://" + path;
            } else if (target.type === "nfs") {
                // override empty path default as nfs path is merged into export on read
                if (!target.path)
                    path = "";
                let exprt = target.export;
                if (!exprt.startsWith("/"))
                    exprt = "/" + exprt;
                savedir = "nfs://" + target.server + exprt + path;
            } else {
                savedir = target.type + "://" + target.server + path;
            }
            this._updateSetting(settings, "KDUMP_SAVEDIR", savedir);
        }
        // compression
        if (this.settings.compression.enabled != settings.compression.enabled) {
            if (settings.compression.enabled) {
                this._updateSetting(settings, "KDUMP_DUMPFORMAT", "compressed");
            } else {
                this._updateSetting(settings, "KDUMP_DUMPFORMAT", "ELF");
            }
        }
        return settings;
    }

    /* generate the config file from raw text and settings
     */
    _generateConfig(settings) {
        settings = this._persistSettings(settings);

        const lines = this._lines.slice(0);

        // we take the lines from our last read operation and modify them with the new settings
        Object.keys(settings._internal).forEach((key) => {
            const entry = settings._internal[key];

            let value = entry.value !== undefined ? entry.value : "";
            // quote what was quoted before + empty values + multi-word values
            if (entry.quoted || value === "" || value.includes(" "))
                value = '"' + value + '"';
            let line = key + "=" + value;
            if (entry.suffix)
                line = line + " " + entry.suffix;
            // this might be a new entry
            if (!(key in this._originalSettings)) {
                lines.push(line);
                return;
            }
            // otherwise edit the old line
            const origEntry = this._originalSettings[key];
            lines[origEntry.index] = line;
        });

        // make sure file ends with a newline
        if (lines[lines.length - 1] !== "")
            lines.push("");
        return lines.join("\n");
    }
}
