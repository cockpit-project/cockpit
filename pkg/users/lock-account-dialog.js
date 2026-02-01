/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

export const lockAccountDialog = (account) => {
    const props = {
        id: "account-confirm-lock-dialog",
        title: cockpit.format(_("Lock $0"), account.name),
    };

    const footer = {
        actions: [
            {
                style: "danger",
                caption: _("Lock"),
                clicked: () => {
                    return cockpit.spawn(["/usr/sbin/usermod", account.name, "--lock"], { superuser: "require", err: "message" })
                            .catch(err => console.warn("Failed to log user out", err));
                },
            }
        ]
    };

    show_modal_dialog(props, footer);
};
