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
import moment from "moment";
import { journal } from "journal";

import React from 'react';
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { AbrtLogDetails } from "./abrtLog.jsx";
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import {
    Breadcrumb, BreadcrumbItem,
    Card, CardBody, CardHeader, CardHeaderMain, CardTitle,
    Page, PageSection,
    Gallery, GalleryItem
} from '@patternfly/react-core';

const _ = cockpit.gettext;

const LogDetails = ({ entry }) => {
    const general = Object.keys(entry).filter(k => k !== 'MESSAGE');
    general.sort();

    const id = entry.PROBLEM_BINARY || entry.SYSLOG_IDENTIFIER || entry._SYSTEMD_UNIT || "";

    return (
        <GalleryItem>
            <Card>
                <CardHeader>
                    <CardHeaderMain>
                        <h2 id="entry-heading">{id}</h2>
                    </CardHeaderMain>
                </CardHeader>
                <CardTitle>{journal.printable(entry.MESSAGE)}</CardTitle>
                <CardBody>
                    <table className="info-table-ct">
                        <tbody>
                            { general.map(key =>
                                <tr key={key}>
                                    <td>{key}</td>
                                    <td>{journal.printable(entry[key])}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
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
            problemPath: null,
            abrtService: null,
        };

        this.loadProblem = this.loadProblem.bind(this);
        this.goHome = this.goHome.bind(this);
    }

    loadProblem(entry) {
        const problems_client = cockpit.dbus('org.freedesktop.problems', { superuser: "try" });
        const service = problems_client.proxy('org.freedesktop.Problems2', '/org/freedesktop/Problems2');
        const problems = problems_client.proxies('org.freedesktop.Problems2.Entry', '/org/freedesktop/Problems2/Entry');

        problems.wait(() => {
            try {
                service.GetProblems(0, {})
                        .then(problem_paths => {
                            const fields = [entry.PROBLEM_DIR, entry.PROBLEM_DUPHASH, entry.PROBLEM_UUID];
                            let path = null;
                            problem_paths.some(pth => {
                                const p = problems[pth];
                                if (fields.indexOf(p.ID) > 0 || fields.indexOf(p.UUID) || fields.indexOf(p.Duphash)) {
                                    path = p;
                                    return true;
                                }
                            });

                            this.setState({ entry: entry, loading: false, error: "", problemPath: path, abrtService: service });
                        });
            } catch (err) {
                this.setState({ entry: entry, loading: false, error: "" });
            }
        });
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
            const date = moment(new Date(entry.__REALTIME_TIMESTAMP / 1000));

            if (this.state.problemPath) {
                breadcrumb = cockpit.format(_("$0: crash at $1"), entry.PROBLEM_BINARY, date.format("YYYY-MM-DD HH:mm:ss"));
                content = <AbrtLogDetails problem={this.state.problemPath}
                                          entry={entry}
                                          service={this.state.abrtService}
                                          reloadProblems={this.goHome} />;
            } else {
                breadcrumb = cockpit.format(_("Entry at $0"), date.format("YYYY-MM-DD HH:mm:ss"));
                content = <LogDetails entry={entry} />;
            }
        }

        return (
            <Page id="log-details" breadcrumb={
                <Breadcrumb>
                    <BreadcrumbItem onClick={this.goHome} to="#">{_("Logs")}</BreadcrumbItem>
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
