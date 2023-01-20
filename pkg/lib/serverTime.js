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
import {
    Button, DatePicker,
    Flex,
    Form, FormGroup,
    Popover,
    Select, SelectOption, SelectVariant,
    Checkbox,
    Spinner, TimePicker
} from '@patternfly/react-core';
import { CloseIcon, ExclamationCircleIcon, InfoCircleIcon, PlusIcon } from "@patternfly/react-icons";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { useObject, useEvent } from "hooks.js";

import * as service from "service.js";
import * as timeformat from "timeformat.js";

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
    const ntpd_service = service.proxy("ntpd.service");
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
        return cockpit.resolve();
    };

    self.update = function update() {
        return cockpit.spawn(["date", "+%s:%z"], { err: "message" })
                .done(function(data) {
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
                .fail(function(ex) {
                    console.log("Couldn't calculate server time offset: " + cockpit.message(ex));
                });
    };

    self.change_time = function change_time(datestr, timestr) {
        return new Promise((resolve, reject) => {
            /*
             * There is no way to make sense of this date without a round trip to the
             * server, as the timezone is really server specific.
             */
            cockpit.spawn(["date", "--date=" + datestr + " " + timestr, "+%s"])
                    .fail(function(ex) {
                        reject(ex);
                    })
                    .done(function(data) {
                        const seconds = parseInt(data.trim(), 10);
                        timedate.call('SetTime', [seconds * 1000 * 1000, false, true])
                                .fail(function(ex) {
                                    reject(ex);
                                })
                                .done(function() {
                                    self.update();
                                    resolve();
                                });
                    });
        });
    };

    self.bump_time = function (millis) {
        return timedate.call('SetTime', [millis, true, true]);
    };

    self.get_time_zone = function () {
        return timedate.Timezone;
    };

    self.set_time_zone = function (tz) {
        return timedate.call('SetTimezone', [tz, true]);
    };

    self.poll_ntp_synchronized = function poll_ntp_synchronized() {
        client.call(timedate.path,
                    "org.freedesktop.DBus.Properties", "Get", ["org.freedesktop.timedate1", "NTPSynchronized"])
                .fail(function(error) {
                    if (error.name != "org.freedesktop.DBus.Error.UnknownProperty" &&
                        error.problem != "not-found")
                        console.log("can't get NTPSynchronized property", error);
                })
                .done(function(result) {
                    const ifaces = { "org.freedesktop.timedate1": { NTPSynchronized: result[0].v } };
                    const data = { };
                    data[timedate.path] = ifaces;
                    client.notify(data);
                });
    };

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
                .done(function(result) {
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
                                console.error(e.message);
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
            ntpd_service.exists !== null &&
            chronyd_service.exists !== null)
            status.initialized = true;

        status.active = timedate.NTP;
        status.synch = timedate.NTPSynchronized;

        const timesyncd_server_regex = /.*time server (.*)\./i;

        const timesyncd_status = (timesyncd_service.state == "running" &&
                                timesyncd_service.service &&
                                timesyncd_service.service.StatusText);

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

    function service_available(s) {
        return s.exists && s.unit.LoadState != "masked";
    }

    function get_timesync_backend() {
        // We assume chronyd > ntpd > timesyncd.  If the assumption
        // turns out to be wrong, we will tell the user afterwards.
        if (service_available(chronyd_service)) {
            return "chronyd";
        } else if (service_available(ntpd_service)) {
            return null;
        } else if (service_available(timesyncd_service)) {
            return "timesyncd";
        } else {
            return null;
        }
    }

    function get_ntp_config_timesyncd() {
        const custom_ntp_config_file = cockpit.file("/etc/systemd/timesyncd.conf.d/50-cockpit.conf",
                                                    { superuser: "try" });

        const result = {
            backend: "timesyncd",
            supported: true,
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

    function set_ntp_config_timesyncd(config) {
        const custom_ntp_config_file = cockpit.file("/etc/systemd/timesyncd.conf.d/50-cockpit.conf",
                                                    { superuser: "try" });

        const text = `# This file is automatically generated by Cockpit\n\n[Time]\n${config.enabled ? "" : "#"}NTP=${config.servers.join(" ")}\n`;

        return cockpit.spawn(["mkdir", "-p", "/etc/systemd/timesyncd.conf.d"], { superuser: "try" })
                .then(() => custom_ntp_config_file.replace(text));
    }

    function find_file_and_read(names, first) {
        if (first === undefined)
            first = 0;
        if (first >= names.length)
            return Promise.reject(new Error("Found none of " + names.join(",")));
        return cockpit.file(names[first], { superuser: "try" }).read()
                .then(text => {
                    if (text)
                        return [names[first], text];
                    return find_file_and_read(names, first + 1);
                });
    }

    function get_ntp_config_chronyd() {
        return find_file_and_read(["/etc/chrony.conf", "/etc/chrony/chrony.conf"])
                .then(([name, text]) => {
                    const result = {
                        supported: true,
                        backend: "chronyd",
                        file: name,
                        standard: [],
                        sources: [],
                        extra: []
                    };

                    let in_cockpit_section = false;
                    for (const line of text.split("\n")) {
                        if (line == "# Added by Cockpit") {
                            in_cockpit_section = true;
                        } else {
                            const fields = line.split(" ");
                            if (fields[0] == "server") {
                                if (in_cockpit_section) {
                                    result.extra.push(fields[1]);
                                } else {
                                    result.standard.push({ name: fields[1], enabled: true });
                                }
                            } else {
                                in_cockpit_section = false;
                                if (fields[0] == "pool")
                                    result.standard.push({ name: fields[1], enabled: true });
                                if (fields[0] == "#pool" || fields[0] == "#server")
                                    result.standard.push({ name: fields[1], enabled: false });
                                if (fields[0] == "sourcedir")
                                    result.sources.push({ name: fields[1], enabled: true });
                                if (fields[0] == "#sourcedir")
                                    result.sources.push({ name: fields[1], enabled: false });
                            }
                        }
                    }

                    return result;
                });
    }

    function set_ntp_config_chronyd(config) {
        const chrony_file = cockpit.file(config.file, { superuser: "try" });

        function confline(line, list, name) {
            const c = list.find(e => e.name == name);
            if (!c)
                return line;
            const line_trim = line.trim();
            const line_enabled = !line_trim.startsWith("#");
            if (c.enabled && !line_enabled)
                return line_trim.substr(1);
            if (!c.enabled && line_enabled)
                return "#" + line_trim;
            return line;
        }

        return chrony_file.modify(text => {
            let new_text = "";

            let in_cockpit_section = false;
            for (const line of text.trimEnd().split("\n")) {
                if (line == "# Added by Cockpit")
                    in_cockpit_section = true;
                else {
                    const fields = line.split(" ");
                    const was_in_cockpit_section = in_cockpit_section;
                    if (fields[0] != "server")
                        in_cockpit_section = false;
                    if (!in_cockpit_section && (!was_in_cockpit_section || line != "")) {
                        if (fields[0] == "pool" || fields[0] == "#pool") {
                            new_text += confline(line, config.standard, fields[1]) + "\n";
                        } else if (fields[0] == "server" || fields[0] == "#server") {
                            new_text += confline(line, config.standard, fields[1]) + "\n";
                        } else if (fields[0] == "sourcedir" || fields[0] == "#sourcedir") {
                            new_text += confline(line, config.sources, fields[1]) + "\n";
                        } else {
                            new_text += line + "\n";
                        }
                    }
                }
            }

            const extra = config.extra.filter(e => !!e);

            if (extra.length > 0) {
                if (!new_text.endsWith("\n\n"))
                    new_text += "\n";

                new_text += "# Added by Cockpit\n";
                for (const e of extra)
                    new_text += "server " + e + "\n";
            }

            return new_text;
        });
    }

    self.get_ntp_config = function () {
        /* We support editing the configuration of systemd-timesyncd
         * or chronyd, by dropping a config file snippet that we
         * assume full control over.
         */

        const backend = get_timesync_backend();
        if (backend == "timesyncd") {
            return get_ntp_config_timesyncd();
        } else if (backend == "chronyd") {
            return get_ntp_config_chronyd();
        } else {
            return Promise.resolve({ supported: false });
        }
    };

    self.set_ntp_config = function (config) {
        if (!config || !config.supported)
            return;
        if (config.backend == "timesyncd")
            return set_ntp_config_timesyncd(config);
        if (config.backend == "chronyd")
            return set_ntp_config_chronyd(config);
    };

    self.check_timesync_backend = function () {
        function wait_enabled(proxy, name) {
            return new Promise((resolve, reject) => {
                function check() {
                    if (proxy.enabled == true) {
                        proxy.removeEventListener("changed", check);
                        window.clearTimeout(timeout);
                        resolve();
                    }
                }
                const timeout = window.setTimeout(() => {
                    proxy.removeEventListener("changed", check);
                    reject(cockpit.format(_("Unexpected OS configuration. The $0 has not been enabled. Your changes might not have had any effect."), name));
                }, 10000);
                proxy.addEventListener("changed", check);
                check();
            });
        }

        const backend = get_timesync_backend();
        if (backend == "timesyncd")
            return wait_enabled(timesyncd_service, "systemd-timesyncd.service");
        if (backend == "chronyd")
            return wait_enabled(chronyd_service, "chronyd.service");
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
                data-timedated-initialized={ntp && ntp.initialized}
                isInline isDisabled={!superuser.allowed || !tz}>
            { server_time.format(true) }
        </Button>);

    let ntp_status = null;
    if (ntp && ntp.active) {
        let icon; let header; let body = ""; let footer = null;
        if (ntp.synch) {
            icon = <InfoCircleIcon className="ct-info-circle" />;
            header = _("Synchronized");
            if (ntp.server)
                body = <div>{cockpit.format(_("Synchronized with $0"), ntp.server)}</div>;
        } else {
            if (ntp.server) {
                icon = <Spinner size="md" isSVG />;
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
    const error = errors && errors[error_key];
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
    const error = errors && errors[error_key];
    return (
        <span className={error ? "ct-validation-wrapper has-error" : "ct-validation-wrapper"}>
            { children }
        </span>
    );
}

const DynamicServerList = ({ servers, errors, change }) => {
    function add_server(event, index) {
        servers.splice(index + 1, 0, "");
        change();
        event.stopPropagation();
        event.preventDefault();
        return false;
    }

    function remove_server(event, index) {
        servers.splice(index, 1);
        change();
        event.stopPropagation();
        event.preventDefault();
        return false;
    }

    function change_server(event, index, value) {
        servers[index] = value;
        change();
        event.stopPropagation();
        event.preventDefault();
        return false;
    }

    if (servers.length == 0)
        servers.push("");

    const server_rows = (
        <table>
            <tbody>
                { servers.map((s, i) => (
                    <tr key={i}>
                        <td style={{ width: "100%" }}>
                            <input type="text" className="form-control" value={s} placeholder={_("NTP server")}
                onChange={event => change_server(event, i, event.target.value)} />
                        </td>
                        <td>
                            <Button variant="secondary" onClick={event => add_server(event, i)}
                                    icon={ <PlusIcon /> } className="add-server" />
                        </td>
                        <td>
                            <Button variant="secondary" onClick={event => remove_server(event, i)}
                                    icon={ <CloseIcon /> } className="remove-server"
                                    isDisabled={servers.length == 1 && servers[0] == ""} />
                        </td>
                    </tr>))
                }
            </tbody>
        </table>);

    return (
        <Validated errors={errors} error_key="ntp_servers">
            <div id="systime-ntp-servers-row">
                <div id="systime-ntp-servers">
                    { server_rows }
                </div>
            </div>
        </Validated>);
};

const StaticServerList = ({ servers, change, map }) => {
    function label(name) {
        if (map && map[name])
            return map[name];
        else
            return name;
    }
    return <>
        { servers.map(s => <Checkbox key={s.name}
                                            id={"cb-" + s.name}
                                            label={label(s.name)}
                                            isChecked={s.enabled}
                                            onChange={val => { s.enabled = val; change() }} />)
        }
    </>;
};

const TimesyncdConfig = ({ state, errors, change }) => {
    return <>
        <Checkbox id="cb-specific"
                         label={_("Use specific time servers")}
                         isChecked={state.enabled}
                         onChange={val => { state.enabled = val; change() }} />
        { state.enabled &&
        <DynamicServerList servers={state.servers} errors={errors} change={change} />
        }
    </>;
};

const chrony_sources_map = {
    "/run/chrony-dhcp": _("NTP servers received via DHCP"),
};

const ChronydConfig = ({ state, errors, change }) => {
    return <>
        { state.standard.length > 0 &&
        <>
            <div id="standard-servers">{_("Standard servers:")}</div>
            <StaticServerList servers={state.standard} change={change} />
        </>
        }
        { state.sources.length > 0 &&
        <>
            <div id="standard-sources">{_("Additional sources of servers:")}</div>
            <StaticServerList servers={state.sources} change={change} map={chrony_sources_map} />
        </>
        }
        <div id="additional-sources">{_("Additional servers:")}</div>
        <DynamicServerList servers={state.extra} errors={errors} change={change} />
    </>;
};

const NTPConfig = ({ state, errors, change }) => {
    if (state.backend == "timesyncd")
        return <TimesyncdConfig state={state} errors={errors} change={change} />;
    if (state.backend == "chronyd")
        return <ChronydConfig state={state} errors={errors} change={change} />;
};

function validate_ntp_config(state, errors) {
    if (state.enabled && state.servers.filter(s => !!s).length == 0)
        errors.ntp_servers = _("Need at least one NTP server");
}

function ChangeSystimeBody({ state, errors, change }) {
    const [zonesOpen, setZonesOpen] = useState(false);
    const [modeOpen, setModeOpen] = useState(false);

    const {
        time_zone, time_zones,
        mode,
        manual_date, manual_time,
        ntp_supported, ntp_config
    } = state;

    return (
        <Form isHorizontal>
            <FormGroup fieldId="systime-timezones" label={_("Time zone")}>
                <Validated errors={errors} error_key="time_zone">
                    <Select id="systime-timezones" variant={SelectVariant.typeahead}
                            isOpen={zonesOpen} onToggle={setZonesOpen}
                            selections={time_zone}
                            onSelect={(event, value) => { setZonesOpen(false); change("time_zone", value) }}
                            menuAppendTo="parent">
                        { time_zones.map(tz => <SelectOption key={tz} value={tz}>{tz.replaceAll("_", " ")}</SelectOption>) }
                    </Select>
                </Validated>
            </FormGroup>
            <FormGroup fieldId="change_systime" label={_("Set time")} isStack>
                <Select id="change_systime"
                        isOpen={modeOpen} onToggle={setModeOpen}
                        selections={mode} onSelect={(event, value) => { setModeOpen(false); change("mode", value) }}
                        menuAppendTo="parent">
                    <SelectOption value="manual_time">{_("Manually")}</SelectOption>
                    <SelectOption isDisabled={!ntp_supported} value="ntp_time">{_("Automatically using NTP")}</SelectOption>
                </Select>
                { mode == "manual_time" &&
                    <div id="systime-manual-row">
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
                    </div>
                }
                { mode == "ntp_time" &&
                <NTPConfig state={ntp_config} change={() => change("ntp_config", ntp_config)}
                             errors={errors} />
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
        ntp_config: null,
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

        if (state.mode == "ntp_time")
            validate_ntp_config(state.ntp_config, errors);

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
                        return server_time.set_ntp(false)
                                .then(() => server_time.set_ntp_config(state.ntp_config))
                                .then(() => server_time.set_ntp(true))
                                .then(() => server_time.check_timesync_backend());
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

    Promise.all([server_time.get_ntp_config(), server_time.get_timezones()])
            .then(([ntp_config, time_zones]) => {
                state.ntp_config = ntp_config;
                state.time_zones = time_zones;
                if (server_time.get_ntp_active()) {
                    state.mode = "ntp_time";
                } else {
                    state.mode = "manual_time";
                    get_current_time();
                }
                update();
            });
}
