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

require([
    "base1/cockpit",
    "react",
    "selinux/setroubleshoot-client",
    "selinux/setroubleshoot-view",
], function(cockpit, React, troubleshootClient, troubleshootView) {

"use strict";

var _ = cockpit.gettext;

var setroubleshoot = { };

var initStore = function(rootElement) {
    var dataStore = { };
    dataStore.domRootElement = rootElement;

    dataStore.entries = [ ];

    // connected to the dbus api of setroubleshootd
    dataStore.connected = false;

    // currently trying to connect / used for timer
    dataStore.connecting = null;

    // did we have a connection error?
    dataStore.error = false;

    dataStore.client = troubleshootClient;

    // run a fix and update the entries accordingly
    var runFix = function(alertId, analysisId) {
        var idx;
        for (idx = dataStore.entries.length - 1; idx >= 0; --idx) {
            if (dataStore.entries[idx].key == alertId)
                break;
        }
        if (idx < 0) {
            console.log("Unable to find alert entry for element requesting fix: " + alertId + " (" + analysisId + ").");
            return;
        }
        dataStore.entries[idx].fix = {
            plugin: analysisId,
            running: true,
            result: null,
            success: false,
        };
        dataStore.render();
        dataStore.client.runFix(alertId, analysisId)
            .done(function(output) {
                 dataStore.entries[idx].fix = {
                     plugin: analysisId,
                     running: false,
                     result: output,
                     success: true,
                 };
                 dataStore.render();
            })
            .fail(function(error) {
                 dataStore.entries[idx].fix = {
                     plugin: analysisId,
                     running: false,
                     result: error,
                     success: false,
                 };
                 dataStore.render();
            });
    };

    var render = function() {
        React.render(React.createElement(troubleshootView.SETroubleshootPage, {
                connected: dataStore.connected,
                connecting: dataStore.connecting,
                error: dataStore.error,
                entries: dataStore.entries,
                runFix: runFix,
            }), rootElement);
    };
    dataStore.render = render;

    /* Update an alert entry if it exists, otherwise create one
       Details: if undefined, we don't have info on them yet,
       while null means an error occurred while retrieving them
       The function doesn't trigger a render
    */
    var maybeUpdateAlert = function(localId, description, count, details) {
        // if we already know about this alert, ignore unless the repetition count changed
        var idx;
        // we start at the back because that's where we push new entries
        // if we receive an alert multiple times, this is where it will be
        for (idx = dataStore.entries.length - 1; idx >= 0; --idx) {
            if (dataStore.entries[idx].key == localId) {
                if (description === undefined || count === undefined) {
                    dataStore.entries[idx].details = details;
                    return;
                }
                // don't update newer information
                // this can happen in cases of highly frequent updates
                if (dataStore.entries[idx].count <= count) {
                    // don't tamper with the status of a fix being run
                    // new alerts might be coming in while a fix is running and we don't want
                    // to lose the progress or result

                    // only allow details to be null if the count has increased
                    if ((details !== undefined) || (dataStore.entries[idx].count < count)) {
                        dataStore.entries[idx].details = details;
                    }
                    dataStore.entries[idx].description = description;
                    dataStore.entries[idx].count = count;
                }
                return;
            }
        }
        // nothing found, so we create a new entry
        dataStore.entries.push({ key: localId, description: description, count: count, details: details, fix: null });
    };

    /* Add a list of messages and triggers getting details for each of them
       The list is added without details at first (if it's a new entry) to preserve the order
     */
    var handleMultipleMessages = function(entries) {
        var idxEntry;
        var entry;
        for (idxEntry = 0; idxEntry != entries.length; ++idxEntry) {
            entry = entries[idxEntry];
            maybeUpdateAlert(entry.localId, entry.summary, entry.reportCount, undefined);
            dataStore.getAlertDetails(entry.localId);
        }
        // make sure we render
        render();
    };

    dataStore.handleAlert = function(level, localId) {
        // right now the level is unused, since we can't access it for existing alerts

        // we receive the item details in added delayed fashion, render only once we have the full info
        dataStore.getAlertDetails(localId);
    };

    var getAlertDetails = function(id) {
        dataStore.client.getAlert(id)
            .done(function(details) {
                maybeUpdateAlert(id, details.summary, details.reportCount, details);
                render();
            })
            .fail(function(error) {
                maybeUpdateAlert(id, undefined, undefined, null);
                render();
            });
    };
    dataStore.getAlertDetails = getAlertDetails;

    var setDisconnected = function() {
        dataStore.connected = false;
        render();
    };

    var setErrorIfNotConnected = function() {
        if (dataStore.connecting === null)
            return;
        dataStore.error = true;
        render();
    };

    dataStore.connectionTimeout = 5000;

    // try to connect
    dataStore.tryConnect = function() {
        if (dataStore.connecting === null) {
            dataStore.connecting = window.setTimeout(setErrorIfNotConnected, dataStore.connectionTimeout);
            render();
            // initialize our setroubleshootd client
            dataStore.client.init()
                .done(function() {
                    dataStore.connected = true;
                    window.clearTimeout(dataStore.connecting);
                    dataStore.connecting = null;
                    render();
                    // now register a callback to get new entries and get all existing ones
                    // the order is important, since we don't want to miss an entry
                    dataStore.client.handleAlert(dataStore.handleAlert);
                    dataStore.client.getAlerts()
                        .done(handleMultipleMessages)
                        .fail(function() {
                            console.error("Unable to get setroubleshootd messages");
                            setDisconnected();
                        });
                })
                .fail(function(error) {
                    dataStore.connected = false;
                    window.clearTimeout(dataStore.connecting);
                    dataStore.connecting = null;
                    dataStore.error = true;
                    render();
                    // TODO: should we propagate the error message here?
                });
        }
    };

    // render once initially
    render();

    // try to connect immediately
    dataStore.tryConnect();

    return dataStore;
};

setroubleshoot.init = function (app) {
    setroubleshoot.dataStore = initStore(app);
};

setroubleshoot.init(document.getElementById('app'));
});

