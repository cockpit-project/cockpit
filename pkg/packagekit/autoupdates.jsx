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
import PropTypes from 'prop-types';
import {
    Alert, Button, Flex, FlexItem, Form, FormGroup,
    FormSelect, FormSelectOption,
    Modal, Radio, TimePicker,
} from '@patternfly/react-core';

import { install_dialog } from "cockpit-components-install-dialog.jsx";

const _ = cockpit.gettext;

function debug() {
    if (window.debugging == "all" || window.debugging == "packagekit")
        console.debug.apply(console, arguments);
}

/**
 * Package manager specific implementations; PackageKit does not cover
 * automatic updates, so we have to implement dnf-automatic and
 * unattended-upgrades configuration ourselves
 */

class ImplBase {
    constructor() {
        this.supported = true; // false if system was customized in a way that we cannot parse
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
        return new Promise((resolve, reject) => {
            this.packageName = "dnf-automatic";

            // - dnf has two ways to enable automatic updates: Either by enabling dnf-automatic-install.timer
            //   or by setting "apply_updates = yes" in the config file and enabling dnf-automatic.timer
            // - the config file determines whether to apply security updates only
            // - by default this runs every day (OnUnitInactiveSec=1d), but the timer can be changed with a timer unit
            //   drop-in, so get the last line
            cockpit.script("set -e; if rpm -q " + this.packageName + " >/dev/null; then echo installed; fi; " +
                           "if grep -q '^[ \\t]*upgrade_type[ \\t]*=[ \\t]*security' /etc/dnf/automatic.conf; then echo security; fi; " +
                           "TIMER=dnf-automatic-install.timer; " +
                           "if systemctl --quiet is-enabled dnf-automatic-install.timer 2>/dev/null; then echo enabled; " +
                           "elif systemctl --quiet is-enabled dnf-automatic.timer 2>/dev/null && grep -q '^[ \t]*apply_updates[ \t]*=[ \t]*yes' " +
                           "    /etc/dnf/automatic.conf; then echo enabled; TIMER=dnf-automatic.timer; " +
                           "fi; " +
                           'OUT=$(systemctl cat $TIMER 2>/dev/null || true); ' +
                           'echo "$OUT" | grep "^OnUnitInactiveSec= *[^ ]" | tail -n1; ' +
                           'echo "$OUT" | grep "^OnCalendar= *[^ ]" | tail -n1; ',
                           [], { err: "message" })
                    .then(output => {
                        this.installed = (output.indexOf("installed\n") >= 0);
                        this.enabled = (output.indexOf("enabled\n") >= 0);
                        this.type = (output.indexOf("security\n") >= 0) ? "security" : "all";

                        // if we have OnCalendar=, use that (we disable OnUnitInactiveSec= in our drop-in)
                        const calIdx = output.indexOf("OnCalendar=");
                        if (calIdx >= 0) {
                            this.parseCalendar(output.substr(calIdx).split('\n')[0].split("=")[1]);
                        } else {
                            if (output.indexOf("InactiveSec=1d\n") >= 0)
                                this.day = this.time = "";
                            else if (this.installed)
                                this.supported = false;
                        }

                        debug(`dnf getConfig: supported ${this.supported}, enabled ${this.enabled}, type ${this.type}, day ${this.day}, time ${this.time}, installed ${this.installed}; raw response '${output}'`);
                        resolve();
                    })
                    .catch(error => {
                        console.error("dnf getConfig failed:", error);
                        this.supported = false;
                        resolve();
                    });
        });
    }

    parseCalendar(spec) {
        // see systemd.time(7); we only support what we write, otherwise we treat it as custom config and "unsupported"
        const daysOfWeek = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
        const validTime = /^((|0|1)[0-9]|2[0-3]):[0-5][0-9]$/;

        var words = spec.trim().toLowerCase()
                .split(/\s+/);

        // check if we have a day of week
        if (daysOfWeek.indexOf(words[0]) >= 0) {
            this.day = words.shift();
        } else if (words[0] === '*-*-*') {
            this.day = ""; // daily with "all matches" date specification
            words.shift();
        } else {
            this.day = ""; // daily without date specification
        }

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
            const value = (type == "security") ? "security" : "default";

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

        return cockpit.script(script, [], { superuser: "require" })
                .then(() => {
                    debug("dnf setConfig: configuration updated successfully");
                    if (enabled !== null)
                        this.enabled = enabled;
                    if (type !== null)
                        this.type = type;
                    if (day !== null)
                        this.day = day;
                    if (time !== null)
                        this.time = time;
                })
                .catch(error => console.error("dnf setConfig failed:", error.toString()));
    }
}

// Returns a promise for instantiating "backend"; this will never fail, if
// automatic updates are not supported, backend will be null.
export function getBackend(forceReinit) {
    if (!getBackend.promise || forceReinit) {
        debug("getBackend() called first time or forceReinit passed, initializing promise");
        getBackend.promise = new Promise((resolve, reject) => {
            cockpit.spawn(["bash", "-ec", "command -v zypper dnf apt | head -n1 | xargs --no-run-if-empty basename"], [], { err: "message" })
                    .then(output => {
                        output = output.trim();
                        debug("getBackend(): detection finished, output", output);
                        let backend;
                        if (output === "dnf")
                            backend = new DnfImpl();
                        // TODO: apt backend
                        if (backend)
                            backend.getConfig().then(() => resolve(backend));
                        else
                            resolve(null);
                    })
                    .catch(error => {
                        // the detection shell script is supposed to always succeed
                        console.error("automatic updates getBackend() detection failed:", error);
                        resolve(null);
                    });
        });
    }

    return getBackend.promise;
}

export class AutoUpdates extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            pending: false,
            showModal: false,
            backend: props.backend,
            enabled: props.backend && props.backend.enabled,
            type: props.backend && props.backend.type,
            day: props.backend && props.backend.day,
            time: props.backend && props.backend.time && props.backend.time.padStart(5, "0"),
        };
        this.handleChange = this.handleChange.bind(this);
    }

    handleChange(event) {
        const { enabled, type, day, time, hour, minute } = this.state;

        if (hour === null || minute === null)
            return;

        this.setState({ pending: true });
        this.state.backend.setConfig(enabled, type, day, time)
                .always(() => {
                    this.setState({ pending: false, showModal: false });
                });

        if (event)
            event.preventDefault();
        return false;
    }

    render() {
        if (!this.state.backend)
            return null;

        const enabled = !this.state.pending && this.props.privileged;
        const body = (
            <Form isHorizontal onSubmit={this.handleChange}>
                <FormGroup fieldId="type" label={_("Type")} hasNoPaddingTop>
                    <Radio isChecked={!this.state.enabled}
                           onChange={e => this.setState({ enabled: false, type: null })}
                           isDisabled={!enabled}
                           label={_("No updates")}
                           id="no-updates"
                           name="type" />
                    <Radio isChecked={this.state.enabled && this.state.type === "security"}
                           onChange={e => this.setState({ enabled: true, type: "security" })}
                           isDisabled={!enabled}
                           label={_("Security updates only")}
                           id="security-updates"
                           name="type" />
                    <Radio isChecked={this.state.enabled && this.state.type === "all"}
                           onChange={e => this.setState({ enabled: true, type: "all" })}
                           isDisabled={!enabled}
                           label={_("All updates")}
                           id="all-updates"
                           name="type" />
                </FormGroup>

                {this.state.enabled && <>
                    <FormGroup fieldId="when" label={_("When")}>
                        <Flex className="auto-update-group">
                            <FormSelect id="auto-update-day" isDisabled={!enabled} value={this.state.day == "" ? "everyday" : this.state.day}
                                        onChange={d => this.setState({ day: d == "everyday" ? "" : d })}>
                                <FormSelectOption value="everyday" label={_("every day")} />
                                <FormSelectOption value="mon" label={_("Mondays")} />
                                <FormSelectOption value="tue" label={_("Tuesdays")} />
                                <FormSelectOption value="wed" label={_("Wednesdays")} />
                                <FormSelectOption value="thu" label={_("Thursdays")} />
                                <FormSelectOption value="fri" label={_("Fridays")} />
                                <FormSelectOption value="sat" label={_("Saturdays")} />
                                <FormSelectOption value="sun" label={_("Sundays")} />
                            </FormSelect>

                            <span className="auto-conf-text">{_("at")}</span>

                            <TimePicker time={this.state.time} is24Hour
                                        menuAppendTo={() => document.body}
                                        id="auto-update-time" isDisabled={!enabled}
                                        invalidFormatErrorMessage={_("Invalid time format")}
                                        onChange={(time, hour, minute) => this.setState({ time, hour, minute })} />
                        </Flex>
                    </FormGroup>

                    <Alert variant="info" title={_("This host will reboot after updates are installed.")} isInline />
                </>}
            </Form>
        );

        let state = null;
        if (!this.state.backend.enabled)
            state = _("Disabled");
        if (!this.state.backend.installed)
            state = _("Not set up");

        const days = {
            "": _("every day"),
            mon: _("every Monday"),
            tue: _("every Tuesday"),
            wed: _("every Wednesday"),
            thu: _("every Thursday"),
            fri: _("every Friday"),
            sat: _("every Saturday"),
            sun: _("every Sunday")
        };

        let desc = null;

        if (this.state.backend.enabled && this.state.backend.supported) {
            desc = this.state.backend.type == "security" ? _("Security updates ") : _("Updates ");
            desc += cockpit.format(_("will be applied $0 at $1"), days[this.state.backend.day], this.state.backend.time);
        }

        const self = this;

        if (enabled && this.state.backend.installed && !this.state.backend.supported)
            return (
                <div id="autoupdates-settings">
                    <Alert isInline
                        variant="info"
                        className="autoupdates-card-error"
                        title={_("Failed to parse unit files for dnf-automatic.timer or dnf-automatic-install.timer. Please remove custom overrides to configure automatic updates.")} />
                </div>);

        return (<>
            <div id="autoupdates-settings">
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <Flex grow={{ default: 'grow' }} alignItems={{ default: 'alignItemsBaseline' }}>
                        <FlexItem>
                            <b>{_("Automatic updates")}</b>
                        </FlexItem>
                        <FlexItem>
                            {state}
                        </FlexItem>
                    </Flex>
                    <Flex>
                        <Button variant="secondary"
                                isDisabled={!enabled}
                                isSmall
                                onClick={() => {
                                    if (!this.state.backend.installed) {
                                        install_dialog(this.state.backend.packageName)
                                                .then(() => {
                                                    getBackend(true).then(b => {
                                                        self.setState({
                                                            backend: b,
                                                            enabled: b.enabled,
                                                            type: b.type,
                                                            day: b.day,
                                                            time: b.time && b.time.padStart(5, "0"),
                                                            showModal: true,
                                                        });
                                                    });
                                                }, () => null);
                                    } else {
                                        this.setState({ showModal: true });
                                    }
                                }}>
                            {!this.state.backend.installed ? _("Enable") : _("Edit")}
                        </Button>
                    </Flex>
                </Flex>
                {desc}
            </div>
            <Modal position="top" variant="small" id="automatic-updates-dialog" isOpen={this.state.showModal}
                title={_("Automatic updates")}
                onClose={() => this.setState({ showModal: false })}
                footer={
                    <>
                        <Button variant="primary"
                                isLoading={ this.state.pending }
                                isDisabled={ this.state.pending }
                                onClick={ this.handleChange }>
                            {_("Save changes")}
                        </Button>
                        <Button variant="link"
                                isDisabled={ this.state.pending }
                                onClick={() => this.setState({ showModal: false })}>
                            {_("Cancel")}
                        </Button>
                    </>
                }>
                {body}
            </Modal>
        </>);
    }
}

AutoUpdates.propTypes = {
    privileged: PropTypes.bool.isRequired,
    backend: PropTypes.object.isRequired,
};
