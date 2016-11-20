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

var cockpit = require("cockpit");
var _ = cockpit.gettext;

var moment = require("moment");

var client = {};

var busName = "org.fedoraproject.Setroubleshootd";
var dbusInterface = "org.fedoraproject.SetroubleshootdIface";
var dbusPath = "/org/fedoraproject/Setroubleshootd";

var busNameFixit = "org.fedoraproject.SetroubleshootFixit";
var dbusInterfaceFixit = busNameFixit;
var dbusPathFixit = "/org/fedoraproject/SetroubleshootFixit/object";

client.init = function(capabilitiesChangedCallback) {
    client.connected = false;
    var dbusClientSeTroubleshoot = cockpit.dbus(busName);
    client.proxy = dbusClientSeTroubleshoot.proxy(dbusInterface, dbusPath);

    client.proxyFixit = cockpit.dbus(busNameFixit).proxy(dbusInterfaceFixit, dbusPathFixit);

    var dfd = cockpit.defer();

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

    client.alertCallback = null;

    function handleSignal(event, name, args) {
        if (client.alertCallback && name == "alert") {
            var level = args[0];
            var localId = args[1];
            client.alertCallback(level, localId);
        }
    }

    // register to receive calls whenever a new alert becomes available
    // signature for the alert callback: (level, localId)
    client.handleAlert = function(callback) {
        // if we didn't listen to events before, do so now
        if (!client.alertCallback) {
            client.proxy.addEventListener("signal", handleSignal);
        }
        client.alertCallback = callback;
    };

    // returns a jquery promise
      client.getAlerts = function(since) {
        var dfdResult = cockpit.defer();
        var call;
        if (since !== undefined)
            call = client.proxy.call("get_all_alerts_since", [since]);
        else
            call = client.proxy.call("get_all_alerts", []);
        call
            .done(function(result) {
                dfdResult.resolve(result[0].map(function(entry) {
                    return {
                        localId: entry[0],
                        summary: entry[1],
                        reportCount: entry[2],
                    };
                }));
            })
            .fail(function(ex) {
                dfdResult.reject(ex);
            });
        return dfdResult.promise();
    };

    /* Return an alert with summary, audit events, fix suggestions (by id)
      localId: an alert id
      summary: a brief description of an alert. E.g.
                  "SELinux is preventing /usr/bin/bash from ioctl access on the unix_stream_socket unix_stream_socket."
      reportCount: count of reports of this alert
      auditEvent: an array of audit events (AVC, SYSCALL) connected to the alert
      pluginAnalysis: an array of plugin analysis structure
          ifText
          thenText
          doText
          analysisId: plugin id. It can be used in org.fedoraproject.SetroubleshootFixit.run_fix()
          fixable: True when an alert is fixable by a plugin
          reportBug: True when an alert should be reported
      firstSeen: when the alert was seen for the first time, momentjs object
      lastSeen: when the alert was seen for the last time, momentjs object
      level: "green", "yellow" or "red"
    */
    client.getAlert = function(localId) {
        var dfdResult = cockpit.defer();
        client.proxy.call("get_alert", [localId])
            .done(function(result) {
                var details = {
                  localId: result[0],
                  summary: result[1],
                  reportCount: result[2],
                  auditEvent: result[3],
                  pluginAnalysis: result[4],
                };
                // these values are available starting setroubleshoot-3.2.25
                // HACK https://bugzilla.redhat.com/show_bug.cgi?id=1306700
                if (result.length >= 8) {
                    // there was an API change: if the timestamps are numbers, divide by 1000
                    // so moment.js can parse them correctly by default
                    if (typeof(result[5]) === "number") {
                        result[5] /= 1000;
                        result[6] /= 1000;
                    }
                    details.firstSeen = moment(result[5]);
                    details.lastSeen = moment(result[6]);
                    details.level = result[7];
                }
                // cleanup analysis
                details.pluginAnalysis = details.pluginAnalysis.map(function(itm) {
                    return {
                        ifText: itm[0],
                        thenText: itm[1],
                        doText: itm[2],
                        analysisId: itm[3],
                        fixable: itm[4],
                        reportBug: itm[5],
                    };
                });
                dfdResult.resolve(details);
            })
            .fail(function(ex) {
                console.warn("Unable to get alert for id " + localId);
                console.warn(ex);
                dfdResult.reject(new Error(cockpit.format(_("Unable to get alert: $0"), localId)));
            });
        return dfdResult.promise();
    };

    /* Run a fix via SetroubleshootFixit
       The analysisId is given as part of pluginAnalysis entries in alert details
     */
    client.runFix = function(alertId, analysisId) {
        var dfdResult = cockpit.defer();
        client.proxyFixit.call("run_fix", [alertId, analysisId])
            .done(function(result) {
                dfdResult.resolve(result[0]);
            })
            .fail(function(ex) {
                dfdResult.reject(new Error(cockpit.format(_("Unable to run fix: %0"), + ex)));
            });
        return dfdResult.promise();
    };

    /* Delete an alert from the database (will be removed for all users), returns true on success
     * Only assign this to the client variable if the dbus interface actually supports the operation
     */
    var deleteAlert = function(localId) {
        var dfdResult = cockpit.defer();
        client.proxy.call("delete_alert", [localId])
            .done(function(success) {
                if (success)
                    dfdResult.resolve();
                else
                    dfdResult.reject(new Error(cockpit.format(_("Failed to delete alert: $0"), localId)));
            })
            .fail(function(ex) {
                console.warn("Unable to delete alert with id " + localId);
                console.warn(ex);
                dfdResult.reject(new Error(cockpit.format(_("Error while deleting alert: $0"), localId)));
            });
        return dfdResult.promise();
    };

    // earlier versions of the dbus interface don't support alert deletion/dismissal
    // HACK https://bugzilla.redhat.com/show_bug.cgi?id=1306700
    // once every client we ship to handles these features, we can remove the capabilities check
    client.capabilities = { };

    // wait for metadata - if this has the method delete_alert, we can use that
    dbusClientSeTroubleshoot.addEventListener("meta", function(event, meta) {
        if (dbusInterface in meta && 'methods' in meta[dbusInterface] && 'delete_alert' in meta[dbusInterface].methods)
            client.capabilities.deleteAlert = deleteAlert;
        else
            delete client.capabilities.deleteAlert;

        if (capabilitiesChangedCallback)
            capabilitiesChangedCallback(client.capabilities);
    });

    // connect to dbus and start setroubleshootd
    return dfd.promise();
};

module.exports = client;
