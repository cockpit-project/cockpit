/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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
import { AlertGroup, Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";

import { useEvent } from "hooks.js";

class GlobalAlerts extends EventTarget {
    constructor() {
        super();
        this.alerts = [];
    }

    emit_changed() {
        this.dispatchEvent(new CustomEvent("changed"));
    }

    add_alert(props) {
        this.alerts.push(props);
        this.emit_changed();
    }

    filter_alerts(pred) {
        const prev_length = this.alerts.length;
        this.alerts = this.alerts.filter(pred);
        if (this.alerts.length != prev_length)
            this.emit_changed();
    }

    remove_alert(a) {
        this.filter_alerts(b => b !== a);
    }
}

export const global_alerts = new GlobalAlerts();

export const GlobalAlertGroup = () => {
    useEvent(global_alerts, "changed");

    return (
        <AlertGroup isToast isLiveRegion>
            {global_alerts.alerts.map(a =>
                <Alert key={a.title}
                       variant={a.variant}
                       title={a.title}
                       actionClose={<AlertActionCloseButton onClose={() => global_alerts.remove_alert(a)} />}>
                    {a.body}
                </Alert>)
            }
        </AlertGroup>);
};
