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
import ReactDOM from 'react-dom';

import utils from "./utils.js";
import { BlockDetails } from "./block-details.jsx";
import { DriveDetails } from "./drive-details.jsx";
import { VGroupDetails } from "./vgroup-details.jsx";
import { MDRaidDetails } from "./mdraid-details.jsx";
import { VDODetails } from "./vdo-details.jsx";
import { NFSDetails } from "./nfs-details.jsx";
import { JobsPanel } from "./jobs-panel.jsx";

const _ = cockpit.gettext;

export class StdDetailsLayout extends React.Component {
    render() {
        if (this.props.sidebar) {
            return (
                <div>
                    <div id="detail-header" className="col-md-12">
                        { this.props.alert }
                        { this.props.header }
                    </div>
                    <div id="detail-sidebar" className="col-md-4 col-lg-3 col-md-push-8 col-lg-push-9">
                        { this.props.sidebar }
                    </div>
                    <div className="col-md-8 col-lg-9 col-md-pull-4 col-lg-pull-3">
                        <div id="detail-content">
                            { this.props.content }
                        </div>
                        <JobsPanel client={this.props.client} />
                    </div>
                </div>
            );
        } else {
            return (
                <div>
                    <div id="detail-header" className="col-md-12">
                        { this.props.alert }
                        { this.props.header }
                    </div>
                    <div className="col-md-12">
                        <div id="detail-content">
                            { this.props.content }
                        </div>
                        <JobsPanel client={this.props.client} />
                    </div>
                </div>
            );
        }
    }
}

class Details extends React.Component {
    constructor() {
        super();
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

        function go_up(event) {
            if (!event || event.button !== 0)
                return;
            cockpit.location.go("/");
        }

        var body = null;
        var name = this.props.name;
        if (this.props.type == "block") {
            var block = client.slashdevs_block["/dev/" + this.props.name];
            var drive = block && client.drives[block.Drive];

            if (drive) {
                name = utils.drive_name(drive);
                body = <DriveDetails client={client} drive={drive} />;
            } else if (block) {
                name = utils.block_name(block);
                body = <BlockDetails client={client} block={block} />;
            }
        } else if (this.props.type == "vgroup") {
            var vgroup = client.vgnames_vgroup[this.props.name];
            if (vgroup) {
                name = vgroup.Name;
                body = <VGroupDetails client={client} vgroup={vgroup} />;
            }
        } else if (this.props.type == "mdraid") {
            var mdraid = client.uuids_mdraid[this.props.name];
            if (mdraid) {
                name = utils.mdraid_name(mdraid);
                body = <MDRaidDetails client={client} mdraid={mdraid} />;
            }
        } else if (this.props.type == "vdo") {
            var vdo = client.vdo_overlay.by_name[this.props.name];
            if (vdo) {
                name = vdo.name;
                body = <VDODetails client={client} vdo={vdo} />;
            }
        } else if (this.props.type == "nfs") {
            var entry = client.nfs.find_entry(name, this.props.name2);
            if (entry)
                body = <NFSDetails client={client} entry={entry} />;
        }

        if (!body)
            body = <div className="col-md-12">{_("Not found")}</div>;

        return (
            <div>
                <div className="col-md-12">
                    <ol className="breadcrumb">
                        <li><a role="link" tabIndex="0" onClick={go_up}>{_("Storage")}</a></li>
                        <li className="active">{name}</li>
                    </ol>
                </div>
                {body}
            </div>
        );
    }
}

export function init(client) {
    var page = document.getElementById("storage-detail");

    function show(type, name, name2) {
        ReactDOM.render(<Details client={client} type={type} name={name} name2={name2} />, page);
        page.style.display = "block";
    }

    function hide() {
        page.style.display = "none";
        ReactDOM.unmountComponentAtNode(page);
    }

    return { show: show, hide: hide };
}
