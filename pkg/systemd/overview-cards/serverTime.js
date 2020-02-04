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
import moment from "moment";
import * as service from "service.js";
import $ from "jquery";

export function ServerTime() {
    var self = this;

    var client = cockpit.dbus('org.freedesktop.timedate1');
    var timedate = client.proxy();

    var time_offset = null;
    var remote_offset = null;

    this.client = client;

    self.timedate = timedate;

    this.ntp_waiting_value = null;
    this.ntp_waiting_resolve = null;

    self.timedate1_service = service.proxy("dbus-org.freedesktop.timedate1.service");
    self.timesyncd_service = service.proxy("systemd-timesyncd.service");

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

    self.updateInterval = window.setInterval(function() {
        $(self).triggerHandler("changed");
    }, 30000);

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
                    $(self).triggerHandler("changed");
                })
                .fail(function(ex) {
                    console.log("Couldn't calculate server time offset: " + cockpit.message(ex));
                });
    };

    self.change_time = function change_time(datestr, hourstr, minstr) {
        var dfd = $.Deferred();

        /*
         * The browser is brain dead when it comes to dates. But even if
         * it wasn't, or we loaded a library like moment.js, there is no
         * way to make sense of this date without a round trip to the
         * server ... the timezone is really server specific.
         */
        cockpit.spawn(["date", "--date=" + datestr + " " + hourstr + ":" + minstr, "+%s"])
                .fail(function(ex) {
                    dfd.reject(ex);
                })
                .done(function(data) {
                    var seconds = parseInt(data.trim(), 10);
                    timedate.call('SetTime', [seconds * 1000 * 1000, false, true])
                            .fail(function(ex) {
                                dfd.reject(ex);
                            })
                            .done(function() {
                                self.update();
                                dfd.resolve();
                            });
                });

        return dfd;
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

    self.ntp_updated = function ntp_updated(path, iface, member, args) {
        if (!self.ntp_waiting_resolve || !args[1].NTP)
            return;
        if (self.ntp_waiting_value !== args[1].NTP.v)
            console.warn("Unexpected value of NTP");
        self.ntp_waiting_resolve();
        self.ntp_waiting_resolve = null;
    };

    self.close = function close() {
        client.close();
    };

    self.update();
}
