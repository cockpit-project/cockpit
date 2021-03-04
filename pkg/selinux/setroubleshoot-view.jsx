/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
    Alert, AlertGroup, AlertActionCloseButton, Button,
    Card, CardHeader, CardTitle, CardBody,
    Page, PageSection, PageSectionVariants,
    Switch, Stack, StackItem, Text, TextVariants,
} from "@patternfly/react-core";
import { ExclamationCircleIcon, InfoCircleIcon, TrashIcon } from "@patternfly/react-icons";

import { Modifications } from "cockpit-components-modifications.jsx";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';

const _ = cockpit.gettext;

/* Show details for an alert, including possible solutions
 * Props correspond to an item in the setroubleshoot dataStore
 */
class SELinuxEventDetails extends React.Component {
    constructor(props) {
        super(props);
        var expanded;
        // all details are collapsed by default
        if (props.details)
            expanded = props.details.pluginAnalysis.map(function() { return false });

        this.state = {
            solutionExpanded: expanded, // show details for solution
        };
    }

    handleSolutionDetailsClick(itmIdx, e) {
        var solutionExpanded = this.state.solutionExpanded;
        solutionExpanded[itmIdx] = !solutionExpanded[itmIdx];
        this.setState({ solutionExpanded: solutionExpanded });
        e.stopPropagation();
        e.preventDefault();
    }

    runFix(itmIdx, runCommand) {
        // make sure the details for the solution are collapsed, or they can hide the progress and result
        var solutionExpanded = this.state.solutionExpanded;
        if (solutionExpanded[itmIdx]) {
            solutionExpanded[itmIdx] = false;
            this.setState({ solutionExpanded: solutionExpanded });
        }
        var localId = this.props.details.localId;
        var analysisId = this.props.details.pluginAnalysis[itmIdx].analysisId;
        this.props.runFix(localId, analysisId, itmIdx, runCommand);
    }

    render() {
        if (!this.props.details) {
            // details should be requested by default, so we just need to wait for them
            if (this.props.details === undefined)
                return <EmptyStatePanel loading title={ _("Waiting for details...") } />;
            else
                return <EmptyStatePanel icon={ExclamationCircleIcon} title={ _("Unable to get alert details.") } />;
        }

        var self = this;
        var fixEntries = this.props.details.pluginAnalysis.map(function(itm, itmIdx) {
            var fixit = null;
            var fixit_command = null;
            var msg = null;

            /* some plugins like catchall_sebool don't report fixable as they offer multiple solutions;
             * we can offer to run a single setsebool command for convenience */
            var fixable = itm.fixable;
            if (!fixable && itm.doText && itm.doText.startsWith("setsebool") && itm.doText.indexOf("\n") < 0) {
                fixable = true;
                fixit_command = itm.doText;
            }

            if (fixable) {
                if ((itm.fix) && (itm.fix.plugin == itm.analysisId)) {
                    if (itm.fix.running) {
                        msg = (
                            <div>
                                <div className="spinner spinner-xs setroubleshoot-progress-spinner" />
                                <span className="setroubleshoot-progress-message"> { _("Applying solution...") }</span>
                            </div>
                        );
                    } else {
                        if (itm.fix.success) {
                            msg = (
                                <Alert isInline variant="success" title={ _("Solution applied successfully") }>
                                    {itm.fix.result}
                                </Alert>
                            );
                        } else {
                            msg = (
                                <Alert isInline variant="danger" title={ _("Solution failed") }>
                                    {itm.fix.result}
                                </Alert>
                            );
                        }
                    }
                }
                if (!itm.fix) {
                    fixit = (
                        <div className="setroubleshoot-listing-action">
                            <Button variant="secondary" onClick={ self.runFix.bind(self, itmIdx, fixit_command) }>
                                { _("Apply this solution") }
                            </Button>
                        </div>
                    );
                }
            } else {
                fixit = (
                    <div className="setroubleshoot-listing-action">
                        <span>{ _("Unable to apply this solution automatically") }</span>
                    </div>
                );
            }

            // Formatted solution
            let doElement = "";

            // One line usually means one command
            if (itm.doText && itm.doText.indexOf("\n") < 0)
                doElement = <pre>{itm.doText}</pre>;

            // There can be text with commands. Command always starts on a new line with '#'
            // Group subsequent commands into one `<pre>` element.
            if (itm.doText && itm.doText.indexOf("\n") >= 0) {
                const parts = [];
                const lines = itm.doText.split("\n");
                let lastCommand = false;
                lines.forEach(l => {
                    if (l[0] == "#") { // command
                        if (lastCommand) // When appending command remove "# ". Only the first command keeps it and it is removed later on
                            parts[parts.length - 1] += ("\n" + l.substr(2));
                        else
                            parts.push(l);
                        lastCommand = true;
                    } else {
                        parts.push(l);
                        lastCommand = false;
                    }
                });
                doElement = parts.map(p => p[0] == "#" ? <pre key={p}>{p.substr(2)}</pre> : <span key={p}>{p}</span>);
            }

            var detailsLink = <Button variant="link" isInline onClick={ self.handleSolutionDetailsClick.bind(self, itmIdx) }>{ _("solution details") }</Button>;
            var doState;
            var doElem;
            var caret;

            if (self.state.solutionExpanded[itmIdx]) {
                caret = <i className="fa fa-angle-down" />;
                doState = <div>{caret} {detailsLink}</div>;
                doElem = doElement;
            } else {
                caret = <i className="fa fa-angle-right" />;
                doState = <div>{caret} {detailsLink}</div>;
                doElem = null;
            }
            return (
                <div className="list-group-item selinux-details" key={itm.analysisId + (itm.ifText || "") + (itm.doText || "")}>
                    <div>
                        <div>
                            <span>{itm.ifText}</span>
                        </div>
                        <div>
                            {itm.thenText}
                        </div>
                        {doState}
                        {doElem}
                        {msg}
                    </div>
                    {fixit}
                </div>
            );
        });
        return (
            <div className="list-group">
                {fixEntries}
            </div>
        );
    }
}

/* Show the audit log events for an alert */
const SELinuxEventLog = ({ details }) => {
    if (!details) {
        // details should be requested by default, so we just need to wait for them
        if (details === undefined)
            return <EmptyStatePanel loading title={ _("Waiting for details...") } />;
        else
            return <EmptyStatePanel icon={ExclamationCircleIcon} title={ _("Unable to get alert details.") } />;
    }

    const logEntries = details.auditEvent.map((itm, idx) => {
        // use the alert id and index in the event log array as the data key for react
        // if the log becomes dynamic, the entire log line might need to be considered as the key
        return <div key={ details.localId + "." + idx }>{itm}</div>;
    });
    return <div className="setroubleshoot-log">{logEntries}</div>;
};

/* Component to show a dismissable error, message as child text
 * dismissError callback function triggered when the close button is pressed
 */
class DismissableError extends React.Component {
    constructor(props) {
        super(props);
        this.handleDismissError = this.handleDismissError.bind(this);
    }

    handleDismissError(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        if (this.props.dismissError)
            this.props.dismissError();
        e.stopPropagation();
    }

    render() {
        return (
            <Alert isInline
                variant='danger' title={this.props.children}
                actionClose={<AlertActionCloseButton onClose={this.handleDismissError} />} />
        );
    }
}

/* Component to show selinux status and offer an option to change it
 * selinuxStatus      status of selinux on the system, properties as defined in selinux-client.js
 * selinuxStatusError error message from reading or setting selinux status/mode
 * changeSelinuxMode  function to use for changing the selinux enforcing mode
 * dismissError       function to dismiss the error message
 */
class SELinuxStatus extends React.Component {
    render() {
        var errorMessage;
        if (this.props.selinuxStatusError) {
            errorMessage = (
                <DismissableError dismissError={this.props.dismissError}>{this.props.selinuxStatusError}</DismissableError>
            );
        }

        if (this.props.selinuxStatus.enabled === undefined) {
            // we don't know the current state
            return (
                <div>
                    {errorMessage}
                    <h3>{_("SELinux system status is unknown.")}</h3>
                </div>
            );
        } else if (!this.props.selinuxStatus.enabled) {
            // selinux is disabled on the system, not much we can do
            return (
                <div>
                    {errorMessage}
                    <h3>{_("SELinux is disabled on the system.")}</h3>
                </div>
            );
        }
        var note = null;
        var configUnknown = (this.props.selinuxStatus.configEnforcing === undefined);
        if (configUnknown)
            note = _("The configured state is unknown, it might change on the next boot.");
        else if (!configUnknown && this.props.selinuxStatus.enforcing !== this.props.selinuxStatus.configEnforcing)
            note = _("Setting deviates from the configured state and will revert on the next boot.");

        return (
            <div className="selinux-policy-ct">
                <div className="selinux-state">
                    <h2>{_("SELinux policy")}</h2>
                    <Switch isChecked={this.props.selinuxStatus.enforcing}
                            label={_("Enforcing")}
                            labelOff={_("Permissive")}
                            onChange={this.props.changeSelinuxMode} />
                </div>
                { note !== null &&
                    <label className="note">
                        <i className="pficon pficon-info" />
                        { note }
                    </label>
                }
                {errorMessage}
            </div>
        );
    }
}

/* The listing only shows if we have a connection to the dbus API
 * Otherwise we have blank slate: trying to connect, error
 * Expected properties:
 * connected    true if the client is connected to setroubleshoot-server via dbus
 * error        error message to show (in EmptyState if not connected, as a dismissable alert otherwise
 * dismissError callback, triggered for the dismissable error in connected state
 * deleteAlert  callback, triggered with an alert id as parameter to trigger deletion
 * entries   setroubleshoot entries
 *  - runFix      function to run fix
 *  - details     fix details as provided by the setroubleshoot client
 *  - description brief description of the error
 *  - count       how many times (>= 1) this alert occurred
 * selinuxStatus      status of selinux on the system, properties as defined in selinux-client.js
 * selinuxStatusError error message from reading or setting selinux status/mode
 * changeSelinuxMode  function to use for changing the selinux enforcing mode
 * dismissStatusError function that is triggered to dismiss the selinux status error
 */
export class SETroubleshootPage extends React.Component {
    constructor(props) {
        super(props);
        this.handleDeleteAlert = this.handleDeleteAlert.bind(this);
        this.handleDismissError = this.handleDismissError.bind(this);
    }

    handleDeleteAlert(alertId, e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        if (this.props.deleteAlert)
            this.props.deleteAlert(alertId);
        e.stopPropagation();
    }

    handleDismissError(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        if (this.props.dismissError)
            this.props.dismissError();
        e.stopPropagation();
    }

    render() {
        // if selinux is disabled, we only show EmptyState
        if (this.props.selinuxStatus.enabled === false) {
            return <EmptyStatePanel icon={ ExclamationCircleIcon } title={ _("SELinux is disabled on the system") } />;
        }
        var self = this;
        var entries;
        var troubleshooting;
        var modifications;
        var title = _("SELinux access control errors");
        var emptyCaption = _("No SELinux alerts.");
        let emptyState;
        if (!this.props.connected) {
            if (this.props.connecting) {
                emptyState = <EmptyStatePanel paragraph={ _("Connecting to SETroubleshoot daemon...") } loading />;
            } else {
                // if we don't have setroubleshoot-server, be more subtle about saying that
                emptyState = <EmptyStatePanel icon={ InfoCircleIcon }
                                              paragraph={_("Install setroubleshoot-server to troubleshoot SELinux events.")} />;
            }
        } else {
            entries = this.props.entries.map(function(itm, index) {
                itm.runFix = self.props.runFix;
                var listingDetail;
                if (itm.details && 'firstSeen' in itm.details) {
                    if (itm.details.reportCount >= 2) {
                        listingDetail = cockpit.format(_("Occurred between $0 and $1"),
                                                       itm.details.firstSeen.calendar(),
                                                       itm.details.lastSeen.calendar()
                        );
                    } else {
                        listingDetail = cockpit.format(_("Occurred $0"), itm.details.firstSeen.calendar());
                    }
                }
                var onDeleteClick;
                if (itm.details)
                    onDeleteClick = self.handleDeleteAlert.bind(self, itm.details.localId);
                var dismissAction = (
                    <Button id="selinux-alert-dismiss"
                            className="btn-sm"
                            variant="danger"
                            aria-label={ _("Dismiss") }
                            onClick={onDeleteClick}
                            isDisabled={ !onDeleteClick || !self.props.deleteAlert }>
                        <TrashIcon />
                    </Button>
                );
                var tabRenderers = [
                    {
                        name: _("Solutions"),
                        renderer: SELinuxEventDetails,
                        data: itm,
                    },
                    {
                        name: _("Audit log"),
                        renderer: SELinuxEventLog,
                        data: itm,
                    },
                ];
                // if the alert has level "red", it's critical
                var criticalAlert = null;
                if (itm.details && 'level' in itm.details && itm.details.level == "red")
                    criticalAlert = <span className="fa fa-exclamation-triangle" />;
                var columns = [
                    { title: criticalAlert },
                    { title: itm.description }
                ];
                var title;
                if (itm.count > 1) {
                    title = cockpit.format(cockpit.ngettext("$0 occurrence", "$0 occurrences", itm.count),
                                           itm.count);
                    columns.push({ title: <span className="badge" title={title}>{itm.count}</span> });
                } else {
                    columns.push({ title: <span /> });
                }
                return ({
                    props: { key: itm.details ? itm.details.localId : index },
                    columns,
                    expandedContent: <ListingPanel tabRenderers={tabRenderers}
                                                   listingDetail={listingDetail}
                                                   listingActions={dismissAction} />
                });
            });
        }

        troubleshooting = (
            <Card>
                <CardHeader>
                    <CardTitle><Text component={TextVariants.h2}>{title}</Text></CardTitle>
                </CardHeader>
                <CardBody className="contains-list">
                    {!emptyState
                        ? <ListingTable aria-label={ title }
                                  gridBreakPoint=''
                                  emptyCaption={ emptyCaption }
                                  columns={[{ title: _("Alert") }, { title: _("Error message"), header: true }, { title: _("Occurances") }]}
                                  showHeader={false}
                                  variant="compact"
                                  rows={entries} /> : emptyState}
                </CardBody>
            </Card>
        );

        modifications = (
            <Modifications
                title={ _("System modifications") }
                permitted={ this.props.selinuxStatus.permitted }
                shell={ "semanage import <<EOF\n" + this.props.selinuxStatus.shell.trim() + "\nEOF" }
                ansible={ this.props.selinuxStatus.ansible }
                entries={ this.props.selinuxStatus.modifications }
                failed={ this.props.selinuxStatus.failed }
            />
        );

        let errorMessage;
        if (this.props.error) {
            errorMessage = (
                <AlertGroup isToast>
                    <Alert
                        isLiveRegion
                        variant='danger' title={this.props.error}
                        actionClose={<AlertActionCloseButton onClose={this.handleDismissError} />} />
                </AlertGroup>
            );
        }

        return (
            <>
                {errorMessage}
                <Page>
                    <PageSection variant={PageSectionVariants.light}>
                        <SELinuxStatus
                            selinuxStatus={this.props.selinuxStatus}
                            selinuxStatusError={this.props.selinuxStatusError}
                            changeSelinuxMode={this.props.changeSelinuxMode}
                            dismissError={this.props.dismissStatusError}
                        />
                    </PageSection>
                    <PageSection>
                        <Stack hasGutter>
                            <StackItem>{modifications}</StackItem>
                            <StackItem>{troubleshooting}</StackItem>
                        </Stack>
                    </PageSection>
                </Page>
            </>
        );
    }
}
