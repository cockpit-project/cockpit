/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

export const logoutAccountDialog = (account) => {
    const props = {
        id: "account-confirm-logout-dialog",
        title: cockpit.format(_("Logout $0"), account.name),
    };

    const footer = {
        actions: [
            {
                style: "primary",
                caption: _("Log out"),
                clicked: () => {
                    return cockpit.spawn(["loginctl", "terminate-user", account.name], { superuser: "try", err: "message" })
                            .catch(err => console.warn("Failed to log user out", err));
                },
            }
        ]
    };

    show_modal_dialog(props, footer);
};
