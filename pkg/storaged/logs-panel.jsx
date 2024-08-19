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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";

import { LogsPanel } from "cockpit-components-logs-panel.jsx";

const _ = cockpit.gettext;

export class StorageLogsPanel extends React.Component {
    render() {
        const match = [
            "_SYSTEMD_UNIT=storaged.service", "+",
            "_SYSTEMD_UNIT=udisks2.service", "+",
            "_SYSTEMD_UNIT=dm-event.service", "+",
            "_SYSTEMD_UNIT=smartd.service", "+",
            "_SYSTEMD_UNIT=multipathd.service"
        ];

        const search_options = { prio: "debug", _SYSTEMD_UNIT: "storaged.service,udisks2.service,dm-event.service,smartd.service,multipathd.service" };
        const url = "/system/logs/#/?prio=debug&_SYSTEMD_UNIT=storaged.service,udisks2.service,dm-event.service,smartd.service,multipathd.service";
        return <LogsPanel title={_("Storage logs")} match={match} max={10} search_options={search_options} goto_url={url} className="contains-list" />;
    }
}
