/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import '../lib/patternfly/patternfly-6-cockpit.scss';
import "polyfills";
import 'cockpit-dark-theme'; // once per page

import cockpit from "cockpit";

import React, { useState } from "react";
import { createRoot } from 'react-dom/client';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { usePageLocation, useObject, useEvent } from "hooks";

import { ApplicationList } from "./application-list.jsx";
import { Application } from "./application.jsx";
import { get_metainfo_db } from "./appstream.js";
import { show_error } from "./utils";

const App = () => {
    const [progress, setProgress] = useState({});
    const [progressTitle, setProgressTitle] = useState({});

    function action(func, arg, progress_title, id) {
        setProgressTitle({ ...progressTitle, [id]: progress_title });
        func(arg, progress => setProgress({ ...progress, [id]: progress }))
                .finally(() => setProgress({ ...progress, [id]: null }))
                .catch(show_error);
    }

    const { path } = usePageLocation();

    const metainfo_db = useObject(get_metainfo_db, null, []);
    useEvent(metainfo_db, "changed");

    if (!metainfo_db.ready)
        return <EmptyStatePanel loading />;

    if (path.length === 0) {
        return <ApplicationList metainfo_db={metainfo_db}
                                action={action}
                                appProgress={progress}
                                appProgressTitle={progressTitle} />;
    } else if (path.length == 1) {
        const id = path[0];
        return <Application metainfo_db={metainfo_db}
                            action={action}
                            progress={progress[id]}
                            id={id} />;
    } else { /* redirect */
        console.warn("not a apps location: " + path);
        cockpit.location = '';
    }
};

function init() {
    const root = createRoot(document.getElementById("apps-page"));
    root.render(<App />);
}

document.addEventListener("DOMContentLoaded", init);
