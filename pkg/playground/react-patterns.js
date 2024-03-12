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

import cockpit from "cockpit";
import React from "react";

import '../lib/patternfly/patternfly-5-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Page/page.css";

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

import { PatternDialogBody } from "./react-demo-dialog.jsx";
import { showCardsDemo } from "./react-demo-cards.jsx";
import { showUploadDemo } from "./react-demo-file-upload.jsx";
import { showFileAcDemo, showFileAcDemoPreselected } from "./react-demo-file-autocomplete.jsx";

/* -----------------------------------------------------------------------------
  Modal Dialog
  -----------------------------------------------------------------------------
 */

let lastAction = "";

const onDialogStandardClicked = function(mode) {
    lastAction = mode;
    const dfd = cockpit.defer();
    dfd.notify("Starting something long");
    if (mode == 'steps') {
        let count = 0;
        const interval = window.setInterval(function() {
            count += 1;
            dfd.notify("Step " + count);
        }, 500);
        window.setTimeout(function() {
            window.clearTimeout(interval);
            dfd.resolve();
        }, 5000);
        dfd.promise.cancel = function() {
            window.clearTimeout(interval);
            dfd.notify("Canceling");
            window.setTimeout(function() {
                dfd.reject("Action canceled");
            }, 1000);
        };
    } else if (mode == 'reject') {
        dfd.reject("Some error occurred");
    } else {
        dfd.resolve();
    }
    return dfd.promise;
};

const onDialogDone = function(success) {
    const result = success ? "successful" : "Canceled";
    const action = success ? lastAction : "no action";
    document.getElementById("demo-dialog-result").textContent = "Dialog closed: " + result + "(" + action + ")";
};

const onStandardDemoClicked = (staticError) => {
    const dialogProps = {
        title: "This shouldn't be seen",
        body: React.createElement(PatternDialogBody, { clickNested: onStandardDemoClicked }),
        static_error: staticError,
    };
    // also test modifying properties in subsequent render calls
    const footerProps = {
        actions: [
            {
                clicked: onDialogStandardClicked.bind(null, 'standard action'),
                caption: "OK",
                style: 'primary',
            },
            {
                clicked: onDialogStandardClicked.bind(null, 'dangerous action'),
                caption: "Danger",
                style: 'danger',
            },
            {
                clicked: onDialogStandardClicked.bind(null, 'steps'),
                caption: "Wait",
            },
        ],
        dialog_done: onDialogDone,
    };
    const dialogObj = show_modal_dialog(dialogProps, footerProps);
    // if this failed, exit (trying to create a nested dialog)
    if (!dialogObj)
        return;
    footerProps.actions.push(
        {
            clicked: onDialogStandardClicked.bind(null, 'reject'),
            caption: "Error",
            style: 'primary',
        });
    dialogObj.setFooterProps(footerProps);
    dialogProps.title = "Example React Dialog";
    dialogObj.setProps(dialogProps);
};

document.addEventListener("DOMContentLoaded", function() {
    document.getElementById('demo-show-dialog').addEventListener("click", onStandardDemoClicked.bind(null, null), false);
    document.getElementById('demo-show-error-dialog').addEventListener("click", onStandardDemoClicked.bind(null, 'Some static error'), false);

    /* -----------------------------------------------------------------------------
      Listing Pattern
      -----------------------------------------------------------------------------
     */
    // File autocomplete
    showFileAcDemo(document.getElementById('demo-file-ac'));
    showFileAcDemoPreselected(document.getElementById('demo-file-ac-preselected'));

    // Cards
    showCardsDemo(document.getElementById('demo-cards'));

    // Upload
    showUploadDemo(document.getElementById('demo-upload'));
});
