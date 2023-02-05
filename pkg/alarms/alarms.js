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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import 'polyfills'; // once per application
import 'cockpit-dark-theme'; // once per page
import cockpit from "cockpit";
import React from "react";
import { createRoot } from "react-dom/client";
import { AlarmsPage } from "./alarms-view.jsx";
import * as AlarmsClient from "./alarms-client.js";
import { superuser } from "superuser";
// import configChange from 'raw-loader!./enableAlarms.sh';
superuser.reload_page_on_change();

const init = function(rootElement) {
    const root = createRoot(rootElement);
    const dataStore = { };
    dataStore.domRootElement = rootElement;
    dataStore.AlarmsClient = new AlarmsClient.AlarmsClient();
    dataStore.saveSettings = settings =>
        dataStore.AlarmsClient.writeSettings(settings);

    dataStore.stateChanging = false;
    function setServiceState(desiredState) {
        if (dataStore.stateChanging) {
            console.log("already trying to change state");
            return;
        }
        dataStore.stateChanging = true;
        dataStore.AlarmsClient.updateConfig(desiredState);
        dataStore.stateChanging = false;
        dataStore.alarmsEnabled = desiredState;
        dataStore.render();
    }

    cockpit.file("/etc/cockpit/cockpit-alarms.conf").read()
            .catch(err => console.error("cannot read /etc/cockpit/cocpit-alarms.conf", err));

    const render = function() {
        root.render(React.createElement(AlarmsPage, {
            onSetServiceState: setServiceState,
            stateChanging: dataStore.stateChanging,
            configSettings: dataStore.configSettings,
            alarmsStatus: dataStore.alarmsEnabled,
            onSaveSettings: dataStore.saveSettings,
        }));
    };
    dataStore.render = render;

    dataStore.AlarmsClient.addEventListener('alarmsConfigChanged', function(event, configs) {
        // console.log(configs);
        dataStore.alarmsEnabled = (configs.config._internal.MODE.value == "ENABLED");
        dataStore.configSettings = configs;
        render();
    });

    render();
    return dataStore;
};

document.addEventListener("DOMContentLoaded", function() {
    init(document.getElementById('alarms-app'));
});
