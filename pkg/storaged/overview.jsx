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

import { StoragePlots } from "./plot.jsx";

import { FilesystemsPanel } from "./fsys-panel.jsx";
import { NFSPanel } from "./nfs-panel.jsx";
import { MDRaidsPanel } from "./mdraids-panel.jsx";
import { VGroupsPanel } from "./vgroups-panel.jsx";
import { VDOsPanel } from "./vdos-panel.jsx";
import { IscsiPanel } from "./iscsi-panel.jsx";
import { DrivesPanel } from "./drives-panel.jsx";
import { OthersPanel } from "./others-panel.jsx";
import { OptionalPanel } from "./optional-panel.jsx";

import { JobsPanel } from "./jobs-panel.jsx";
import { StorageLogsPanel } from "./logs-panel.jsx";

const _ = cockpit.gettext;

export class OverviewSidePanel extends React.Component {
    constructor() {
        super();
        this.state = { collapsed: true };
    }

    render() {
        var show_all_button = null;
        var children = this.props.children;

        if (this.state.collapsed && children.length > 20) {
            show_all_button = (
                <tr>
                    <td colSpan="3" onClick={() => { this.setState({ collapsed: false }) }}>
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
                    ? <table className={"table" + (this.props.hover !== false ? " table-hover" : "")}>
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

export class OverviewSidePanelRow extends React.Component {
    render() {
        let { client, job_path } = this.props;

        const go = (event) => {
            if (!event || event.button !== 0)
                return;
            return this.props.go();
        };

        let job_spinner = (client.path_jobs[job_path]
            ? <span className="spinner spinner-sm" />
            : null);

        let warning_triangle = (client.path_warnings[job_path]
            ? <span className="pficon pficon-warning-triangle-o" />
            : null);

        return (
            <tr data-testkey={this.props.testkey}
                onClick={this.props.go ? go : null} className={this.props.highlight ? "highlight-ct" : ""}>
                <td className="storage-icon">
                    { this.props.kind !== false
                        ? <img src={"images/storage-" + (this.props.kind || "disk") + ".png"} />
                        : null
                    }
                </td>
                <td className="row storage-disk-info">
                    <h3 className="storage-disk-name">{this.props.name}</h3>
                    <div className="storage-disk-size">{this.props.detail}</div>
                </td>
                <td className="storage-icon storage-disk-extended">
                    { this.props.actions || job_spinner || warning_triangle }
                </td>
            </tr>
        );
    }
}

export class Overview extends React.Component {
    constructor() {
        super();
        this.state = { highlight: false };
    }

    render() {
        var client = this.props.client;

        return (
            <div className="container-fluid">
                <div className="col-md-8 col-lg-9">
                    <StoragePlots client={client} onHover={(dev) => this.setState({ highlight: dev })} />
                    <br />
                    <FilesystemsPanel client={client} />
                    <NFSPanel client={client} />
                    <JobsPanel client={client} />
                    <StorageLogsPanel />
                </div>
                <div className="col-md-4 col-lg-3 storage-sidebar">
                    <MDRaidsPanel client={client} />
                    <VGroupsPanel client={client} />
                    <VDOsPanel client={client} />
                    <IscsiPanel client={client} />
                    <DrivesPanel client={client} highlight={this.state.highlight} />
                    <OthersPanel client={client} />
                </div>
            </div>
        );
    }
}
