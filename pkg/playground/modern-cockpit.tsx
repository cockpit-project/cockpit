/*
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useEffect, useReducer } from "react";
import { createRoot } from 'react-dom/client';

import { get_session_controller } from 'cockpit/session';

/* A minimal page that uses the modern 'cockpit/...' APIs without
   loading the old 'cockpit' module.
 */

const Demo = () => {
    const controller = get_session_controller();
    const [, forceUpdate] = useReducer(x => x + 1, 0);

    useEffect(() => {
        forceUpdate();
        return controller.on("changed", forceUpdate);
    }, [controller]);

    return (
        <>
            <div id="active">{controller.active ? "Active" : "Inactive"}</div>
            <div id="countdown">{controller.countdown}</div>
        </>
    );
};

document.addEventListener("DOMContentLoaded", async function() {
    createRoot(document.getElementById('app')!).render(<Demo />);
});
