/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from 'cockpit';
import React from 'react';

import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

export function Validated({ errors, error_key, children }) {
    const error = errors?.[error_key];
    // We need to always render the <div> for the has-error
    // class so that the input field keeps the focus when
    // errors are cleared.  Otherwise the DOM changes enough
    // for the Browser to remove focus.
    return (
        <div className={error ? "ct-validation-wrapper has-error" : "ct-validation-wrapper"}>
            { children }
            { error ? <span className="help-block dialog-error">{error}</span> : null }
        </div>
    );
}

export function has_errors(errors) {
    for (const field in errors) {
        if (errors[field])
            return true;
    }
    return false;
}

function show_error_dialog(title, message) {
    const props = {
        id: "error-popup",
        title,
        body: <p>{message}</p>
    };

    const footer = {
        actions: [],
        cancel_button: { text: _("Close"), variant: "secondary" }
    };

    show_modal_dialog(props, footer);
}

export function show_unexpected_error(error) {
    show_error_dialog(_("Unexpected error"), error.message || error);
}

export function is_valid_char_name(c) {
    return (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '.' || c == '_' || c == '-';
}
