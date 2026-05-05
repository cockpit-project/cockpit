/*
 * Copyright (C) 2025 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from "react";
import { createRoot, Container } from 'react-dom/client';

import '../lib/patternfly/patternfly-6-cockpit.scss';

import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

import { PatternDialogBody } from "./react-demo-dialog";
import { FileAcDemo, FileAcDemoPreselected } from "./react-demo-file-autocomplete";
import { TypeaheadDemo } from "./react-demo-typeahead";
import { MultiTypeaheadDemo } from "./react-demo-multi-typeahead";
import { CardsDemo } from "./react-demo-cards";
import { UploadDemo } from "./react-demo-file-upload";

import 'cockpit-dark-theme'; // once per page
import 'page.scss';

/* -----------------------------------------------------------------------------
  Modal Dialog
  -----------------------------------------------------------------------------
 */

let lastAction: string = "";

const onDialogStandardClicked = function(mode: string, progress_cb: (text: string, cancel?: () => void) => void) {
    lastAction = mode;

    return new Promise<void>((resolve, reject) => {
        progress_cb("Starting something long");
        if (mode == 'steps') {
            let interval: number = 0;
            const cancel = function() {
                window.clearTimeout(interval);
                progress_cb("Canceling");
                window.setTimeout(function() {
                    reject(new Error("Action canceled"));
                }, 1000);
            };
            let count = 0;
            interval = window.setInterval(function() {
                count += 1;
                progress_cb("Step " + count, cancel);
            }, 500);
            window.setTimeout(function() {
                window.clearTimeout(interval);
                resolve();
            }, 5000);
        } else if (mode == 'reject') {
            reject(new Error("Some error occurred"));
        } else {
            resolve();
        }
    });
};

const onDialogDone = function(success: boolean) {
    const result = success ? "successful" : "Canceled";
    const action = success ? lastAction : "no action";
    document.getElementById("demo-dialog-result")!.textContent = "Dialog closed: " + result + "(" + action + ")";
};

const onStandardDemoClicked = (staticError: React.ReactNode) => {
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

const ReactPatterns = () => {
    const narrow = { maxWidth: 600 };

    return (
        <Page isContentFilled className="no-masthead-sidebar">
            <PageSection>
                <h3>Select file</h3>
                <div id="demo-file-ac" style={narrow}>
                    <FileAcDemo />
                </div>
                <div id="demo-file-ac-preselected" style={narrow}>
                    <FileAcDemoPreselected />
                </div>
            </PageSection>

            <PageSection id="demo-typeahead">
                <h3>Typeahead</h3>
                <div style={narrow}>
                    <TypeaheadDemo />
                </div>
            </PageSection>

            <PageSection id="demo-multi-typeahead">
                <h3>Multi Typeahead</h3>
                <div style={narrow}>
                    <MultiTypeaheadDemo />
                </div>
            </PageSection>

            <PageSection>
                <h3>Dialogs</h3>
                <Button
                    id="demo-show-dialog"
                    onClick={onStandardDemoClicked.bind(null, null)}
                >
                    Show Dialog
                </Button>
                <Button
                    id="demo-show-error-dialog"
                    onClick={onStandardDemoClicked.bind(null, 'Some static error')}
                >
                    Show Error-Dialog
                </Button>
                <div id="demo-dialog-result" />
            </PageSection>

            <PageSection>
                <h3>Cards</h3>
                <CardsDemo />
            </PageSection>

            <PageSection id="demo-upload">
                <h3>Upload</h3>
                <div style={narrow}>
                    <UploadDemo />
                </div>
            </PageSection>
        </Page>
    );
};

function init_app(rootElement: Container) {
    const root = createRoot(rootElement);
    root.render(<ReactPatterns />);
}

document.addEventListener("DOMContentLoaded", function() {
    cockpit.transport.wait(function() {
        init_app(document.getElementById('app')!);
    });
});
