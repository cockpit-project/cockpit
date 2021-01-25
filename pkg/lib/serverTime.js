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
import React, { useState, useRef, useEffect } from "react";
import { Button, Popover, Select, SelectOption, SelectVariant } from '@patternfly/react-core';
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { useObject, useEvent } from "hooks.js";

import moment from "moment";
import * as service from "service.js";
import jQuery from "jquery";

import { superuser } from "superuser.js";

const _ = cockpit.gettext;

export function ServerTime() {
    var self = this;
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

    timesyncd_service.addEventListener("changed", emit_changed);

    /*
     * The time we return from here as its UTC time set to the
     * server time. This is the only way to get predictable
     * behavior and formatting of a Date() object in the absence of
     * IntlDateFormat and  friends.
     */
    Object.defineProperty(self, 'utc_fake_now', {
        enumerable: true,
        get: function get() {
            var offset = time_offset + remote_offset;
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
        if (and_time)
            return moment.utc(self.utc_fake_now).format('lll');
        return moment.utc(self.utc_fake_now).format('ll');
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

    self.change_time = function change_time(datestr, hourstr, minstr) {
        return new Promise((resolve, reject) => {
            /*
             * The browser is brain dead when it comes to dates. But even if
             * it wasn't, or we loaded a library like moment.js, there is no
             * way to make sense of this date without a round trip to the
             * server ... the timezone is really server specific.
             */
            cockpit.spawn(["date", "--date=" + datestr + " " + hourstr + ":" + minstr, "+%s"])
                    .fail(function(ex) {
                        reject(ex);
                    })
                    .done(function(data) {
                        var seconds = parseInt(data.trim(), 10);
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
                    var ifaces = { "org.freedesktop.timedate1": { NTPSynchronized: result[0].v } };
                    var data = { };
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
        var promise = new Promise((resolve, reject) => {
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

        // flag for tests that timedated proxy got activated
        if (timedate.CanNTP !== undefined && timedate1_service.unit && timedate1_service.unit.Id)
            status.initialized = true;

        status.active = timedate.NTP;
        status.synch = timedate.NTPSynchronized;

        var timesyncd_server_regex = /.*time server (.*)\./i;

        var timesyncd_status = (timesyncd_service.state == "running" &&
                                timesyncd_service.service &&
                                timesyncd_service.service.StatusText);

        if (timesyncd_service.state == "running")
            status.service = "systemd-timesyncd.service";

        if (timesyncd_status) {
            var match = timesyncd_status.match(timesyncd_server_regex);
            if (match)
                status.server = match[1];
            else if (timesyncd_status != "Idle." && timesyncd_status !== "")
                status.sub_status = timesyncd_status;
        }

        return status;
    };

    const custom_ntp_config_file = cockpit.file("/etc/systemd/timesyncd.conf.d/50-cockpit.conf",
                                                { superuser: "try" });

    self.get_custom_ntp = function () {
        /* We only support editing the configuration of
         * systemd-timesyncd, by dropping a file into
         * /etc/systemd/timesyncd.conf.d.  We assume that timesyncd is
         * used when:
         *
         * - systemd-timedated is answering for
         *   org.freedesktop.timedate1 as opposed to, say, timedatex.
         *
         * - systemd-timesyncd is actually available.
         *
         * The better alternative would be to have an API in
         * o.fd.timedate1 for managing the list of NTP server
         * candidates.
         */

        const timedate1 = timedate1_service;
        const timesyncd = timesyncd_service;

        const result = {
            supported: false,
            enabled: false,
            servers: []
        };

        if (!timedate1.exists || timedate1.unit.Id !== "systemd-timedated.service") {
            console.log("systemd-timedated not in use, ntp server configuration not supported");
            return Promise.resolve(result);
        }

        if (!timesyncd.exists) {
            console.log("systemd-timesyncd not available, ntp server configuration not supported");
            return Promise.resolve(result);
        }

        result.supported = true;

        return custom_ntp_config_file.read()
                .then(function(text) {
                    var ntp_line = "";
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
    };

    self.set_custom_ntp = function (servers, enabled) {
        var text = `# This file is automatically generated by Cockpit\n\n[Time]\n${enabled ? "" : "#"}NTP=${servers.join(" ")}\n`;

        return cockpit.spawn(["mkdir", "-p", "/etc/systemd/timesyncd.conf.d"], { superuser: "try" })
                .then(() => custom_ntp_config_file.replace(text));
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
            icon = <span className="fa fa-lg fa-info-circle" />;
            header = _("Synchronized");
            if (ntp.server)
                body = <div>{cockpit.format(_("Synchronized with $0"), ntp.server)}</div>;
        } else {
            if (ntp.server) {
                icon = <span className="spinner spinner-xs spinner-inline" />;
                header = _("Synchronizing");
                body = <div>{cockpit.format(_("Trying to synchronize with $0"), ntp.server)}</div>;
            } else {
                icon = <span className="fa fa-lg fa-exclamation-circle" />;
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

    return <>
        <span>{systime_button}</span>
        {"\n"}
        {ntp_status}
    </>;
}

function Validated({ errors, error_key, children }) {
    var error = errors && errors[error_key];
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
    var error = errors && errors[error_key];
    return (
        <span className={error ? "ct-validation-wrapper has-error" : "ct-validation-wrapper"}>
            { children }
        </span>
    );
}

function ChangeSystimeBody({ state, errors, change }) {
    const date_ref = useRef(null);
    useEffect(() => {
        if (date_ref.current)
            jQuery(date_ref.current).datepicker({
                autoclose: true,
                todayHighlight: true,
                format: 'yyyy-mm-dd'
            });
    });

    const [zonesOpen, setZonesOpen] = useState(false);
    const [modeOpen, setModeOpen] = useState(false);

    const {
        time_zone, time_zones,
        mode,
        manual_date, manual_hours, manual_minutes,
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
        <table>
            <tbody>
                { custom_ntp.servers.map((s, i) => (
                    <tr key={i}>
                        <td style={{ width: "100%" }}>
                            <input type="text" className="form-control" value={s} placeholder={_("NTP server")}
                onChange={event => change_server(event, i, event.target.value)} />
                        </td>
                        <td>
                            <button onClick={event => add_server(event, i)} className="pf-c-button pf-m-secondary">
                                <span className="fa fa-plus" />
                            </button>
                        </td>
                        <td>
                            <button onClick={event => remove_server(event, i)} className="pf-c-button pf-m-secondary"
                            disabled={i == custom_ntp.servers.length - 1}>
                                <span className="pficon-close" />
                            </button>
                        </td>
                    </tr>))
                }
            </tbody>
        </table>);

    return (
        <div className="ct-form">
            <label htmlFor="systime-timezones" className="control-label">{_("Time zone")}</label>
            <Validated errors={errors} error_key="time_zone">
                <Select id="systime-timezones" variant={SelectVariant.typeahead}
                        isOpen={zonesOpen} onToggle={setZonesOpen}
                        selections={time_zone}
                        onSelect={(event, value) => { setZonesOpen(false); change("time_zone", value) }}
                        menuAppendTo="parent">
                    { time_zones.map(tz => <SelectOption key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectOption>) }
                </Select>
            </Validated>
            <label className="control-label" htmlFor="change_systime">{_("Set time")}</label>
            <Select id="change_systime"
                    isOpen={modeOpen} onToggle={setModeOpen}
                    selections={mode} onSelect={(event, value) => { setModeOpen(false); change("mode", value) }}
                    menuAppendTo="parent">
                <SelectOption value="manual_time">{_("Manually")}</SelectOption>
                <SelectOption isDisabled={!ntp_supported} value="ntp_time">{_("Automatically using NTP")}</SelectOption>
                <SelectOption isDisabled={!ntp_supported || !custom_ntp.supported} value="ntp_time_custom">{_("Automatically using specific NTP servers")}</SelectOption>
            </Select>
            { mode == "manual_time" &&
                <div id="systime-manual-row">
                    <ValidatedInput errors={errors} error_key="manual_date">
                        <input ref={date_ref} className="form-control" id="systime-date-input"
                     value={manual_date} onChange={event => change("manual_date", event.target.value)} /> { "\n" }
                    </ValidatedInput>
                    <ValidatedInput errors={errors} error_key="manual_hours">
                        <input type='text' className="form-control" id="systime-time-hours"
                     value={manual_hours} onChange={event => change("manual_hours", event.target.value)} /> { "\n" }
                    </ValidatedInput>
                    : { "\n" }
                    <ValidatedInput errors={errors} error_key="manual_minutes">
                        <input type='text' className="form-control" id="systime-time-minutes"
                     value={manual_minutes} onChange={event => change("manual_minutes", event.target.value)}
                     onBlur={event => change("manual_minutes", event.target.value, true)} />
                    </ValidatedInput>
                    <Validated errors={errors} error_key="manual_date" />
                    <Validated errors={errors} error_key="manual_hours" />
                    <Validated errors={errors} error_key="manual_minutes" />
                </div>
            }
            { mode == "ntp_time_custom" &&
                <Validated errors={errors} error_key="ntp_servers">
                    <div id="systime-ntp-servers-row">
                        <div id="systime-ntp-servers">
                            { ntp_servers }
                        </div>
                    </div>
                </Validated>
            }
        </div>);
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
        custom_ntp: null
    };
    let errors = { };

    function get_current_time() {
        state.manual_date = server_time.format();
        state.manual_hours = server_time.utc_fake_now.getUTCHours().toString();
        state.manual_minutes = server_time.utc_fake_now.getUTCMinutes().toString();
    }

    function normalize_minutes() {
        const mins = parseInt(state.manual_minutes);
        if (mins < 10)
            state.manual_minutes = "0" + mins;
    }

    function change(field, value, commit) {
        state[field] = value;
        errors = { };

        if (field == "mode" && value == "manual_time")
            get_current_time();

        if (field == "manual_minutes" && commit)
            normalize_minutes();

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

            if (!/^[0-9]+$/.test(state.manual_hours.trim()) ||
                Number(state.manual_hours) < 0 ||
                Number(state.manual_hours) > 23)
                errors.manual_hours = _("Hours must be a number between 0 and 23");

            if (!/^[0-9]+$/.test(state.manual_minutes.trim()) ||
                Number(state.manual_minutes) < 0 ||
                Number(state.manual_minutes) > 59)
                errors.manual_minutes = _("Minutes must be a number between 0 and 59");
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
                                                                    state.manual_hours,
                                                                    state.manual_minutes));
                    } else {
                    /* HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1272085
                     *
                     * Switch off NTP, bump the clock by one microsecond to
                     * clear the NTPSynchronized status, write the config
                     * file, and switch NTP back on.
                     *
                     */
                        return server_time.set_ntp(false)
                                .then(function() {
                                    return server_time.bump_time(1);
                                })
                                .then(function() {
                                    if (state.custom_ntp.supported)
                                        return server_time.set_custom_ntp(state.custom_ntp.servers.filter(s => !!s),
                                                                          state.mode == "ntp_time_custom");
                                    else
                                        return Promise.resolve();
                                })
                                .then(function() {
                                    // NTPSynchronized should be false now.  Make
                                    // sure we pick that up immediately.
                                    server_time.poll_ntp_synchronized();
                                    return server_time.set_ntp(true);
                                });
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
                    normalize_minutes();
                }
                update();
            });
}
