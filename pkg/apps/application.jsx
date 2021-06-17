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
import {
    Button, Breadcrumb, BreadcrumbItem,
    Card, CardActions, CardHeader, CardTitle, CardBody,
    Flex,
    Page, PageSection,
    Stack,
} from "@patternfly/react-core";
import { ExternalLinkAltIcon } from '@patternfly/react-icons';

import * as PackageKit from "./packagekit.js";
import { left_click, icon_url, show_error, launch, ProgressBar, CancelButton } from "./utils.jsx";

import "./application.css";

const _ = cockpit.gettext;

export class Application extends React.Component {
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
                    return (
                        <Button isInline variant="link" component='a' href={url.link}
                                target="_blank" rel="noopener noreferrer"
                                icon={<ExternalLinkAltIcon />}
                                iconPosition="right">
                            {_("View project website")}
                        </Button>
                    );
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
                    return <div>{_("Unknown application")}</div>;
                else
                    return <div className="spinner" />;
            }

            var progress_or_launch, button;
            if (state.progress) {
                progress_or_launch = <ProgressBar title={self.state.progress_title} data={self.state.progress} />;
                button = <CancelButton data={self.state.progress} />;
            } else if (comp.installed) {
                progress_or_launch = <Button variant="link" onClick={left_click(() => launch(comp))}>{_("Go to application")}</Button>;
                button = <Button variant="danger" onClick={left_click(remove)}>{_("Remove")}</Button>;
            } else {
                progress_or_launch = null;
                button = <Button variant="secondary" onClick={left_click(install)}>{_("Install")}</Button>;
            }

            return (
                <Card>
                    <CardHeader>
                        <CardTitle>
                            <Flex alignItems={{ default: 'alignItemsCenter' }}>
                                <img src={icon_url(comp.icon)} role="presentation" alt="" />
                                <span>{comp.summary}</span>
                            </Flex>
                        </CardTitle>
                        <CardActions>
                            {progress_or_launch}
                            {button}
                        </CardActions>
                    </CardHeader>
                    <CardBody>
                        <Stack hasGutter>
                            {render_homepage_link(comp.urls)}
                            <div className="app-description">{render_description(comp.description)}</div>
                            {comp.screenshots.length ? <div className="text-center">
                                { comp.screenshots.map((s, index) => <img key={`comp-${index}`} className="app-screenshot" role="presentation" alt="" src={s.full} />) }
                            </div> : null}
                        </Stack>
                    </CardBody>
                </Card>
            );
        }

        function navigate_up() {
            cockpit.location.go("/");
        }

        return (
            <Page groupProps={{ sticky: 'top' }}
                  className="application-details"
                  isBreadcrumbGrouped
                  breadcrumb={
                      <Breadcrumb>
                          <BreadcrumbItem className="pf-c-breadcrumb__link" onClick={left_click(navigate_up)} to="#">{_("Applications")}</BreadcrumbItem>
                          <BreadcrumbItem isActive>{comp ? comp.name : this.props.id}</BreadcrumbItem>
                      </Breadcrumb>
                  }>
                <PageSection>
                    {render_comp()}
                </PageSection>
            </Page>
        );
    }
}
