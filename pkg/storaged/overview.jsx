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

import React from "react";
import ReactDOM from 'react-dom';

import { fmt_rate } from "./utils.js";

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

export class OverviewSidePanel extends React.Component {
    render() {
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
                            { this.props.children }
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
        const go = (event) => {
            if (!event || event.button !== 0)
                return;
            return this.props.go();
        };

        return (
            <tr data-testkey={this.props.testkey}
                onClick={this.props.go ? go : null} className={this.props.highlight ? "highlight-ct" : ""}>
                <td className="storage-icon">
                    { this.props.kind !== false
                        ? <div><img src={"images/storage-" + (this.props.kind || "disk") + ".png"} /></div>
                        : null
                    }
                </td>
                <td className="row">
                    <span className="col-md-12 storage-disk-name">{this.props.name}</span>
                    <br />
                    <span className="col-md-12 col-lg-5 storage-disk-size">{this.props.detail}</span>
                    { this.props.stats
                        ? <span className="col-md-12 col-lg-7">
                            <span>R: {fmt_rate(this.props.stats[0])}</span>
                            { "\n" }
                            <span className="rate-gap" />
                            { "\n" }
                            <span>W: {fmt_rate(this.props.stats[1])}</span>
                        </span>
                        : null
                    }
                </td>
                { this.props.actions ? (
                    <td className="storage-icon">
                        { this.props.actions }
                    </td>
                ) : this.props.client.path_jobs[this.props.job_path] ? (
                    <td className="storage-icon">
                        <div className="spinner spinner-sm" />
                    </td>
                ) : null
                }
            </tr>
        );
    }
}

class Overview extends React.Component {
    constructor() {
        super();
        this.state = { highlight: false };
        this.on_client_changed = () => { this.setState({}) };
    }

    componentDidMount() {
        this.props.client.addEventListener("changed", this.on_client_changed);
    }

    componentWillUnmount() {
        this.props.client.removeEventListener("changed", this.on_client_changed);
    }

    render() {
        var client = this.props.client;

        return (
            <div>
                <div className="col-md-8 col-lg-9 page-ct">
                    <StoragePlots client={client} onHover={(dev) => this.setState({ highlight: dev })} />
                    <br />
                    <FilesystemsPanel client={client} />
                    <NFSPanel client={client} />
                    <JobsPanel client={client} />
                    <StorageLogsPanel />
                </div>
                <div className="col-md-4 col-lg-3 storage-sidebar page-ct">
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

export function init(client, jobs) {
    var page = document.getElementById("storage");

    function show() {
        ReactDOM.render(<Overview client={client} jobs={jobs} />, page);
        page.style.display = "block";
    }

    function hide() {
        // We don't unmount the page here in order to keep the plots alive.
        page.style.display = "none";
    }

    return { show: show, hide: hide };
}
