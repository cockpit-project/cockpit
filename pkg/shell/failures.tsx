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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

import { EmptyStatePanel } from "cockpit-components-empty-state";

import { codes } from "./hosts_dialog.jsx";
import { Machine } from "./machines/machines";

const _ = cockpit.gettext;

export const EarlyFailure = () => {
    let ca_cert_url = null;
    if (window.navigator.userAgent.indexOf("Safari") >= 0)
        ca_cert_url = window.sessionStorage.getItem("CACertUrl");

    return (
        <div id="early-failure" className="early-failure">
            <Page className="pf-m-no-sidebar">
                <PageSection hasBodyWrapper={false}>
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
        </div>
    );
};

const EarlyFailureReady = ({
    loading = false,
    title,
    paragraph,
    reconnect = false,
    troubleshoot = false,
    onTroubleshoot = () => {},
    onReconnect = () => {},
} : {
    loading?: boolean,
    title: string,
    paragraph: string,
    reconnect?: boolean,
    troubleshoot?: boolean,
    onTroubleshoot?: () => void,
    onReconnect?: () => void,
}) => {
    return (
        <div id="early-failure-ready" className="curtains-ct">
            <Page className="pf-m-no-sidebar">
                <PageSection hasBodyWrapper={false}>
                    <EmptyStatePanel {... !loading ? { icon: ExclamationCircleIcon } : {} }
                                     loading={loading}
                                     title={title}
                                     action={<>
                                         {reconnect &&
                                         <Button id="machine-reconnect" onClick={onReconnect}>
                                             {_("Reconnect")}
                                         </Button>}
                                         {troubleshoot &&
                                         <Button id="machine-troubleshoot" onClick={onTroubleshoot}>
                                             {_("Log in")}
                                         </Button>}
                                     </>}
                                     paragraph={paragraph} />
                </PageSection>
            </Page>
        </div>
    );
};

export const Disconnected = ({
    problem
} : {
    problem: string
}) => {
    return (
        <EarlyFailureReady title={_("Disconnected")}
                               reconnect
                               onReconnect={() => {
                                   cockpit.sessionStorage.clear();
                                   window.location.reload();
                               }}
                               paragraph={cockpit.message(problem)} />
    );
};

export const MachineTroubleshoot = ({
    machine,
    onClick
} : {
    machine: Machine,
    onClick: () => void
}) => {
    const connecting = (machine.state == "connecting");
    let title;
    let message;
    if (machine.restarting) {
        title = _("The machine is rebooting");
        message = "";
    } else if (connecting) {
        title = _("Connecting to the machine");
        message = "";
    } else {
        title = _("Not connected to host");
        if (machine.problem == "not-found") {
            message = _("Cannot connect to an unknown host");
        } else {
            const error = machine.problem || machine.state;
            if (error)
                message = cockpit.message(error);
            else
                message = "";
        }
    }

    let troubleshooting = false;

    if (!machine.restarting && (machine.problem === "no-host" || (machine.problem && machine.problem in codes))) {
        troubleshooting = true;
    }

    const restarting = !!machine.restarting;
    const reconnect = !connecting && machine.problem != "not-found" && !troubleshooting;

    return (
        <EarlyFailureReady loading={connecting || restarting}
                           title={title}
                           reconnect={reconnect}
                           troubleshoot={troubleshooting}
                           onTroubleshoot={onClick}
                           onReconnect={onClick}
                           paragraph={message} />
    );
};
