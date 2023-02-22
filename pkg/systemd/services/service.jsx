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

import { ServiceDetails } from "./service-details.jsx";
import { LogsPanel } from "cockpit-components-logs-panel.jsx";
import { superuser } from 'superuser';
import { WithDialogs } from "dialogs.jsx";

import cockpit from "cockpit";

const _ = cockpit.gettext;

export class Service extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            /* The initial load of the Services page will not call GetAll for units Properties
             * since ListUnits API call already has provided us with a subset of the Properties.
             * As a result, properties like the 'Requires' are not present in the state at this point.
             * If it's the first time to open this service's details page we need to fetch
             * the unit properties by calling getUnitByPath.
             */
            shouldFetchProps: props.unit.Names === undefined,
        };
    }

    componentDidMount() {
        if (this.state.shouldFetchProps)
            this.props.getUnitByPath(this.props.unit.path).finally(() => this.setState({ shouldFetchProps: false }));
    }

    render() {
        if (this.state.shouldFetchProps || this.props.unit.Names === undefined)
            return null;

        const serviceDetails = <ServiceDetails unit={this.props.unit}
                                owner={this.props.owner}
                                permitted={superuser.allowed}
                                loadingUnits={this.props.loadingUnits}
                                isValid={this.props.unitIsValid}
                                isPinned={this.props.isPinned}
        />;

        const unit_type = this.props.owner == "system" ? "UNIT" : "USER_UNIT";
        const cur_unit_id = this.props.unit.Id;
        const match = [
            "_SYSTEMD_" + unit_type + "=" + cur_unit_id, "+",
            "COREDUMP_" + unit_type + "=" + cur_unit_id, "+",
            unit_type + "=" + cur_unit_id,
        ];
        const service_type = this.props.owner == "system" ? "service" : "user-service";
        const url = "/system/logs/#/?prio=debug&" + service_type + "=" + cur_unit_id;

        return (
            <WithDialogs>
                <Page groupProps={{ sticky: 'top' }}
                      isBreadcrumbGrouped
                      id="service-details"
                      breadcrumb={
                          <Breadcrumb>
                              <BreadcrumbItem to={"#" + cockpit.location.href.replace(/\/[^?]*/, '')}>{_("Services")}</BreadcrumbItem>
                              <BreadcrumbItem isActive>
                                  {this.props.unit.Id}
                              </BreadcrumbItem>
                          </Breadcrumb>}>
                    <PageSection>
                        <Gallery hasGutter>
                            <GalleryItem id="service-details-unit">{serviceDetails}</GalleryItem>
                            {(this.props.unit.LoadState === "loaded" || this.props.unit.LoadState === "masked") &&
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
