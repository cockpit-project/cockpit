/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

export function left_click(fun) {
    return function (event) {
        if (!event || event.button !== 0)
            return;
        event.stopPropagation();
        return fun(event);
    };
}

export function icon_url(path_or_url) {
    if (!path_or_url)
        return "default.png";

    if (path_or_url[0] != '/')
        return path_or_url;

    var queryobj = {
        payload: "fsread1",
        binary: "raw",
        path: path_or_url,
    };

    if (path_or_url.endsWith(".svg")) {
        queryobj.external = {"content-type": "image/svg+xml"};
    }

    var query = window.btoa(JSON.stringify(queryobj));
    return "/cockpit/channel/" + cockpit.transport.csrf_token + '?' + query;
}

export const ProgressBar = ({ title, data }) => {
    if (data.waiting) {
        return (
            <div>
                <div className="pull-right spinner spinner-sm" />
                <div className="progress-title">
                    {_("Waiting for other programs to finish using the package manager...")}
                </div>
            </div>
        );
    } else {
        return (
            <div>
                <div className="progress-title">
                    {title}
                </div>
                <div className="progress">
                    <div className="progress-bar" style={{ "width": data.percentage + "%" }} />
                </div>
            </div>
        );
    }
};

export const CancelButton = ({ data }) => {
    return (
        <button className="btn btn-default"
                disabled={!data.cancel}
                onClick={left_click(data.cancel)}>
            {_("Cancel")}
        </button>
    );
};

export const show_error = ex => {
    if (ex.code == "cancelled")
        return;

    if (ex.code == "not-found")
        ex.detail = _("No installation package found for this application.");

    show_modal_dialog(
        {
            title: _("Error"),
            body: (
                <div className="modal-body">
                    <p>{ex.detail || ex}</p>
                </div>
            )
        },
        {
            cancel_caption: _("Close"),
            actions: [ ]
        });
};

export const launch = (comp) => {
    var i;
    for (i = 0; i < comp.launchables.length; i++) {
        if (comp.launchables[i].type == "cockpit-manifest") {
            cockpit.jump([ comp.launchables[i].name ]);
            return;
        }
    }
};
