/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from "react";
import { createRoot } from 'react-dom/client';

import '../lib/patternfly/patternfly-6-cockpit.scss';
import "page.scss";

import { LogsPanel } from "cockpit-components-logs-panel.jsx";

document.addEventListener("DOMContentLoaded", function() {
    const cur_unit_id = "certmonger.service";
    const match = [
        "_SYSTEMD_UNIT=" + cur_unit_id, "+",
        "COREDUMP_UNIT=" + cur_unit_id, "+",
        "UNIT=" + cur_unit_id
    ];
    const root = createRoot(document.getElementById('journal-box'));
    root.render(<LogsPanel title="Logs!" match={match} max={10} />);
});
