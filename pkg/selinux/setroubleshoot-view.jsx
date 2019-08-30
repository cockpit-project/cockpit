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

import * as cockpitListing from "cockpit-components-listing.jsx";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";
import { Modifications } from "cockpit-components-modifications.jsx";

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

    runFix(itmIdx) {
        // make sure the details for the solution are collapsed, or they can hide the progress and result
        var solutionExpanded = this.state.solutionExpanded;
        if (solutionExpanded[itmIdx]) {
            solutionExpanded[itmIdx] = false;
            this.setState({ solutionExpanded: solutionExpanded });
        }
        var localId = this.props.details.localId;
        var analysisId = this.props.details.pluginAnalysis[itmIdx].analysisId;
        this.props.runFix(localId, analysisId);
    }

    render() {
        if (!this.props.details) {
            // details should be requested by default, so we just need to wait for them
            var waiting = (this.props.details === undefined);
            return (
                <EmptyState
                    icon={ waiting ? 'waiting' : 'error' }
                    description={ waiting ? _("Waiting for details...") : _("Unable to get alert details.") }
                    message={null}
                    relative />
            );
        }
        var self = this;
        var fixEntries = this.props.details.pluginAnalysis.map(function(itm, itmIdx) {
            var fixit = null;
            var msg = null;
            if (itm.fixable) {
                if ((self.props.fix) && (self.props.fix.plugin == itm.analysisId)) {
                    if (self.props.fix.running) {
                        msg = (
                            <div>
                                <div className="spinner setroubleshoot-progress-spinner" />
                                <span className="setroubleshoot-progress-message"> { _("Applying solution...") }</span>
                            </div>
                        );
                    } else {
                        if (self.props.fix.success) {
                            msg = (
                                <div className="alert alert-success">
                                    <span className="pficon pficon-ok" />
                                    <span> { _("Solution applied successfully") }: {self.props.fix.result}</span>
                                </div>
                            );
                        } else {
                            msg = (
                                <div className="alert alert-danger">
                                    <span className="pficon pficon-error-circle-o" />
                                    <span> { _("Solution failed") }: {self.props.fix.result}</span>
                                </div>
                            );
                        }
                    }
                }
                fixit = (
                    <div className="setroubleshoot-listing-action">
                        <button className="btn btn-default"
                                onClick={ self.runFix.bind(self, itmIdx) }
                        >{ _("Apply this solution") }
                        </button>
                    </div>
                );
            } else {
                fixit = (
                    <div className="setroubleshoot-listing-action">
                        <span>{ _("Unable to apply this solution automatically") }</span>
                    </div>
                );
            }
            var detailsLink = <a href="#" tabIndex="0" onClick={ self.handleSolutionDetailsClick.bind(self, itmIdx) }>{ _("solution details") }</a>;
            var doState;
            var doElem;
            var caret;
            if (self.state.solutionExpanded[itmIdx]) {
                caret = <i className="fa fa-angle-down" />;
                doState = <div>{caret} {detailsLink}</div>;
                doElem = <div>{itm.doText}</div>;
            } else {
                caret = <i className="fa fa-angle-right" />;
                doState = <div>{caret} {detailsLink}</div>;
                doElem = null;
            }
            return (
                <div className="list-group-item" key={itm.analysisId}>
                    <div>
                        <div>
                            <span>{itm.ifText}</span>
                        </div>
                        {fixit}
                        <div>
                            {itm.thenText}
                        </div>
                        {doState}
                        {doElem}
                        {msg}
                    </div>
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
class SELinuxEventLog extends React.Component {
    render() {
        if (!this.props.details) {
            // details should be requested by default, so we just need to wait for them
            var waiting = (this.props.details === undefined);
            return (
                <EmptyState
                    icon={ waiting ? 'waiting' : 'error' }
                    description={ waiting ? _("Waiting for details...") : _("Unable to get alert details.") }
                    message={null}
                    relative />
            );
        }
        var self = this;
        var logEntries = this.props.details.auditEvent.map(function(itm, idx) {
            // use the alert id and index in the event log array as the data key for react
            // if the log becomes dynamic, the entire log line might need to be considered as the key
            return (<div key={ self.props.details.localId + "." + idx }>{itm}</div>);
        });
        return (
            <div className="setroubleshoot-log">{logEntries}</div>
        );
    }
}

/* Implements a subset of the PatternFly Empty State pattern
 * https://www.patternfly.org/patterns/empty-state/
 * Special values for icon property:
 *   - 'waiting' - display spinner
 *   - 'error'   - display error icon
 */
class EmptyState extends React.Component {
    render() {
        var description = null;
        if (this.props.description)
            description = <h1>{this.props.description}</h1>;

        var message = null;
        if (this.props.message)
            message = <p>{this.props.message}</p>;

        var curtains = "curtains-ct";
        if (this.props.relative)
            curtains = "curtains-relative";

        var icon = this.props.icon;
        if (icon == 'waiting')
            icon = <div className="spinner spinner-lg" />;
        else if (icon == 'error')
            icon = <div className="pficon pficon-error-circle-o" />;

        return (
            <div className={ curtains + " blank-slate-pf" }>
                <div className="blank-slate-pf-icon">
                    {icon}
                </div>
                {description}
                {message}
            </div>
        );
    }
}

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
            <div className="alert alert-danger alert-dismissable alert-ct-top">
                <span className="pficon pficon-error-circle-o" />
                <span>{this.props.children}</span>
                <button type="button" className="close" aria-hidden="true" onClick={this.handleDismissError}>
                    <span className="pficon pficon-close" />
                </button>
            </div>
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

        const statusMsg = this.props.selinuxStatus.enforcing ? _("Enforcing") : _("Permissive");

        return (
            <div className="selinux-policy-ct">
                <div className="selinux-state">
                    <h2>{_("SELinux Policy")}</h2>
                    <OnOffSwitch state={this.props.selinuxStatus.enforcing} onChange={this.props.changeSelinuxMode} />
                    <span className="status">{ statusMsg }</span>
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
            return (
                <EmptyState
                    icon={ <div className="fa fa-exclamation-circle" /> }
                    description={ _("SELinux is disabled on the system") }
                    message={null}
                    relative={false} />
            );
        }
        var self = this;
        var entries;
        var troubleshooting;
        var modifications;
        var title = _("SELinux Access Control Errors");
        var emptyCaption = _("No SELinux alerts.");
        if (!this.props.connected) {
            if (this.props.connecting) {
                emptyCaption = (
                    <div>
                        <div className="spinner spinner-sm" />
                        <span>{_("Connecting to SETroubleshoot daemon...")}</span>
                    </div>
                );
            } else {
                // if we don't have setroubleshoot-server, be more subtle about saying that
                title = "";
                emptyCaption = (
                    <span>
                        {_("Install setroubleshoot-server to troubleshoot SELinux events.")}
                    </span>
                );
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
                    <button
                        title="Dismiss"
                        className="pficon pficon-delete btn btn-danger"
                        onClick={onDeleteClick}
                        disabled={ !onDeleteClick || !self.props.deleteAlert } />
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
                    criticalAlert,
                    { name: itm.description, header: true }
                ];
                var title;
                if (itm.count > 1) {
                    title = cockpit.format(cockpit.ngettext("$0 occurrence", "$1 occurrences", itm.count),
                                           itm.count);
                    columns.push(<span className="badge" title={title}>{itm.count}</span>);
                } else {
                    columns.push(<span />);
                }
                return (
                    <cockpitListing.ListingRow
                        key={itm.details ? itm.details.localId : index}
                        columns={columns}
                        tabRenderers={tabRenderers}
                        listingDetail={listingDetail}
                        listingActions={dismissAction} />
                );
            });
        }

        troubleshooting = (
            <cockpitListing.Listing
                    title={ title }
                    emptyCaption={ emptyCaption }
            >
                {entries}
            </cockpitListing.Listing>
        );

        modifications = (
            <Modifications
                title={ _("System Modifications") }
                permitted={ this.props.selinuxStatus.permitted }
                shell={ "semanage import <<EOF\n" + this.props.selinuxStatus.shell.trim() + "\nEOF" }
                entries={ this.props.selinuxStatus.modifications }
                failed={ this.props.selinuxStatus.failed }
            />
        );

        var errorMessage;
        if (this.props.error) {
            errorMessage = (
                <div className="alert alert-danger alert-dismissable alert-ct-top">
                    <span className="pficon pficon-error-circle-o" />
                    <span>{this.props.error}</span>
                    <button type="button" className="close" aria-hidden="true" onClick={this.handleDismissError}>
                        <span className="pficon pficon-close" />
                    </button>
                </div>
            );
        }

        return (
            <div className="container-fluid">
                <SELinuxStatus
                    selinuxStatus={this.props.selinuxStatus}
                    selinuxStatusError={this.props.selinuxStatusError}
                    changeSelinuxMode={this.props.changeSelinuxMode}
                    dismissError={this.props.dismissStatusError}
                />
                {errorMessage}
                {modifications}
                {troubleshooting}
            </div>
        );
    }
}
