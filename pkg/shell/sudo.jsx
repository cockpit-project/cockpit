/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

function sudo_gain(password) {
    return cockpit.user().then(info => {
        var data = cockpit.base64_encode(info.name + ":" + password);
        // inject password into cockpit-ws cache
        cockpit.transport.control("authorize", { response: "basic:" + data });
        // allow failed and exited bridges to start again
        cockpit.transport.control("login");
        // check whether "superuser" now works, and reload everything if it does
        var ch = cockpit.channel({ payload: "null", superuser: "require" });
        return (ch.wait()
                .always(function () { ch.close() })
                .then(() => { window.location.reload(true) })
                .catch(err => {
                    if (err.problem == "access-denied")
                        err = "Sorry, this didn't work";
                    return Promise.reject(err);
                }));
    });
}

export function sudo_dialog() {
    var dialog = null;

    var password = "";

    function update() {
        var props = {
            title: "Sudo",
            body: (
                <div className=".modal-body">
                    <input type="password" value={password}
                           onChange={event => { password = event.target.value; update() }} />
                </div>
            )
        };

        var footer = {
            actions:
            [
                {
                    clicked: () => sudo_gain(password),
                    caption: "Sudo",
                    style: 'primary'
                }
            ]
        };

        if (dialog)
            dialog.setProps(props);
        else
            dialog = show_modal_dialog(props, footer);
    }

    update();
}
