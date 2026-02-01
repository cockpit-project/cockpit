/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
