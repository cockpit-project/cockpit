/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import React from "react";
import ReactDOM from "react-dom";

import '../lib/patternfly/patternfly-4-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Page/page.css";
import "page.scss";

import { LogsPanel } from "cockpit-components-logs-panel.jsx";

document.addEventListener("DOMContentLoaded", function() {
    const cur_unit_id = "certmonger.service";
    const match = [
        "_SYSTEMD_UNIT=" + cur_unit_id, "+",
        "COREDUMP_UNIT=" + cur_unit_id, "+",
        "UNIT=" + cur_unit_id
    ];
    ReactDOM.render(<LogsPanel title="Logs!" match={match} max={10} />, document.getElementById('journal-box'));
});
