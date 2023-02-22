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

import cockpit from "cockpit";
import { journal } from "journal";
import * as timeformat from "timeformat";

import React from 'react';
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { AbrtLogDetails } from "./abrtLog.jsx";
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardActions, CardBody, CardHeader, CardHeaderMain, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Gallery, GalleryItem } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";

const _ = cockpit.gettext;

const LogDetails = ({ entry }) => {
    const general = Object.keys(entry).filter(k => k !== 'MESSAGE');
    general.sort();

    const id = entry.PROBLEM_BINARY || entry.UNIT || entry.SYSLOG_IDENTIFIER || "";
    let service = entry.USER_UNIT || entry.COREDUMP_USER_UNIT || entry._SYSTEMD_USER_UNIT || "";
    const is_user = !!service;
    service = service || entry.UNIT || entry.COREDUMP_UNIT || entry._SYSTEMD_UNIT || "";

    // Only show redirect for unit types we show
    if (["service", "target", "socket", "timer", "path"].indexOf(service.split(".").slice(-1)[0]) === -1)
        service = undefined;

    return (
        <GalleryItem>
            <Card>
                <CardHeader>
                    <CardHeaderMain>
                        <h2 id="entry-heading">{id}</h2>
                    </CardHeaderMain>
                    { service &&
                        <CardActions>
                            <Button variant="link" onClick={() => cockpit.jump("/system/services#/" + service + (is_user ? "?owner=user" : "")) }>
                                {cockpit.format(_("Go to $0"), service)}
                            </Button>
                        </CardActions>
                    }
                </CardHeader>
                <CardTitle>{journal.printable(entry.MESSAGE)}</CardTitle>
                <CardBody>
                    <DescriptionList className="pf-m-horizontal-on-sm">
                        { general.map(key =>
                            <DescriptionListGroup key={key}>
                                <DescriptionListTerm>{key}</DescriptionListTerm>
                                <DescriptionListDescription>{journal.printable(entry[key])}</DescriptionListDescription>
                            </DescriptionListGroup>
                        )}
                    </DescriptionList>
                </CardBody>
            </Card>
        </GalleryItem>
    );
};

function get_problems(service) {
    return service.wait()
            .then(() => {
                return service.GetProblems(0, {})
                        .then(paths => {
                            const proxies = paths.map(p => service.client.proxy("org.freedesktop.Problems2.Entry", p));
                            return Promise.all(proxies.map(p => p.wait()))
                                    .then(() => {
                                        const result = { };
                                        for (let i = 0; i < paths.length; i++)
                                            result[paths[i]] = proxies[i];
                                        return result;
                                    });
                        });
            });
}

export class LogEntry extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            error: "",
            entry: null,
            loading: true,
            problemPath: null,
            abrtService: null,
        };

        this.loadProblem = this.loadProblem.bind(this);
        this.goHome = this.goHome.bind(this);
        this.problems_client = null;
    }

    loadProblem(entry) {
        if (this.problems_client)
            this.problems_client.close();
        this.problems_client = cockpit.dbus('org.freedesktop.problems', { superuser: "try" });

        const service = this.problems_client.proxy('org.freedesktop.Problems2', '/org/freedesktop/Problems2');
        get_problems(service)
                .then(problems => {
                    const fields = [entry.PROBLEM_DIR, entry.PROBLEM_DUPHASH, entry.PROBLEM_UUID];
                    let path = null;
                    Object.keys(problems).some(pth => {
                        const p = problems[pth];
                        if (p && (fields.indexOf(p.ID) > 0 || fields.indexOf(p.UUID) || fields.indexOf(p.Duphash))) {
                            path = p;
                            return true;
                        } else {
                            return false;
                        }
                    });

                    this.setState({ entry: entry, loading: false, error: "", problemPath: path, abrtService: service });
                })
                .catch(err => this.setState({ entry: entry, loading: false, error: err.toString() }));
    }

    componentDidMount() {
        const cursor = cockpit.location.path[0];
        journal.journalctl({ cursor: cursor, count: 1, follow: false })
                .then(entries => {
                    if (entries.length >= 1 && entries[0].__CURSOR == cursor) {
                        if (entries[0].SYSLOG_IDENTIFIER === "abrt-notification" || entries[0]._SYSTEMD_UNIT === "abrt-notification")
                            this.loadProblem(entries[0]);
                        else
                            this.setState({ entry: entries[0], loading: false, error: "" });
                    } else
                        this.setState({ entry: null, loading: false, error: _("Journal entry not found") });
                })
                .catch(error => this.setState({ entry: null, loading: false, error: error }));
    }

    componentWillUnmount() {
        if (this.problems_client) {
            this.problems_client.close();
            this.problems_client = null;
        }
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

            if (this.state.problemPath) {
                breadcrumb = cockpit.format(_("$0: crash at $1"), entry.PROBLEM_BINARY, date);
                content = <AbrtLogDetails problem={this.state.problemPath}
                                          entry={entry}
                                          service={this.state.abrtService}
                                          reloadProblems={this.goHome} />;
            } else {
                breadcrumb = cockpit.format(_("Entry at $0"), date);
                content = <LogDetails entry={entry} />;
            }
        }

        return (
            <Page groupProps={{ sticky: 'top' }}
                  isBreadcrumbGrouped
                  id="log-details"
                  breadcrumb={
                      <Breadcrumb>
                          <BreadcrumbItem onClick={this.goHome} className="pf-c-breadcrumb__link">{_("Logs")}</BreadcrumbItem>
                          <BreadcrumbItem isActive>
                              {breadcrumb}
                          </BreadcrumbItem>
                      </Breadcrumb>}>
                <PageSection>
                    <Gallery hasGutter>
                        {content}
                    </Gallery>
                </PageSection>
            </Page>
        );
    }
}
