/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import '../lib/patternfly/patternfly-5-cockpit.scss';
import cockpit from "cockpit";
import 'cockpit-dark-theme'; // once per page
import React, { useRef } from 'react';
import { createRoot } from "react-dom/client";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ModelContext } from './model-context.jsx';
import { NetworkInterfacePage } from './network-interface.jsx';
import { NetworkPage } from './network-main.jsx';
import { UsageMonitor } from './helpers.js';

import * as service from 'service.js';
import { init as initDialogs, NetworkManagerModel } from './interfaces.js';
import { superuser } from 'superuser';
import { PlotState } from 'plot';

import { useObject, useEvent, usePageLocation } from "hooks";
import { WithDialogs } from "dialogs.jsx";

const _ = cockpit.gettext;

const App = () => {
    const nmService = useObject(() => service.proxy("NetworkManager"),
                                null,
                                []);
    useEvent(nmService, "changed");

    const model = useObject(() => new NetworkManagerModel(), null, []);
    useEvent(model, "changed");

    const nmRunning_ref = useRef(undefined);
    useEvent(model.client, "owner", (event, owner) => { nmRunning_ref.current = owner !== null });

    const { path } = usePageLocation();

    useEvent(superuser, "changed");

    const usage_monitor = useObject(() => new UsageMonitor(), null, []);
    const plot_state_main = useObject(() => new PlotState(), null, []);
    const plot_state_iface = useObject(() => new PlotState(), null, []);

    if (model.curtain == 'testing' || model.curtain == 'restoring') {
        return <EmptyStatePanel loading title={model.curtain == 'testing' ? _("Testing connection") : _("Restoring connection")} />;
    }

    if (model.ready === undefined)
        return <EmptyStatePanel loading />;

    /* Show EmptyStatePanel when nm is not running */
    if (!nmRunning_ref.current) {
        if (nmService.enabled) {
            return (
                <div id="networking-nm-crashed">
                    <EmptyStatePanel icon={ ExclamationCircleIcon }
                                     title={ _("NetworkManager is not running") }
                                     action={nmService.exists ? _("Start service") : null}
                                     onAction={ nmService.start }
                                     secondary={
                                         <Button component="a"
                                                 variant="secondary"
                                                 onClick={() => cockpit.jump("/system/services#/NetworkManager.service", cockpit.transport.host)}>
                                             {_("Troubleshoot…")}
                                         </Button>
                                     } />
                </div>
            );
        } else if (!nmService.exists) {
            return (
                <div id="networking-nm-not-found">
                    <EmptyStatePanel icon={ ExclamationCircleIcon }
                                     title={ _("NetworkManager is not installed") } />

                </div>
            );
        } else {
            return (
                <div id="networking-nm-disabled">
                    <EmptyStatePanel icon={ ExclamationCircleIcon }
                                     title={ _("Network devices and graphs require NetworkManager") }
                                     action={nmService.exists ? _("Enable service") : null}
                                     onAction={() => {
                                         nmService.enable();
                                         nmService.start();
                                     }} />

                </div>
            );
        }
    }

    const interfaces = model.list_interfaces();

    /* At this point NM is running and the model is ready */
    if (path.length == 0) {
        return (
            <ModelContext.Provider value={model}>
                <WithDialogs key="1">
                    <NetworkPage privileged={superuser.allowed}
                                 operationInProgress={model.operationInProgress}
                                 usage_monitor={usage_monitor}
                                 plot_state={plot_state_main}
                                 interfaces={interfaces} />
                </WithDialogs>
            </ModelContext.Provider>
        );
    } else if (path.length == 1) {
        const iface = interfaces.find(iface => iface.Name == path[0]);

        if (iface) {
            return (
                <ModelContext.Provider value={model}>
                    <WithDialogs key="2">
                        <NetworkInterfacePage privileged={superuser.allowed}
                                              operationInProgress={model.operationInProgress}
                                              usage_monitor={usage_monitor}
                                              plot_state={plot_state_iface}
                                              interfaces={interfaces}
                                              iface={iface} />
                    </WithDialogs>
                </ModelContext.Provider>
            );
        }
    }

    return null;
};

function init() {
    initDialogs();
    const root = createRoot(document.getElementById("network-page"));
    root.render(<App />);
}

document.addEventListener("DOMContentLoaded", init);
