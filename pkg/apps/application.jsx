/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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

import { icon_url, launch, ProgressBar, CancelButton, reload_bridge_packages, ProgressReporter } from "./utils";

import "./application.scss";
import { getPackageManager } from "packagemanager.js";

const _ = cockpit.gettext;

async function install_package(pkgname, progress_cb) {
    const packagemanager = await getPackageManager();
    await packagemanager.install_packages([pkgname], progress_cb);
    await reload_bridge_packages();
}

async function remove_package(filename, progress_cb) {
    const progress = new ProgressReporter(0, 1, progress_cb);
    const packagemanager = await getPackageManager();
    const pkgnames = await packagemanager.find_file_packages([filename], progress.progress_reporter);
    progress.base = 1;
    progress.range = 99;
    await packagemanager.remove_packages(pkgnames, progress.progress_reporter);
    await reload_bridge_packages();
}

export const ActionButton = ({ comp, progress, action }) => {
    function install(comp) {
        action(install_package, comp.pkgname, _("Installing"), comp.id);
    }

    function remove(comp) {
        action(remove_package, comp.file, _("Removing"), comp.id);
    }

    if (progress) {
        return <CancelButton data={progress} />;
    } else if (comp.installed) {
        return <Button variant="danger" onClick={() => remove(comp)}>{_("Remove")}</Button>;
    } else {
        return <Button variant="secondary" onClick={() => install(comp)}>{_("Install")}</Button>;
    }
};

export const Application = ({ metainfo_db, id, progress, action }) => {
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

    // Render a description in the form returned by the AppStream
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
            progress_or_launch = <ProgressBar data={progress} />;
        } else if (comp.installed) {
            progress_or_launch = <Button variant="link" onClick={() => launch(comp)}>{_("Go to application")}</Button>;
        } else {
            progress_or_launch = null;
        }

        return (
            <Card isPlain>
                <CardHeader actions={{
                    actions: <>{progress_or_launch}<ActionButton comp={comp} progress={progress} action={action} /></>,
                }}>
                    <CardTitle>
                        <Flex alignItems={{ default: 'alignItemsCenter' }}>
                            <img src={icon_url(comp.icon)} alt="" />
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
                                { comp.screenshots.map((s, index) => <img key={`comp-${index}`} className="app-screenshot" alt="" src={s.full} />) }
                            </div>
                            : null}
                    </Stack>
                </CardBody>
            </Card>
        );
    }

    return (
        <Page id="app-page"
              className="application-details pf-m-no-sidebar">
            <PageBreadcrumb hasBodyWrapper={false} stickyOnBreakpoint={{ default: "top" }}>
                <Breadcrumb>
                    <BreadcrumbItem to="#/">{_("Applications")}</BreadcrumbItem>
                    <BreadcrumbItem isActive>{comp ? comp.name : id}</BreadcrumbItem>
                </Breadcrumb>
            </PageBreadcrumb>
            <PageSection hasBodyWrapper={false}>
                {render_comp()}
            </PageSection>
        </Page>
    );
};
