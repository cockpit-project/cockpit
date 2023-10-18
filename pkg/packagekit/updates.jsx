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
import '../lib/patternfly/patternfly-5-cockpit.scss';
import 'polyfills'; // once per application
import 'cockpit-dark-theme'; // once per page

import cockpit from "cockpit";
import React from "react";
import { createRoot } from 'react-dom/client';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Badge } from "@patternfly/react-core/dist/esm/components/Badge/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CodeBlock, CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { LabelGroup } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Progress, ProgressSize } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Text, TextContent, TextList, TextListItem, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";

import {
    BugIcon,
    CheckIcon,
    EnhancementIcon,
    ExclamationCircleIcon,
    ExclamationTriangleIcon,
    RebootingIcon,
    RedoIcon,
    ProcessAutomationIcon,
    SecurityIcon,
} from "@patternfly/react-icons";
import { cellWidth, TableText } from "@patternfly/react-table";
import { Remarkable } from "remarkable";

import { AutoUpdates, getBackend } from "./autoupdates.jsx";
import { KpatchSettings, KpatchStatus } from "./kpatch.jsx";
import { History, PackageList } from "./history.jsx";
import { page_status } from "notifications";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ListingTable } from 'cockpit-components-table.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ShutdownModal } from 'cockpit-components-shutdown.jsx';
import { WithDialogs } from "dialogs.jsx";

import { superuser } from 'superuser';
import * as PK from "packagekit.js";
import * as timeformat from "timeformat.js";

import * as python from "python.js";
import callTracerScript from './callTracer.py';

import "./updates.scss";

const _ = cockpit.gettext;

// "available" heading is built dynamically
const STATE_HEADINGS = {};
const PK_STATUS_STRINGS = {};
const PK_STATUS_LOG_STRINGS = {};
const packageSummaries = {};

const UPDATES = {
    ALL: 0,
    SECURITY: 1,
    KPATCHES: 2,
};

function init() {
    STATE_HEADINGS.loading = _("Loading available updates, please wait...");
    STATE_HEADINGS.locked = _("Some other program is currently using the package manager, please wait...");
    STATE_HEADINGS.refreshing = _("Refreshing package information");
    STATE_HEADINGS.uptodate = _("System is up to date");
    STATE_HEADINGS.applying = _("Applying updates");
    STATE_HEADINGS.updateError = _("Applying updates failed");
    STATE_HEADINGS.loadError = _("Loading available updates failed");

    PK_STATUS_STRINGS[PK.Enum.STATUS_DOWNLOAD] = _("Downloading");
    PK_STATUS_STRINGS[PK.Enum.STATUS_INSTALL] = _("Installing");
    PK_STATUS_STRINGS[PK.Enum.STATUS_UPDATE] = _("Updating");
    PK_STATUS_STRINGS[PK.Enum.STATUS_CLEANUP] = _("Setting up");
    PK_STATUS_STRINGS[PK.Enum.STATUS_SIGCHECK] = _("Verifying");

    PK_STATUS_LOG_STRINGS[PK.Enum.STATUS_DOWNLOAD] = _("Downloaded");
    PK_STATUS_LOG_STRINGS[PK.Enum.STATUS_INSTALL] = _("Installed");
    PK_STATUS_LOG_STRINGS[PK.Enum.STATUS_UPDATE] = _("Updated");
    PK_STATUS_LOG_STRINGS[PK.Enum.STATUS_CLEANUP] = _("Set up");
    PK_STATUS_LOG_STRINGS[PK.Enum.STATUS_SIGCHECK] = _("Verified");
}

// parse CVEs from an arbitrary text (changelog) and return URL array
function parseCVEs(text) {
    if (!text)
        return [];

    const cves = text.match(/CVE-\d{4}-\d+/g);
    if (!cves)
        return [];
    return cves.map(n => "https://cve.mitre.org/cgi-bin/cvename.cgi?name=" + n);
}

function deduplicate(list) {
    const d = { };
    list.forEach(i => { if (i) d[i] = true; });
    const result = Object.keys(d);
    result.sort();
    return result;
}

// Insert comma strings in between elements of the list. Unlike list.join(",")
// this does not stringify the elements, which we need to keep as JSX objects.
function insertCommas(list) {
    if (list.length <= 1)
        return list;
    return list.reduce((prev, cur) => [prev, ", ", cur]);
}

// Fedora changelogs are a wild mix of enumerations or not, headings, etc.
// Remove that formatting to avoid an untidy updates overview list
function cleanupChangelogLine(text) {
    if (!text)
        return text;

    // enumerations
    text = text.replace(/^[-* ]*/, "");

    // headings
    text = text.replace(/^=+\s+/, "").replace(/=+\s*$/, "");

    return text.trim();
}

// Replace cockpit-wsinstance-https@[long_id] with a shorter string
function shortenCockpitWsInstance(list) {
    list = [...list];

    list.forEach((item, idx) => {
        if (item.startsWith("cockpit-wsinstance-https"))
            list[idx] = "cockpit-wsinstance-https@.";
    });

    return list;
}

function count_security_updates(updates) {
    let num_security = 0;
    for (const u in updates)
        if (updates[u].severity === PK.Enum.INFO_SECURITY)
            ++num_security;
    return num_security;
}

function isKpatchPackage(name) {
    return name.startsWith("kpatch-patch");
}

function count_kpatch_updates(updates) {
    let num_kpatches = 0;
    for (const u in updates)
        if (isKpatchPackage(updates[u].name))
            ++num_kpatches;
    return num_kpatches;
}

function find_highest_severity(updates) {
    let max = PK.Enum.INFO_LOW;
    for (const u in updates)
        if (updates[u].severity > max)
            max = updates[u].severity;
    return max;
}

/**
 * Get appropriate icon for an update severity
 *
 * info: An Enum.INFO_* level
 * secSeverity: If given, further classification of the severity of Enum.INFO_SECURITY from the vendor_urls;
 *              e. g. "critical", see https://access.redhat.com/security/updates/classification
 * Returns: Icon JSX object
 *
 */
function getSeverityIcon(info, secSeverity) {
    let classes = "severity-icon";
    if (secSeverity)
        classes += " severity-" + secSeverity;
    if (info == PK.Enum.INFO_SECURITY)
        return <SecurityIcon aria-label={ secSeverity || _("security") } className={classes} />;
    else if (info >= PK.Enum.INFO_NORMAL)
        return <BugIcon className={classes} aria-label={ _("bug fix") } />;
    else
        return <EnhancementIcon className={classes} aria-label={ _("enhancement") } />;
}

function getPageStatusSeverityIcon(severity) {
    if (severity == PK.Enum.INFO_SECURITY)
        return "security";
    else if (severity >= PK.Enum.INFO_NORMAL)
        return "bug";
    else
        return "enhancement";
}

function getSeverityURL(urls) {
    if (!urls)
        return null;

    // in ascending severity
    const knownLevels = ["low", "moderate", "important", "critical"];
    let highestIndex = -1;
    let highestURL = null;

    // search URLs for highest valid severity; by all means we expect an update to have at most one, but for paranoia..
    urls.forEach(value => {
        if (value.startsWith("https://access.redhat.com/security/updates/classification/#")) {
            const i = knownLevels.indexOf(value.slice(value.indexOf("#") + 1));
            if (i > highestIndex) {
                highestIndex = i;
                highestURL = value;
            }
        }
    });
    return highestURL;
}

// Overrides the link_open function to apply our required HTML attributes
function customRemarkable() {
    const remarkable = new Remarkable();

    const orig_link_open = remarkable.renderer.rules.link_open;
    remarkable.renderer.rules.link_open = function() {
        let result = orig_link_open.apply(null, arguments);

        const parser = new DOMParser();
        const htmlDocument = parser.parseFromString(result, "text/html");
        const links = htmlDocument.getElementsByTagName("a");
        if (links.length === 1) {
            const href = links[0].getAttribute("href");
            result = `<a rel="noopener noreferrer" target="_blank" href="${href}">`;
        }
        return result;
    };
    return remarkable;
}

function updateItem(remarkable, info, pkgNames, key) {
    let bugs = null;
    if (info.bug_urls && info.bug_urls.length) {
        // we assume a bug URL ends with a number; if not, show the complete URL
        bugs = insertCommas(info.bug_urls.map(url => (
            <a key={url} rel="noopener noreferrer" target="_blank" href={url}>
                {url.match(/[0-9]+$/) || url}
            </a>)
        ));
    }

    let cves = null;
    if (info.cve_urls && info.cve_urls.length) {
        cves = insertCommas(info.cve_urls.map(url => (
            <a key={url} href={url} rel="noopener noreferrer" target="_blank">
                {url.match(/[^/=]+$/)}
            </a>)
        ));
    }

    let errata = null;
    if (info.vendor_urls) {
        errata = insertCommas(info.vendor_urls.filter(url => url.indexOf("/errata/") > 0).map(url => (
            <a key={url} href={url} rel="noopener noreferrer" target="_blank">
                {url.match(/[^/=]+$/)}
            </a>)
        ));
        if (!errata.length)
            errata = null; // simpler testing below
    }

    let secSeverityURL = getSeverityURL(info.vendor_urls);
    const secSeverity = secSeverityURL ? secSeverityURL.slice(secSeverityURL.indexOf("#") + 1) : null;
    const icon = getSeverityIcon(info.severity, secSeverity);
    let type;
    if (info.severity === PK.Enum.INFO_SECURITY) {
        if (secSeverityURL)
            secSeverityURL = <a rel="noopener noreferrer" target="_blank" href={secSeverityURL}>{secSeverity}</a>;
        type = (
            <>
                <Tooltip id="tip-severity" content={ secSeverity || _("security") }>
                    <span>
                        {icon}
                        { (info.cve_urls && info.cve_urls.length > 0) ? info.cve_urls.length : "" }
                    </span>
                </Tooltip>
            </>);
    } else {
        const tip = (info.severity >= PK.Enum.INFO_NORMAL) ? _("bug fix") : _("enhancement");
        type = (
            <Tooltip id="tip-severity" content={tip}>
                <span>
                    {icon}
                    { bugs ? info.bug_urls.length : "" }
                </span>
            </Tooltip>
        );
    }

    const pkgList = pkgNames.map((n, index) => (
        <Tooltip key={n.name + n.arch} id="tip-summary" content={packageSummaries[n.name] + " (" + n.arch + ")"}>
            <span>{n.name + (index !== (pkgNames.length - 1) ? ", " : "")}</span>
        </Tooltip>)
    );
    const pkgs = pkgList;
    const pkgsTruncated = pkgList.slice(0, 4);

    if (pkgList.length > 4)
        pkgsTruncated.push(<span key="more">…</span>);

    if (pkgNames.some(pkg => isKpatchPackage(pkg.name)))
        pkgsTruncated.push(
            <LabelGroup key={`${key}-kpatches-labelgroup`} className="kpatches-labelgroup">
                {" "}<Badge color="blue" variant="filled">{_("patches")}</Badge>
            </LabelGroup>
        );

    let descriptionFirstLine = (info.description || "").trim();
    if (descriptionFirstLine.indexOf("\n") >= 0)
        descriptionFirstLine = descriptionFirstLine.slice(0, descriptionFirstLine.indexOf("\n"));
    descriptionFirstLine = cleanupChangelogLine(descriptionFirstLine);
    let description;
    if (info.markdown) {
        descriptionFirstLine = <span dangerouslySetInnerHTML={{ __html: remarkable.render(descriptionFirstLine) }} />;
        description = <div dangerouslySetInnerHTML={{ __html: remarkable.render(info.description) }} />;
    } else {
        description = <div className="changelog">{info.description}</div>;
    }

    const expandedContent = (
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
            <DescriptionList>
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Packages")}</DescriptionListTerm>
                    <DescriptionListDescription>{pkgs}</DescriptionListDescription>
                </DescriptionListGroup>
                { cves
                    ? <DescriptionListGroup>
                        <DescriptionListTerm>{_("CVE")}</DescriptionListTerm>
                        <DescriptionListDescription>{cves}</DescriptionListDescription>
                    </DescriptionListGroup>
                    : null }
                { secSeverityURL
                    ? <DescriptionListGroup>
                        <DescriptionListTerm>{_("Severity")}</DescriptionListTerm>
                        <DescriptionListDescription className="severity">{secSeverityURL}</DescriptionListDescription>
                    </DescriptionListGroup>
                    : null }
                { errata
                    ? <DescriptionListGroup>
                        <DescriptionListTerm>{_("Errata")}</DescriptionListTerm>
                        <DescriptionListDescription>{errata}</DescriptionListDescription>
                    </DescriptionListGroup>
                    : null }
                { bugs
                    ? <DescriptionListGroup>
                        <DescriptionListTerm>{_("Bugs")}</DescriptionListTerm>
                        <DescriptionListDescription>{bugs}</DescriptionListDescription>
                    </DescriptionListGroup>
                    : null }
            </DescriptionList>
            <TextContent>{description}</TextContent>
        </Flex>
    );

    return {
        columns: [
            { title: pkgsTruncated },
            { title: <TableText wrapModifier="truncate">{info.version}</TableText>, props: { className: "version" } },
            { title: <TableText wrapModifier="nowrap">{type}</TableText>, props: { className: "type" } },
            { title: descriptionFirstLine, props: { className: "changelog" } },
        ],
        props: {
            key,
            className: info.severity === PK.Enum.INFO_SECURITY ? ["error"] : [],
        },
        hasPadding: true,
        expandedContent,
    };
}

const UpdatesList = ({ updates }) => {
    const remarkable = customRemarkable();
    const update_ids = [];

    // PackageKit doesn"t expose source package names, so group packages with the same version and changelog
    // create a reverse version+changes → [id] map on iteration
    const sameUpdate = {};
    const packageNames = {};
    Object.keys(updates).forEach(id => {
        const u = updates[id];
        // did we already see the same version and description? then merge
        const hash = u.version + u.description;
        const seenId = sameUpdate[hash];
        if (seenId) {
            packageNames[seenId].push({ name: u.name, arch: u.arch });
        } else {
            // this is a new update
            sameUpdate[hash] = id;
            packageNames[id] = [{ name: u.name, arch: u.arch }];
            update_ids.push(id);
        }
    });

    // sort security first
    update_ids.sort((a, b) => {
        if (updates[a].severity === PK.Enum.INFO_SECURITY && updates[b].severity !== PK.Enum.INFO_SECURITY)
            return -1;
        if (updates[a].severity !== PK.Enum.INFO_SECURITY && updates[b].severity === PK.Enum.INFO_SECURITY)
            return 1;
        return a.localeCompare(b);
    });

    return (
        <ListingTable aria-label={_("Available updates")}
                gridBreakPoint='grid-lg'
                columns={[
                    { title: _("Name"), transforms: [cellWidth(40)] },
                    { title: _("Version"), transforms: [cellWidth(15)] },
                    { title: _("Severity"), transforms: [cellWidth(15)] },
                    { title: _("Details"), transforms: [cellWidth(30)] },
                ]}
                rows={update_ids.map(id => updateItem(remarkable, updates[id], packageNames[id].sort((a, b) => a.name > b.name), id))} />
    );
};

class RestartServices extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dialogError: undefined,
            restartInProgress: false,
        };

        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.dialogErrorDismiss = this.dialogErrorDismiss.bind(this);
        this.restart = this.restart.bind(this);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    dialogErrorDismiss() {
        this.setState({ dialogError: undefined });
    }

    restart() {
        // make sure cockpit package is the last to restart
        const daemons = this.props.tracerPackages.daemons.sort((a, b) => {
            if (a.includes("cockpit") && b.includes("cockpit"))
                return 0;
            if (a.includes("cockpit"))
                return 1;
            return a.localeCompare(b);
        });
        const restarts = daemons.map(service => cockpit.spawn(["systemctl", "restart", service + ".service"], { superuser: "required", err: "message" }));
        this.setState({ restartInProgress: true });
        Promise.all(restarts)
                .then(() => {
                    this.props.onValueChanged({ tracerPackages: { reboot: this.props.tracerPackages.reboot, daemons: [], manual: this.props.tracerPackages.manual } });
                    if (this.props.state === "updateSuccess")
                        this.props.loadUpdates();
                    this.setState({ restartInProgress: false });
                    this.props.close();
                })
                .catch(ex => {
                    this.dialogErrorSet(_("Failed to restart service"), ex.message);
                    // call Tracer again to see what services remain
                    this.props.callTracer(null);
                });
    }

    render() {
        let body;
        if (this.props.tracerRunning) {
            body = (
                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <Spinner size="sm" />
                    <p>{_("Reloading the state of remaining services")}</p>
                </Flex>
            );
        } else if (this.props.tracerPackages.daemons.length > 0) {
            body = (<>
                {cockpit.ngettext("The following service will be restarted:", "The following services will be restarted:", this.props.tracerPackages.daemons.length)}
                <TwoColumnContent list={this.props.tracerPackages.daemons} flexClassName="restart-services-modal-body" />
            </>);
        }

        return (
            <Modal id="restart-services-modal" isOpen
                   position="top"
                   variant="medium"
                   onClose={this.props.close}
                   title={_("Restart services")}
                   footer={
                       <>
                           {this.props.tracerPackages.daemons.includes("cockpit") &&
                               <Alert variant="warning"
                                   title={_("Web Console will restart")}
                                   isInline>
                                   <p>
                                       {_("When the Web Console is restarted, you will no longer see progress information. However, the update process will continue in the background. Reconnect to continue watching the update process.")}
                                   </p>
                               </Alert>}
                           <Button variant='primary'
                               isDisabled={ this.state.restartInProgress }
                               onClick={ this.restart }>
                               {_("Restart services")}
                           </Button>
                           <Button variant='link' className='btn-cancel' onClick={ this.props.close }>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                <Stack hasGutter>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    <StackItem>{body}</StackItem>
                </Stack>
            </Modal>
        );
    }
}

const formatPackageId = packageId => {
    const pfields = packageId.split(";");
    return pfields[0] + " " + pfields[1] + " (" + pfields[2] + ")";
};

// actions is a chronological list of { status, packageId } events that happen during applying updates
// status: see PK_STATUS_* at https://github.com/PackageKit/PackageKit/blob/main/lib/packagekit-glib2/pk-enum.h
const ApplyUpdates = ({ transactionProps, actions, onCancel, rebootAfter, setRebootAfter }) => {
    const remain = transactionProps.RemainingTime
        ? timeformat.distanceToNow(new Date().valueOf() + transactionProps.RemainingTime * 1000)
        : null;

    let percentage = transactionProps.Percentage || 0;
    // PackageKit sets this to 101 initially
    if (percentage > 100)
        percentage = 0;

    // scroll update log to the bottom, if it already is (almost) at the bottom
    const log = document.getElementById("update-log");
    if (log) {
        if (log.scrollHeight - log.clientHeight <= log.scrollTop + 2)
            log.scrollTop = log.scrollHeight;
    }

    const cancelButton = transactionProps.AllowCancel
        ? <Button variant="secondary" onClick={onCancel} size="sm">{_("Cancel")}</Button>
        : null;

    if (actions.length === 0 && percentage === 0) {
        return <EmptyStatePanel title={ _("Initializing...") }
                                headingLevel="h5"
                                titleSize="4xl"
                                secondary={cancelButton}
                                loading
        />;
    }

    const lastAction = actions[actions.length - 1];
    // when resuming an upgrade, we did not get any Package signal yet; fall back to LastPackage
    const curPackage = formatPackageId(lastAction?.packageId || transactionProps.LastPackage || "");
    return (
        <div className="progress-main-view">
            <Grid hasGutter>
                <GridItem span="9">
                    <div className="progress-description">
                        <Spinner size="md" />
                        <strong>{ PK_STATUS_STRINGS[lastAction?.status] || PK_STATUS_STRINGS[PK.Enum.STATUS_UPDATE] }</strong>
                        &nbsp;{curPackage}
                    </div>
                    <Progress title={remain}
                              value={percentage}
                              size={ProgressSize.sm}
                              className="pf-v5-u-mb-xs" />
                </GridItem>

                <GridItem span="3">{cancelButton}</GridItem>

                <GridItem span="12">
                    <Switch id="reboot-after" isChecked={rebootAfter}
                            label={ _("Reboot after completion") }
                            onChange={setRebootAfter} />
                </GridItem>

                <GridItem span="12" className="update-log">
                    <ExpandableSection toggleText={_("View update log")} onToggle={() => {
                        // always scroll down on expansion
                        const log = document.getElementById("update-log");
                        log.scrollTop = log.scrollHeight;
                    }}>
                        <div id="update-log" className="update-log-content">
                            <table>
                                <tbody>
                                    { actions.slice(0, -1).map((action, i) => (
                                        <tr key={action.packageId + i}>
                                            <th>{PK_STATUS_LOG_STRINGS[action.status] || PK_STATUS_LOG_STRINGS[PK.Enum.STATUS_UPDATE]}</th>
                                            <td>{formatPackageId(action.packageId)}</td>
                                        </tr>)) }
                                </tbody>
                            </table>
                        </div>
                    </ExpandableSection>
                </GridItem>
            </Grid>
        </div>
    );
};

const TwoColumnContent = ({ list, flexClassName }) => {
    const half = Math.round(list.length / 2);
    const col1 = list.slice(0, half);
    const col2 = list.slice(half);
    return (
        <Flex className={flexClassName}>
            <FlexItem flex={{ default: 'flex_1' }}>
                <TextContent>
                    <TextList>
                        {col1.map(item => (<TextListItem key={item}>{item}</TextListItem>))}
                    </TextList>
                </TextContent>
            </FlexItem>
            {col2.length > 0 && <FlexItem flex={{ default: 'flex_1' }}>
                <TextContent>
                    <TextList>
                        {col2.map(item => (<TextListItem key={item}>{item}</TextListItem>))}
                    </TextList>
                </TextContent>
            </FlexItem>}
        </Flex>
    );
};

const TwoColumnTitle = ({ icon, str }) => {
    return (<>
        {icon}
        <span className="update-success-table-title">
            {str}
        </span>
    </>);
};

const UpdateSuccess = ({ onIgnore, openServiceRestartDialog, openRebootDialog, restart, manual, reboot, tracerAvailable, history }) => {
    if (!tracerAvailable) {
        return (<>
            <EmptyStatePanel icon={RebootingIcon}
                             title={ _("Update was successful") }
                             headingLevel="h5"
                             titleSize="4xl"
                             paragraph={ _("Updated packages may require a reboot to take effect.") }
                             secondary={
                                 <>
                                     <Button id="reboot-system" variant="primary" onClick={openRebootDialog}>{_("Reboot system...")}</Button>
                                     <Button id="ignore" variant="link" onClick={onIgnore}>{_("Ignore")}</Button>
                                 </>
                             } />
            <div className="flow-list-blank-slate">
                <ExpandableSection toggleText={_("Package information")}>
                    <PackageList packages={history[0]} />
                </ExpandableSection>
            </div>
        </>);
    }

    const entries = [];
    if (reboot.length > 0) {
        entries.push({
            columns: [
                {
                    title: <TwoColumnTitle icon={<RebootingIcon />}
                                           str={cockpit.format(cockpit.ngettext("$0 package needs a system reboot",
                                                                                "$0 packages need a system reboot",
                                                                                reboot.length),
                                                               reboot.length)} />
                },
            ],
            props: { key: "reboot", id: "reboot-row" },
            hasPadding: true,
            expandedContent: <TwoColumnContent list={reboot} />,
        });
    }

    if (restart.length > 0) {
        entries.push({
            columns: [
                {
                    title: <TwoColumnTitle icon={<ProcessAutomationIcon />}
                                           str={cockpit.format(cockpit.ngettext("$0 service needs to be restarted",
                                                                                "$0 services need to be restarted",
                                                                                restart.length),
                                                               restart.length)} />
                },
            ],
            props: { key: "service", id: "service-row" },
            hasPadding: true,
            expandedContent: <TwoColumnContent list={restart} />,
        });
    }

    if (manual.length > 0) {
        entries.push({
            columns: [
                {
                    title: <TwoColumnTitle icon={<ProcessAutomationIcon />}
                                           str={_("Some software needs to be restarted manually")} />
                }
            ],
            props: { key: "manual", id: "manual-row" },
            hasPadding: true,
            expandedContent: <TwoColumnContent list={manual} />,
        });
    }

    const showReboot = reboot.length > 0 || manual.length > 0;

    return (<>
        <EmptyStatePanel title={ _("Update was successful") }
            headingLevel="h5"
            titleSize="4xl"
            secondary={
                <>
                    { entries.length > 0 && <ListingTable aria-label={_("Update Success Table")}
                        columns={[{ title: _("Info") }]}
                        showHeader={false}
                        className="updates-success-table"
                        rows={entries} /> }
                    <div className="update-success-actions">
                        { showReboot && <Button id="reboot-system" variant="primary" onClick={openRebootDialog}>{_("Reboot system...")}</Button> }
                        { restart.length > 0 && <Button id="choose-service" variant={showReboot ? "secondary" : "primary"} onClick={openServiceRestartDialog}>{_("Restart services...")}</Button> }
                        { reboot.length > 0 || restart.length > 0 || manual.length > 0
                            ? <Button id="ignore" variant="link" onClick={onIgnore}>{_("Ignore")}</Button>
                            : <Button id="ignore" variant="primary" onClick={onIgnore}>{_("Continue")}</Button> }
                    </div>
                </>
            } />
        <div className="flow-list-blank-slate">
            <ExpandableSection toggleText={_("Package information")}>
                <PackageList packages={history[0]} />
            </ExpandableSection>
        </div>
    </>);
};

const UpdatesStatus = ({ updates, highestSeverity, timeSinceRefresh, tracerPackages, onValueChanged }) => {
    const numUpdates = Object.keys(updates).length;
    const numSecurity = count_security_updates(updates);
    const numRestartServices = tracerPackages.daemons.length;
    const numManualSoftware = tracerPackages.manual.length;
    const numRebootPackages = tracerPackages.reboot.length;
    let lastChecked;
    // PackageKit returns G_MAXUINT if the db was never checked.
    if (timeSinceRefresh !== null && timeSinceRefresh !== 2 ** 32 - 1)
        lastChecked = cockpit.format(_("Last checked: $0"), timeformat.distanceToNow(new Date().valueOf() - timeSinceRefresh * 1000, true));

    const notifications = [];
    if (numUpdates > 0) {
        if (numUpdates == numSecurity) {
            const stateStr = cockpit.ngettext("$0 security fix available", "$0 security fixes available", numSecurity);
            notifications.push({
                id: "security-updates-available",
                stateStr: cockpit.format(stateStr, numSecurity),
                icon: getSeverityIcon(highestSeverity),
                secondary: <Text id="last-checked" component={TextVariants.small}>{lastChecked}</Text>
            });
        } else {
            let stateStr = cockpit.ngettext("$0 update available", "$0 updates available", numUpdates);
            if (numSecurity > 0)
                stateStr += cockpit.ngettext(", including $1 security fix", ", including $1 security fixes", numSecurity);
            notifications.push({
                id: "updates-available",
                stateStr: cockpit.format(stateStr, numUpdates, numSecurity),
                icon: getSeverityIcon(highestSeverity),
                secondary: <Text id="last-checked" component={TextVariants.small}>{lastChecked}</Text>
            });
        }
    } else if (!numRestartServices && !numRebootPackages && !numManualSoftware) {
        notifications.push({
            id: "system-up-to-date",
            stateStr: STATE_HEADINGS.uptodate,
            icon: <CheckIcon color="green" />,
            secondary: <Text id="last-checked" component={TextVariants.small}>{lastChecked}</Text>
        });
    }

    if (numRebootPackages > 0) {
        const stateStr = cockpit.ngettext("$0 package needs a system reboot", "$0 packages need a system reboot", numRebootPackages);
        notifications.push({
            id: "packages-need-reboot",
            stateStr: cockpit.format(stateStr, numRebootPackages),
            icon: <RebootingIcon />,
            secondary: <Button variant="danger" onClick={() => onValueChanged("showRebootSystemDialog", true)}>
                {_("Reboot system...")}
            </Button>
        });
    }

    if (numRestartServices > 0) {
        const stateStr = cockpit.ngettext("$0 service needs to be restarted", "$0 services need to be restarted", numRestartServices);
        notifications.push({
            id: "services-need-restart",
            stateStr: cockpit.format(stateStr, numRestartServices),
            icon: <ProcessAutomationIcon />,
            secondary: <Button variant="primary" onClick={() => onValueChanged("showRestartServicesDialog", true)}>
                {_("Restart services...")}
            </Button>
        });
    }

    if (numManualSoftware > 0) {
        notifications.push({
            id: "processes-need-restart",
            stateStr: _("Some software needs to be restarted manually"),
            icon: <ProcessAutomationIcon />,
            secondary: <Text component={TextVariants.small}>{tracerPackages.manual.join(", ")}</Text>
        });
    }

    return (<Stack hasGutter>
        { notifications.map(notification => (
            <StackItem key={notification.id}>
                <Flex flexWrap={{ default: 'nowrap' }} id={notification.id}>
                    <FlexItem>
                        {notification.icon}
                    </FlexItem>
                    <FlexItem>
                        <Stack>
                            <StackItem>
                                <Text component={TextVariants.p}>{notification.stateStr}</Text>
                            </StackItem>
                            <StackItem>
                                { notification.secondary }
                            </StackItem>
                        </Stack>
                    </FlexItem>
                </Flex>
            </StackItem>
        ))}
    </Stack>);
};

class CardsPage extends React.Component {
    constructor() {
        super();
        this.state = {
            autoupdates_backend: undefined,
        };
    }

    componentDidMount() {
        getBackend(this.props.backend).then(b => { this.setState({ autoupdates_backend: b }) });
    }

    render() {
        const cardContents = [];
        let settingsContent = null;
        const statusContent = <Stack hasGutter>
            <UpdatesStatus key="updates-status"
                                updates={this.props.updates}
                                onValueChanged={this.props.onValueChanged}
                                tracerPackages={this.props.tracerPackages}
                                highestSeverity={this.props.highestSeverity}
                                timeSinceRefresh={this.props.timeSinceRefresh} />
            <KpatchStatus />
        </Stack>;

        if (this.state.autoupdates_backend) {
            settingsContent = <Stack hasGutter>
                <AutoUpdates privileged={this.props.privileged} packagekit_backend={this.props.backend} />
                <KpatchSettings privileged={this.props.privileged} />
            </Stack>;
        }

        cardContents.push({
            id: "status",
            className: settingsContent !== null ? "ct-card-info" : "",
            title: _("Status"),
            actions: (<Tooltip content={_("Check for updates")}>
                <Button variant="secondary" onClick={this.props.handleRefresh}><RedoIcon /></Button>
            </Tooltip>),
            body: statusContent,
        });

        if (settingsContent !== null) {
            cardContents.push({
                id: "settings",
                className: "ct-card-info",
                title: _("Settings"),
                body: settingsContent,
            });
        }

        if (this.props.state === "available") { // automatic updates are not tracked by PackageKit, hide history when they are enabled
            cardContents.push({
                id: "available-updates",
                title: _("Available updates"),
                actions: (<div className="pk-updates--header--actions">
                    {this.props.cockpitUpdate &&
                        <Flex flex={{ default: 'inlineFlex' }} className="cockpit-update-warning">
                            <FlexItem>
                                <ExclamationTriangleIcon className="ct-icon-exclamation-triangle cockpit-update-warning-icon" />
                                <strong className="cockpit-update-warning-text">
                                    <span className="pf-screen-reader">{_("Danger alert:")}</span>
                                    {_("Web Console will restart")}
                                </strong>
                            </FlexItem>
                            <FlexItem>
                                <Popover aria-label="More information popover"
                                         bodyContent={_("When the Web Console is restarted, you will no longer see progress information. However, the update process will continue in the background. Reconnect to continue watching the update process.")}>
                                    <Button variant="link" isInline>{_("More info...")}</Button>
                                </Popover>
                            </FlexItem>
                        </Flex>}
                    {this.props.applyKpatches}
                    {this.props.applySecurity}
                    {this.props.applyAll}
                </div>),
                containsList: true,
                body: <UpdatesList updates={this.props.updates} />
            });
        }

        if ((!this.state.autoupdates_backend || !this.state.autoupdates_backend.enabled) && this.props.history.length > 0) { // automatic updates are not tracked by PackageKit, hide history when they are enabled
            cardContents.push({
                id: "update-history",
                title: _("Update history"),
                containsList: true,
                body: <History packagekit={this.props.history} />
            });
        }

        return cardContents.map(card => {
            return (
                <Card key={card.id} className={card.className} id={card.id}>
                    <CardHeader actions={{ actions: card.actions }}>
                        <CardTitle component="h2">{card.title}</CardTitle>
                    </CardHeader>
                    <CardBody className={card.containsList ? "contains-list" : null}>
                        {card.body}
                    </CardBody>
                </Card>
            );
        });
    }
}

class OsUpdates extends React.Component {
    constructor() {
        super();
        this.state = {
            state: "loading",
            errorMessages: [],
            updates: {},
            timeSinceRefresh: null,
            loadPercent: null,
            cockpitUpdate: false,
            haveOsRepo: null,
            applyTransaction: null,
            applyTransactionProps: {},
            applyActions: [],
            history: [],
            unregistered: false,
            privileged: false,
            autoUpdatesEnabled: undefined,
            tracerPackages: { daemons: [], manual: [], reboot: [] },
            tracerAvailable: false,
            tracerRunning: false,
            showRestartServicesDialog: false,
            showRebootSystemDialog: false,
            backend: "",
            rebootAfterSuccess: false,
        };
        this.handleLoadError = this.handleLoadError.bind(this);
        this.handleRefresh = this.handleRefresh.bind(this);
        this.loadUpdates = this.loadUpdates.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);

        superuser.addEventListener("changed", () => {
            this.setState({ privileged: superuser.allowed });
            // get out of error state when switching from unprivileged to privileged
            if (superuser.allowed && this.state.state.indexOf("Error") >= 0)
                this.loadUpdates();
        });
    }

    onValueChanged(key, value) {
        this.setState({ [key]: value });
    }

    componentDidMount() {
        this._mounted = true;
        this.callTracer(null);

        PK.getBackendName().then(([prop]) => this.setState({ backend: prop.v }));

        // check if there is an upgrade in progress already; if so, switch to "applying" state right away
        PK.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTransactionList", [])
                .then(([transactions]) => {
                    if (!this._mounted)
                        return;

                    const promises = transactions.map(transactionPath => PK.call(
                        transactionPath, "org.freedesktop.DBus.Properties", "Get", [PK.transactionInterface, "Role"]));

                    Promise.all(promises)
                            .then(roles => {
                                // any transaction with UPDATE_PACKAGES role?
                                for (let idx = 0; idx < roles.length; ++idx) {
                                    if (roles[idx][0].v === PK.Enum.ROLE_UPDATE_PACKAGES) {
                                        this.watchUpdates(transactions[idx]);
                                        return;
                                    }
                                }

                                // no running updates found, proceed to showing available updates
                                this.initialLoadOrRefresh();
                            })
                            .catch(ex => {
                                console.warn("GetTransactionList: failed to read PackageKit transaction roles:", ex.message);
                                // be robust, try to continue with loading updates anyway
                                this.initialLoadOrRefresh();
                            });
                })
                .catch(this.handleLoadError);
    }

    componentWillUnmount() {
        this._mounted = false;
    }

    callTracer(state) {
        this.setState({ tracerRunning: true });
        python.spawn(callTracerScript, null, { err: "message", superuser: "require" })
                .then(output => {
                    const tracerPackages = JSON.parse(output);
                    // Filter out duplicates
                    tracerPackages.reboot = [...new Set(shortenCockpitWsInstance(tracerPackages.reboot))];
                    tracerPackages.daemons = [...new Set(shortenCockpitWsInstance(tracerPackages.daemons))];
                    tracerPackages.manual = [...new Set(shortenCockpitWsInstance(tracerPackages.manual))];
                    const nextState = { tracerAvailable: true, tracerRunning: false, tracerPackages };
                    if (state)
                        nextState.state = state;

                    this.setState(nextState);
                })
                .catch((exception, data) => {
                    // common cases: this platform does not have tracer installed
                    if (!exception.message?.includes("ModuleNotFoundError") &&
                        // or supported (like on Arch)
                        !exception.message?.includes("UnsupportedDistribution") &&
                        // or polkit does not allow it
                        exception.problem !== "access-denied" &&
                        // or the session goes away while checking
                        exception.problem !== "terminated")
                        console.error(`Tracer failed: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
                    // When tracer fails, act like it's not available (demand reboot after every update)
                    const nextState = { tracerAvailable: false, tracerRunning: false, tracerPackages: { reboot: [], daemons: [], manual: [] } };
                    if (state)
                        nextState.state = state;
                    this.setState(nextState);
                });
    }

    handleLoadError(ex) {
        console.warn("loading available updates failed:", JSON.stringify(ex));

        if (!this._mounted)
            return;

        if (ex.problem === "not-found" || ex.name?.includes("DBus.Error.ServiceUnknown"))
            ex = _("PackageKit is not installed");
        this.state.errorMessages.push(ex.detail || ex.message || ex);
        this.setState({ state: "loadError" });
    }

    removeHeading(text) {
        // on Debian the update_text starts with "== version ==" which is
        // redundant; we don't want Markdown headings in the table
        if (text)
            return text.trim().replace(/^== .* ==\n/, "")
                    .trim();
        return text;
    }

    loadUpdateDetails(pkg_ids) {
        const limit = 500; // Load iteratively to avoid exceeding cockpit-ws frame size
        PK.cancellableTransaction("GetUpdateDetail", [pkg_ids.slice(0, limit)], null, {
            UpdateDetail: (packageId, updates, obsoletes, vendor_urls, bug_urls, cve_urls, restart,
                update_text, changelog /* state, issued, updated */) => {
                const u = this.state.updates[packageId];
                if (!u) {
                    console.warn("Mismatching update:", packageId);
                    return;
                }

                u.vendor_urls = vendor_urls;
                // HACK: bug_urls and cve_urls also contain titles, in a not-quite-predictable order; ignore them,
                // only pick out http[s] URLs (https://bugs.freedesktop.org/show_bug.cgi?id=104552)
                if (bug_urls)
                    bug_urls = bug_urls.filter(url => url.match(/^https?:\/\//));
                if (cve_urls)
                    cve_urls = cve_urls.filter(url => url.match(/^https?:\/\//));

                u.description = this.removeHeading(update_text) || changelog;
                if (update_text)
                    u.markdown = true;
                u.bug_urls = deduplicate(bug_urls);
                // many backends don't support proper severities; parse CVEs from description as a fallback
                u.cve_urls = deduplicate(cve_urls && cve_urls.length > 0 ? cve_urls : parseCVEs(u.description));
                if (u.cve_urls && u.cve_urls.length > 0)
                    u.severity = PK.Enum.INFO_SECURITY;
                u.vendor_urls = vendor_urls || [];
                // u.restart = restart; // broken (always "1") at least in Fedora

                this.setState(prevState => ({ updates: prevState.updates }));
            },
        })
                .then(() => {
                    if (pkg_ids.length <= limit)
                        this.setState({ state: "available" });
                    else
                        this.loadUpdateDetails(pkg_ids.slice(limit));
                })
                .catch(ex => {
                    console.warn("GetUpdateDetail failed:", JSON.stringify(ex));
                    // still show available updates, with reduced detail
                    this.setState({ state: "available" });
                });
    }

    loadUpdates() {
        const updates = {};
        let cockpitUpdate = false;

        this.setState({ state: "loading" });

        // check if there is an available version of coreutils; this is a heuristics for unregistered RHEL
        // systems to see if they need a subscription to get "proper" OS updates
        let have_coreutils = false;
        PK.cancellableTransaction(
            "Resolve",
            [PK.Enum.FILTER_ARCH | PK.Enum.FILTER_NEWEST | PK.Enum.FILTER_NOT_INSTALLED, ["coreutils"]],
            null,
            {
                Package: (info, package_id) => { have_coreutils = true }
            })
                .then(() => this.setState({ haveOsRepo: have_coreutils }),
                      ex => console.warn("Resolving coreutils failed:", JSON.stringify(ex)))
                .then(() => PK.cancellableTransaction(
                    "GetUpdates", [0],
                    data => this.setState({ state: data.waiting ? "locked" : "loading" }),
                    {
                        Package: (info, packageId, _summary) => {
                            const id_fields = packageId.split(";");
                            packageSummaries[id_fields[0]] = _summary;
                            // HACK: dnf backend yields wrong severity with PK < 1.2.4 (https://github.com/PackageKit/PackageKit/issues/268)
                            if (info < PK.Enum.INFO_LOW || info > PK.Enum.INFO_SECURITY)
                                info = PK.Enum.INFO_NORMAL;
                            updates[packageId] = { name: id_fields[0], version: id_fields[1], severity: info, arch: id_fields[2] };
                            if (id_fields[0] == "cockpit-ws")
                                cockpitUpdate = true;
                            // Arch Linux has no cockpit-ws package
                            if (id_fields[0] == "cockpit" && this.state.backend === "alpm")
                                cockpitUpdate = true;
                        },
                    }))
                .then(() => {
                    // get the details for all packages
                    const pkg_ids = Object.keys(updates);
                    if (pkg_ids.length) {
                        this.setState({ updates, cockpitUpdate }, () => {
                            this.loadUpdateDetails(pkg_ids);
                        });
                    } else {
                        this.setState({ updates: {}, state: "uptodate" });
                    }
                    this.loadHistory();
                })
                .catch(this.handleLoadError);
    }

    loadHistory() {
        const history = [];

        // would be nice to filter only for "update-packages" role, but can't here
        PK.transaction("GetOldTransactions", [0], {
            Transaction: (objPath, timeSpec, succeeded, role, duration, data) => {
                if (role !== PK.Enum.ROLE_UPDATE_PACKAGES)
                    return;
                    // data looks like:
                    // downloading\tbash-completion;1:2.6-1.fc26;noarch;updates-testing
                    // updating\tbash-completion;1:2.6-1.fc26;noarch;updates-testing
                const pkgs = { _time: Date.parse(timeSpec) };
                let empty = true;
                data.split("\n").forEach(line => {
                    const fields = line.trim().split("\t");
                    if (fields.length >= 2) {
                        const pkgId = fields[1].split(";");
                        pkgs[pkgId[0]] = pkgId[1];
                        empty = false;
                    }
                });
                if (!empty)
                    history.unshift(pkgs); // PK reports in time-ascending order, but we want the latest first
            },

            // only update the state once to avoid flicker
            Finished: () => {
                if (history.length > 0)
                    this.setState({ history });
            }
        })
                .catch(ex => console.warn("Failed to load old transactions:", ex));
    }

    initialLoadOrRefresh() {
        PK.watchRedHatSubscription(registered => this.setState({ unregistered: !registered }));

        cockpit.addEventListener("visibilitychange", () => {
            if (!cockpit.hidden)
                this.loadOrRefresh(false);
        });

        if (!cockpit.hidden)
            this.loadOrRefresh(true);
        else
            this.loadUpdates();
    }

    loadOrRefresh(always_load) {
        PK.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTimeSinceAction",
                [PK.Enum.ROLE_REFRESH_CACHE])
                .then(([seconds]) => {
                    this.setState({ timeSinceRefresh: seconds });

                    // automatically trigger refresh for ≥ 1 day or if never refreshed
                    if (seconds >= 24 * 3600 || seconds < 0)
                        this.handleRefresh();
                    else if (always_load)
                        this.loadUpdates();
                })
                .catch(this.handleLoadError);
    }

    watchUpdates(transactionPath) {
        this.setState({ state: "applying", applyTransaction: transactionPath, applyTransactionProps: {}, applyActions: [] });

        return PK.watchTransaction(transactionPath,
                                   {
                                       ErrorCode: (code, details) => this.state.errorMessages.push(details),

                                       Finished: exit => {
                                           this.setState({ applyTransaction: null, applyTransactionProps: {}, applyActions: [] });

                                           if (exit === PK.Enum.EXIT_SUCCESS) {
                                               if (this.state.tracerAvailable) {
                                                   this.setState({ state: "loading", loadPercent: null });
                                                   this.callTracer("updateSuccess");
                                               } else {
                                                   this.setState({ state: "updateSuccess", loadPercent: null });
                                               }
                                               this.loadHistory();
                                           } else if (exit === PK.Enum.EXIT_CANCELLED) {
                                               if (this.state.tracerAvailable) {
                                                   this.setState({ state: "loading", loadPercent: null });
                                                   this.callTracer(null);
                                               }
                                               this.loadUpdates();
                                           } else {
                                               // normally we get FAILED here with ErrorCodes; handle unexpected errors to allow for some debugging
                                               if (exit !== PK.Enum.EXIT_FAILED)
                                                   this.state.errorMessages.push(cockpit.format(_("PackageKit reported error code $0"), exit));
                                               this.setState({ state: "updateError" });
                                           }
                                       },

                                       // not working/being used in at least Fedora
                                       RequireRestart: (type, packageId) => console.log("update RequireRestart", type, packageId),

                                       Package: (status, packageId) => this.setState(old =>
                                           ({ applyActions: [...old.applyActions, { status, packageId }] })
                                       ),
                                   },

                                   notify => this.setState(old =>
                                       ({ applyTransactionProps: { ...old.applyTransactionProps, ...notify } })
                                   )
        )
                .catch(ex => {
                    this.state.errorMessages.push(ex);
                    this.setState({ state: "updateError" });
                });
    }

    applyUpdates(type) {
        let ids = Object.keys(this.state.updates);
        if (type === UPDATES.SECURITY)
            ids = ids.filter(id => this.state.updates[id].severity === PK.Enum.INFO_SECURITY);
        if (type === UPDATES.KPATCHES) {
            ids = ids.filter(id => isKpatchPackage(this.state.updates[id].name));
        }

        PK.transaction()
                .then(transactionPath => {
                    this.watchUpdates(transactionPath)
                            .then(() => {
                                PK.call(transactionPath, PK.transactionInterface, "UpdatePackages", [0, ids])
                                        .catch(ex => {
                                            // We get more useful error messages through ErrorCode or "PackageKit has crashed", so only
                                            // show this if we don't have anything else
                                            if (this.state.errorMessages.length === 0)
                                                this.state.errorMessages.push(ex.message);
                                            this.setState({ state: "updateError" });
                                        });
                            });
                })
                .catch(ex => {
                    this.state.errorMessages.push(ex.message);
                    this.setState({ state: "updateError" });
                });
    }

    renderContent() {
        let applySecurity, applyKpatches, applyAll;

        /* On unregistered RHEL systems we need some heuristics: If the "main" OS repos (which provide coreutils) require
         * a subscription, then point this out and don't show available updates, even if there are some auxiliary
         * repositories enabled which don't require subscriptions. But there are a lot of cases (cloud repos, nightly internal
         * repos) which don't need a subscription, there it would just be confusing */
        if (this.state.unregistered && this.state.haveOsRepo === false) {
            page_status.set_own({
                type: "warning",
                title: _("Not registered"),
                details: {
                    link: "subscriptions",
                }
            });

            return <EmptyStatePanel
                title={_("This system is not registered")}
                headingLevel="h5"
                titleSize="4xl"
                paragraph={ _("To get software updates, this system needs to be registered with Red Hat, either using the Red Hat Customer Portal or a local subscription server.") }
                icon={ExclamationCircleIcon}
                action={ _("Register…") }
                onAction={ () => cockpit.jump("/subscriptions", cockpit.transport.host) }
            />;
        }

        switch (this.state.state) {
        case "loading":
        case "refreshing":
        case "locked":
            page_status.set_own({
                type: null,
                title: _("Checking for package updates..."),
                details: {
                    link: false,
                    pficon: "spinner",
                }
            });

            if (this.state.loadPercent)
                return <Progress value={this.state.loadPercent} title={STATE_HEADINGS[this.state.state]} />;
            else
                return <EmptyStatePanel loading title={ _("Checking software status")}
                                        headingLevel="h5"
                                        titleSize="4xl"
                                        paragraph={STATE_HEADINGS[this.state.state]}
                />;

        case "available":
        {
            const num_updates = Object.keys(this.state.updates).length;
            const num_security_updates = count_security_updates(this.state.updates);
            const num_kpatches = count_kpatch_updates(this.state.updates);
            const highest_severity = find_highest_severity(this.state.updates);

            applyAll = (
                <Button id={num_updates == num_security_updates ? "install-security" : "install-all"} variant="primary" onClick={ () => this.applyUpdates(UPDATES.ALL) }>
                    { num_updates == num_security_updates
                        ? _("Install security updates")
                        : _("Install all updates") }
                </Button>);

            if (num_security_updates > 0 && num_updates > num_security_updates) {
                applySecurity = (
                    <Button id="install-security" variant="secondary" onClick={ () => this.applyUpdates(UPDATES.SECURITY) }>
                        {_("Install security updates")}
                    </Button>);
            }

            if (num_kpatches > 0) {
                applyKpatches = (
                    <Button id="install-kpatches" variant="secondary" onClick={ () => this.applyUpdates(UPDATES.KPATCHES) }>
                        {_("Install kpatch updates")}
                    </Button>);
            }

            let text;
            if (highest_severity == PK.Enum.INFO_SECURITY)
                text = _("Security updates available");
            else if (highest_severity >= PK.Enum.INFO_NORMAL)
                text = _("Bug fix updates available");
            else if (highest_severity >= PK.Enum.INFO_LOW)
                text = _("Enhancement updates available");
            else
                text = _("Updates available");

            page_status.set_own({
                type: num_security_updates > 0 ? "warning" : "info",
                title: text,
                details: {
                    pficon: getPageStatusSeverityIcon(highest_severity)
                }
            });

            return (
                <>
                    <PageSection>
                        <Gallery className='ct-cards-grid' hasGutter>
                            <CardsPage handleRefresh={this.handleRefresh}
                                       applySecurity={applySecurity}
                                       applyAll={applyAll}
                                       applyKpatches={applyKpatches}
                                       highestSeverity={highest_severity}
                                       onValueChanged={this.onValueChanged}
                                       {...this.state} />
                        </Gallery>
                    </PageSection>
                    { this.state.showRestartServicesDialog &&
                        <RestartServices tracerPackages={this.state.tracerPackages}
                            close={() => this.setState({ showRestartServicesDialog: false })}
                            state={this.state.state}
                            callTracer={(state) => this.callTracer(state)}
                            onValueChanged={delta => this.setState(delta)}
                            loadUpdates={this.loadUpdates} />
                    }
                    { this.state.showRebootSystemDialog &&
                        <ShutdownModal onClose={() => this.setState({ showRebootSystemDialog: false })} />
                    }
                </>
            );
        }

        case "loadError":
        case "updateError":
            page_status.set_own({
                type: "error",
                title: STATE_HEADINGS[this.state.state],
            });
            return (
                <Stack>
                    <EmptyStatePanel title={ STATE_HEADINGS[this.state.state] }
                                    icon={ ExclamationCircleIcon }
                                    paragraph={
                                        <TextContent>
                                            <Text component={TextVariants.p}>
                                                {_("Please resolve the issue and reload this page.")}
                                            </Text>
                                        </TextContent>
                                    }
                    />
                    <CodeBlock className='pf-v5-u-mx-auto error-log'>
                        <CodeBlockCode>
                            {this.state.errorMessages
                                    .filter((m, index) => index == 0 || m != this.state.errorMessages[index - 1])
                                    .map(m => <span key={m}>{m}</span>)}
                        </CodeBlockCode>
                    </CodeBlock>
                </Stack>
            );

        case "applying":
            page_status.set_own(null);
            return <ApplyUpdates transactionProps={this.state.applyTransactionProps}
                                 actions={this.state.applyActions}
                                 onCancel={ () => PK.call(this.state.applyTransaction, PK.transactionInterface, "Cancel", []) }
                                 rebootAfter={this.state.rebootAfterSuccess}
                                 setRebootAfter={ (_event, enabled) => this.setState({ rebootAfterSuccess: enabled }) }
            />;

        case "updateSuccess": {
            if (this.state.rebootAfterSuccess) {
                this.setState({ state: "restart" });
                cockpit.spawn(["shutdown", "--reboot", "now"], { superuser: "require" });
                return null;
            }

            let warningTitle;
            if (!this.state.tracerAvailable) {
                warningTitle = _("Reboot recommended");
            } else {
                if (this.state.tracerPackages.reboot.length > 0)
                    warningTitle = cockpit.ngettext("A package needs a system reboot for the updates to take effect:",
                                                    "Some packages need a system reboot for the updates to take effect:",
                                                    this.state.tracerPackages.reboot.length);
                else if (this.state.tracerPackages.daemons.length > 0)
                    warningTitle = cockpit.ngettext("A service needs to be restarted for the updates to take effect:",
                                                    "Some services need to be restarted for the updates to take effect:",
                                                    this.state.tracerPackages.daemons.length);
                else if (this.state.tracerPackages.manual.length > 0)
                    warningTitle = _("Some software needs to be restarted manually");
            }

            if (warningTitle) {
                page_status.set_own({
                    type: "warning",
                    title: warningTitle
                });
            }

            return (
                <>
                    <UpdateSuccess onIgnore={this.loadUpdates}
                        openServiceRestartDialog={() => this.setState({ showRestartServicesDialog: true })}
                        openRebootDialog={() => this.setState({ showRebootSystemDialog: true })}
                        restart={this.state.tracerPackages.daemons}
                        manual={this.state.tracerPackages.manual}
                        reboot={this.state.tracerPackages.reboot}
                        tracerAvailable={this.state.tracerAvailable}
                        history={this.state.history} />
                    { this.state.showRebootSystemDialog &&
                        <ShutdownModal onClose={() => this.setState({ showRebootSystemDialog: false })} />
                    }
                    { this.state.showRestartServicesDialog &&
                        <RestartServices tracerPackages={this.state.tracerPackages}
                            close={() => this.setState({ showRestartServicesDialog: false })}
                            state={this.state.state}
                            callTracer={(state) => this.callTracer(state)}
                            onValueChanged={delta => this.setState(delta)}
                            loadUpdates={this.loadUpdates} />
                    }
                </>
            );
        }

        case "restart":
            page_status.set_own(null);
            return <EmptyStatePanel loading title={ _("Restarting") }
                                    headingLevel="h5"
                                    titleSize="4xl"
                                    paragraph={ _("Your server will close the connection soon. You can reconnect after it has restarted.") }
            />;

        case "uptodate":
        {
            page_status.set_own({
                title: STATE_HEADINGS[this.state.state],
                details: {
                    link: false,
                    pficon: "check",
                }
            });

            return (
                <>
                    <PageSection>
                        <Gallery className='ct-cards-grid' hasGutter>
                            <CardsPage onValueChanged={this.onValueChanged} handleRefresh={this.handleRefresh} {...this.state} />
                        </Gallery>
                        { this.state.showRestartServicesDialog &&
                            <RestartServices tracerPackages={this.state.tracerPackages}
                                close={() => this.setState({ showRestartServicesDialog: false })}
                                state={this.state.state}
                                callTracer={(state) => this.callTracer(state)}
                                onValueChanged={delta => this.setState(delta)}
                                loadUpdates={this.loadUpdates} />
                        }
                        { this.state.showRebootSystemDialog &&
                            <ShutdownModal onClose={() => this.setState({ showRebootSystemDialog: false })} />
                        }
                    </PageSection>
                </>
            );
        }

        default:
            page_status.set_own(null);
            return null;
        }
    }

    handleRefresh() {
        this.setState({ state: "refreshing", loadPercent: null });
        PK.cancellableTransaction("RefreshCache", [true], data => this.setState({ loadPercent: data.percentage }))
                .then(() => {
                    if (this._mounted === false)
                        return;

                    this.setState({ timeSinceRefresh: 0 });
                    this.loadUpdates();
                })
                .catch(this.handleLoadError);
    }

    render() {
        let content = this.renderContent();
        if (!["available", "uptodate"].includes(this.state.state))
            content = <PageSection variant={PageSectionVariants.light}>{content}</PageSection>;

        return (
            <WithDialogs>
                <Page>
                    {content}
                </Page>
            </WithDialogs>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);
    init();
    const root = createRoot(document.getElementById('app'));
    root.render(<OsUpdates />);
});
