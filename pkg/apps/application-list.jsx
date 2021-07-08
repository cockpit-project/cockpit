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
    Alert, AlertActionCloseButton,
    Button, Card,
    DataList, DataListItem, DataListItemRow, DataListCell,
    DataListAction,
    DataListItemCells,
    Flex, FlexItem,
    Page, PageSection, PageSectionVariants,
} from "@patternfly/react-core";
import { RebootingIcon } from "@patternfly/react-icons";

import * as PackageKit from "./packagekit.js";
import { left_click, icon_url, show_error, launch, ProgressBar, CancelButton } from "./utils.jsx";

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
            func(arg, (data) => self.setState({ progress: data }))
                    .finally(() => self.setState({ progress: null }))
                    .catch(show_error);
        }

        function install() {
            action(PackageKit.install, comp.pkgname, _("Installing"));
        }

        function remove() {
            action(PackageKit.remove, comp.file, _("Removing"));
        }

        var name, summary_or_progress, button;

        if (comp.installed) {
            name = <Button variant="link" isInline id={comp.name} onClick={left_click(() => launch(comp))}>{comp.name}</Button>;
        } else {
            name = <Button variant="link" isInline id={comp.name} onClick={left_click(() => cockpit.location.go(comp.id))}>{comp.name}</Button>;
        }

        if (state.progress) {
            summary_or_progress = <ProgressBar title={state.progress_title} data={state.progress} />;
            button = <CancelButton data={state.progress} />;
        } else {
            if (state.error) {
                summary_or_progress = (
                    <div>
                        {comp.summary}
                        <Alert isInline variant='danger'
                            actionClose={<AlertActionCloseButton onClose={left_click(() => { this.setState({ error: null }) })} />}
                            title={state.error} />
                    </div>
                );
            } else {
                summary_or_progress = comp.summary;
            }

            if (comp.installed) {
                button = <Button variant="danger" onClick={left_click(remove)}>{_("Remove")}</Button>;
            } else {
                button = <Button variant="secondary" onClick={left_click(install)}>{_("Install")}</Button>;
            }
        }

        return (
            <DataListItem className="app-list" aria-labelledby={comp.name}>
                <DataListItemRow>
                    <DataListItemCells
                        dataListCells={[
                            <DataListCell isIcon key="icon">
                                <img src={icon_url(comp.icon)} role="presentation" alt="" />
                            </DataListCell>,
                            <DataListCell width={1} key="app name">
                                {name}
                            </DataListCell>,
                            <DataListCell width={4} key="secondary content">
                                {summary_or_progress}
                            </DataListCell>,
                        ]}
                    />
                    <DataListAction aria-labelledby={comp.name} aria-label={_("Actions")}>
                        {button}
                    </DataListAction>
                </DataListItemRow>
            </DataListItem>
        );
    }
}

export class ApplicationList extends React.Component {
    constructor() {
        super();
        this.state = { progress: false };
    }

    render() {
        var self = this;
        var comps = [];
        for (var id in this.props.metainfo_db.components)
            comps.push(this.props.metainfo_db.components[id]);
        comps.sort((a, b) => a.name.localeCompare(b.name));

        function get_config(name, distro_id, def) {
            if (cockpit.manifests.apps && cockpit.manifests.apps.config) {
                let val = cockpit.manifests.apps.config[name];
                if (typeof val === 'object' && val !== null && !Array.isArray(val))
                    val = val[distro_id];
                return val !== undefined ? val : def;
            } else {
                return def;
            }
        }

        function refresh() {
            const distro_id = JSON.parse(window.localStorage['os-release'] || "{}").ID;

            PackageKit.refresh(self.props.metainfo_db.origin_files,
                               get_config('appstream_config_packages', distro_id, []),
                               get_config('appstream_data_packages', distro_id, []),
                               data => self.setState({ progress: data }))
                    .finally(() => self.setState({ progress: false }))
                    .catch(show_error);
        }

        var refresh_progress, refresh_button, empty_caption, tbody;
        if (this.state.progress) {
            refresh_progress = <ProgressBar size="sm" title={_("Checking for new applications")} data={this.state.progress} />;
            refresh_button = <CancelButton data={this.state.progress} />;
        } else {
            refresh_progress = null;
            refresh_button = (
                <Button variant="secondary" onClick={left_click(refresh)} id="refresh" aria-label={ _("Update package information") }>
                    <RebootingIcon />
                </Button>
            );
        }

        if (comps.length === 0) {
            if (this.props.metainfo_db.ready)
                empty_caption = _("No applications installed or available");
            else
                empty_caption = <div className="spinner spinner-sm" />;
            tbody = <div className="app-list-empty">{empty_caption}</div>;
        } else {
            tbody = comps.map(c => <ApplicationRow comp={c} key={c.id} />);
        }

        return (
            <Page>
                <PageSection variant={PageSectionVariants.light}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <h2 className="pf-u-font-size-3xl">{_("Applications")}</h2>
                        <FlexItem align={{ default: 'alignRight' }}>
                            <Flex>
                                {refresh_progress}
                                {refresh_button}
                            </Flex>
                        </FlexItem>
                    </Flex>
                </PageSection>
                <PageSection>
                    <Card>
                        <DataList aria-label={_("Applications list")}>
                            { tbody }
                        </DataList>
                    </Card>
                </PageSection>
            </Page>
        );
    }
}
