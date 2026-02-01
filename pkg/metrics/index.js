/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import '../lib/patternfly/patternfly-6-cockpit.scss';
import 'cockpit-dark-theme'; // once per page

import React from 'react';
import { createRoot } from "react-dom/client";
import { Application } from './metrics.jsx';

document.addEventListener("DOMContentLoaded", function () {
    const root = createRoot(document.getElementById("app"));
    root.render(React.createElement(Application, {}));
});
