/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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
import client from "./client";

import { get_page_from_location } from "./pages.jsx";

import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Page, PageBreadcrumb, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";

import { MultipathAlert } from "./multipath.jsx";

export const StoragePage = ({ location, plot_state }) => {
    const page = get_page_from_location(location);

    // XXX - global alerts here, Multipath, Anaconda

    const parent_crumbs = [];
    let pp = page.parent;
    while (pp) {
        parent_crumbs.unshift(
            <BreadcrumbItem key={pp.name} to={"#" + cockpit.location.encode(pp.location)}>
                {pp.name}
            </BreadcrumbItem>
        );
        pp = pp.parent;
    }

    return (
        <Page id="storage">
            <PageBreadcrumb stickyOnBreakpoint={{ default: "top" }}>
                <Breadcrumb>
                    { parent_crumbs }
                    <BreadcrumbItem isActive>{page.name}</BreadcrumbItem>
                </Breadcrumb>
            </PageBreadcrumb>
            <PageSection>
                <Stack hasGutter>
                    <MultipathAlert client={client} />
                    <StackItem>
                        <page.component page={page} plot_state={plot_state} {...page.props} />
                    </StackItem>
                </Stack>
            </PageSection>
        </Page>
    );
};
