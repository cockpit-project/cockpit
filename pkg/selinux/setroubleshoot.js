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
], function(cockpit, React, troubleshoot_client, troubleshoot_view) {

"use strict";

var _ = cockpit.gettext;

var setroubleshoot = { };

var init_store = function(root_element) {
    var data_store = { };
    data_store.dom_root_element = root_element;

    data_store.entries = [ ];

    // connected to the dbus api of setroubleshootd
    data_store.connected = false;

    // currently trying to connect / used for timer
    data_store.connecting = null;

    // did we have a connection error?
    data_store.error = false;

    data_store.client = troubleshoot_client;

    // run a fix and update the entries accordingly
    var run_fix = function(alert_id, analysis_id) {
        var idx;
        for (idx = data_store.entries.length - 1; idx >= 0; --idx) {
            if (data_store.entries[idx].key == alert_id)
                break;
        }
        if (idx < 0) {
            console.log("Unable to find alert entry for element requesting fix: " + alert_id + " (" + analysis_id + ").");
            return;
        }
        data_store.entries[idx].fix = {
            plugin: analysis_id,
            running: true,
            result: null,
            success: false,
        };
        data_store.render();
        data_store.client.run_fix(alert_id, analysis_id)
            .done(function(output) {
                 data_store.entries[idx].fix = {
                     plugin: analysis_id,
                     running: false,
                     result: output,
                     success: true,
                 };
                 data_store.render();
            })
            .fail(function(error) {
                 data_store.entries[idx].fix = {
                     plugin: analysis_id,
                     running: false,
                     result: error,
                     success: false,
                 };
                 data_store.render();
            });
    };

    var render = function() {
        React.render(React.createElement(troubleshoot_view.SETroubleshootPage, {
                connected: data_store.connected,
                connecting: data_store.connecting,
                error: data_store.error,
                entries: data_store.entries,
                run_fix: run_fix,
            }), root_element);
    };
    data_store.render = render;

    /* Update an alert entry if it exists, otherwise create one
       Details are only stored if a non-null value is passed
       The function doesn't trigger a render
    */
    var maybe_update_alert = function(local_id, description, count, details) {
        // if we already know about this alert, ignore unless the repetition count changed
        var idx;
        // we start at the back because that's where we push new entries
        // if we receive an alert multiple times, this is where it will be
        for (idx = data_store.entries.length - 1; idx >= 0; --idx) {
            if (data_store.entries[idx].key == local_id) {
                // don't update newer information
                // this can happen in cases of highly frequent updates
                if (data_store.entries[idx].count <= count) {
                    // don't tamper with the status of a fix being run
                    // new alerts might be coming in while a fix is running and we don't want
                    // to lose the progress or result

                    // only allow details to be null if the count has increased
                    if ((details !== null) || (data_store.entries[idx].count < count)) {
                        data_store.entries[idx].details = details;
                    }
                    data_store.entries[idx].description = description;
                    data_store.entries[idx].count = count;
                }
                return;
            }
        }
        // nothing found, so we create a new entry
        data_store.entries.push({ key: local_id, description: description, count: count, details: details, fix: null });
    };

    /* Add a list of messages and triggers getting details for each of them
       The list is added without details at first (if it's a new entry) to preserve the order
     */
    var handleMultipleMessages = function(entries) {
        var idx_entry;
        var entry;
        for (idx_entry = 0; idx_entry != entries.length; ++idx_entry) {
            entry = entries[idx_entry];
            maybe_update_alert(entry.local_id, entry.summary, entry.report_count, null);
            data_store.get_alert_details(entry.local_id);
        }
        // make sure we render
        render();
    };

    data_store.handleAlert = function(level, local_id) {
        // right now the level is unused, since we can't access it for existing alerts

        // we receive the item details in a delayed fashion, render only once we have the full info
        data_store.get_alert_details(local_id);
    };

    var get_alert_details = function(id) {
        data_store.client.get_alert(id)
            .done(function(details) {
                maybe_update_alert(id, details.summary, details.report_count, details);
                render();
            })
            .fail(function(error) {
                console.error("Unable to get setroubleshoot alert " + id + ": " + error);
                // TODO: should this result in a failing page / empty state + error page?
            });
    };
    data_store.get_alert_details = get_alert_details;

    var setDisconnected = function() {
        data_store.connected = false;
        render();
    };

    var setErrorIfNotConnected = function() {
        if (data_store.connecting === null)
            return;
        data_store.error = true;
        render();
    };

    data_store.connection_timeout = 5000;

    // try to connect
    data_store.try_connect = function() {
        if (data_store.connecting === null) {
            data_store.connecting = window.setTimeout(setErrorIfNotConnected, data_store.connection_timeout);
            render();
            // initialize our setroubleshootd client
            data_store.client.init()
                .done(function() {
                    data_store.connected = true;
                    window.clearTimeout(data_store.connecting);
                    data_store.connecting = null;
                    render();
                    // now register a callback to get new entries and get all existing ones
                    // the order is important, since we don't want to miss an entry
                    data_store.client.handle_alert(data_store.handleAlert);
                    data_store.client.get_alerts()
                        .done(handleMultipleMessages)
                        .fail(function() {
                            console.error("Unable to get setroubleshootd messages");
                            setDisconnected();
                        });
                })
                .fail(function(error) {
                    data_store.connected = false;
                    window.clearTimeout(data_store.connecting);
                    data_store.connecting = null;
                    data_store.error = true;
                    render();
                    // TODO: should we propagate the error message here?
                });
        }
    };

    // render once initially
    render();

    // try to connect immediately
    data_store.try_connect();

    return data_store;
};

setroubleshoot.init = function (app) {
    setroubleshoot.data_store = init_store(app);
};

setroubleshoot.init(document.getElementById('app'));
});

