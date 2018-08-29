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

import OnOffSwitch from "cockpit-components-onoff.jsx";
import * as Select from "cockpit-components-select.jsx";
import { install_dialog } from "cockpit-components-install-dialog.jsx";

const _ = cockpit.gettext;

function debug() {
    if (window.debugging == "all" || window.debugging == "packagekit")
        console.debug.apply(console, arguments);
}

/**
 * Package manager specific implementations; PackageKit does not cover
 * automatic updates , so we have to implement dnf-automatic, yum-cron, and
 * unattended-upgrades configuration ourselves
 */

class ImplBase {
    constructor() {
        this.supported = true; // false if system was customed in a way that we cannot parse
        this.enabled = null; // boolean
        this.type = null; // "all" or "security"
        this.day = null; // systemd.time(7) day of week (e. g. "mon"), or empty for daily
        this.time = null; // systemd.time(7) time (e. g. "06:00") or empty for "any time"
        this.installed = null; // boolean
        this.packageName = null; // name of the package providing automatic updates
    }

    // Init data members. Return a promise that resolves when done.
    getConfig() {
        throw new Error("abstract method");
    }

    // Update configuration for given non-null values, and update member variables on success;
    // return a promise that resolves when done, or fails when configuration writing fails
    setConfig(enabled, type, day, time) {
        throw new Error("abstract method", enabled, type, day, time);
    }
}

class DnfImpl extends ImplBase {
    getConfig() {
        let dfd = cockpit.defer();
        this.packageName = "dnf-automatic";

        // - dnf has two ways to enable automatic updates: Either by enabling dnf-automatic-install.timer
        //   or by setting "apply_updates = yes" in the config file and enabling dnf-automatic.timer
        // - the config file determines whether to apply security updates only
        // - by default this runs every day (OnUnitInactiveSec=1d), but the timer can be changed with a timer unit
        //   drop-in, so get the last line
        cockpit.script("if rpm -q " + this.packageName + " >/dev/null; then echo installed; fi; " +
                       "if systemctl --quiet is-enabled dnf-automatic-install.timer 2>/dev/null || " +
                       "  (systemctl --quiet is-enabled dnf-automatic.timer 2>/dev/null && grep -q '^[ \t]*apply_updates[ \t]*=[ \t]*yes' " +
                       "    /etc/dnf/automatic.conf); then echo enabled; fi; " +
                       "if grep -q '^[ \\t]*upgrade_type[ \\t]*=[ \\t]*security' /etc/dnf/automatic.conf; then echo security; fi; " +
                       "systemctl cat dnf-automatic-install.timer dnf-automatic.timer 2>/dev/null| grep '^OnUnitInactiveSec= *[^ ]' | tail -n1; " +
                       "systemctl cat dnf-automatic-install.timer dnf-automatic.timer 2>/dev/null| grep '^OnCalendar= *[^ ]' | tail -n1; ",
                       [], { err: "message" })
                .done(output => {
                    this.installed = (output.indexOf("installed\n") >= 0);
                    this.enabled = (output.indexOf("enabled\n") >= 0);
                    this.type = (output.indexOf("security\n") >= 0) ? "security" : "all";

                    // if we have OnCalendar=, use that (we disable OnUnitInactiveSec= in our drop-in)
                    let calIdx = output.indexOf("OnCalendar=");
                    if (calIdx >= 0) {
                        this.parseCalendar(output.substr(calIdx).split('\n')[0].split("=")[1]);
                    } else {
                        if (output.indexOf("InactiveSec=1d\n") >= 0)
                            this.day = this.time = "";
                        else
                            this.supported = false;
                    }

                    debug(`dnf getConfig: supported ${this.supported}, enabled ${this.enabled}, type ${this.type}, day ${this.day}, time ${this.time}, installed ${this.installed}; raw response '${output}'`);
                    dfd.resolve();
                })
                .fail(error => {
                    console.error("dnf getConfig failed:", error);
                    this.supported = false;
                    dfd.resolve();
                });

        return dfd.promise();
    }

    parseCalendar(spec) {
        // see systemd.time(7); we only support what we write, otherwise we treat it as custom config and "unsupported"
        const daysOfWeek = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
        // TODO: allow arbitrary minutes once we support that in the UI widget
        const validTime = /^((|0|1)[0-9]|2[0-3]):00$/;

        var words = spec.trim().toLowerCase()
                .split(/\s+/);

        // check if we have a day of week
        if (daysOfWeek.indexOf(words[0]) >= 0)
            this.day = words.shift();
        else
            this.day = ""; // daily

        // now there should only be a time left
        if (words.length == 1 && validTime.test(words[0]))
            this.time = words[0].replace(/^0+/, "");
        else
            this.supported = false;
    }

    setConfig(enabled, type, day, time) {
        const timerConf = "/etc/systemd/system/dnf-automatic-install.timer.d/time.conf";
        var script = "set -e; ";

        if (type !== null) {
            let value = (type == "security") ? "security" : "default";

            // normally upgrade_type = should already be in the file, so replace that line;
            // if it's not already present, append it to the file
            script += "sed -i '/\\bupgrade_type\\b[ \\t]*=/ { h; s/^.*$/upgrade_type = " + value + "/ }; " +
                      "$ { x; /^$/ { s//upgrade_type = " + value + "/; H }; x }' /etc/dnf/automatic.conf; ";
        }

        // if we enable through Cockpit, make sure that starting the timer doesn't start the .service right away,
        // due to the packaged default OnBootSec=1h; just set a reasonable initial time which will trigger the code below
        if (enabled && !this.enabled && !this.time && !this.day)
            time = "6:00";

        if (time !== null || day !== null) {
            if (day === "" && time === "") {
                // restore defaults
                script += "rm -f " + timerConf + "; ";
            } else {
                if (day == null)
                    day = this.day;
                if (time == null)
                    time = this.time;
                script += "mkdir -p /etc/systemd/system/dnf-automatic-install.timer.d; ";
                script += "printf '[Timer]\\nOnBootSec=\\nOnCalendar=" + day + " " + time + "\\n' > " + timerConf + "; ";
                script += "systemctl daemon-reload; ";
            }
        }

        if (enabled !== null) {
            const rebootConf = "/etc/systemd/system/dnf-automatic-install.service.d/autoreboot.conf";

            script += "systemctl " + (enabled ? "enable" : "disable") + " --now dnf-automatic-install.timer; ";

            if (enabled) {
                // HACK: enable automatic reboots after updating; dnf-automatic does not leave a log file behind for
                // deciding whether it actually installed anything, so resort to grepping the journal for the last run
                // (https://bugzilla.redhat.com/show_bug.cgi?id=1491190)
                script += "mkdir -p /etc/systemd/system/dnf-automatic-install.service.d; ";
                script += "printf '[Service]\\nExecStartPost=/bin/sh -ec \"" +
                          "if systemctl status --no-pager --lines=100 dnf-automatic-install.service| grep -q ===========$$; then " +
                          "shutdown -r +5 rebooting after applying package updates; fi\"\\n' > " + rebootConf + "; ";
                script += "systemctl daemon-reload; ";
            } else {
                // also make sure that the legacy unit name is disabled; this can fail if the unit does not exist
                script += "systemctl disable --now dnf-automatic.timer 2>/dev/null || true; ";
                script += "rm -f " + rebootConf + "; ";
            }
        }

        debug(`setConfig(${enabled}, "${type}", "${day}", "${time}"): script "${script}"`);

        let dfd = cockpit.defer();
        cockpit.script(script, [], { superuser: "require" })
                .done(() => {
                    debug("dnf setConfig: configuration updated successfully");
                    if (enabled !== null)
                        this.enabled = enabled;
                    if (type !== null)
                        this.type = type;
                    if (day !== null)
                        this.day = day;
                    if (time !== null)
                        this.time = time;
                    dfd.resolve();
                })
                .fail(error => {
                    console.error("dnf setConfig failed:", error);
                    dfd.reject(error);
                });

        return dfd.promise();
    }
}

// Returns a promise for instantiating "backend"; this will never fail, if
// automatic updates are not supported, backend will be null.
function getBackend(forceReinit) {
    if (!getBackend.promise || forceReinit) {
        debug("getBackend() called first time or forceReinit passed, initializing promise");
        let dfd = cockpit.defer();
        getBackend.promise = dfd.promise();

        cockpit.script(["command -v dnf yum apt | head -n1 | xargs basename"], [], { err: "message" })
                .done(output => {
                    output = output.trim();
                    debug("getBackend(): detection finished, output", output);
                    let backend;
                    if (output === "dnf")
                        backend = new DnfImpl();
                    // yum-cron is too limited: neither auto-reboot nor customized time, and nowhere to hook them in
                    // TODO: apt backend
                    if (backend)
                        backend.getConfig().then(() => {
                            if (!backend.installed)
                                dfd.resolve(backend);
                            else
                                dfd.resolve(backend.supported ? backend : null);
                        });
                    else
                        dfd.resolve(null);
                })
                .fail(error => {
                // the detection shell script is supposed to always succeed
                    console.error("automatic updates getBackend() detection failed:", error);
                    dfd.resolve(null);
                });
    }

    return getBackend.promise;
}

/**
 * Main React component
 *
 * Properties:
 * onInitialized(enabled): (optional): callback once backend knowsn whether automatic updates are enabled
 */
export default class AutoUpdates extends React.Component {
    constructor() {
        super();
        this.state = { backend: null, pending: false, pendingEnable: null };
        this.initializeBackend();
    }

    initializeBackend(forceReinit) {
        let dfd = cockpit.defer();
        getBackend(forceReinit).then(b => {
            this.setState({ backend: b }, () => {
                this.debugBackendState("AutoUpdates: backend initialized");
                dfd.resolve();
            });
            if (this.props.onInitialized)
                this.props.onInitialized(b ? b.enabled : null);
        });
        return dfd.promise;
    }

    debugBackendState(prefix) {
        if (this.state.backend)
            debug(`${prefix}: state is (${this.state.backend.enabled}, ${this.state.backend.type}, ${this.state.backend.day}, ${this.state.backend.time})`);
    }

    handleChange(enabled, type, day, time) {
        this.debugBackendState(`handleChange(${enabled}, ${type}, ${day}, ${time})`);
        this.setState({ pending: true, pendingEnable: enabled });
        this.state.backend.setConfig(enabled, type, day, time)
                .always(() => {
                    this.debugBackendState("handleChange: setConfig finished");
                    this.setState({ pending: false, pendingEnable: null });
                });
    }

    render() {
        var backend = this.state.backend;
        if (!backend)
            return null;

        var autoConfig;

        if (backend.enabled && backend.installed) {
            let hours = Array.from(Array(24).keys());

            autoConfig = (
                <div className="auto-conf">
                    <span className="auto-conf-group">
                        <Select.Select id="auto-update-type" enabled={!this.state.pending} initial={backend.type}
                                       onChange={ t => this.handleChange(null, t, null, null) }>
                            <Select.SelectEntry data="all">{_("Apply all updates")}</Select.SelectEntry>
                            <Select.SelectEntry data="security">{_("Apply security updates")}</Select.SelectEntry>
                        </Select.Select>
                    </span>

                    <span className="auto-conf-group">
                        <Select.Select id="auto-update-day" enabled={!this.state.pending} initial={backend.day}
                                       onChange={ d => this.handleChange(null, null, d, null) }>
                            <Select.SelectEntry data="">{_("every day")}</Select.SelectEntry>
                            <Select.SelectEntry data="mon">{_("on Mondays")}</Select.SelectEntry>
                            <Select.SelectEntry data="tue">{_("on Tuesdays")}</Select.SelectEntry>
                            <Select.SelectEntry data="wed">{_("on Wednesdays")}</Select.SelectEntry>
                            <Select.SelectEntry data="thu">{_("on Thursdays")}</Select.SelectEntry>
                            <Select.SelectEntry data="fri">{_("on Fridays")}</Select.SelectEntry>
                            <Select.SelectEntry data="sat">{_("on Saturdays")}</Select.SelectEntry>
                            <Select.SelectEntry data="sun">{_("on Sundays")}</Select.SelectEntry>
                        </Select.Select>
                    </span>

                    <span className="auto-conf-group">
                        <span className="auto-conf-text">{_("at")}</span>

                        <Select.Select id="auto-update-time" enabled={!this.state.pending} initial={backend.time}
                                       onChange={ t => this.handleChange(null, null, null, t) }>
                            { hours.map(h => <Select.SelectEntry data={h + ":00"}>{('0' + h).slice(-2) + ":00"}</Select.SelectEntry>)}
                        </Select.Select>
                    </span>

                    <span className="auto-conf-group auto-conf-text">{_("and restart the machine automatically.")}</span>
                </div>
            );
        }

        // we want the button to already show the target state while being disabled
        let onOffState = this.state.pendingEnable == null ? backend.enabled : this.state.pendingEnable;

        return (
            <div className="header-buttons pk-updates--header pk-updates--header--auto" id="automatic">
                <h2 className="pk-updates--header--heading">{_("Automatic Updates")}</h2>
                <div className="pk-updates--header--actions">
                    <OnOffSwitch.OnOffSwitch state={onOffState} enabled={!this.state.pending}
                                             onChange={e => {
                                                 if (!this.state.backend.installed) {
                                                     install_dialog(this.state.backend.packageName)
                                                             .then(() => { this.initializeBackend(true).then(() => { this.handleChange(e, null, null, null) }) }, () => null);
                                                 } else {
                                                     this.handleChange(e, null, null, null);
                                                 }
                                             }} />
                </div>
                {autoConfig}
            </div>);
    }
}
