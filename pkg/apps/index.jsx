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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import "polyfills";

import cockpit from "cockpit";

import React from "react";
import ReactDOM from 'react-dom';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ApplicationList } from "./application-list.jsx";
import { Application } from "./application.jsx";
import { get_metainfo_db } from "./appstream.js";
import { usePageLocation, useObject, useEvent } from "hooks";

import "page.scss";

const App = () => {
    const { path } = usePageLocation();

    const metainfo_db = useObject(get_metainfo_db, null, []);
    useEvent(metainfo_db, "changed");

    if (!metainfo_db.ready)
        return <EmptyStatePanel loading />;

    if (path.length === 0) {
        return <ApplicationList metainfo_db={metainfo_db} />;
    } else if (path.length == 1) {
        return <Application metainfo_db={metainfo_db} id={cockpit.location.path[0]} />;
    } else { /* redirect */
        console.warn("not a apps location: " + path);
        cockpit.location = '';
    }
};

function init() {
    ReactDOM.render(<App />, document.getElementById("apps-page"));
}

document.addEventListener("DOMContentLoaded", init);
