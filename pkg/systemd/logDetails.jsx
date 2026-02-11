/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import { journal } from "journal";
import * as timeformat from "timeformat";

import React from 'react';
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Page, PageBreadcrumb, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Gallery, GalleryItem } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";

const _ = cockpit.gettext;

const LogDetails = ({ entry }) => {
    const general = Object.keys(entry).filter(k => k !== 'MESSAGE');
    general.sort();

    const id = entry.UNIT || entry.SYSLOG_IDENTIFIER || "";
    let service = entry.USER_UNIT || entry.COREDUMP_USER_UNIT || entry._SYSTEMD_USER_UNIT || "";
    const is_user = !!service;
    service = service || entry.UNIT || entry.COREDUMP_UNIT || entry._SYSTEMD_UNIT || "";

    // Only show redirect for unit types we show
    if (["service", "target", "socket", "timer", "path"].indexOf(service.split(".").slice(-1)[0]) === -1)
        service = undefined;

    const actions = service && (
        <Button variant="link" onClick={() => cockpit.jump("/system/services#/" + service + (is_user ? "?owner=user" : "")) }>
            {cockpit.format(_("Go to $0"), service)}
        </Button>
    );

    return (
        <GalleryItem>
            <Card isPlain>
                <CardHeader actions={{ actions }}>
                    <h2 id="entry-heading">{id}</h2>
                </CardHeader>
                <CardTitle>{journal.printable(entry.MESSAGE, "MESSAGE")}</CardTitle>
                <CardBody>
                    <DescriptionList className="pf-m-horizontal-on-sm">
                        { general.map(key =>
                            <DescriptionListGroup key={key}>
                                <DescriptionListTerm>{key}</DescriptionListTerm>
                                <DescriptionListDescription data-label={key}>{journal.printable(entry[key], key)}</DescriptionListDescription>
                            </DescriptionListGroup>
                        )}
                    </DescriptionList>
                </CardBody>
            </Card>
        </GalleryItem>
    );
};

export class LogEntry extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            error: "",
            entry: null,
            loading: true,
        };

        this.goHome = this.goHome.bind(this);
    }

    componentDidMount() {
        const cursor = cockpit.location.path[0];
        journal.journalctl({ cursor, count: 1, follow: false })
                .then(entries => {
                    if (entries.length >= 1 && entries[0].__CURSOR == cursor) {
                        this.setState({ entry: entries[0], loading: false, error: "" });
                    } else
                        this.setState({ entry: null, loading: false, error: _("Journal entry not found") });
                })
                .catch(error => this.setState({ entry: null, loading: false, error }));
    }

    goHome(ev) {
        ev.preventDefault();
        let parent_options = {};
        if (cockpit.location.options.parent_options)
            parent_options = JSON.parse(cockpit.location.options.parent_options);
        cockpit.location.go('/', parent_options);
    }

    render() {
        let breadcrumb = _("Journal entry");
        let content = null;

        if (this.state.error)
            content = <EmptyStatePanel icon={ExclamationCircleIcon} title={this.state.error} />;
        else if (this.state.loading)
            content = <EmptyStatePanel loading title={ _("Loading...") } />;
        else if (this.state.entry) {
            const entry = this.state.entry;
            const date = timeformat.dateTimeSeconds(entry.__REALTIME_TIMESTAMP / 1000);

            breadcrumb = cockpit.format(_("Entry at $0"), date);
            content = <LogDetails entry={entry} />;
        }

        return (
            <Page id="log-details" className="log-details pf-m-no-sidebar">
                <PageBreadcrumb hasBodyWrapper={false} stickyOnBreakpoint={{ default: "top" }}>
                    <Breadcrumb>
                        <BreadcrumbItem onClick={this.goHome} className="pf-v6-c-breadcrumb__link">{_("Logs")}</BreadcrumbItem>
                        <BreadcrumbItem isActive>
                            {breadcrumb}
                        </BreadcrumbItem>
                    </Breadcrumb>
                </PageBreadcrumb>
                <PageSection hasBodyWrapper={false}>
                    <Gallery hasGutter>
                        {content}
                    </Gallery>
                </PageSection>
            </Page>
        );
    }
}
