/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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
import { superuser } from "superuser";

import '../lib/patternfly/patternfly-cockpit.scss';

const _ = cockpit.gettext;

var sos_task;
var sos_archive_url;
var sos_archive_files;

function sos_init() {
    // Start right away
    sos_create();
}

function sos_error(message, extra) {
    document.getElementById("sos-alert").setAttribute("hidden", "hidden");
    document.getElementById("sos-progress").setAttribute("hidden", "hidden");
    document.getElementById("sos-download").setAttribute("hidden", "hidden");
    document.querySelector("#sos-error .alert-message").textContent = message;

    const e_extra = document.getElementById("sos-error-extra");
    if (extra) {
        e_extra.textContent = extra;
        e_extra.removeAttribute("hidden");
    } else
        e_extra.setAttribute("hidden", "hidden");
    document.getElementById("sos-cancel").textContent = _("Close");
    document.getElementById("sos-error").removeAttribute("hidden");
}

function sos_create() {
    document.querySelector("#sos-progress .progress-bar").style.width = "0%";
    document.getElementById("sos-download").setAttribute("hidden", "hidden");
    document.getElementById("sos-error").setAttribute("hidden", "hidden");
    document.getElementById("sos-cancel").textContent = _("Cancel");

    sos_archive_url = null;
    sos_archive_files = [];

    var task = cockpit.spawn(["sosreport", "--batch"],
                             { superuser: true, err: "out", pty: true });
    sos_task = task;

    // TODO - Use a real API instead of scraping stdout once such
    //        an API exists.

    var output = "";
    var plugins_count = 0;
    var progress_regex = /Running ([0-9]+)\/([0-9]+):/; // Only for sos < 3.6
    var finishing_regex = /Finishing plugins.*\[Running: (.*)\]/;
    var starting_regex = /Starting ([0-9]+)\/([0-9]+).*\[Running: (.*)\]/;
    var archive_regex = /Your sosreport has been generated and saved in:\s+(\/[^\r\n]+)/;

    task.stream(function (text) {
        if (sos_task == task) {
            var m, p;
            p = 0;

            output += text;
            var lines = output.split("\n");
            for (var i = lines.length - 1; i >= 0; i--) {
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
            document.getElementById("sos-alert").removeAttribute("hidden");
            document.getElementById("sos-progress").removeAttribute("hidden");
            document.querySelector("#sos-progress .progress-bar").style.width = p.toString() + "%";
        }
    });
    task.done(function () {
        if (sos_task == task) {
            var m = archive_regex.exec(output);
            if (m) {
                var archive = m[1];
                var basename = archive.replace(/.*\//, "");

                // When running sosreport in a container on the
                // Atomics, the archive path needs to be adjusted.
                //
                if (archive.indexOf("/host") === 0)
                    archive = archive.substr(5);

                sos_archive_files = [archive, archive + ".md5"];

                var query = window.btoa(JSON.stringify({
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
                var prefix = (new URL(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token))).pathname;
                sos_archive_url = prefix + '?' + query;
                document.getElementById("sos-progress").setAttribute("hidden", "hidden");
                document.getElementById("sos-error").setAttribute("hidden", "hidden");
                document.getElementById("sos-alert").removeAttribute("hidden");
                document.getElementById("sos-download").removeAttribute("hidden");
                document.getElementById("sos-cancel").textContent = _("Close");
            } else {
                sos_error(_("No archive has been created."), output);
            }
            sos_task = null;
        }
    });
    task.fail(function (error) {
        if (sos_task == task) {
            sos_error(error.toString(), output);
            sos_task = null;
        }
    });
}

function sos_cancel() {
    if (sos_task) {
        sos_task.close("cancelled");
        sos_task = null;
    }
    if (sos_archive_files.length > 0) {
        cockpit.spawn(["rm"].concat(sos_archive_files), { superuser: true, err: "message" })
                .fail(function (error) {
                    console.log("failed to remove", sos_archive_files, error);
                });
    }
    sos_archive_url = null;
    sos_archive_files = [];
    document.getElementById("sos").setAttribute("hidden", "hidden");
}

function sos_download() {
    // We download via a hidden iframe to get better control over
    // the error cases.
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", sos_archive_url);
    iframe.setAttribute("hidden", "hidden");
    iframe.addEventListener("load", () => {
        const title = iframe.contentDocument.title;
        if (title)
            sos_error(title);
    });
    document.body.appendChild(iframe);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("create-button").addEventListener("click", () => {
        document.getElementById("sos").removeAttribute("hidden");
        sos_init();
    });
    document.getElementById("sos-cancel").addEventListener("click", sos_cancel);
    document.querySelector("#sos-download button").addEventListener("click", sos_download);

    cockpit.translate();
    document.body.removeAttribute("hidden");

    function update_admin_allowed() {
        document.getElementById("switch-instructions").style.display = superuser.allowed === false ? "block" : "none";
        if (superuser.allowed)
            document.getElementById("create-button").removeAttribute("hidden");
        else
            document.getElementById("create-button").setAttribute("hidden", "hidden");
    }

    superuser.addEventListener("changed", update_admin_allowed);
    update_admin_allowed();

    // Send a 'init' message.  This tells the tests that we
    // are ready to go.
    //
    cockpit.transport.wait(() => { });
});
