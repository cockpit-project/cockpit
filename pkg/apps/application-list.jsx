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

import PackageKit from "./packagekit";
import { left_click, icon_url, show_error, launch, ProgressBar, CancelButton } from  "./utils.jsx";

const _ = cockpit.gettext;

class ApplicationRow extends React.Component {
    constructor() {
        super();
        this.state = { progress: null };
    }

    render() {
        var self = this;
        var comp = self.props.comp;
        var state = self.state;

        function action(func, arg, progress_title) {
            self.setState({ progress_title: progress_title });
            func(arg, (data) => self.setState({ progress: data })).
                always(() => self.setState({ progress: null })).
                fail(show_error);
        }

        function install() {
            action(PackageKit.install, comp.pkgname, _("Installing"));
        }

        function remove() {
            action(PackageKit.remove, comp.file, _("Removing"));
        }

        var name, summary_or_progress, button;

        if (comp.installed) {
            name = <a onClick={left_click(() => launch(comp))}>{comp.name}</a>;
        } else {
            name = comp.name;
        }

        if (state.progress) {
            summary_or_progress = <ProgressBar title={state.progress_title} data={state.progress}/>;
            button = <CancelButton data={state.progress}/>;
        } else {
            if (state.error) {
                summary_or_progress = (
                    <div>
                        {comp.summary}
                        <div className="alert alert-danger alert-dismissable">
                            <button className="close"
                                    onClick={left_click(() => { this.setState({ error: null }) })}>
                                <span className="pficon pficon-close"/>
                            </button>
                            <span className="pficon pficon-error-circle-o"/>
                            {state.error}
                        </div>
                    </div>
                );
            } else {
                summary_or_progress = comp.summary;
            }

            if (comp.installed) {
                button = <button className="btn btn-danger" onClick={left_click(remove)}>{_("Remove")}</button>;
            } else {
                button = <button className="btn btn-default" onClick={left_click(install)}>{_("Install")}</button>;
            }
        }

        return (
            <tr onClick={left_click(() => cockpit.location.go(comp.id))}>
                <td><img src={icon_url(comp.icon)}/></td>
                <td>{name}</td>
                <td>{summary_or_progress}</td>
                <td>{button}</td>
            </tr>
        );
    }
}

class ApplicationList extends React.Component {
    constructor() {
        super();
        this.state = { progress: false };
    }

    render() {
        var self = this;
        var comps = [ ];
        for (var id in this.props.metainfo_db.components)
            comps.push(this.props.metainfo_db.components[id]);
        comps.sort((a, b) => a.name.localeCompare(b.name));

        function refresh() {
            var config = cockpit.manifests["apps"].config || { };
            PackageKit.refresh(self.props.metainfo_db.origin_files,
                               config.appstream_config_packages || [ ],
                               config.appstream_data_packages || [ ],
                               data => self.setState({ progress: data })).
                always(() => self.setState({ progress: false })).
                fail(show_error);
        }

        var refresh_progress, refresh_button, empty_caption, tbody, table_classes;
        if (this.state.progress) {
            refresh_progress = <ProgressBar title={_("Checking for new applications")} data={this.state.progress}/>;
            refresh_button = <CancelButton data={this.state.progress}/>;
        } else {
            refresh_progress = null;
            refresh_button = <button className="btn btn-default fa fa-refresh" onClick={left_click(refresh)}/>
        }

        table_classes = "table app-list";
        if (comps.length === 0) {
            if (this.props.metainfo_db.ready)
                empty_caption = _("No applications installed or available");
            else
                empty_caption = <div className="spinner spinner-sm"/>;
            tbody = <tr className="app-list-empty"><td>{empty_caption}</td></tr>;
        } else {
            table_classes += " table-hover";
            tbody = comps.map((c) => <ApplicationRow comp={c}/>);
        }

        return (
            <table className={table_classes}>
                <caption>
                    <table>
                        <tr>
                            <td><h2>{_("Applications")}</h2></td>
                            <td>{refresh_progress}</td>
                            <td>{refresh_button}</td>
                        </tr>
                    </table>
                </caption>
                <tbody>
                    { tbody }
                </tbody>
            </table>
        );
    }
}

module.exports = {
    ApplicationList: ApplicationList
};
