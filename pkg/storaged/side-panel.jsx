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

import { OptionalPanel } from "./optional-panel.jsx";
import { get_block_link_parts, block_name } from "./utils.js";

import { Spinner } from '@patternfly/react-core';

const _ = cockpit.gettext;

export class SidePanel extends React.Component {
    constructor() {
        super();
        this.state = { collapsed: true };
    }

    render() {
        var show_all_button = null;
        var children = this.props.children;

        if (this.state.collapsed && children.length > 20) {
            show_all_button = (
                <tr role="button" tabIndex="0"
                    onKeyPress={ev => ev.key === "Enter" && this.setState({ collapsed: false })}
                    onClick={() => { this.setState({ collapsed: false }) }}>
                    <td>
                        {this.props.show_all_text || _("Show all")}
                    </td>
                </tr>);
            children = children.slice(0, 20);
        }

        return (
            <OptionalPanel id={this.props.id}
                           title={this.props.title}
                           actions={this.props.actions}
                           client={this.props.client}
                           feature={this.props.feature}
                           not_installed_text={this.props.not_installed_text}
                           install_title={this.props.install_title}>
                { this.props.children.length > 0
                    ? <table className={"pf-c-table pf-m-compact" + (this.props.hover !== false ? " table-hover" : "")}>
                        <tbody>
                            { children }
                            { show_all_button }
                        </tbody>
                    </table>

                    : <div className="empty-panel-text">{this.props.empty_text}</div>
                }
            </OptionalPanel>
        );
    }
}

export class SidePanelRow extends React.Component {
    render() {
        const { client, job_path } = this.props;

        const go = (event) => {
            if (!event)
                return;

            // only consider primary mouse button for clicks
            if (event.type === 'click' && event.button !== 0)
                return;

            // only consider enter button for keyboard events
            if (event.type === 'keypress' && event.key !== "Enter")
                return;

            return this.props.go();
        };

        const eat_event = (event) => {
            // Stop events from disabled actions. Otherwise they would
            // reach the <tr> element and cause spurious navigation.
            event.stopPropagation();
        };

        let decoration = null;
        if (this.props.actions)
            decoration = (
                <div role="presentation"
                     onClick={eat_event}
                     onKeyPress={eat_event}>
                    {this.props.actions}
                </div>);
        else if (client.path_jobs[job_path])
            decoration = <Spinner size="sm" />;
        else if (client.path_warnings[job_path])
            decoration = <div className="pficon pficon-warning-triangle-o" />;

        return (
            <tr data-testkey={this.props.testkey}
                role="link" tabIndex="0"
                onKeyPress={this.props.go ? go : null}
                onClick={this.props.go ? go : null} className={this.props.highlight ? "highlight-ct" : ""}>
                <td className={this.props.highlight ? "highlight-ct" : ""}>
                    <div className="sidepanel-row">
                        <div className="sidepanel-row-body">
                            <div className="sidepanel-row-name">{this.props.name}</div>
                            <div className="sidepanel-row-info">
                                <div className="sidepanel-row-detail">{this.props.detail}</div>
                                <div className="sidepanel-row-devname">{this.props.devname}</div>
                            </div>
                        </div>
                        {decoration}
                    </div>
                </td>
            </tr>
        );
    }
}

export class SidePanelBlockRow extends React.Component {
    render() {
        const { client, block, detail, actions } = this.props;

        const parts = get_block_link_parts(client, block.path);
        const name = cockpit.format(parts.format, parts.link);

        return <SidePanelRow client={client}
                             name={name}
                             devname={block_name(block)}
                             detail={detail}
                             go={() => { cockpit.location.go(parts.location) }}
                             actions={actions} />;
    }
}
