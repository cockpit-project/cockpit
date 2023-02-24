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
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Gallery, GalleryItem } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { ExclamationCircleIcon } from '@patternfly/react-icons';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ServiceDetails } from "./service-details.jsx";
import { LogsPanel } from "cockpit-components-logs-panel.jsx";
import { superuser } from 'superuser';
import { WithDialogs } from "dialogs.jsx";

import s_bus from "./busnames.js";

import cockpit from "cockpit";

const _ = cockpit.gettext;

function debug() {
    if (window.debugging == "all" || window.debugging?.includes("service-details")) // not-covered: debugging
        console.debug.apply(console, arguments); // not-covered: debugging
}

export class Service extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            unit_id: null,
            unit_props: null,
            error: null,
            reloading: false,
        };

        this.path = null;
        this.subscriptions = [];
    }

    async componentDidMount() {
        const dbus = this.props.dbusClient;
        const [path] = await dbus.call(s_bus.O_MANAGER, s_bus.I_MANAGER, "LoadUnit", [this.props.unitId]);
        this.path = path;

        this.subscriptions.push(dbus.subscribe(
            { interface: s_bus.I_MANAGER, member: "Reloading" },
            async (_path, _iface, _signal, [reloading]) => {
                debug("Service detail", this.props.unitId, "Reloading", reloading);
                this.setState({ reloading });
                if (!reloading)
                    await this.updateProperties();
            }));

        this.subscriptions.push(dbus.subscribe(
            { path, interface: s_bus.I_PROPS, member: "PropertiesChanged" }, async () => {
                debug("Service detail", this.props.unitId, "PropertiesChanged");
                await this.updateProperties();
            }));

        /* We need this *only* to pick up failed Conditions after attempting to start a service, as the unit immediately gets
         * unloaded again and we don't get a PropertiesChanged signal. */
        this.subscriptions.push(dbus.subscribe(
            { interface: s_bus.I_MANAGER, member: "JobRemoved" }, async (_p, _i, _s, [_job_id, _job_path, unit, result]) => {
                if (unit === this.props.unitId && result === "done") {
                    debug("Service detail", this.props.unitId, "JobRemoved");
                    await this.updateProperties();
                }
            }));

        debug("Service detail", this.props.unitId, "componentDidMount, loading initial properties");
        await this.updateProperties();
    }

    componentWillUnmount() {
        this.subscriptions.forEach(s => s.remove());
        this.subscriptions = [];
        debug("Service detail", this.props.unitId, "componentWillUnmount");
    }

    async updateProperties() {
        const dbus = this.props.dbusClient;
        const unit_id = this.props.unitId;

        try {
            const [unit_props] = await dbus.call(this.path, s_bus.I_PROPS, "GetAll", [s_bus.I_UNIT]);
            // unwrap variants
            for (const key in unit_props)
                unit_props[key] = unit_props[key].v;

            if (unit_id.endsWith(".timer")) {
                const [timer_props] = await dbus.call(this.path, s_bus.I_PROPS, "GetAll", [s_bus.I_TIMER]);
                // unwrap variants
                for (const key in timer_props)
                    timer_props[key] = timer_props[key].v;
                this.props.addTimerProperties(timer_props, unit_props);
            }

            if (unit_id.endsWith(".socket")) {
                const [socket_props] = await dbus.call(this.path, s_bus.I_PROPS, "GetAll", [s_bus.I_SOCKET]);
                unit_props.Listen = socket_props.Listen.v;
            }

            unit_props.path = this.path;

            debug("Service detail", unit_id, "updated properties:", JSON.stringify(unit_props));
            this.setState({ unit_id, unit_props, error: null });
        } catch (ex) {
            this.setState({ error: ex.toString() }); // not-covered: unexpected OS error
        }
    }

    render() {
        if (this.state.error)
            return <EmptyStatePanel title={_("Loading unit failed")} icon={ExclamationCircleIcon} paragraph={this.state.error} />;

        const cur_unit_id = this.props.unitId;

        if (this.state.unit_props === null)
            return <EmptyStatePanel loading title={_("Loading...")} paragraph={cur_unit_id} />;

        const serviceDetails = <ServiceDetails unit={this.state.unit_props}
                                owner={this.props.owner}
                                permitted={superuser.allowed}
                                loadingUnits={this.state.reloading}
                                isValid={this.props.unitIsValid}
                                pinnedUnits={this.props.pinnedUnits}
        />;

        const unit_type = this.props.owner == "system" ? "UNIT" : "USER_UNIT";
        const match = [
            "_SYSTEMD_" + unit_type + "=" + cur_unit_id, "+",
            "COREDUMP_" + unit_type + "=" + cur_unit_id, "+",
            unit_type + "=" + cur_unit_id,
        ];
        const service_type = this.props.owner == "system" ? "service" : "user-service";
        const url = "/system/logs/#/?prio=debug&" + service_type + "=" + cur_unit_id;

        const load_state = this.state.unit_props.LoadState;

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
                            <GalleryItem id="service-details-unit">{serviceDetails}</GalleryItem>
                            {(load_state === "loaded" || load_state === "masked") &&
                            <GalleryItem id="service-details-logs">
                                <LogsPanel title={_("Service logs")} match={match} emptyMessage={_("No log entries")} max={10} goto_url={url} search_options={{ prio: "debug", [service_type]: cur_unit_id }} />
                            </GalleryItem>}
                        </Gallery>
                    </PageSection>
                </Page>
            </WithDialogs>
        );
    }
}
