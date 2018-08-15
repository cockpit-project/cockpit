/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import * as PK from "packagekit.es6";

import "cockpit-components-install-dialog.css";

const _ = cockpit.gettext;

// TODO - generalize this to arbitrary number of arguments (when needed)
function format_to_array(fmt, arg) {
    var index = fmt.indexOf("$0");
    if (index >= 0)
        return [ fmt.slice(0, index), arg, fmt.slice(index + 2) ];
    else
        return [ fmt ];
}

/* Calling install_dialog will open a dialog that lets the user
 * install the given package.
 *
 * The install_dialog function returns a promise that is fulfilled when the dialog closes after
 * a successful installation.  The promise is rejected when the user cancels the dialog.
 *
 * If the package is already installed before the dialog opens, we still go
 * through all the motions and the dialog closes successfully without doing
 * anything when the use hits "Install".
 *
 * You shouldn't call install_dialog unless you know that PackageKit is available.
 * (If you do anyway, the resulting D-Bus errors will be shown to the user.)
 */

export function install_dialog(pkg) {
    var data = null;
    var error_message = null;
    var progress_message = null;
    var cancel = null;
    var done = null;

    var prom = new Promise((resolve, reject) => { done = f => { if (f) resolve(); else reject(); } });

    var dialog = null;
    function update() {
        let extra_details = null;
        let remove_details = null;
        let footer_message = null;

        let missing_name = <strong>{pkg}</strong>;

        if (data && data.extra_names.length > 0)
            extra_details = (
                <p className="scale-up-ct">
                    {_("Additional packages:")}
                    <ul className="package-list-ct">{data.extra_names.map(id => <li>{id}</li>)}</ul>
                </p>
            );

        if (data && data.remove_names.length > 0)
            remove_details = (
                <p className="scale-up-ct">
                    <span className="pficon pficon-warning-triangle-o" /> {_("Removals:")}
                    <ul className="package-list">{data.remove_names.map(id => <li>{id}</li>)}</ul>
                </p>
            );

        if (progress_message)
            footer_message = (
                <div>
                    <div className="spinner spinner-sm" />
                    <span>{ progress_message }</span>
                </div>
            );
        else if (data && data.download_size) {
            footer_message = (
                <div>
                    { format_to_array(_("Total size: $0"), <strong>{cockpit.format_bytes(data.download_size)}</strong>) }
                </div>
            );
        }

        let body = {
            id: "dialog",
            title: _("Install Software"),
            body: (
                <div className="modal-body scroll">
                    <p>{ format_to_array(_("$0 will be installed."), missing_name) }</p>
                    { remove_details }
                    { extra_details }
                </div>
            )
        };

        let footer = {
            actions: [
                { caption: _("Install"),
                  style: "primary",
                  clicked: install_missing,
                  disabled: data == null
                }
            ],
            static_error: error_message,
            idle_message: footer_message,
            dialog_done: f => { if (!f && cancel) cancel(); done(f) }
        };

        if (dialog) {
            dialog.setProps(body);
            dialog.setFooterProps(footer);
        } else {
            dialog = show_modal_dialog(body, footer);
        }
    }

    function check_missing() {
        PK.check_missing_packages([ pkg ],
                                  p => {
                                      cancel = p.cancel;
                                      var pm = null;
                                      if (p.waiting)
                                          pm = _("Waiting for other software management operations to finish");
                                      else
                                          pm = _("Checking installed software");
                                      if (pm != progress_message) {
                                          progress_message = pm;
                                          update();
                                      }
                                  })
                .then(d => {
                    if (d.unavailable_names.length > 0)
                        error_message = cockpit.format(_("$0 is not available from any repository."),
                                                       d.unavailable_names[0]);
                    else
                        data = d;
                    progress_message = null;
                    cancel = null;
                    update();
                })
                .catch(e => {
                    progress_message = null;
                    cancel = null;
                    error_message = e.toString();
                    update();
                });
    }

    function install_missing() {
        // We need to return a Cockpit flavoured promise since we want
        // to use progress notifications.
        var dfd = cockpit.defer();

        PK.install_missing_packages(data,
                                    p => {
                                        var text = null;
                                        if (p.waiting) {
                                            text = _("Waiting for other software management operations to finish");
                                        } else if (p.package) {
                                            var fmt;
                                            if (p.info == PK.Enum.INFO_DOWNLOADING)
                                                fmt = _("Downloading $0");
                                            else if (p.info == PK.Enum.INFO_REMOVING)
                                                fmt = _("Removing $0");
                                            else
                                                fmt = _("Installing $0");
                                            text = format_to_array(fmt, <strong>{p.package}</strong>);
                                        }
                                        dfd.notify(text, p.cancel);
                                    })
                .then(() => {
                    dfd.resolve();
                })
                .catch(error => {
                    dfd.reject(error);
                });

        return dfd.promise;
    }

    update();
    check_missing();
    return prom;
}
