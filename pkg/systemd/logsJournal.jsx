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
import { superuser } from "superuser";

import React from 'react';
import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { JournalOutput } from "cockpit-components-logs-panel.jsx";
import { ExclamationCircleIcon } from '@patternfly/react-icons';

import { getGrepFiltersFromOptions, getFilteredQuery } from "./logsHelpers.js";

// We open a couple of long-running channels with { superuser: "try" },
// so we need to reload the page if the access level changes.
superuser.reload_page_on_change();

const _ = cockpit.gettext;
// Stop stream when entries > QUERY_MORE after clicking 'Load earlier entries' button
const QUERY_MORE = 1000;
// Stop stream when entries > QUERY_COUNT
const QUERY_COUNT = 5000;

export class JournalBox extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            cursor: undefined,
            loading: true,
            logs: [],
            streamFinished: false,
            didntReachStart: true,
        };

        this.appendEntries = this.appendEntries.bind(this);
        this.followingProcs = [];
        this.loadServiceFilters = this.loadServiceFilters.bind(this);
        this.prependEntries = this.prependEntries.bind(this);
        this.procs = [];
        this.updateQuery = this.updateQuery.bind(this);
        this.queryError = this.queryError.bind(this);

        this.options = cockpit.location.options;
    }

    componentDidMount() {
        cockpit.addEventListener("locationchanged", this.updateQuery);
        this.updateQuery();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.dataFollowing != this.props.dataFollowing) {
            if (this.props.dataFollowing) {
                const cursor = document.querySelector(".cockpit-logline");
                if (cursor)
                    this.follow(cursor.getAttribute("data-cursor"));
                else
                    this.follow();
            } else {
                this.stopFollowing();
            }
        }
    }

    updateQuery() {
        this.stop();

        this.options = cockpit.location.options;
        this.match = getGrepFiltersFromOptions({ options: this.options })[1];
        const { dataFollowing, defaultSince, updateIdentifiersList, setFilteredQuery } = this.props;
        const { priority, grep, boot, since, until } = this.options;
        let last = dataFollowing ? null : 1;
        let count = 0;
        let oldest = null;
        const all = boot === undefined && since === undefined && until === undefined;

        this.out = new JournalOutput(this.options);
        this.renderer = journal.renderer(this.out);

        const tags_match = [];
        this.match.forEach(field => {
            if (!field.startsWith("SYSLOG_IDENTIFIER"))
                tags_match.push(field);
        });

        const journalctlOptions = {
            boot,
            follow: false, /* follow: Show only the most recent journal entries, and continuously print new entries as they are appended to the journal. */
            grep,
            priority,
            reverse: true, /* reverse: Reverse output so that the newest entries are displayed first */
            since: since || defaultSince,
            until
        };

        setFilteredQuery(getFilteredQuery({ match: this.match, options: journalctlOptions }));

        if (updateIdentifiersList)
            this.loadServiceFilters(tags_match, journalctlOptions);

        this.setState({ loading: true, didntReachStart: false, streamFinished: false, logs: [] });

        const promise = journal.journalctl(this.match, journalctlOptions)
                .fail(this.queryError)
                .stream(entries => {
                    if (!last) {
                        last = entries[0].__CURSOR;
                        this.follow(last);
                    }
                    count += entries.length;
                    this.appendEntries(entries);
                    oldest = entries[entries.length - 1].__CURSOR;
                    if (count >= QUERY_COUNT) {
                        this.setState({ didntReachStart: true, cursor: oldest });
                        promise.stop();
                    }
                })
                .done(() => {
                    this.setState({ streamFinished: true });

                    if (!last && !promise.stopped) {
                        const journalctlOptions = {
                            boot,
                            count: 0,
                            follow: true,
                            grep,
                            priority,
                            since,
                            until,
                        };
                        this.followingProcs.push(journal.journalctl(this.match, journalctlOptions)
                                .fail(this.queryError)
                                .stream(entries => {
                                    this.prependEntries(entries);
                                }));
                    }
                    if (!all)
                        this.setState({ didntReachStart: true, cursor: oldest });
                })
                .always(() => this.setState({ loading: false }));
        this.procs.push(promise);
    }

    queryError(error) {
        this.setState({ error: cockpit.message(error) });
    }

    prependEntries(entries) {
        for (let i = 0; i < entries.length; i++) {
            const serviceTag = entries[i].SYSLOG_IDENTIFIER;
            this.renderer.prepend(entries[i]);
            // Only update if the service is not yet known
            if (serviceTag && !this.props.currentIdentifiers.includes(serviceTag))
                // Due to asynchronous nature it needs to be checked whether this
                // identifier is not yet defined. The previous check could be omitted
                // and only this one used but let's try to trigger as few updates as possible
                this.props.setCurrentIdentifiers(identifiers => {
                    if (!identifiers.includes(serviceTag))
                        return [...identifiers, serviceTag];
                    return identifiers;
                });
        }
        this.renderer.prepend_flush();

        this.setState({ logs: this.out.logs, loading: false });
    }

    appendEntries(entries) {
        for (let i = 0; i < entries.length; i++)
            this.renderer.append(entries[i]);
        this.renderer.append_flush();

        this.setState({ logs: this.out.logs, loading: false });
    }

    follow(cursor) {
        const { priority, until, grep } = this.options;

        const journalctlOptions = {
            count: 0,
            cursor: cursor || null,
            follow: true,
            grep,
            priority,
            until,
        };
        this.followingProcs.push(journal.journalctl(this.match, journalctlOptions)
                .fail(this.queryError)
                .stream(entries => {
                    if (entries[0].__CURSOR == cursor)
                        entries.shift();
                    this.prependEntries(entries);
                }));
    }

    loadServiceFilters(match, options) {
        // Ideally this would use `--output cat --output-fields SYSLOG_IDENTIFIER` and do
        // without `sh -ec`, grep, sort, replaceAll and all of those ugly stuff
        // For that we however need newer systemd that includes https://github.com/systemd/systemd/issues/13937
        const currentServices = new Set();
        const service_options = Object.assign({ output: "verbose" }, options);
        let cmd = journal.build_cmd(match, service_options);

        cmd = cmd.map(i => i.replaceAll(" ", "\\ ")).join(" ");
        cmd = "set -o pipefail; " + cmd + " | grep SYSLOG_IDENTIFIER= | sort -u";
        cockpit.spawn(["/bin/bash", "-ec", cmd], { superuser: "try", err: "message" })
                .then(entries => {
                    entries.split("\n").forEach(entry => {
                        if (entry)
                            currentServices.add(entry.substr(entry.indexOf('=') + 1));
                    });
                })
                .catch(e => {
                    // grep returns `1` when nothing to match, but in that case message is empty
                    if (e.message)
                        console.log("Failed to load services:", e.message);
                })
                .finally(() => {
                    this.props.setCurrentIdentifiers(Array.from(currentServices));
                });
    }

    stop() {
        this.procs.forEach(proc => proc.stop());
        this.followingProcs.forEach(proc => proc.stop());
    }

    stopFollowing() {
        this.followingProcs.forEach(proc => proc.stop());
    }

    render() {
        const { priority, grep } = this.options;
        const noLogs = !this.state.logs.length;
        let error = null;
        if (this.state.error)
            error = (
                <Alert variant="danger"
                       isInline
                       actionClose={<AlertActionCloseButton onClose={() => this.setState({ error: undefined })} />}
                       title={_("Failed to fetch logs")}>
                    {this.state.error}
                </Alert>
            );

        if (!this.state.logs.length && this.state.loading)
            return (
                <>
                    {error}
                    <EmptyStatePanel loading title={_("Loading...")} />
                </>
            );

        /* Journalctl command stream finished and there are not more entries to query */
        if (!this.state.logs.length && !this.state.didntReachStart && this.state.streamFinished) {
            return (
                <div id="start-box" className="journal-start">
                    {error}
                    <EmptyStatePanel action={_("Clear all filters")}
                                     icon={ExclamationCircleIcon}
                                     actionVariant="link"
                                     onAction={() => cockpit.location.go('/')}
                                     paragraph={_("Can not find any logs using the current combination of filters.")}
                                     title={_("No logs found")}
                                     loading={false} />
                </div>
            );
        }
        const loadEarlier = (
            /* Show 'Load earlier entries' button if we didn't reach start yet */
            this.state.didntReachStart
                ? <EmptyStatePanel action={_("Load earlier entries")}
                             actionInProgressText={_("Loading earlier entries")}
                             icon={noLogs ? ExclamationCircleIcon : undefined}
                             isActionInProgress={this.state.loading}
                             onAction={() => {
                                 let count = 0;
                                 this.setState({ loading: true });

                                 const journalctlOptions = {
                                     cursor: this.state.cursor,
                                     follow: false,
                                     grep,
                                     priority,
                                     reverse: true,
                                 };
                                 this.setState({ didntReachStart: false });
                                 const promise = journal.journalctl(this.match, journalctlOptions)
                                         .fail(this.queryError)
                                         .stream(entries => {
                                             if (entries[0].__CURSOR == this.state.cursor)
                                                 entries.shift();
                                             count += entries.length;
                                             this.appendEntries(entries);
                                             if (count >= QUERY_MORE) {
                                                 const stopped = entries[entries.length - 1].__CURSOR;
                                                 this.setState({ didntReachStart: true, cursor: stopped, loading: false });
                                                 promise.stop();
                                             }
                                         })
                                         .done(() => {
                                             this.setState({ streamFinished: true, loading: false });
                                         });
                                 this.procs.push(promise);
                             }}
                             paragraph={noLogs ? _("You may try to load older entries.") : ""}
                             title={noLogs ? _("No logs found") : ""}
                             loading={false} />
                : null
        );

        return (
            <>
                {error}
                {this.state.logs.length
                    ? <div id="journal-logs" className="panel panel-default cockpit-log-panel" role="table">
                        {this.state.logs}
                    </div>
                    : null}
                <div id="start-box" className="journal-start">
                    {loadEarlier}
                </div>
            </>
        );
    }
}
