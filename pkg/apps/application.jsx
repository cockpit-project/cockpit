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
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Page, PageBreadcrumb, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ExternalLinkAltIcon } from '@patternfly/react-icons';

import * as PackageKit from "./packagekit.js";

import { icon_url, launch, ProgressBar, CancelButton } from "./utils.jsx";

import "./application.scss";

const _ = cockpit.gettext;

export const ActionButton = ({ comp, progress, action }) => {
    function install(comp) {
        action(PackageKit.install, comp.pkgname, _("Installing"), comp.id);
    }

    function remove(comp) {
        action(PackageKit.remove, comp.file, _("Removing"), comp.id);
    }

    if (progress) {
        return <CancelButton data={progress} />;
    } else if (comp.installed) {
        return <Button variant="danger" onClick={() => remove(comp)}>{_("Remove")}</Button>;
    } else {
        return <Button variant="secondary" onClick={() => install(comp)}>{_("Install")}</Button>;
    }
};

export const Application = ({ metainfo_db, id, progress, progress_title, action }) => {
    if (!id)
        return null;

    const comp = metainfo_db.components[id];

    function render_homepage_link(urls) {
        return urls.map((url, index) => {
            if (url.type == 'homepage') {
                return (
                    <Button isInline variant="link" component='a' href={url.link}
                            key={"project-url-" + index}
                            target="_blank" rel="noopener noreferrer"
                            icon={<ExternalLinkAltIcon />}
                            iconPosition="right">
                        {_("View project website")}
                    </Button>
                );
            } else {
                return null;
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
        if (!comp)
            return <div>{_("Unknown application")}</div>;

        let progress_or_launch;
        if (progress) {
            progress_or_launch = <ProgressBar title={progress_title} data={progress} />;
        } else if (comp.installed) {
            progress_or_launch = <Button variant="link" onClick={() => launch(comp)}>{_("Go to application")}</Button>;
        } else {
            progress_or_launch = null;
        }

        return (
            <Card>
                <CardHeader actions={{
                    actions: <>{progress_or_launch}<ActionButton comp={comp} progress={progress} action={action} /></>,
                }}>
                    <CardTitle>
                        <Flex alignItems={{ default: 'alignItemsCenter' }}>
                            <img src={icon_url(comp.icon)} role="presentation" alt="" />
                            <span>{comp.summary}</span>
                        </Flex>
                    </CardTitle>
                </CardHeader>
                <CardBody>
                    <Stack hasGutter>
                        {render_homepage_link(comp.urls)}
                        <div className="app-description">{render_description(comp.description)}</div>
                        {comp.screenshots.length
                            ? <div className="text-center">
                                { comp.screenshots.map((s, index) => <img key={`comp-${index}`} className="app-screenshot" role="presentation" alt="" src={s.full} />) }
                            </div>
                            : null}
                    </Stack>
                </CardBody>
            </Card>
        );
    }

    return (
        <Page id="app-page"
              className="application-details">
            <PageBreadcrumb stickyOnBreakpoint={{ default: "top" }}>
                <Breadcrumb>
                    <BreadcrumbItem to="#/">{_("Applications")}</BreadcrumbItem>
                    <BreadcrumbItem isActive>{comp ? comp.name : id}</BreadcrumbItem>
                </Breadcrumb>
            </PageBreadcrumb>
            <PageSection>
                {render_comp()}
            </PageSection>
        </Page>
    );
};
