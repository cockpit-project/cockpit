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
import React, { useState } from "react";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { TimePicker } from "@patternfly/react-core/dist/esm/components/TimePicker/index.js";

import { install_dialog } from "cockpit-components-install-dialog.jsx";
import { useDialogs } from "dialogs.jsx";
import { useInit } from "hooks";

const _ = cockpit.gettext;

function debug() {
    if (window.debugging == "all" || window.debugging?.includes("packagekit"))
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
    async getConfig() {
        throw new Error("abstract method");
    }

    // Update configuration for given non-null values, and update member variables on success;
    // return a promise that resolves when done, or fails when configuration writing fails
    async setConfig(enabled, type, day, time) {
        throw new Error("abstract method", enabled, type, day, time);
    }

    parseCalendar(spec) {
        // see systemd.time(7); we only support what we write, otherwise we treat it as custom config and "unsupported"
        const daysOfWeek = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
        const validTime = /^((|0|1)[0-9]|2[0-3]):[0-5][0-9]$/;

        const words = spec.trim().toLowerCase()
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
}

class DnfImpl extends ImplBase {
    async getConfig() {
        this.packageName = "dnf-automatic";

        try {
            // - dnf has two ways to enable automatic updates: Either by enabling dnf-automatic-install.timer
            //   or by setting "apply_updates = yes" in the config file and enabling dnf-automatic.timer
            // - the config file determines whether to apply security updates only
            // - by default this runs every day (OnUnitInactiveSec=1d), but the timer can be changed with a timer unit
            //   drop-in, so get the last line
            const output = await cockpit.script(
                "set -e; if rpm -q " + this.packageName + " >/dev/null; then echo installed; fi; " +
                "if grep -q '^[ \\t]*upgrade_type[ \\t]*=[ \\t]*security' /etc/dnf/automatic.conf; then echo security; fi; " +
                "TIMER=dnf-automatic-install.timer; " +
                "if systemctl --quiet is-enabled dnf-automatic-install.timer 2>/dev/null; then echo enabled; " +
                "elif systemctl --quiet is-enabled dnf-automatic.timer 2>/dev/null && grep -q '^[ \t]*apply_updates[ \t]*=[ \t]*yes' " +
                "    /etc/dnf/automatic.conf; then echo enabled; TIMER=dnf-automatic.timer; " +
                "fi; " +
                'OUT=$(systemctl cat $TIMER 2>/dev/null || true); ' +
                'echo "$OUT" | grep "^OnUnitInactiveSec= *[^ ]" | tail -n1; ' +
                'echo "$OUT" | grep "^OnCalendar= *[^ ]" | tail -n1; ',
                [], { err: "message" });

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
        } catch (error) {
            console.error("dnf getConfig failed:", error);
            this.supported = false;
        }
    }

    async setConfig(enabled, type, day, time) {
        const timerConf = "/etc/systemd/system/dnf-automatic-install.timer.d/time.conf";
        let script = "set -e; ";

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
                /* dnf 4.15+ supports automatic reboots; check if the config option exists, and if so, change the
                   default to "when-needed"; but be strict about the format, to avoid changing a customized setting */
                script += "if grep '^[[:space:]]*reboot\\b' /etc/dnf/automatic.conf; then ";
                script += "  sed -i 's/^reboot = never$/reboot = when-needed/' /etc/dnf/automatic.conf; ";
                // and drop the previous hack on upgrades */
                script += "  rm -f " + rebootConf + "; ";
                /* HACK for older dnf: enable automatic reboots after updating; dnf-automatic does not leave a log
                   file behind for deciding whether it actually installed anything, so resort to grepping the journal
                   for the last run (https://bugzilla.redhat.com/show_bug.cgi?id=1491190) */
                script += "else ";
                script += "  mkdir -p /etc/systemd/system/dnf-automatic-install.service.d; ";
                script += "  printf '[Service]\\nExecStartPost=/bin/sh -ec \"" +
                          "if systemctl status --no-pager --lines=100 dnf-automatic-install.service| grep -q ===========$$; then " +
                          "shutdown -r +5 rebooting after applying package updates; fi\"\\n' > " + rebootConf + "; ";
                script += "  systemctl daemon-reload; ";
                script += "fi";
            } else {
                // also make sure that the legacy unit name is disabled; this can fail if the unit does not exist
                script += "systemctl disable --now dnf-automatic.timer 2>/dev/null || true; ";
                script += "rm -f " + rebootConf + "; ";
            }
        }

        debug(`setConfig(${enabled}, "${type}", "${day}", "${time}"): script "${script}"`);

        try {
            await cockpit.script(script, [], { superuser: "require" });
            debug("dnf setConfig: configuration updated successfully");
            if (enabled !== null)
                this.enabled = enabled;
            if (type !== null)
                this.type = type;
            if (day !== null)
                this.day = day;
            if (time !== null)
                this.time = time;
        } catch (error) {
            console.error("dnf setConfig failed:", error.toString());
        }
    }
}

// Returns a promise for instantiating "backend"; this will never fail, if
// automatic updates are not supported, backend will be null.
export function getBackend(packagekit_backend, forceReinit) {
    if (!getBackend.promise || forceReinit) {
        debug("getBackend() called first time or forceReinit passed, initializing promise");
        getBackend.promise = new Promise((resolve, reject) => {
            const backend = (packagekit_backend === "dnf") ? new DnfImpl() : undefined;
            // TODO: apt backend
            if (backend)
                backend.getConfig().then(() => resolve(backend));
            else
                resolve(null);
        });
    }
    return getBackend.promise;
}

const AutoUpdatesDialog = ({ backend }) => {
    const Dialogs = useDialogs();
    const [pending, setPending] = useState(false);
    const [enabled, setEnabled] = useState(backend.enabled);
    const [type, setType] = useState(backend.type);
    const [day, setDay] = useState(backend.day);
    const [time, setTime] = useState(backend.time && backend.time.padStart(5, "0"));

    function save(event) {
        setPending(true);
        backend.setConfig(enabled, type, day, time)
                .finally(Dialogs.close);

        if (event)
            event.preventDefault();
        return false;
    }

    return (
        <Modal position="top" variant="small" id="automatic-updates-dialog" isOpen
               title={_("Automatic updates")}
               onClose={Dialogs.close}
               footer={
                   <>
                       <Button variant="primary"
                               isLoading={pending}
                               isDisabled={pending}
                               onClick={save}>
                           {_("Save changes")}
                       </Button>
                       <Button variant="link"
                               isDisabled={pending}
                               onClick={Dialogs.close}>
                           {_("Cancel")}
                       </Button>
                   </>
               }>
            <Form isHorizontal onSubmit={save}>
                <FormGroup fieldId="type" label={_("Type")} hasNoPaddingTop>
                    <Radio isChecked={!enabled}
                           onChange={() => { setEnabled(false); setType(null) }}
                           isDisabled={pending}
                           label={_("No updates")}
                           id="no-updates"
                           name="type" />
                    <Radio isChecked={enabled && type === "security"}
                           onChange={() => { setEnabled(true); setType("security") }}
                           isDisabled={pending}
                           label={_("Security updates only")}
                           id="security-updates"
                           name="type" />
                    <Radio isChecked={enabled && type === "all"}
                           onChange={() => { setEnabled(true); setType("all") }}
                           isDisabled={pending}
                           label={_("All updates")}
                           id="all-updates"
                           name="type" />
                </FormGroup>

                {enabled &&
                <>
                    <FormGroup fieldId="when" label={_("When")}>
                        <Flex className="auto-update-group">
                            <FormSelect id="auto-update-day"
                                         isDisabled={pending}
                                         value={day == "" ? "everyday" : day}
                                         onChange={(_, d) => setDay(d == "everyday" ? "" : d) }>
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

                            <TimePicker time={time} is24Hour
                                         menuAppendTo={() => document.body}
                                         id="auto-update-time" isDisabled={pending}
                                         invalidFormatErrorMessage={_("Invalid time format")}
                                         onChange={(_, time) => setTime(time)} />
                        </Flex>
                    </FormGroup>

                    <Alert variant="info" title={_("This host will reboot after updates are installed.")} isInline />
                </>}
            </Form>
        </Modal>);
};

export const AutoUpdates = ({ privileged, packagekit_backend }) => {
    const Dialogs = useDialogs();
    const [backend, setBackend] = useState(null);
    useInit(() => getBackend(packagekit_backend).then(setBackend));

    if (!backend)
        return null;

    let state = null;
    if (!backend.enabled)
        state = _("Disabled");
    if (!backend.installed)
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

    if (backend.enabled && backend.supported) {
        const day = days[backend.day];
        const time = backend.time;
        desc = backend.type == "security"
            ? cockpit.format(_("Security updates will be applied $0 at $1"), day, time)
            : cockpit.format(_("Updates will be applied $0 at $1"), day, time);
    }

    if (privileged && backend.installed && !backend.supported)
        return (
            <div id="autoupdates-settings">
                <Alert isInline
                       variant="info"
                       className="autoupdates-card-error"
                       title={_("Failed to parse unit files for dnf-automatic.timer or dnf-automatic-install.timer. Please remove custom overrides to configure automatic updates.")} />
            </div>
        );

    return (
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
                            isDisabled={!privileged}
                            size="sm"
                            onClick={() => {
                                if (!backend.installed) {
                                    install_dialog(backend.packageName)
                                            .then(() => {
                                                getBackend(packagekit_backend, true).then(b => {
                                                    setBackend(b);
                                                    Dialogs.show(<AutoUpdatesDialog backend={b} />);
                                                });
                                            }, () => null);
                                } else {
                                    Dialogs.show(<AutoUpdatesDialog backend={backend} />);
                                }
                            }}>
                        {!backend.installed ? _("Enable") : _("Edit")}
                    </Button>
                </Flex>
            </Flex>
            {desc}
        </div>);
};
