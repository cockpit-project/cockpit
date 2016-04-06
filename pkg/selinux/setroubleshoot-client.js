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

define([
    "jquery",
    "base1/cockpit",
], function($, cockpit) {

"use strict";
var _ = cockpit.gettext;

var client = {};

var bus_name = "org.fedoraproject.Setroubleshootd";
var dbus_interface = "org.fedoraproject.SetroubleshootdIface";
var dbus_path = "/org/fedoraproject/Setroubleshootd";

var bus_name_fixit = "org.fedoraproject.SetroubleshootFixit";
var dbus_interface_fixit = bus_name_fixit;
var dbus_path_fixit = "/org/fedoraproject/SetroubleshootFixit/object";

client.init = function() {
    client.connected = false;
    client.proxy = cockpit.dbus(bus_name).proxy(dbus_interface, dbus_path);

    client.proxy_fixit = cockpit.dbus(bus_name_fixit).proxy(dbus_interface_fixit, dbus_path_fixit);

    var dfd = $.Deferred();

    client.proxy.wait(function() {
        // HACK setroubleshootd seems to drop connections if we don't start explicitly
        client.proxy.call("start", [])
            .done(function() {
                client.connected = true;
                dfd.resolve();
            })
            .fail(function(ex) {
                dfd.reject(new Error(_("Unable to start setroubleshootd")));
            });
    });

    client.alert_callback = null;

    function handle_signal(event, name, args) {
        if (client.alert_callback && name == "alert") {
            var level = args[0];
            var local_id = args[1];
            client.alert_callback(level, local_id);
        }
    }

    // register to receive calls whenever a new alert becomes available
    // signature for the alert callback: (level, local_id)
    client.handle_alert = function(callback) {
        // if we didn't listen to events before, do so now
        if (!client.alert_callback) {
            $(client.proxy).on("signal", handle_signal);
        }
        client.alert_callback = callback;
    };

    // returns a jquery promise
    client.get_alerts = function(since) {
        var dfd_result = $.Deferred();
        var call;
        if (since !== undefined)
            call = client.proxy.call("get_all_alerts_since", [since]);
        else
            call = client.proxy.call("get_all_alerts", []);
        call
            .done(function(result) {
                dfd_result.resolve(result[0].map(function(entry) {
                    return {
                        local_id: entry[0],
                        summary: entry[1],
                        report_count: entry[2],
                    };
                }));
            })
            .fail(function(ex) {
                dfd_result.reject(ex);
            });
        return dfd_result;
    };

    /* Return an alert with summary, audit events, fix suggestions (by id)
      local_id: an alert id
      summary: a brief description of an alert. E.g.
                  "SELinux is preventing /usr/bin/bash from ioctl access on the unix_stream_socket unix_stream_socket."
      report_count: count of reports of this alert
      audit_event: an array of audit events (AVC, SYSCALL) connected to the alert
      plugin_analysis: an array of plugin analysis structure
          if_text
          then_text
          do_text
          analysis_id: plugin id. It can be used in org.fedoraproject.SetroubleshootFixit.run_fix()
          fixable: True when an alert is fixable by a plugin
          report_bug: True when an alert should be reported to bugzilla
    */
    client.get_alert = function(local_id) {
        var dfd_result = $.Deferred();
        client.proxy.call("get_alert", [local_id])
            .done(function(result) {
                var details = {
                  local_id: result[0],
                  summary: result[1],
                  report_count: result[2],
                  audit_event: result[3],
                  plugin_analysis: result[4],
                };
                // cleanup analysis
                details.plugin_analysis = details.plugin_analysis.map(function(itm) {
                    return {
                        if_text: itm[0],
                        then_text: itm[1],
                        do_text: itm[2],
                        analysis_id: itm[3],
                        fixable: itm[4],
                        report_bug: itm[5],
                    };
                });
                dfd_result.resolve(details);
            })
            .fail(function(ex) {
                console.warn("Unable to get alert for id " + local_id);
                console.warn(ex);
                dfd_result.reject(new Error(_("Unable to get alert") + ": " + local_id));
            });
        return dfd_result.promise();
    };

    /* Run a fix via SetroubleshootFixit
       The analysis_id is given as part of plugin_analysis entries in alert details
     */
    client.run_fix = function(alert_id, analysis_id) {
        var dfd_result = $.Deferred();
        client.proxy_fixit.call("run_fix", [alert_id, analysis_id])
            .done(function(result) {
                dfd_result.resolve(result[0]);
            })
            .fail(function(ex) {
                dfd_result.reject(new Error(_("Unable to run fix") + ": " + ex));
            });
        return dfd_result.promise();
    };

    // connect to dbus and start setroubleshootd
    return dfd.promise();
};

return client;

});
