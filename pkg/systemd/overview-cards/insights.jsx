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

import React from 'react';
import { Button } from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';

import cockpit from "cockpit";
import * as service from "service.js";

import insights_poll_hack_sh from "raw-loader!./insights-poll-hack.sh";

import "./insights.scss";

const _ = cockpit.gettext;

const InsightsIcon = ({ critical, important, moderate, low }) => {
    const vars = {
        "--critical": critical,
        "--important": important,
        "--moderate": moderate,
        "--low": low
    };
    return (
        <span className="insights-icon" style={vars}>
            <span className="insights-icon-critical" />
            <span className="insights-icon-important" />
            <span className="insights-icon-moderate" />
            <span className="insights-icon-low" />
        </span>);
};

export class InsightsStatus extends React.Component {
    constructor() {
        super();
        this.state = { };

        this.subman_supports_insights = (cockpit.manifests.subscriptions &&
                                         cockpit.manifests.subscriptions.features &&
                                         cockpit.manifests.subscriptions.features.insights);
    }

    componentDidMount() {
        this.insights_client_timer = service.proxy("insights-client.timer");
        this.insights_client_timer.addEventListener("changed", () => this.setState({}));

        const watch = (name, state, parser) => {
            return cockpit.file(name, { syntax: { parse: parser } }).watch((data, tag, error) => {
                if (error)
                    console.warn("Parse error", name, error.toString());
                this.setState({ [state]: data });
            });
        };

        this.id_watch = watch("/var/lib/insights/host-details.json", "id",
                              data => JSON.parse(data).results[0].id);

        this.hits_watch = watch("/var/lib/insights/insights-details.json", "hits",
                                data => {
                                    const json = JSON.parse(data);
                                    const n_hits = json.length;
                                    const n_hits_by_risk = [0, 0, 0, 0];
                                    json.forEach(r => {
                                        const risk_index =
                                              Math.max(1, Math.min(5, Math.floor(r.rule.total_risk || 0))) - 1;
                                        n_hits_by_risk[risk_index] += 1;
                                    });
                                    return {
                                        n: n_hits,
                                        n_by_risk: n_hits_by_risk
                                    };
                                });

        // Let's try to keep the results up-to-date
        this.upload_watch = cockpit.file("/etc/insights-client/.lastupload").watch(data => {
            if (this.pollster) {
                this.pollster.close();
                this.pollster = null;
            }
            if (data)
                this.pollster = cockpit.script(insights_poll_hack_sh, [], { superuser: true });
        });
    }

    componentWillUnmount() {
        this.id_watch.remove();
        this.hits_watch.remove();
        this.upload_watch.remove();
    }

    render() {
        if (!this.insights_client_timer) {
            // Not mounted yet
            return null;
        }

        if (!this.insights_client_timer.exists) {
            // insights-client is not installed
            return null;
        }

        if (!this.insights_client_timer.enabled) {
            // machine is not registered with Insights
            if (this.subman_supports_insights) {
                // subscriptions page can register us
                return (
                    <li className="system-health-insights">
                        <span className="fa fa-exclamation-triangle" />
                        <a href="#"
                    onClick={ev => { ev.preventDefault(); cockpit.jump("/subscriptions") }}>
                            {_("Not connected to Insights")}
                        </a>
                    </li>);
            } else
                return null;
        }

        let url;
        if (this.state.id)
            url = "https://cloud.redhat.com/insights/inventory/" + this.state.id;
        else
            url = "https://cloud.redhat.com/insights";

        let icon, text;
        if (this.state.hits) {
            const n = this.state.hits.n;
            if (n == 0) {
                icon = <span className="fa fa-check-circle-o" />;
                text = _("No rule hits");
            } else {
                const by_risk = this.state.hits.n_by_risk;
                icon = <InsightsIcon critical={by_risk[3]}
                                     important={by_risk[2]}
                                     moderate={by_risk[1]}
                                     low={by_risk[0]} />;

                // We do this all explicitly and in a long
                // winded way so that the translation
                // machinery gets to see all the strings.
                if (by_risk[3]) {
                    text = cockpit.format(cockpit.ngettext("$0 critical hit",
                                                           "$0 hits, including critical",
                                                           n),
                                          n);
                } else if (by_risk[2]) {
                    text = cockpit.format(cockpit.ngettext("$0 important hit",
                                                           "$0 hits, including important",
                                                           n),
                                          n);
                } else if (by_risk[1]) {
                    text = cockpit.format(cockpit.ngettext("$0 moderate hit",
                                                           "$0 hits, including moderate",
                                                           n),
                                          n);
                } else {
                    text = cockpit.format(cockpit.ngettext("$0 low severity hit",
                                                           "$0 low severity hits",
                                                           n),
                                          n);
                }
            }
        } else {
            // Couldn't parse the results at all, be quiet
            return null;
        }

        return (
            <li className="system-health-insights">
                {icon}
                <Button isInline variant="link" component='a' href={url}
                        target="_blank" rel="noopener noreferrer"
                        icon={<ExternalLinkAltIcon />}
                        iconPosition="right">
                    {_("Insights: ")} {text}
                </Button>
            </li>);
    }
}
