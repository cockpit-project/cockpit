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

import React, { useRef, useState } from "react";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Gallery, GalleryItem } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { ExclamationCircleIcon } from '@patternfly/react-icons';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ServiceDetails } from "./service-details.jsx";
import { LogsPanel } from "cockpit-components-logs-panel.jsx";
import { superuser } from 'superuser';
import { WithDialogs } from "dialogs.jsx";

import cockpit from "cockpit";
import { useObject } from "hooks";

import s_bus from "./busnames.js";

const _ = cockpit.gettext;

function debug() {
    if (window.debugging == "all" || window.debugging?.includes("service-details")) // not-covered: debugging
        console.debug.apply(console, arguments); // not-covered: debugging
}

export const Service = ({ dbusClient, owner, unitId, unitIsValid, addTimerProperties, pinnedUnits }) => {
    const _path = useRef(null);
    const [error, setError] = useState(null);
    const [reloading, setReloading] = useState(false);
    const [unitProps, setUnitProps] = useState(null);

    const updateProperties = async () => {
        const path = _path.current?.path;
        try {
            const [unit_props] = await dbusClient.call(path, s_bus.I_PROPS, "GetAll", [s_bus.I_UNIT]);
            // unwrap variants
            for (const key in unit_props)
                unit_props[key] = unit_props[key].v;

            if (unitId.endsWith(".timer")) {
                const [timer_props] = await dbusClient.call(path, s_bus.I_PROPS, "GetAll", [s_bus.I_TIMER]);
                addTimerProperties(timer_props, unit_props);
            }

            if (unitId.endsWith(".socket")) {
                const [socket_props] = await dbusClient.call(path, s_bus.I_PROPS, "GetAll", [s_bus.I_SOCKET]);
                unit_props.Listen = socket_props.Listen.v;
            }

            unit_props.path = path;

            debug("Service detail", unitId, "updated properties:", JSON.stringify(unit_props));
            setUnitProps(unit_props);
            setError(null);
        } catch (ex) {
            setError(ex.toString()); // not-covered: unexpected OS error
        }
    };

    // load object path and set up PropertiesChanged subscription whenever unitId changes
    useObject(
        () => {
            dbusClient.call(s_bus.O_MANAGER, s_bus.I_MANAGER, "LoadUnit", [unitId])
                    .then(([path]) => {
                        debug("Service detail", unitId, "loaded path", path);

                        _path.current?.propSub.remove();
                        const propSub = dbusClient.subscribe(
                            { path, interface: s_bus.I_PROPS, member: "PropertiesChanged" }, () => {
                                debug("Service detail", unitId, "PropertiesChanged; path", path);
                                updateProperties();
                            });

                        _path.current = { unitId, path, propSub };

                        // initial load
                        updateProperties();
                    })
                    .catch(ex => setError(ex.toString())); // not-covered: unexpected OS error
        },
        null, [unitId]);

    useObject(
        () => dbusClient.subscribe(
            { interface: s_bus.I_MANAGER, member: "Reloading" },
            async (_, _i, _s, [is_reloading]) => {
                debug("Service detail", unitId, "Reloading", is_reloading, "current unit", _path.current?.path);
                setReloading(is_reloading);
                if (!is_reloading && _path.current)
                    await updateProperties();
            }),
        sub => sub.remove(), []);

    /* We need this *only* to pick up failed Conditions after attempting to start a service, as the unit immediately gets
    * unloaded again and we don't get a PropertiesChanged signal. */
    useObject(
        () => dbusClient.subscribe(
            { interface: s_bus.I_MANAGER, member: "JobRemoved" }, async (_p, _i, _s, [_job_id, _job_path, unit, result]) => {
                if (result === "done" && unitId === _path.current?.unitId) {
                    debug("Service detail", unitId, "JobRemoved", _path.current?.path);
                    await updateProperties();
                }
            }),
        sub => sub.remove(), []);

    // render
    if (error)
        return <EmptyStatePanel title={_("Loading unit failed")} icon={ExclamationCircleIcon} paragraph={error} />; // not-covered: unexpected OS error

    if (unitProps === null)
        return <EmptyStatePanel loading title={_("Loading...")} paragraph={unitId} />;

    // resolve Alias name to primary ID
    const cur_unit_id = unitProps.Id;

    const unit_type = owner == "system" ? "UNIT" : "USER_UNIT";
    const match = [
        "_SYSTEMD_" + unit_type + "=" + cur_unit_id, "+",
        "COREDUMP_" + unit_type + "=" + cur_unit_id, "+",
        unit_type + "=" + cur_unit_id,
    ];
    const service_type = owner == "system" ? "service" : "user-service";
    const url = "/system/logs/#/?prio=debug&" + service_type + "=" + cur_unit_id;
    const load_state = unitProps.LoadState;

    return (
        <WithDialogs>
            <Page groupProps={{ sticky: 'top' }}
                    isBreadcrumbGrouped
                    id="service-details"
                    breadcrumb={
                        <Breadcrumb>
                            <BreadcrumbItem to={"#" + cockpit.location.href.replace(/\/[^?]*/, '')}>{_("Services")}</BreadcrumbItem>
                            <BreadcrumbItem isActive>
                                {cur_unit_id}
                            </BreadcrumbItem>
                        </Breadcrumb>}>
                <PageSection>
                    <Gallery hasGutter>
                        <GalleryItem id="service-details-unit">
                            <ServiceDetails unit={unitProps}
                                            owner={owner}
                                            permitted={superuser.allowed}
                                            loadingUnits={reloading}
                                            isValid={unitIsValid}
                                            pinnedUnits={pinnedUnits} />
                        </GalleryItem>
                        {(load_state === "loaded" || load_state === "masked") &&
                        <GalleryItem id="service-details-logs">
                            <LogsPanel title={_("Service logs")} match={match} emptyMessage={_("No log entries")} max={10} goto_url={url} search_options={{ prio: "debug", [service_type]: cur_unit_id }} />
                        </GalleryItem>}
                    </Gallery>
                </PageSection>
            </Page>
        </WithDialogs>
    );
};
