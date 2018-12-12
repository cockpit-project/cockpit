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

import PackageKit from "./packagekit.js";
import { left_click, icon_url, show_error, launch, ProgressBar, CancelButton } from "./utils.jsx";

import "./application.css";

var _ = cockpit.gettext;

class Application extends React.Component {
    constructor() {
        super();
        this.state = { error: null, progress: null };
    }

    render() {
        var self = this;
        var state = this.state;
        var metainfo_db = this.props.metainfo_db;
        var comp;

        if (!this.props.id)
            return null;

        comp = metainfo_db.components[this.props.id];

        function action(func, arg, progress_title) {
            self.setState({ progress_title: progress_title });
            func(arg, data => self.setState({ progress: data }))
                    .finally(() => self.setState({ progress: null }))
                    .catch(show_error);
        }

        function install() {
            action(PackageKit.install, comp.pkgname, _("Installing"));
        }

        function remove() {
            action(PackageKit.remove, comp.file, _("Removing"));
        }

        function render_homepage_link(urls) {
            return urls.map(url => {
                if (url.type == 'homepage') {
                    return (<div className="app-links" key={url.link}>
                        <a href={url.link} target="_blank" rel="noopener" data-linkedhost={url.link}>
                                    View Project Website <i className="fa fa-external-link" aria-hidden="true" />
                        </a>
                    </div>);
                }
            });
        }

        // Render a description in the form returned by the AppsSream
        // parser, which is a list of paragraphs and lists.

        function render_description(description) {
            if (!description)
                return <p>{_("No description provided.")}</p>;

            return description.map((paragraph, index) => {
                if (paragraph.tag == 'ul') {
                    return <ul key={`paragraph-${index}`}>{paragraph.items.map(item => <li key={item}>{item}</li>)}</ul>;
                } else if (paragraph.tag == 'ol') {
                    return <ol key={`paragraph-${index}`}>{paragraph.items.map(item => <li key={item}>{item}</li>)}</ol>;
                } else {
                    return <p key={`paragraph-${index}`}>{paragraph}</p>;
                }
            });
        }

        // Render the icon, name, homepage link, summary, description, and screenshots of the component,
        // plus the UI for installing and removing it.

        function render_comp() {
            if (!comp) {
                if (metainfo_db.ready)
                    return <div>{_("Unknown Application")}</div>;
                else
                    return <div className="spinner" />;
            }

            var progress_or_launch, button;
            if (state.progress) {
                progress_or_launch = <ProgressBar title={self.state.progress_title} data={self.state.progress} />;
                button = <CancelButton data={self.state.progress} />;
            } else if (comp.installed) {
                progress_or_launch = <a role="link" tabIndex="0" onClick={left_click(() => launch(comp))}>{_("Go to Application")}</a>;
                button = <button className="btn btn-danger" onClick={left_click(remove)}>{_("Remove")}</button>;
            } else {
                progress_or_launch = null;
                button = <button className="btn btn-default" onClick={left_click(install)}>{_("Install")}</button>;
            }

            return (
                <div>
                    <table className="table app">
                        <tbody>
                            <tr>
                                <td><img src={icon_url(comp.icon)} role="presentation" /></td>
                                <td>{comp.summary}</td>
                                <td>{progress_or_launch}</td>
                                <td>{button}</td>
                            </tr>
                        </tbody>
                    </table>
                    {render_homepage_link(comp.urls)}
                    <div className="app-description">{render_description(comp.description)}</div>
                    <center>
                        { comp.screenshots.map((s, index) => <img key={`comp-${index}`} className="app-screenshot" role="presentation" src={s.full} />) }
                    </center>
                </div>
            );
        }

        function navigate_up() {
            cockpit.location.go("/");
        }

        return (
            <div>
                <ol className="breadcrumb">
                    <li><a role="link" tabIndex="0" onClick={left_click(navigate_up)}>{_("Applications")}</a></li>
                    <li className="active">{comp ? comp.name : this.props.id}</li>
                </ol>
                {render_comp()}
            </div>
        );
    }
}

module.exports = {
    Application: Application
};
