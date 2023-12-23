/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { DatePicker } from "@patternfly/react-core/dist/esm/components/DatePicker/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Select, SelectOption } from "@patternfly/react-core/dist/esm/deprecated/components/Select/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TimePicker } from "@patternfly/react-core/dist/esm/components/TimePicker/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { CloseIcon, ExclamationCircleIcon, InfoCircleIcon, PlusIcon } from "@patternfly/react-icons";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { useObject, useEvent } from "hooks.js";

import * as service from "service.js";
import * as timeformat from "timeformat.js";
import * as python from "python.js";
import get_timesync_backend_py from "./get-timesync-backend.py";

import { superuser } from "superuser.js";

import "serverTime.scss";

const _ = cockpit.gettext;

export function ServerTime() {
    const self = this;
    cockpit.event_target(self);

    function emit_changed() {
        self.dispatchEvent("changed");
    }

    let time_offset = null;
    let remote_offset = null;

    let client = null;
    let timedate = null;

    function connect() {
        if (client) {
            timedate.removeEventListener("changed", emit_changed);
            client.close();
        }
        client = cockpit.dbus('org.freedesktop.timedate1', { superuser: "try" });
        timedate = client.proxy();
        timedate.addEventListener("changed", emit_changed);
        client.subscribe({
            interface: "org.freedesktop.DBus.Properties",
            member: "PropertiesChanged"
        }, ntp_updated);
    }

    const timedate1_service = service.proxy("dbus-org.freedesktop.timedate1.service");
    const timesyncd_service = service.proxy("systemd-timesyncd.service");
    const chronyd_service = service.proxy("chronyd.service");

    timesyncd_service.addEventListener("changed", emit_changed);
    chronyd_service.addEventListener("changed", emit_changed);

    /*
     * The time we return from here as its UTC time set to the
     * server time. This is the only way to get predictable
     * behavior.
     */
    Object.defineProperty(self, 'utc_fake_now', {
        enumerable: true,
        get: function get() {
            const offset = time_offset + remote_offset;
            return new Date(offset + (new Date()).valueOf());
        }
    });

    Object.defineProperty(self, 'now', {
        enumerable: true,
        get: function get() {
            return new Date(time_offset + (new Date()).valueOf());
        }
    });

    self.format = function format(and_time) {
        const options = { dateStyle: "medium", timeStyle: and_time ? "short" : undefined, timeZone: "UTC" };
        return timeformat.formatter(options).format(self.utc_fake_now);
    };

    const updateInterval = window.setInterval(emit_changed, 30000);

    self.wait = function wait() {
        if (remote_offset === null)
            return self.update();
        return Promise.resolve();
    };

    self.update = function update() {
        return cockpit.spawn(["date", "+%s:%z"], { err: "message" })
                .then(data => {
                    const parts = data.trim().split(":");
                    const timems = parseInt(parts[0], 10) * 1000;
                    let tzmin = parseInt(parts[1].slice(-2), 10);
                    const tzhour = parseInt(parts[1].slice(0, -2));
                    if (tzhour < 0)
                        tzmin = -tzmin;
                    const offsetms = (tzhour * 3600000) + tzmin * 60000;
                    const now = new Date();
                    time_offset = (timems - now.valueOf());
                    remote_offset = offsetms;
                    emit_changed();
                })
                .catch(ex => console.log("Couldn't calculate server time offset: " + cockpit.message(ex)));
    };

    /* There is no way to make sense of this date without a round trip to the
     * server, as the timezone is really server specific. */
    self.change_time = (datestr, timestr) => cockpit.spawn(["date", "--date=" + datestr + " " + timestr, "+%s"])
            .then(data => {
                const seconds = parseInt(data.trim(), 10);
                return timedate.call('SetTime', [seconds * 1000 * 1000, false, true])
                        .then(self.update);
            });

    self.bump_time = function (millis) {
        return timedate.call('SetTime', [millis, true, true]);
    };

    self.get_time_zone = function () {
        return timedate.Timezone;
    };

    self.set_time_zone = function (tz) {
        return timedate.call('SetTimezone', [tz, true]);
    };

    self.poll_ntp_synchronized = () => client.call(
        timedate.path, "org.freedesktop.DBus.Properties", "Get", ["org.freedesktop.timedate1", "NTPSynchronized"])
            .then(result => {
                const ifaces = { "org.freedesktop.timedate1": { NTPSynchronized: result[0].v } };
                const data = { };
                data[timedate.path] = ifaces;
                client.notify(data);
            })
            .catch(error => {
                if (error.name != "org.freedesktop.DBus.Error.UnknownProperty" &&
                        error.problem != "not-found")
                    console.log("can't get NTPSynchronized property", error);
            });

    let ntp_waiting_value = null;
    let ntp_waiting_resolve = null;

    function ntp_updated(path, iface, member, args) {
        if (!ntp_waiting_resolve || !args[1].NTP)
            return;
        if (ntp_waiting_value !== args[1].NTP.v)
            console.warn("Unexpected value of NTP");
        ntp_waiting_resolve();
        ntp_waiting_resolve = null;
    }

    self.set_ntp = function set_ntp(val) {
        const promise = new Promise((resolve, reject) => {
            ntp_waiting_resolve = resolve;
        });
        ntp_waiting_value = val;
        client.call(timedate.path,
                    "org.freedesktop.DBus.Properties", "Get", ["org.freedesktop.timedate1", "NTP"])
                .then(result => {
                // Check if don't want to enable enabled or disable disabled
                    if (result[0].v === val) {
                        ntp_waiting_resolve();
                        ntp_waiting_resolve = null;
                        return;
                    }
                    timedate.call('SetNTP', [val, true])
                            .catch(e => {
                                ntp_waiting_resolve();
                                ntp_waiting_resolve = null;
                                console.error("Failed to call SetNTP:", e.message); // not-covered: OS error
                            });
                });
        return promise;
    };

    self.get_ntp_active = function () {
        return timedate.NTP;
    };

    self.get_ntp_supported = function () {
        return timedate.CanNTP;
    };

    self.get_ntp_status = function () {
        const status = {
            initialized: false,
            active: false,
            synch: false,
            service: null,
            server: null,
            sub_status: null
        };

        // flag for tests that timedated/timesyncd proxies got initialized
        if (timedate.CanNTP !== undefined &&
            timedate1_service.unit && timedate1_service.unit.Id &&
            timesyncd_service.exists !== null &&
            chronyd_service.exists !== null)
            status.initialized = true;

        status.active = timedate.NTP;
        status.synch = timedate.NTPSynchronized;

        const timesyncd_server_regex = /.*time server (.*)\./i;

        const timesyncd_status = (timesyncd_service.state == "running" &&
                                timesyncd_service.service?.StatusText);

        if (timesyncd_service.state == "running")
            status.service = "systemd-timesyncd.service";
        else if (chronyd_service.state == "running")
            status.service = "chronyd.service";

        if (timesyncd_status) {
            const match = timesyncd_status.match(timesyncd_server_regex);
            if (match)
                status.server = match[1];
            else if (timesyncd_status != "Idle." && timesyncd_status !== "")
                status.sub_status = timesyncd_status;
        }

        return status;
    };

    function get_timesync_backend() {
        return python.spawn(get_timesync_backend_py, [], { superuser: "try", err: "message" })
                .then(data => {
                    const unit = data.trim();
                    if (unit == "systemd-timesyncd.service")
                        return "timesyncd";
                    else if (unit == "chrony.service" || unit == "chronyd.service")
                        return "chronyd";
                    else
                        return null;
                });
    }

    function get_custom_ntp_timesyncd() {
        const custom_ntp_config_file = cockpit.file("/etc/systemd/timesyncd.conf.d/50-cockpit.conf",
                                                    { superuser: "try" });

        const result = {
            backend: "timesyncd",
            enabled: false,
            servers: []
        };

        return custom_ntp_config_file.read()
                .then(function(text) {
                    let ntp_line = "";
                    if (text) {
                        result.enabled = true;
                        text.split("\n").forEach(function(line) {
                            if (line.indexOf("NTP=") === 0) {
                                ntp_line = line.slice(4);
                                result.enabled = true;
                            } else if (line.indexOf("#NTP=") === 0) {
                                ntp_line = line.slice(5);
                                result.enabled = false;
                            }
                        });

                        result.servers = ntp_line.split(" ").filter(function(val) {
                            return val !== "";
                        });
                        if (result.servers.length === 0)
                            result.enabled = false;
                    }
                    return result;
                })
                .catch(function(error) {
                    console.warn("failed to load time servers", error);
                    return result;
                });
    }

    function set_custom_ntp_timesyncd(config) {
        const custom_ntp_config_file = cockpit.file("/etc/systemd/timesyncd.conf.d/50-cockpit.conf",
                                                    { superuser: true });

        const text = `# This file is automatically generated by Cockpit\n\n[Time]\n${config.enabled ? "" : "#"}NTP=${config.servers.join(" ")}\n`;

        return cockpit.spawn(["mkdir", "-p", "/etc/systemd/timesyncd.conf.d"], { superuser: true })
                .then(() => custom_ntp_config_file.replace(text));
    }

    const chronyd_sourcedir = "/etc/chrony/sources.d";
    const chronyd_sources_enabled = chronyd_sourcedir + "/cockpit.sources";
    const chronyd_sources_disabled = chronyd_sourcedir + "/cockpit.disabled";

    function get_custom_ntp_chronyd() {
        const enabled_file = cockpit.file(chronyd_sources_enabled, { superuser: "try" });
        const disabled_file = cockpit.file(chronyd_sources_disabled, { superuser: "try" });

        function parse_servers(data) {
            if (!data)
                return [];
            const servers = [];
            data.split("\n").forEach(function(line) {
                const parts = line.split(" ");
                if (parts[0] == "server")
                    servers.push(parts[1]);
            });
            return servers;
        }

        return enabled_file.read()
                .then(data => {
                    if (data) {
                        return {
                            backend: "chronyd",
                            enabled: true,
                            servers: parse_servers(data)
                        };
                    } else {
                        return disabled_file.read()
                                .then(data => {
                                    return {
                                        backend: "chronyd",
                                        enabled: false,
                                        servers: parse_servers(data)
                                    };
                                });
                    }
                });
    }

    function set_custom_ntp_chronyd(config) {
        const enabled_file = cockpit.file(chronyd_sources_enabled, { superuser: true });
        const disabled_file = cockpit.file(chronyd_sources_disabled, { superuser: true });

        const text = "# This file is automatically generated by Cockpit\n\n" + config.servers.map(s => `server ${s}\n`).join("");

        // HACK - https://bugzilla.redhat.com/show_bug.cgi?id=2168863
        function ensure_sourcedir() {
            function add_sourcedir(data) {
                const line = "sourcedir " + chronyd_sourcedir;
                if (data && data.indexOf(line) == -1)
                    data += "\n# Added by Cockpit\n" + line + "\n";
                return data;
            }
            return cockpit.file("/etc/chrony.conf", { superuser: true }).modify(add_sourcedir);
        }

        return cockpit.spawn(["mkdir", "-p", chronyd_sourcedir], { superuser: true })
                .then(() => {
                    if (config.enabled)
                        return enabled_file.replace(text).then(() => disabled_file.replace(null)).then(ensure_sourcedir);
                    else
                        return disabled_file.replace(text).then(() => enabled_file.replace(null));
                });
    }

    self.get_custom_ntp = function () {
        return get_timesync_backend().then(backend => {
            if (backend == "timesyncd") {
                return get_custom_ntp_timesyncd();
            } else if (backend == "chronyd") {
                return get_custom_ntp_chronyd();
            } else {
                return Promise.resolve({ backend: null, servers: [], enabled: false });
            }
        });
    };

    self.set_custom_ntp = function (config) {
        if (config.backend == "timesyncd") {
            return set_custom_ntp_timesyncd(config);
        } else if (config.backend == "chronyd") {
            return set_custom_ntp_chronyd(config);
        } else {
            return Promise.resolve();
        }
    };

    self.get_timezones = function() {
        return cockpit.spawn(["/usr/bin/timedatectl", "list-timezones"])
                .then(content => content.split('\n').filter(tz => tz != ""));
    };

    /* NTPSynchronized needs to be polled so we just do that
     * always.
     */

    const ntp_poll_interval = window.setInterval(function() {
        self.poll_ntp_synchronized();
    }, 5000);

    self.close = function close() {
        window.clearInterval(updateInterval);
        window.clearInterval(ntp_poll_interval);
        client.close();
    };

    connect();
    superuser.addEventListener("reconnect", connect);
    self.update();
}

export function ServerTimeConfig() {
    const server_time = useObject(() => new ServerTime(),
                                  st => st.close(),
                                  []);
    useEvent(server_time, "changed");

    const ntp = server_time.get_ntp_status();

    const tz = server_time.get_time_zone();
    const systime_button = (
        <Button variant="link" id="system_information_systime_button"
                onClick={ () => change_systime_dialog(server_time, tz) }
                data-timedated-initialized={ntp?.initialized}
                isInline isDisabled={!superuser.allowed || !tz}>
            { server_time.format(true) }
        </Button>);

    let ntp_status = null;
    if (ntp?.active) {
        let icon; let header; let body = ""; let footer = null;
        if (ntp.synch) {
            icon = <InfoCircleIcon className="ct-info-circle" />;
            header = _("Synchronized");
            if (ntp.server)
                body = <div>{cockpit.format(_("Synchronized with $0"), ntp.server)}</div>;
        } else {
            if (ntp.server) {
                icon = <Spinner size="md" />;
                header = _("Synchronizing");
                body = <div>{cockpit.format(_("Trying to synchronize with $0"), ntp.server)}</div>;
            } else {
                icon = <ExclamationCircleIcon className="ct-exclamation-circle" />;
                header = _("Not synchronized");
                if (ntp.service) {
                    footer = (
                        <Button variant="link"
                                onClick={() => cockpit.jump("/system/services#/" +
                                                            encodeURIComponent(ntp.service))}>
                            {_("Log messages")}
                        </Button>);
                }
            }
        }

        if (ntp.sub_status) {
            body = <>{body}<div>{ntp.sub_status}</div></>;
        }

        ntp_status = (
            <Popover headerContent={header} bodyContent={body} footerContent={footer}>
                {icon}
            </Popover>);
    }

    return (
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
            {systime_button}
            {ntp_status}
        </Flex>
    );
}

function Validated({ errors, error_key, children }) {
    const error = errors?.[error_key];
    // We need to always render the <div> for the has-error
    // class so that the input field keeps the focus when
    // errors are cleared.  Otherwise the DOM changes enough
    // for the Browser to remove focus.
    return (
        <div className={error ? "ct-validation-wrapper has-error" : "ct-validation-wrapper"}>
            { children }
            { error ? <span className="help-block dialog-error">{error}</span> : null }
        </div>
    );
}

function ValidatedInput({ errors, error_key, children }) {
    const error = errors?.[error_key];
    return (
        <span className={error ? "ct-validation-wrapper has-error" : "ct-validation-wrapper"}>
            { children }
        </span>
    );
}

function ChangeSystimeBody({ state, errors, change }) {
    const [zonesOpen, setZonesOpen] = useState(false);
    const [modeOpen, setModeOpen] = useState(false);

    const {
        time_zone, time_zones,
        mode,
        manual_date, manual_time,
        ntp_supported, custom_ntp
    } = state;

    function add_server(event, index) {
        custom_ntp.servers.splice(index + 1, 0, "");
        change("custom_ntp", custom_ntp);
        event.stopPropagation();
        event.preventDefault();
        return false;
    }

    function remove_server(event, index) {
        custom_ntp.servers.splice(index, 1);
        change("custom_ntp", custom_ntp);
        event.stopPropagation();
        event.preventDefault();
        return false;
    }

    function change_server(event, index, value) {
        custom_ntp.servers[index] = value;
        change("custom_ntp", custom_ntp);
        event.stopPropagation();
        event.preventDefault();
        return false;
    }

    const ntp_servers = (
        custom_ntp.servers.map((s, i) => (
            <Flex className="ntp-server-input-group" spaceItems={{ default: 'spaceItemsSm' }} key={i}>
                <FlexItem grow={{ default: 'grow' }}>
                    <TextInput value={s} placeholder={_("NTP server")} aria-label={_("NTP server")}
                               onChange={(event, value) => change_server(event, i, value)} />
                </FlexItem>
                <Button variant="secondary" onClick={event => add_server(event, i)}
                        icon={ <PlusIcon /> } />
                <Button variant="secondary" onClick={event => remove_server(event, i)}
                        icon={ <CloseIcon /> } isDisabled={i === custom_ntp.servers.length - 1} />
            </Flex>
        ))
    );

    const mode_options = [
        <SelectOption key="manual_time" value="manual_time">{_("Manually")}</SelectOption>,
        <SelectOption key="ntp_time" value="ntp_time" isDisabled={!ntp_supported}>{_("Automatically using NTP")}</SelectOption>
    ];

    if (custom_ntp.backend)
        mode_options.push(
            <SelectOption key="ntp_time_custom" value="ntp_time_custom" isDisabled={!ntp_supported}>
                { custom_ntp.backend == "chronyd"
                    ? _("Automatically using additional NTP servers")
                    : _("Automatically using specific NTP servers")
                }
            </SelectOption>);

    return (
        <Form isHorizontal>
            <FormGroup fieldId="systime-timezones" label={_("Time zone")}>
                <Validated errors={errors} error_key="time_zone">
                    <Select id="systime-timezones" variant="typeahead"
                            isOpen={zonesOpen} onToggle={(_, isOpen) => setZonesOpen(isOpen)}
                            selections={time_zone}
                            onSelect={(event, value) => { setZonesOpen(false); change("time_zone", value) }}
                            menuAppendTo="parent">
                        { time_zones.map(tz => <SelectOption key={tz} value={tz}>{tz.replaceAll("_", " ")}</SelectOption>) }
                    </Select>
                </Validated>
            </FormGroup>
            <FormGroup fieldId="change_systime" label={_("Set time")} isStack>
                <Select id="change_systime"
                        isOpen={modeOpen} onToggle={(_, isOpen) => setModeOpen(isOpen)}
                        selections={mode} onSelect={(event, value) => { setModeOpen(false); change("mode", value) }}
                        menuAppendTo="parent">
                    { mode_options }
                </Select>
                { mode == "manual_time" &&
                    <Flex spaceItems={{ default: 'spaceItemsSm' }} id="systime-manual-row">
                        <ValidatedInput errors={errors} error_key="manual_date">
                            <DatePicker id="systime-date-input"
                                        aria-label={_("Pick date")}
                                        buttonAriaLabel={_("Toggle date picker")}
                                        dateFormat={timeformat.dateShort}
                                        dateParse={timeformat.parseShortDate}
                                        invalidFormatText=""
                                        locale={timeformat.dateFormatLang()}
                                        weekStart={timeformat.firstDayOfWeek()}
                                        placeholder={timeformat.dateShortFormat()}
                                        onChange={(_, d) => change("manual_date", d)}
                                        value={manual_date}
                                        appendTo={() => document.body} />
                        </ValidatedInput>
                        <ValidatedInput errors={errors} error_key="manual_time">
                            <TimePicker id="systime-time-input"
                                        className="ct-serverTime-time-picker"
                                        time={manual_time}
                                        is24Hour
                                        menuAppendTo={() => document.body}
                                        invalidFormatErrorMessage=""
                                        onChange={(e, time, h, m, s, valid) => change("manual_time", time, valid) } />
                        </ValidatedInput>
                        <Validated errors={errors} error_key="manual_date" />
                        <Validated errors={errors} error_key="manual_time" />
                    </Flex>
                }
                { mode == "ntp_time_custom" &&
                    <Validated errors={errors} error_key="ntp_servers">
                        <div id="systime-ntp-servers">
                            { ntp_servers }
                        </div>
                    </Validated>
                }
            </FormGroup>
        </Form>
    );
}

function has_errors(errors) {
    for (const field in errors) {
        if (errors[field])
            return true;
    }
    return false;
}

function change_systime_dialog(server_time, timezone) {
    let dlg = null;
    const state = {
        time_zone: timezone,
        time_zones: null,
        mode: null,
        ntp_supported: server_time.get_ntp_supported(),
        custom_ntp: null,
        manual_time_valid: true,
    };
    let errors = { };

    function get_current_time() {
        state.manual_date = server_time.format();

        const minutes = server_time.utc_fake_now.getUTCMinutes();
        // normalize to two digits
        const minutes_str = (minutes < 10) ? "0" + minutes.toString() : minutes.toString();
        state.manual_time = `${server_time.utc_fake_now.getUTCHours()}:${minutes_str}`;
    }

    function change(field, value, isValid) {
        state[field] = value;
        errors = { };

        if (field == "mode" && value == "manual_time")
            get_current_time();

        if (field == "manual_time")
            state.manual_time_valid = value && isValid;

        update();
    }

    function validate() {
        errors = { };

        if (state.time_zone == "")
            errors.time_zone = _("Invalid timezone");

        if (state.mode == "manual_time") {
            const new_date = new Date(state.manual_date);
            if (isNaN(new_date.getTime()) || new_date.getTime() < 0)
                errors.manual_date = _("Invalid date format");

            if (!state.manual_time_valid)
                errors.manual_time = _("Invalid time format");
        }

        if (state.mode == "ntp_time_custom") {
            if (state.custom_ntp.servers.filter(s => !!s).length == 0)
                errors.ntp_servers = _("Need at least one NTP server");
        }

        return !has_errors(errors);
    }

    function apply() {
        return server_time.set_time_zone(state.time_zone)
                .then(() => {
                    if (state.mode == "manual_time") {
                        return server_time.set_ntp(false)
                                .then(() => server_time.change_time(state.manual_date,
                                                                    state.manual_time));
                    } else {
                        // Switch off NTP, write the config file, and switch NTP back on
                        state.custom_ntp.enabled = (state.mode == "ntp_time_custom");
                        state.custom_ntp.servers = state.custom_ntp.servers.filter(s => !!s);
                        return server_time.set_ntp(false)
                                .then(() => server_time.set_custom_ntp(state.custom_ntp))
                                .then(() => server_time.set_ntp(true));
                    }
                });
    }

    function update() {
        const props = {
            id: "system_information_change_systime",
            title: _("Change system time"),
            body: <ChangeSystimeBody state={state} errors={errors} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Change"),
                    style: "primary",
                    clicked: () => {
                        if (validate()) {
                            return apply();
                        } else {
                            update();
                            return Promise.reject();
                        }
                    }
                }
            ]
        };

        if (!dlg)
            dlg = show_modal_dialog(props, footer);
        else {
            dlg.setProps(props);
            dlg.setFooterProps(footer);
        }
    }

    Promise.all([server_time.get_custom_ntp(), server_time.get_timezones()])
            .then(([custom_ntp, time_zones]) => {
                if (custom_ntp.servers.length == 0)
                    custom_ntp.servers = [""];
                state.custom_ntp = custom_ntp;
                state.time_zones = time_zones;
                if (server_time.get_ntp_active()) {
                    if (custom_ntp.enabled)
                        state.mode = "ntp_time_custom";
                    else
                        state.mode = "ntp_time";
                } else {
                    state.mode = "manual_time";
                    get_current_time();
                }
                update();
            });
}
