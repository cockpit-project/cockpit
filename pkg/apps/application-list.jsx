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
import React, { useState } from "react";
import { Alert, AlertActionCloseButton, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DataList, DataListAction, DataListCell, DataListItem, DataListItemCells, DataListItemRow } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";

import { RebootingIcon } from "@patternfly/react-icons";

import { check_uninstalled_packages } from "packagekit.js";
import * as PackageKit from "./packagekit.js";
import { read_os_release } from "os-release.js";
import { icon_url, show_error, launch, ProgressBar, CancelButton } from "./utils.jsx";
import { ActionButton } from "./application.jsx";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { useInit } from "../lib/hooks.js";

const _ = cockpit.gettext;

const ApplicationRow = ({ comp, progress, progress_title, action }) => {
    const [error, setError] = useState();

    const name = (
        <Button variant="link"
            isInline id={comp.name}
            onClick={() => comp.installed ? launch(comp) : cockpit.location.go(comp.id)}>
            {comp.name}
        </Button>);

    let summary_or_progress;
    if (progress) {
        summary_or_progress = (
            <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                <span id={comp.name + "-progress"} className="progress-title-span">{progress_title}</span>
                <ProgressBar title={progress_title} data={progress} ariaLabelledBy={comp.name + "-progress"} />
            </Flex>);
    } else {
        if (error) {
            summary_or_progress = (
                <div>
                    {comp.summary}
                    <Alert isInline variant='danger'
                        actionClose={<AlertActionCloseButton onClose={() => setError(null)} />}
                        title={error} />
                </div>
            );
        } else {
            summary_or_progress = comp.summary;
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
                    <ActionButton comp={comp} progress={progress} action={action} />
                </DataListAction>
            </DataListItemRow>
        </DataListItem>
    );
};

export const ApplicationList = ({ metainfo_db, appProgress, appProgressTitle, action }) => {
    const [progress, setProgress] = useState(false);
    const [dataPackagesInstalled, setDataPackagesInstalled] = useState(null);
    const comps = [];
    for (const id in metainfo_db.components)
        comps.push(metainfo_db.components[id]);
    comps.sort((a, b) => a.name.localeCompare(b.name));

    function get_config(name, os_release, def) {
        // ID is a single value, ID_LIKE is a list
        const os_list = [os_release?.ID || "", ...(os_release?.ID_LIKE || "").split(/\s+/)];

        if (cockpit.manifests.apps && cockpit.manifests.apps.config) {
            const val = cockpit.manifests.apps.config[name];
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                for (const os of os_list) {
                    if (val[os])
                        return val[os];
                }
                return def;
            }
            return val !== undefined ? val : def;
        } else {
            return def;
        }
    }

    async function check_missing_data(packages) {
        try {
            const missing = await check_uninstalled_packages(packages);
            setDataPackagesInstalled(missing.size === 0);
        } catch (e) {
            console.warn("Failed to check missing AppStream metadata packages:", e.toString());
        }
    }

    useInit(async () => {
        const os_release = await read_os_release();
        const configPackages = get_config('appstream_config_packages', os_release, []);
        const dataPackages = get_config('appstream_data_packages', os_release, []);
        await check_missing_data([...dataPackages, ...configPackages]);
    });

    function refresh() {
        read_os_release().then(os_release => {
            const configPackages = get_config('appstream_config_packages', os_release, []);
            const dataPackages = get_config('appstream_data_packages', os_release, []);
            PackageKit.refresh(metainfo_db.origin_files,
                               configPackages,
                               dataPackages,
                               setProgress)
                    .finally(async () => {
                        await check_missing_data([...dataPackages, ...configPackages]);
                        setProgress(false);
                    }).catch(show_error);
        });
    }

    let refresh_progress, refresh_button, tbody;
    if (progress) {
        refresh_progress = <ProgressBar id="refresh-progress" size="sm" title={_("Checking for new applications")} data={progress} />;
        refresh_button = <CancelButton data={progress} />;
    } else {
        refresh_progress = null;
        refresh_button = (
            <Button variant="secondary" onClick={refresh} id="refresh" aria-label={ _("Update package information") }>
                <RebootingIcon />
            </Button>
        );
    }

    if (comps.length) {
        tbody = comps.map(c => <ApplicationRow comp={c} key={c.id}
                                               progress={appProgress[c.id]}
                                               progress_title={appProgressTitle[c.id]}
                                               action={action} />);
    }

    const data_missing_msg = (dataPackagesInstalled == false && !refresh_progress)
        ? _("Application information is missing")
        : null;

    return (
        <Page id="list-page" data-packages-checked={dataPackagesInstalled !== null}>
            <PageSection variant={PageSectionVariants.light}>
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <h2 className="pf-v5-u-font-size-3xl">{_("Applications")}</h2>
                    <FlexItem align={{ default: 'alignRight' }}>
                        <Flex alignItems={{ default: 'alignItemsCenter' }} spacer={{ default: 'spacerXs' }}>
                            <FlexItem>
                                {refresh_progress}
                            </FlexItem>
                            <FlexItem>
                                {refresh_button}
                            </FlexItem>
                        </Flex>
                    </FlexItem>
                </Flex>
            </PageSection>
            {comps.length == 0
                ? <EmptyStatePanel title={ _("No applications installed or available.") }
                                   paragraph={data_missing_msg}
                                   action={ data_missing_msg && _("Install application information")} onAction={refresh} />
                : <PageSection>
                    <Stack hasGutter>
                        {!progress && data_missing_msg &&
                            <StackItem key="missing-meta-alert">
                                <Alert variant="warning" isInline title={data_missing_msg}
                                    actionLinks={ <AlertActionLink onClick={refresh}>{_("Install")}</AlertActionLink>} />
                            </StackItem>
                        }
                        <StackItem>
                            <Card>
                                <DataList aria-label={_("Applications list")}>
                                    { tbody }
                                </DataList>
                            </Card>
                        </StackItem>
                    </Stack>
                </PageSection>
            }
        </Page>
    );
};
