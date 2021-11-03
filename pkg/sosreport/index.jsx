/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import React, { useState } from "react";
import ReactDOM from "react-dom";
import {
    Alert,
    Button,
    CodeBlockCode,
    EmptyState,
    EmptyStateVariant,
    EmptyStateBody,
    Modal,
    Progress,
} from "@patternfly/react-core";

import cockpit from "cockpit";
import { superuser } from "superuser";
import { useObject, useEvent } from "hooks";

import "../lib/patternfly/patternfly-4-cockpit.scss";
import "page.scss";

const _ = cockpit.gettext;

function sosCreate(setProgress, setError, setErrorDetail) {
    let output = "";
    let plugins_count = 0;
    const progress_regex = /Running ([0-9]+)\/([0-9]+):/; // Only for sos < 3.6
    const finishing_regex = /Finishing plugins.*\[Running: (.*)\]/;
    const starting_regex = /Starting ([0-9]+)\/([0-9]+).*\[Running: (.*)\]/;
    const archive_regex = /Your sosreport has been generated and saved in:\s+(\/[^\r\n]+)/;

    // TODO - Use a real API instead of scraping stdout once such an API exists
    const task = cockpit.spawn(["sos", "report", "--batch"], { superuser: true, err: "out", pty: true });

    task.archive_url = null;

    task.stream(text => {
        let p = 0;
        let m;

        output += text;
        const lines = output.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
            if ((m = starting_regex.exec(lines[i]))) {
                plugins_count = parseInt(m[2], 10);
                p = ((parseInt(m[1], 10) - m[3].split(" ").length) / plugins_count) * 100;
                break;
            } else if ((m = finishing_regex.exec(lines[i]))) {
                if (!plugins_count)
                    p = 100;
                else
                    p = ((plugins_count - m[1].split(" ").length) / plugins_count) * 100;
                break;
            } else if ((m = progress_regex.exec(lines[i]))) {
                p = (parseInt(m[1], 10) / parseInt(m[2], 10)) * 100;
                break;
            }
        }

        setProgress(p);
    });

    task.then(() => {
        const m = archive_regex.exec(output);
        if (m) {
            let archive = m[1];
            const basename = archive.replace(/.*\//, "");

            // When running sosreport in a container, the archive path needs to be adjusted
            //
            if (archive.indexOf("/host") === 0)
                archive = archive.substr(5);

            const query = window.btoa(JSON.stringify({
                payload: "fsread1",
                binary: "raw",
                path: archive,
                superuser: true,
                max_read_size: 150 * 1024 * 1024,
                external: {
                    "content-disposition": 'attachment; filename="' + basename + '"',
                    "content-type": "application/x-xz, application/octet-stream"
                }
            }));
            const prefix = (new URL(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token))).pathname;
            task.archive_url = prefix + '?' + query;
            setProgress(100);
        } else {
            setError(_("No archive has been created."));
            setErrorDetail(output);
        }
    });

    task.catch(error => {
        setError(error.toString());
        setErrorDetail(output);
    });

    return task;
}

function sosDownload(task, setError, onClose) {
    // We download via a hidden iframe to get better control over the error cases
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", task.archive_url);
    iframe.setAttribute("hidden", "hidden");
    iframe.addEventListener("load", () => {
        const title = iframe.contentDocument.title;
        if (title)
            setError(title);
        else
            onClose();
    });
    document.body.appendChild(iframe);
}

const SOSDialog = ({ onClose }) => {
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    const [errorDetail, setErrorDetail] = useState(null);

    const task = useObject(() => sosCreate(setProgress, setError, setErrorDetail),
                           task => task.close(),
                           []);

    const actions = [];

    if (task.archive_url) {
        // success
        actions.push(
            <Button id="sos-download" key="download" variant="primary" onClick={ () => sosDownload(task, setError, onClose) }>
                { _("Download report") }
            </Button>);
    } else if (!error && progress < 100) {
        // in progress
        actions.push(<Button id="sos-cancel" key="cancel" variant="secondary" onClick={ () => {
            task.close("cancelled");
            onClose();
        } }>{ _("Cancel") }</Button>);
    } else {
        // error
        actions.push(<Button key="close" variant="secondary" onClick={onClose}>{ _("Close") }</Button>);
    }

    let content;
    if (error) {
        content = <Alert variant="warning" isInline title={error}><CodeBlockCode>{errorDetail}</CodeBlockCode></Alert>;
    } else {
        content = (
            <>
                <Alert variant="info" isInline
                       title={ _("The generated archive contains data considered sensitive and its content should be reviewed by the originating organization before being passed to any third party.") } />

                <Progress id="sos-progress" value={progress} title={ progress == 100 ? _("Done!") : _("Generating report") } />
            </>
        );
    }

    return <Modal id="sos-dialog" position="top" variant="medium" isOpen onClose={onClose} actions={actions}
                  title={ _("Create diagnostic report") }>{content}</Modal>;
};

const SOSPage = () => {
    const [showDialog, setShowDialog] = useState(false);

    useEvent(superuser, "changed");

    return (
        <>
            <EmptyState variant={EmptyStateVariant.full}>
                <img className="pf-c-empty-state__icon" aria-hidden="true" src="./sosreport.png" alt="" />
                <EmptyStateBody>
                    <p>{ _("This tool will collect system configuration and diagnostic information from this system for use with diagnosing problems with the system.") }</p>
                    <p>{ _("The collected information will be stored locally on the system.") }</p>
                    { superuser.allowed || <p id="switch-instructions">{ _("You need to switch to \"Administrative access\" in order to create reports.") }</p> }
                </EmptyStateBody>

                { superuser.allowed &&
                    <Button id="create-button" variant="primary" onClick={ () => setShowDialog(true) }>
                        { _("Create report") }
                    </Button> }
            </EmptyState>

            { showDialog && <SOSDialog onClose={ () => setShowDialog(false) } /> }
        </>
    );
};

document.addEventListener("DOMContentLoaded", () => {
    cockpit.translate();
    ReactDOM.render(React.createElement(SOSPage, {}), document.getElementById('app'));
});
