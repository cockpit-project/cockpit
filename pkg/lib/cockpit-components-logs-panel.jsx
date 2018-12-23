/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import { journal } from "journal";

const _ = cockpit.gettext;

/* JournalOutput implements the interface expected by
   journal.renderer, and also collects the output.
 */

class JournalOutput {
    constructor() {
        this.logs = [ ];
        this.reboot_key = 0;
    }

    render_line(ident, prio, message, count, time, entry) {
        var problem = false;
        var warning = false;

        if (ident === 'abrt-notification') {
            problem = true;
            ident = entry['PROBLEM_BINARY'];
        } else if (prio < 4) {
            warning = true;
        }

        return (
            <div className="cockpit-logline" role="row" key={entry["__MONOTONIC_TIMESTAMP"]}>
                <div className="cockpit-log-warning" role="cell">
                    { warning
                        ? <i className="fa fa-exclamation-triangle" />
                        : null
                    }
                    { problem
                        ? <i className="fa fa-times-circle-o" />
                        : null
                    }
                </div>
                <div className="cockpit-log-time" role="cell">{time}</div>
                <span className="cockpit-log-message" role="cell">{message}</span>
                {
                    count > 1
                        ? <div className="cockpit-log-service-container" role="cell">
                            <div className="cockpit-log-service-reduced" role="cell">{ident}</div>
                            <span className="badge" role="cell">{count}&#160;<i className="fa fa-caret-right" /></span>
                        </div>
                        : <div className="cockpit-log-service" role="cell">{ident}</div>
                }
            </div>
        );
    }

    render_day_header(day) {
        return <div className="panel-heading" key={day}>{day}</div>;
    }

    render_reboot_separator() {
        return (
            <div className="cockpit-logline" role="row" key={"reboot-" + this.reboot_key++}>
                <div className="cockpit-log-warning" role="cell" />
                <span className="cockpit-log-message cockpit-logmsg-reboot" role="cell">{_("Reboot")}</span>
            </div>
        );
    }

    prepend(item) {
        this.logs.unshift(item);
    }

    remove_first() {
        this.logs.shift();
    }

    limit(max) {
        if (this.logs.length > max)
            this.logs = this.logs.slice(-max);
    }
}

export class LogsPanel extends React.Component {
    constructor() {
        super();
        this.state = { logs: [ ] };
    }

    componentDidMount() {
        this.journalctl = journal.journalctl(this.props.match, { count: this.props.max });

        var out = new JournalOutput();
        var render = journal.renderer(out);

        this.journalctl.stream((entries) => {
            for (var i = 0; i < entries.length; i++)
                render.prepend(entries[i]);
            render.prepend_flush();
            out.limit(this.props.max);
            this.setState({ logs: out.logs });
        });
    }

    componentWillUnmount() {
        this.journalctl.stop();
    }

    // TODO: refactor, the state object can't store neither functions nor React components
    // Better approach: store just data to the component's state and render rows directly in the render() method
    // Do not use helper functions (the "render_*" above) to generate elements but make components from them (start with CapitalLetter)
    render() {
        return (
            <div className="panel panel-default cockpit-log-panel" role="table">
                <div className="panel-heading">{this.props.title}</div>
                <div className="panel-body" role="rowgroup">
                    { this.state.logs }
                </div>
            </div>
        );
    }
}
