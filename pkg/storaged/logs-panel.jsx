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

import cockpit from "cockpit";
import React from "react";

import { LogsPanel } from "cockpit-components-logs-panel.jsx";

const _ = cockpit.gettext;

export class StorageLogsPanel extends React.Component {
    render() {
        var match = [
            "_SYSTEMD_UNIT=storaged.service", "+",
            "_SYSTEMD_UNIT=udisks2.service", "+",
            "_SYSTEMD_UNIT=dm-event.service", "+",
            "_SYSTEMD_UNIT=smartd.service", "+",
            "_SYSTEMD_UNIT=multipathd.service"
        ];

        return <LogsPanel title={_("Storage Logs")} match={match} max={10} />
    }
}
