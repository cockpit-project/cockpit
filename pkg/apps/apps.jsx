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

import '../lib/patternfly/patternfly-5-cockpit.scss';
import "polyfills";
import 'cockpit-dark-theme'; // once per page

import cockpit from "cockpit";

import React, { useState } from "react";
import { createRoot } from 'react-dom/client';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ApplicationList } from "./application-list.jsx";
import { Application } from "./application.jsx";
import { get_metainfo_db } from "./appstream.js";
import { usePageLocation, useObject, useEvent } from "hooks";
import { show_error } from "./utils.jsx";

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
                            progressTitle={progressTitle[id]}
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
