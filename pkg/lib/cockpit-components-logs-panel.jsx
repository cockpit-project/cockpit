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

import { journalctl, renderer } from "journal";

const _ = cockpit.gettext;

/* JournalOutput implements the interface expected by
   journal.renderer, and also collects the output.
 */

class JournalOutput {
    constructor() {
        this.logs = [ ];
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
            <div className="cockpit-logline">
                <div className="cockpit-log-warning">
                    { warning ?
                      <i className="fa fa-exclamation-triangle"/>
                      : null
                    }
                      { problem ?
                        <i className="fa fa-times-circle-o"/>
                        : null
                      }
                </div>
                <div className="cockpit-log-time">{time}</div>
                <span className="cockpit-log-message">{message}</span>
                {
                    count > 1?
                    <div className="cockpit-log-service-container">
                        <div className="cockpit-log-service-reduced">{ident}</div>
                        <span className="badge">{count}&#160;<i className="fa fa-caret-right"></i></span>
                    </div>
                    : <div className="cockpit-log-service">{ident}</div>
                }
            </div>
        );
    }

    render_day_header(day) {
        return <div className="panel-heading">{day}</div>;
    }

    render_reboot_separator() {
        return (
            <div className="cockpit-logline">
                <div className="cockpit-log-warning"></div>
                <span className="cockpit-log-message cockpit-logmsg-reboot">{_("Reboot")}</span>
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
        this.journalctl = journalctl(this.props.match, { count: this.props.max });

        var out = new JournalOutput();
        var render = renderer(out);

        this.journalctl.stream((entries) => {
            for (var i = 0; i < entries.length; i++)
                render.prepend(entries[i]);
            render.prepend_flush();
            out.limit(this.props.max);
            this.setState({ logs: out.logs })
        });
    }

    componentDillUnmount() {
        this.journalctl.stop();
    }

    render() {
        return (
            <div className="panel panel-default cockpit-log-panel">
                <div className="panel-heading">{this.props.title}</div>
                <div className="panel-body">
                    { this.state.logs }
                </div>
            </div>
        );
    }
}
