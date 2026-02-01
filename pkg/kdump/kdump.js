/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import '../lib/patternfly/patternfly-6-cockpit.scss';
import 'polyfills'; // once per application
import 'cockpit-dark-theme'; // once per page

import cockpit from "cockpit";

import React from "react";
import { createRoot } from "react-dom/client";

import { KdumpPage } from "./kdump-view.jsx";
import * as kdumpClient from "./kdump-client.js";
import { superuser } from "superuser";
import { WithDialogs } from "dialogs.jsx";

import './kdump.scss';

superuser.reload_page_on_change();

const initStore = function(rootElement) {
    const root = createRoot(rootElement);
    const dataStore = { };
    dataStore.domRootElement = rootElement;

    dataStore.kdumpClient = new kdumpClient.KdumpClient();

    dataStore.saveSettings = settings =>
        dataStore.kdumpClient.validateSettings(settings)
                .then(() => dataStore.kdumpClient.writeSettings(settings));

    dataStore.exportConfig = settings =>
        dataStore.kdumpClient.exportConfig(settings);

    // whether we're actively trying to change the state
    dataStore.stateChanging = false;
    function setServiceState(_event, desiredState) {
        if (dataStore.stateChanging) {
            console.log("already trying to change state");
            return;
        }
        const promise = desiredState ? dataStore.kdumpClient.ensureOn() : dataStore.kdumpClient.ensureOff();
        dataStore.stateChanging = true;
        dataStore.render();
        promise
                .catch(error => console.warn("Failed to change kdump state:", error))
                .finally(() => {
                    dataStore.stateChanging = false;
                    dataStore.render();
                });
    }
    const render = function() {
        root.render(<WithDialogs>{React.createElement(KdumpPage, {
            kdumpActive: false,
            onSetServiceState: setServiceState,
            stateChanging: dataStore.stateChanging,
            reservedMemory: dataStore.kdumpMemory,
            kdumpStatus: dataStore.kdumpStatus,
            kdumpCmdlineEnabled: dataStore.crashkernel || false,
            onSaveSettings: dataStore.saveSettings,
            onCrashKernel: dataStore.kdumpClient.crashKernel,
            exportConfig: dataStore.exportConfig,
        })}</WithDialogs>);
    };
    dataStore.render = render;

    const crashkernelPromise = cockpit.file("/proc/cmdline").read()
            .then(content => {
                if (content !== null) {
                    dataStore.crashkernel = content.indexOf('crashkernel=') !== -1;
                }
            })
            .catch(err => console.error("cannot read /proc/cmdline", err));

    // read memory reserved for kdump from system
    dataStore.kdumpMemory = undefined;
    const crashsizePromise = cockpit.file("/sys/kernel/kexec_crash_size").read()
            .then(content => {
                const value = parseInt(content, 10);
                if (!isNaN(value)) {
                // if it's only a number, guess from the size what units we should use
                // https://access.redhat.com/solutions/59432 states limit to be 896MiB and the auto at 768MiB max
                // default unit is MiB
                    if (value >= 1024 * 1024)
                        dataStore.kdumpMemory = value;
                    else if (value >= 1024)
                        dataStore.kdumpMemory = value * 1024;
                    else
                        dataStore.kdumpMemory = value * 1024 * 1024;
                } else {
                    dataStore.kdumpMemory = 0;
                }
            })
            .catch(() => { dataStore.kdumpMemory = "error" });

    Promise.allSettled([crashkernelPromise, crashsizePromise]).then(render);

    // catch kdump config and service changes
    dataStore.kdumpClient.addEventListener('kdumpStatusChanged', function(event, status) {
        dataStore.kdumpStatus = status;
        render();
    });

    // render once
    render();

    return dataStore;
};

document.addEventListener("DOMContentLoaded", function() {
    initStore(document.getElementById('app'));
});
