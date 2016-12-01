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

(function() {
    "use strict";

    var cockpit = require("cockpit");
    var $ = require("jquery");

    var _ = cockpit.gettext;

    var run_sosreport_sh = require("raw!./run-sosreport.sh");

    var sos_task;
    var sos_archive_url;
    var sos_archive_files;

    function sos_init() {
        // Start right away
        sos_create();
    }

    function sos_error(message, extra) {
        $("#sos-alert, #sos-progress, #sos-download").hide();
        $("#sos-error .alert-message").text(message);
        if (extra) {
            $("#sos-error-extra").text(extra);
            $("#sos-error-extra").show();
        } else
            $("#sos-error-extra").hide();
        $("#sos-error").show();
        $("#sos-cancel").text(_("Close"));
    }

    function sos_create() {
        $("#sos-progress .progress-bar").css("width", "0%");
        $("#sos-download, #sos-error").hide();
        $("#sos-cancel").text(_("Cancel"));

        sos_archive_url = null;
        sos_archive_files = [ ];

        var task = cockpit.script(run_sosreport_sh, [ "--batch" ],
                                  { superuser: true, err: "out", pty: true });
        sos_task = task;

        // TODO - Use a real API instead of scraping stdout once such
        //        an API exists.

        var output = "";
        var progress_regex = /Running ([0-9]+)\/([0-9]+):/g;
        var archive_regex = /Your sosreport has been generated and saved in:[ \r\n]+(\/[^\r\n]+)/;

        task.stream(function (text) {
            if (sos_task == task) {
                var m, p;

                output += text;

                p = 0;
                while ((m = progress_regex.exec(output))) {
                    p = (parseInt(m[1], 10) / parseInt(m[2], 10)) * 100;
                }
                $("#sos-alert, #sos-progress").show();
                $("#sos-progress .progress-bar").css("width", p.toString() + "%");
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

                    sos_archive_files = [ archive, archive + ".md5" ];

                    var query = window.btoa(JSON.stringify({
                        payload: "fsread1",
                        binary: "raw",
                        path: archive,
                        superuser: true,
                        external: {
                            "content-disposition": 'attachment; filename="' + basename + '"',
                            "content-type": "application/x-xz, application/octet-stream"
                        }
                    }));
                    sos_archive_url = "/cockpit/channel/" + cockpit.transport.csrf_token + '?' + query;
                    $("#sos-progress, #sos-error").hide();
                    $("#sos-alert, #sos-download").show();
                    $("#sos-cancel").text(_("Close"));
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
            cockpit.spawn([ "rm" ].concat(sos_archive_files), { superuser: true, err: "message" }).
                fail(function (error) {
                    console.log("failed to remove", sos_archive_files, error);
                });
        }
        sos_archive_url = null;
        sos_archive_files =  [ ];
        $("#sos").modal('hide');
    }

    function sos_download() {
        // We download via a hidden iframe to get better control over
        // the error cases.
        var iframe = $('<iframe>').attr('src', sos_archive_url).hide();
        iframe.on('load', function (event) {
            var title = iframe.get(0).contentDocument.title;
            if (title)
                sos_error(title);
        });
        $('body').append(iframe);
    }

    function init() {
        $(function () {
            $("#sos").on("show.bs.modal", sos_init);
            $("#sos-cancel").on("click", sos_cancel);
            $('#sos-download button').on('click', sos_download);

            cockpit.translate();
            $('body').show();

            // Send a 'init' message.  This tells the tests that we
            // are ready to go.
            //
            cockpit.transport.wait(function () { });
        });
    }

    init();
}());
