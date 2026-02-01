/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
