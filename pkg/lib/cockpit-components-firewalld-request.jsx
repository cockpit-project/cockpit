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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
import React, { useState } from 'react';
import { Alert, AlertActionCloseButton, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Select, SelectOption } from "@patternfly/react-core/dist/esm/deprecated/components/Select/index.js";
import { Toolbar, ToolbarContent, ToolbarGroup, ToolbarItem } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
import { PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";

import cockpit from 'cockpit';
import './cockpit-components-firewalld-request.scss';

const _ = cockpit.gettext;
const firewalld = cockpit.dbus('org.fedoraproject.FirewallD1', { superuser: "try" });

function debug() {
    if (window.debugging == "all" || window.debugging?.includes("firewall"))
        console.debug.apply(console, arguments);
}

/* React component for an info alert to enable some new service in firewalld.
 * Use this when enabling some network-facing service. The alert will only be shown
 * if firewalld is running, has at least one active zone, and the service is not enabled
 * in any zone yet. It will allow the user to enable the service in any active zone,
 * or go to the firewall page  for more fine-grained configuration.
 *
 * Properties:
 *   - service (string, required): firewalld service name
 *   - title (string, required): Human readable/translated alert title
 *   - pageSection (bool, optional, default false): Render the alert inside a <PageSection>
 */
export const FirewalldRequest = ({ service, title, pageSection }) => {
    const [zones, setZones] = useState(null);
    const [selectedZone, setSelectedZone] = useState(null);
    const [zoneSelectorOpened, setZoneSelectorOpened] = useState(false);
    const [enabledAnywhere, setEnabledAnywhere] = useState(null);
    const [enableError, setEnableError] = useState(null);
    debug("FirewalldRequest", service, "zones", JSON.stringify(zones), "selected zone", selectedZone, "enabledAnywhere", enabledAnywhere);

    if (!service)
        return null;

    // query zones on component initialization
    if (zones === null) {
        firewalld.call("/org/fedoraproject/FirewallD1", "org.fedoraproject.FirewallD1.zone", "getActiveZones")
                .then(([info]) => {
                    const names = Object.keys(info);
                    Promise.all(names.map(name => firewalld.call("/org/fedoraproject/FirewallD1", "org.fedoraproject.FirewallD1.zone", "getZoneSettings2", [name])))
                            .then(zoneInfos => {
                                setEnabledAnywhere(!!zoneInfos.find(zoneInfo => ((zoneInfo[0].services || {}).v || []).indexOf(service) >= 0));
                                setZones(names);
                            })
                            .catch(ex => {
                                console.warn("FirewalldRequest: getZoneSettings failed:", JSON.stringify(ex));
                                setZones([]);
                            });

                    firewalld.call("/org/fedoraproject/FirewallD1", "org.fedoraproject.FirewallD1", "getDefaultZone")
                            .then(([zone]) => setSelectedZone(zone))
                            .catch(ex => console.warn("FirewalldRequest: getDefaultZone failed:", JSON.stringify(ex)));
                })
                .catch(ex => {
                    // firewalld not running
                    debug("FirewalldRequest: getActiveZones failed, considering firewall inactive:", JSON.stringify(ex));
                    setZones([]);
                });
    }

    const onAddService = () => {
        firewalld.call("/org/fedoraproject/FirewallD1", "org.fedoraproject.FirewallD1.zone", "addService",
                       [selectedZone, service, 0])
                // permanent config
                .then(() => firewalld.call("/org/fedoraproject/FirewallD1/config",
                                           "org.fedoraproject.FirewallD1.config",
                                           "getZoneByName", [selectedZone]))
                .then(([path]) => firewalld.call(path, "org.fedoraproject.FirewallD1.config.zone", "addService", [service]))
                // all successful, hide alert
                .then(() => setEnabledAnywhere(true))
                .catch(ex => {
                    // may already be enabled in permanent config, that's ok
                    if (ex.message && ex.message.indexOf("ALREADY_ENABLED") >= 0) {
                        setEnabledAnywhere(true);
                        return;
                    }

                    setEnableError(ex.toString());
                    setEnabledAnywhere(true);
                    console.error("Failed to enable", service, "in firewalld:", JSON.stringify(ex));
                });
    };

    let alert;

    if (enableError) {
        alert = (
            <Alert isInline variant="warning"
                   title={ cockpit.format(_("Failed to enable $0 in firewalld"), service) }
                   actionClose={ <AlertActionCloseButton onClose={ () => setEnableError(null) } /> }
                   actionLinks={
                       <AlertActionLink onClick={() => cockpit.jump("/network/firewall")}>
                           { _("Visit firewall") }
                       </AlertActionLink>
                   }>
                {enableError}
            </Alert>
        );
    // don't show anything if firewalld is not active, or service is already enabled somewhere
    } else if (!zones || zones.length === 0 || !selectedZone || enabledAnywhere) {
        return null;
    } else {
        alert = (
            <Alert isInline variant="info" title={title} className="pf-v5-u-box-shadow-sm">
                <Toolbar className="ct-alert-toolbar">
                    <ToolbarContent>
                        <ToolbarGroup spaceItems={{ default: "spaceItemsMd" }}>
                            <ToolbarItem variant="label">{ _("Zone") }</ToolbarItem>
                            <ToolbarItem>
                                <Select
                                    aria-label={_("Zone")}
                                    onToggle={(_event, isOpen) => setZoneSelectorOpened(isOpen)}
                                    isOpen={zoneSelectorOpened}
                                    onSelect={ (e, sel) => { setSelectedZone(sel); setZoneSelectorOpened(false) } }
                                    selections={selectedZone}
                                    toggleId={"firewalld-request-" + service}>
                                    { zones.map(zone => <SelectOption key={zone} value={zone}>{zone}</SelectOption>) }
                                </Select>
                            </ToolbarItem>

                            <ToolbarItem>
                                <Button variant="primary" onClick={onAddService}>{ cockpit.format(_("Add $0"), service) }</Button>
                            </ToolbarItem>
                        </ToolbarGroup>

                        <ToolbarItem variant="separator" />

                        <ToolbarItem>
                            <Button variant="link" onClick={() => cockpit.jump("/network/firewall")}>
                                { _("Visit firewall") }
                            </Button>
                        </ToolbarItem>
                    </ToolbarContent>
                </Toolbar>
            </Alert>
        );
    }

    if (pageSection)
        return <PageSection className="ct-no-bottom-padding">{alert}</PageSection>;
    else
        return alert;
};
