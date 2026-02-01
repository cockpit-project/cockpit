/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';
import React from 'react';
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

function DeleteAccountDialogBody({ state, change }) {
    const { delete_files } = state;

    return (
        <Checkbox id="account-confirm-delete-files"
                  label={_("Delete files")}
                  isChecked={delete_files} onChange={(_event, checked) => change("delete_files", checked)} />
    );
}

export function delete_account_dialog(account) {
    let dlg = null;

    const state = {
        delete_files: false
    };

    function change(field, value) {
        state[field] = value;
        update();
    }

    function update() {
        const props = {
            id: "account-confirm-delete-dialog",
            title: cockpit.format(_("Delete $0"), account.name),
            body: <DeleteAccountDialogBody state={state} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Delete"),
                    style: "danger",
                    clicked: () => {
                        const prog = ["/usr/sbin/userdel"];
                        if (state.delete_files)
                            prog.push("-r");
                        prog.push(account.name);

                        return cockpit.spawn(prog, { superuser: "require", err: "message" })
                                .then(function () {
                                    cockpit.location.go("/");
                                });
                    }
                }
            ]
        };

        if (!dlg)
            dlg = show_modal_dialog(props, footer);
        else {
            dlg.setProps(props);
            dlg.setFooterProps(footer);
        }
    }

    update();
}
