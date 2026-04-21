/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState } from "react";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { TimePicker } from "@patternfly/react-core/dist/esm/components/TimePicker/index.js";

import { install_dialog } from "cockpit-components-install-dialog.jsx";
import { useDialogs } from "dialogs.jsx";

import { debug } from "./utils";

const _ = cockpit.gettext;

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

    // Generate shell script fragment to create a systemd timer drop-in
    generateTimerConfigScript(configFile, day, time) {
        let script = "";

        if (time !== null || day !== null) {
            if (day === "" && time === "") {
                // restore defaults
                script += `rm -f ${configFile}; `;
            } else {
                if (day == null) day = this.day;
                if (time == null) time = this.time;

                const confDir = configFile.substring(0, configFile.lastIndexOf('/'));
                script += `mkdir -p ${confDir}; `;
                script += `printf '[Timer]\\nOnBootSec=\\nOnCalendar=${day} ${time}\\n' > ${configFile}; `;
            }

            script += "systemctl daemon-reload; ";
        }

        return script;
    }
}

class Dnf4Impl extends ImplBase {
    async getConfig() {
        this.packageName = "dnf-automatic";

        try {
            // - dnf 4 has two ways to enable automatic updates: Either by enabling dnf-automatic-install.timer
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
                this.parseCalendar(output.substring(calIdx).split('\n')[0].split("=")[1]);
            } else {
                if (output.indexOf("InactiveSec=1d\n") >= 0)
                    this.day = this.time = "";
                else if (this.installed)
                    this.supported = false;
            }

            debug(`dnf4 getConfig: supported ${this.supported}, enabled ${this.enabled}, type ${this.type}, day ${this.day}, time ${this.time}, installed ${this.installed}; raw response '${output}'`);
        } catch (error) {
            console.error("dnf4 getConfig failed:", error);
            this.supported = false;
        }
    }

    async setConfig(enabled, type, day, time) {
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

        const timerConf = "/etc/systemd/system/dnf-automatic-install.timer.d/time.conf";
        script += this.generateTimerConfigScript(timerConf, day, time);

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

        debug(`dnf4 setConfig(${enabled}, "${type}", "${day}", "${time}"): script "${script}"`);

        try {
            await cockpit.script(script, [], { superuser: "require" });
            debug("dnf4 setConfig: configuration updated successfully");
            if (enabled !== null)
                this.enabled = enabled;
            if (type !== null)
                this.type = type;
            if (day !== null)
                this.day = day;
            if (time !== null)
                this.time = time;
        } catch (error) {
            console.error("dnf4 setConfig failed:", error.toString());
        }
    }
}

class Dnf5Impl extends ImplBase {
    async getConfig() {
        this.packageName = "dnf5-plugin-automatic";
        this.configFile = "/etc/dnf/dnf5-plugins/automatic.conf";

        try {
            await cockpit.spawn(["rpm", "-q", this.packageName], { err: "ignore" });
            this.installed = true;
        } catch (ex) {
            this.installed = false;
            debug("dnf5 getConfig: not installed:", ex);
            return;
        }

        // - dnf 5 only has a single timer dnf5-automatic.timer and a config file with
        //   "apply_updates" (yes/no) and "upgrade_type" (default/security)
        // - by default this runs every day (OnCalendar)
        try {
            const output = await cockpit.script(
                "set -eu;" +
                "if grep -q '^[ \\t]*upgrade_type[ \\t]*=[ \\t]*security' " + this.configFile + "; then echo security; fi; " +
                "if systemctl --quiet is-enabled dnf5-automatic.timer && " +
                "  grep -q '^[ \t]*apply_updates[ \t]*=[ \t]*yes' " + this.configFile + "; then echo enabled; fi; " +
                'OUT=$(systemctl cat dnf5-automatic.timer || true); ' +
                'echo "$OUT" | grep "^OnUnitInactiveSec= *[^ ]" | tail -n1; ' +
                'echo "$OUT" | grep "^OnCalendar= *[^ ]" | tail -n1; ',
                [], { err: "message" });

            this.enabled = (output.indexOf("enabled\n") >= 0);
            this.type = (output.indexOf("security\n") >= 0) ? "security" : "all";

            // if we have OnCalendar=, use that (we disable OnUnitInactiveSec= in our drop-in)
            const calIdx = output.indexOf("OnCalendar=");
            if (calIdx >= 0) {
                this.parseCalendar(output.substring(calIdx).split('\n')[0].split("=")[1]);
            } else {
                if (output.indexOf("InactiveSec=1d\n") >= 0)
                    this.day = this.time = "";
                else if (this.installed)
                    this.supported = false;
            }

            debug(`dnf5 getConfig: supported ${this.supported}, enabled ${this.enabled}, type ${this.type}, day ${this.day}, time ${this.time}, installed ${this.installed}; raw response '${output}'`);
        } catch (error) {
            console.error("dnf5 getConfig failed:", error);
            this.supported = false;
        }
    }

    async setConfig(enabled, type, day, time) {
        let script = "set -e; ";

        // there's no default config file, admins are supposed to put their own settings into a new file
        const settings = [];

        if (type !== null)
            settings.push(["upgrade_type", (type == "security") ? "security" : "default"]);

        const timerConf = "/etc/systemd/system/dnf5-automatic.timer.d/time.conf";
        script += this.generateTimerConfigScript(timerConf, day, time);

        if (enabled !== null) {
            script += "systemctl " + (enabled ? "enable" : "disable") + " --now dnf5-automatic.timer; ";

            if (enabled) {
                settings.push(["apply_updates", "yes"]);
                settings.push(["reboot", "when-needed"]);
            }
        }

        debug(`dnf5 setConfig(${enabled}, "${type}", "${day}", "${time}"): script "${script}", settings ${settings}`);

        try {
            if (settings.length > 0) {
                // parse/update automatic.conf with the new settings; modify existing or append
                await cockpit.file(this.configFile, { superuser: "require" }).modify(content => {
                    const lines = content ? content.split('\n') : [];
                    settings.forEach(([key, value]) => {
                        const idx = lines.findIndex(line => line.startsWith(key));
                        if (idx >= 0)
                            lines[idx] = key + " = " + value;
                        else
                            // let's avoid context sensitive parsing/writing; multiple sections are ok
                            lines.push(`[commands]\n${key} = ${value}`);
                    });
                    return lines.join('\n');
                });
            }

            await cockpit.script(script, [], { superuser: "require" });
            debug("dnf5 setConfig: configuration updated successfully");
            if (enabled !== null)
                this.enabled = enabled;
            if (type !== null)
                this.type = type;
            if (day !== null)
                this.day = day;
            if (time !== null)
                this.time = time;
        } catch (error) {
            console.error("dnf5 setConfig failed:", error.toString());
        }
    }
}

class AptImpl extends ImplBase {
    constructor() {
        super();
        this.originsPatterns = null;
    }

    async getConfig() {
        this.packageName = "unattended-upgrades";

        try {
            await cockpit.spawn(["dpkg", "-l", this.packageName], { err: "ignore" });
            this.installed = true;
        } catch (ex) {
            this.installed = false;
            debug("apt getConfig: not installed:", ex);
            return;
        }

        try {
            // Detect distribution
            const distroOutput = await cockpit.script(
                "grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '\"'",
                [], { err: "message" });
            const distro = distroOutput.trim().toLowerCase();

            // Set patterns based on distribution
            if (distro === 'ubuntu') {
                this.originsPatterns = {
                    configKey: 'Allowed-Origins',
                    all: '"*:*";',
                    stable: '"${distro_id}:${distro_codename}";',
                    security: [
                        '"${distro_id}:${distro_codename}-security";',
                        '"${distro_id}ESMApps:${distro_codename}-apps-security";',
                        '"${distro_id}ESM:${distro_codename}-infra-security";'
                    ]
                };
            } else if (distro === 'debian') {
                this.originsPatterns = {
                    configKey: 'Origins-Pattern',
                    all: '"origin=*";',
                    stable: '"origin=Debian,codename=${distro_codename},label=Debian";',
                    security: [
                        '"origin=Debian,codename=${distro_codename}-security,label=Debian-Security";',
                        '"origin=Debian,codename=${distro_codename},label=Debian-Security";'
                    ]
                };
            } else {
                // Unsupported distribution
                console.error(`AptImpl: Unsupported distribution: ${distro}. Only Ubuntu and Debian are supported.`);
                this.supported = false;
                return;
            }

            // Check timer status and configuration
            const timerOutput = await cockpit.script(
                "set -eu; " +
                "if systemctl --quiet is-enabled apt-daily.timer 2>/dev/null; then echo update-enabled; fi; " +
                "if systemctl --quiet is-enabled apt-daily-upgrade.timer 2>/dev/null; then echo upgrade-enabled; fi; " +
                "systemctl cat apt-daily-upgrade.timer 2>/dev/null | grep '^OnCalendar=' | tail -n1 || true; ",
                [], { err: "message" });

            const updateTimerEnabled = timerOutput.includes("update-enabled");
            const upgradeTimerEnabled = timerOutput.includes("upgrade-enabled");
            this.enabled = (updateTimerEnabled && upgradeTimerEnabled);

            // Parse timer schedule
            const calIdx = timerOutput.indexOf("OnCalendar=");
            if (calIdx >= 0) {
                const calendarSpec = timerOutput.substring(calIdx).split('\n')[0].split("=")[1];
                this.parseCalendar(calendarSpec);
            } else if (this.installed) {
                this.supported = false;
            }

            // Get unattended-upgrades configuration
            const aptConfigOutput = await cockpit.script(
                `apt-config dump | grep "Unattended-Upgrade::${this.originsPatterns.configKey}:: "`,
                [], { superuser: "require", err: "message" });

            // Determine upgrade type based on configuration patterns
            const allUpgrades = aptConfigOutput.includes(this.originsPatterns.all);
            let securityUpgrades = false;

            // Check for stable and security patterns
            securityUpgrades = aptConfigOutput.includes(this.originsPatterns.stable) &&
                this.originsPatterns.security.every(pattern => aptConfigOutput.includes(pattern));

            if (allUpgrades) {
                this.type = "all";
            } else if (securityUpgrades) {
                this.type = "security";
            }

            debug(`apt getConfig: distro ${distro}, supported ${this.supported}, enabled ${this.enabled}, type ${this.type}, day ${this.day}, time ${this.time}, installed ${this.installed}, raw timer output: '${timerOutput}'; raw apt-config output: '${aptConfigOutput}'`);
        } catch (error) {
            console.error("AptImpl: getConfig failed:", error);
            this.supported = false;
        }
    }

    async setConfig(enabled, type, day, time) {
        this.defaultConfigFile = "/etc/apt/apt.conf.d/50unattended-upgrades";
        this.configFile = "/etc/apt/apt.conf.d/52unattended-upgrades-cockpit";

        let script = "set -e; ";

        if (type !== null) {
            if (!this.originsPatterns) {
                console.error("Patterns not initialized");
                return;
            }

            // Configure upgrade origins based on update type in our override file
            script += "cat > " + this.configFile + " << 'EOF'\n";
            script += "// Cockpit managed configuration\n";
            // Clear the configuration as they get merged otherwise
            script += `#clear Unattended-Upgrade::${this.originsPatterns.configKey};\n`;
            script += `Unattended-Upgrade::${this.originsPatterns.configKey} {\n`;

            if (type === "all") {
                script += `        ${this.originsPatterns.all}\n`;
            } else {
                // Only security upgrades which includes stable and all security patterns
                script += `        ${this.originsPatterns.stable}\n`;
                this.originsPatterns.security.forEach(securityPattern => {
                    script += `        ${securityPattern}\n`;
                });
            }
            script += "};\n\n";

            // Enable Automatic reboot (to conform to current dnf implementation)
            script += "// Enable automatic reboot when required\n";
            script += 'Unattended-Upgrade::Automatic-Reboot "true";\n';
            script += "EOF\n";
        }

        // Configure timers
        const timerConfigs = [
            "/etc/systemd/system/apt-daily.timer.d/time.conf",
            "/etc/systemd/system/apt-daily-upgrade.timer.d/time.conf"
        ];

        timerConfigs.forEach(conf => {
            script += this.generateTimerConfigScript(conf, day, time);
        });

        if (enabled !== null) {
            const action = enabled ? "enable --now" : "disable --now";
            const timers = ["apt-daily-upgrade.timer", "apt-daily.timer"];

            timers.forEach(timer => { script += `systemctl ${action} ${timer}; ` });

            if (!enabled) {
                script += `rm -f ${this.configFile}; `;
            }
        }

        debug(`apt setConfig(${enabled}, "${type}", "${day}", "${time}"): script "${script}"`);

        try {
            await cockpit.script(script, [], { superuser: "require" });
            debug("apt setConfig: configuration updated successfully");
            if (enabled !== null)
                this.enabled = enabled;
            if (type !== null)
                this.type = type;
            if (day !== null)
                this.day = day;
            if (time !== null)
                this.time = time;
        } catch (error) {
            console.error("apt setConfig failed:", error instanceof Error ? error.toString() : String(error));
        }
    }
}

// Returns a promise for instantiating "backend"; this will never fail, if
// automatic updates are not supported, backend will be null.
export function getBackend(packagekit_backend, forceReinit) {
    if (!getBackend.promise || forceReinit) {
        debug("getBackend() called first time or forceReinit passed, initializing promise");
        getBackend.promise = new Promise((resolve, reject) => {
            if (packagekit_backend === "dnf5") {
                const backend = new Dnf5Impl();
                backend.getConfig().then(() => resolve(backend));
            } else if (packagekit_backend === "dnf") {
                // we need to do this runtime check -- you can e.g. install dnf5 on Fedora 40, but it's not the "main" dnf
                cockpit.spawn(["dnf", "--version"], { err: "message" })
                        .then(version => {
                            const backend = version.includes("dnf5") ? new Dnf5Impl() : new Dnf4Impl();
                            backend.getConfig().then(() => resolve(backend));
                        })
                        .catch(ex => {
                            console.error("failed to run dnf --version:", ex);
                            resolve(null);
                        });
            } else if (packagekit_backend === "apt") {
                const backend = new AptImpl();
                backend.getConfig().then(() => resolve(backend));
            } else {
                // TODO: other backends
                resolve(null);
            }
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
               onClose={Dialogs.close}>
            <ModalHeader title={_("Automatic updates")} />
            <ModalBody>
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
            </ModalBody>
            <ModalFooter>
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
            </ModalFooter>
        </Modal>);
};

export const AutoUpdates = ({ privileged, packagekit_backend, initial_backend }) => {
    const Dialogs = useDialogs();
    const [backend, setBackend] = useState(initial_backend);

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
                       title={_("Failed to parse configuration for automatic updates. Please remove custom overrides to configure automatic updates.")} />
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
