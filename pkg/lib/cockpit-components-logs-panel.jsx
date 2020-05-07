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
import "journal.css";
import "cockpit-components-logs-panel.scss";

const _ = cockpit.gettext;

/* JournalOutput implements the interface expected by
   journal.renderer, and also collects the output.
 */

class JournalOutput {
    constructor(search_options) {
        this.logs = [];
        this.reboot_key = 0;
        this.search_options = search_options || {};
    }

    onEvent(ev, cursor) {
        // only consider primary mouse button for clicks
        if (ev.type === 'click' && ev.button !== 0)
            return;

        // only consider enter button for keyboard events
        if (ev.type === 'keypress' && ev.key !== "Enter")
            return;

        cockpit.jump("system/logs#/" + cursor + "?parent_options=" + JSON.stringify(this.search_options));
    }

    render_line(ident, prio, message, count, time, entry) {
        var problem = false;
        var warning = false;

        if (ident === 'abrt-notification') {
            problem = true;
            ident = entry.PROBLEM_BINARY;
        } else if (prio < 4) {
            warning = true;
        }

        return (
            <div className="cockpit-logline" role="row" tabIndex="0" key={entry.__CURSOR}
                onClick={ev => this.onEvent(ev, entry.__CURSOR)}
                onKeyPress={ev => this.onEvent(ev, entry.__CURSOR)}>
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
            this.logs = this.logs.slice(0, max);
    }
}

export class LogsPanel extends React.Component {
    constructor() {
        super();
        this.state = { logs: [] };
    }

    componentDidMount() {
        this.journalctl = journal.journalctl(this.props.match, { count: this.props.max });

        var out = new JournalOutput(this.props.search_options);
        var render = journal.renderer(out);

        this.journalctl.stream((entries) => {
            for (var i = 0; i < entries.length; i++)
                render.prepend(entries[i]);
            render.prepend_flush();
            // "max + 1" since there is always a date header and we
            // want to show "max" entries below it.
            out.limit(this.props.max + 1);
            this.setState({ logs: out.logs });
        });
    }

    componentWillUnmount() {
        this.journalctl.stop();
    }

    render() {
        return (
            <div className="panel panel-default cockpit-log-panel" role="table">
                <div className="panel-heading">
                    <h2 className="panel-title">{this.props.title}</h2>
                    { this.props.goto_url && <button className="link-button" role="link" onClick={e => cockpit.jump(this.props.goto_url)}>{_("All logs")}</button> }
                </div>
                <div className={"panel-body " + ((!this.state.logs.length && this.props.emptyMessage.length) ? "empty-message" : "")} role="rowgroup">
                    { this.state.logs.length ? this.state.logs : this.props.emptyMessage }
                </div>
            </div>
        );
    }
}
LogsPanel.defaultProps = {
    emptyMessage: [],
};
