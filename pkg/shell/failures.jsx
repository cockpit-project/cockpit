/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";

const _ = cockpit.gettext;

export const EarlyFailure = ({ ca_cert_url }) => {
    return (
        <Page>
            <PageSection variant={PageSectionVariants.light}>
                <EmptyStatePanel icon={ExclamationCircleIcon}
                                 title={ _("Connection failed") }
                                 paragraph={
                                     <Stack hasGutter>
                                         <div>{_("There was an unexpected error while connecting to the machine.")}</div>
                                         <div>{_("Messages related to the failure might be found in the journal:")}</div>
                                         <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")}>journalctl -u cockpit</ClipboardCopy>
                                         {ca_cert_url && <div id="safari-cert-help">
                                             <div>{_("Safari users need to import and trust the certificate of the self-signing CA:")}</div>
                                             <Button variant="link" component="a" id="safari-cert" href={ca_cert_url} download>ca.cer</Button>
                                         </div>}
                                     </Stack>
                                 } />
            </PageSection>
        </Page>
    );
};

export const EarlyFailureReady = ({ loading, title, paragraph, reconnect, troubleshoot, onTroubleshoot, watchdog_problem, navigate }) => {
    const onReconnect = () => {
        if (watchdog_problem) {
            cockpit.sessionStorage.clear();
            window.location.reload(true);
        } else {
            navigate(null, true);
        }
    };

    return (
        <Page>
            <PageSection variant={PageSectionVariants.light}>
                <EmptyStatePanel icon={!loading ? ExclamationCircleIcon : undefined}
                                 loading={loading}
                                 title={title}
                                 action={<>
                                     {reconnect && <Button id="machine-reconnect" onClick={onReconnect}>{_("Reconnect")}</Button>}
                                     {troubleshoot && <Button id="machine-troubleshoot" onClick={onTroubleshoot}>{_("Log in")}</Button>}
                                 </>}
                                 paragraph={paragraph} />
            </PageSection>
        </Page>
    );
};
