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

var cockpit = require("cockpit");
var _ = cockpit.gettext;

var React = require("react");
var moment = require("moment");

var cockpitListing = require("cockpit-components-listing.jsx");

/* Show details for an alert, including possible solutions
 * Props correspond to an item in the setroubleshoot dataStore
 */
var SELinuxEventDetails = React.createClass({
    getInitialState: function() {
        var expanded;
        // all details are collapsed by default
        if (this.props.details)
            expanded = this.props.details.pluginAnalysis.map(function() { return false; } );

        return {
            solutionExpanded: expanded, // show details for solution
        };
    },
    handleSolutionDetailsClick: function(itmIdx, e) {
        var solutionExpanded = this.state.solutionExpanded;
        solutionExpanded[itmIdx] = !solutionExpanded[itmIdx];
        this.setState( { solutionExpanded: solutionExpanded } );
        e.stopPropagation();
        e.preventDefault();
    },
    runFix: function(itmIdx, e) {
        // make sure the details for the solution are collapsed, or they can hide the progress and result
        var solutionExpanded = this.state.solutionExpanded;
        if (solutionExpanded[itmIdx]) {
            solutionExpanded[itmIdx] = false;
            this.setState( { solutionExpanded: solutionExpanded } );
        }
        var localId = this.props.details.localId;
        var analysisId = this.props.details.pluginAnalysis[itmIdx].analysisId;
        this.props.runFix(localId, analysisId);
    },
    render: function() {
        if (!this.props.details) {
            // details should be requested by default, so we just need to wait for them
            var waiting = (this.props.details === undefined);
            return (
                <EmptyState
                    icon={ waiting ? 'waiting' : 'error' }
                    description={ waiting ? _("Waiting for details...") : _("Unable to get alert details.") }
                    message={null}
                    relative={true}/>
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
                                <div className="spinner setroubleshoot-progress-spinner"></div>
                                <span className="setroubleshoot-progress-message"> { _("Applying solution...") }</span>
                            </div>
                        );
                    } else {
                        if (self.props.fix.success) {
                            msg = (
                                <div className="alert alert-success">
                                    <span className="pficon pficon-ok"></span>
                              <span> { _("Solution applied successfully") }: {self.props.fix.result}</span>
                                </div>
                            );
                        } else {
                            msg = (
                                <div className="alert alert-danger">
                                    <span className="pficon pficon-error-circle-o"></span>
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
            var detailsLink = <a href="#" onClick={ self.handleSolutionDetailsClick.bind(self, itmIdx) }>{ _("solution details") }</a>;
            var doState;
            var doElem;
            var caret;
            if (self.state.solutionExpanded[itmIdx]) {
                caret = <i className="fa fa-angle-down" />;
                doState = <div>{caret} {detailsLink}</div>;
                doElem =  <div>{itm.doText}</div>;
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
});

/* Show the audit log events for an alert */
var SELinuxEventLog = React.createClass({
    render: function() {
        if (!this.props.details) {
            // details should be requested by default, so we just need to wait for them
            var waiting = (this.props.details === undefined);
            return (
                <EmptyState
                    icon={ waiting ? 'waiting' : 'error' }
                    description={ waiting ? _("Waiting for details...") : _("Unable to get alert details.") }
                    message={null}
                    relative={true}/>
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
});

/* Implements a subset of the PatternFly Empty State pattern
 * https://www.patternfly.org/patterns/empty-state/
 * Special values for icon property:
 *   - 'waiting' - display spinner
 *   - 'error'   - display error icon
 */
var EmptyState = React.createClass({
    render: function() {
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
            icon = <div className="spinner spinner-lg"></div>;
        else if (icon == 'error')
            icon = <div className="pficon pficon-error-circle-o"></div>;

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
});

/* Component to show a dismissable error, message as child text
 * dismissError callback function triggered when the close button is pressed
 */
var DismissableError = React.createClass({
    handleDismissError: function(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        if (this.props.dismissError)
            this.props.dismissError();
        e.stopPropagation();
    },
    render: function() {
        return (
            <div className="alert alert-danger alert-dismissable alert-ct-top">
                <span className="pficon pficon-error-circle-o" />
                <span>{this.props.children}</span>
                <button type="button" className="close" aria-hidden="true" onClick={this.handleDismissError}>
                    <span className="pficon pficon-close"/>
                </button>
            </div>
        );
    }
});

/* Component to show an on/off switch
 * state      boolean value (off or on)
 * captionOff optional string, default 'Off'
 * captionOn  optional string, default 'On'
 * onChange   triggered when the switch is flipped, parameter: new state
 */
var OnOffSwitch = React.createClass({
    getDefaultProps: function() {
        return {
            captionOff: _("Off"),
            captionOn: _("On"),
        };
    },
    handleOnOffClick: function(newState, e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        if (this.props.onChange)
            this.props.onChange(newState);
        e.stopPropagation();
    },
    render: function() {
        var onClasses = ["btn"];
        var offClasses = ["btn"];
        if (this.props.state)
            onClasses.push("active");
        else
            offClasses.push("active");
        var clickHandler = this.handleOnOffClick.bind(this, !this.props.state);
        return (
            <div className="btn-group btn-onoff-ct">
                <label className={ onClasses.join(" ") }>
                    <input type="radio" />
                    <span onClick={clickHandler}>{this.props.captionOn}</span>
                </label>
                <label className={ offClasses.join(" ") }>
                    <input type="radio" />
                    <span onClick={clickHandler}>{this.props.captionOff}</span>
                </label>
            </div>
        );
    }
});

/* Component to show selinux status and offer an option to change it
 * selinuxStatus      status of selinux on the system, properties as defined in selinux-client.js
 * selinuxStatusError error message from reading or setting selinux status/mode
 * changeSelinuxMode  function to use for changing the selinux enforcing mode
 * dismissError       function to dismiss the error message
 */
var SELinuxStatus = React.createClass({
    render: function() {
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
        var note;
        var configUnknown = (this.props.selinuxStatus.configEnforcing === undefined);
        if (configUnknown)
            note = <span> {_("The configured state is unknown, it might change on the next boot.")}</span>;
        else if (!configUnknown && this.props.selinuxStatus.enforcing !== this.props.selinuxStatus.configEnforcing)
            note = <span> {_("Setting deviates from the configured state and will revert on the next boot.")}</span>;

        return (
            <div className="selinux-policy-ct">
                <h2>{_("SELinux Policy")}</h2>
                {errorMessage}
                <label>{_("Enforce policy:")}
                <OnOffSwitch state={this.props.selinuxStatus.enforcing} onChange={this.props.changeSelinuxMode} />
                </label>
                {note}
            </div>
        );
    }
});

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
var SETroubleshootPage = React.createClass({
    handleDeleteAlert: function(alertId, e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        if (this.props.deleteAlert)
            this.props.deleteAlert(alertId);
        e.stopPropagation();
    },
    handleDismissError: function(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        if (this.props.dismissError)
            this.props.dismissError();
        e.stopPropagation();
    },
    render: function() {
        var self = this;
        if (!this.props.connected) {
            var icon;
            var description;
            if (this.props.connecting) {
                icon = <div className="spinner spinner-lg" />;
                description = _("Connecting...");
            } else {
                icon = <i className="fa fa-exclamation-circle" />;
                description = _("Couldn't connect to SETroubleshoot daemon. Please ensure that setroubleshoot-server is installed.");
            }

            return (
                <EmptyState
                    icon={icon}
                    description={description}
                    message={this.props.error} />
            );
        } else {
            var entries = this.props.entries.map(function(itm) {
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
                    { name: itm.description, 'header': true }
                ];
                var title;
                if (itm.count > 1) {
                    title = cockpit.format(cockpit.ngettext("$0 occurrence", "$1 occurrences", itm.count),
                            itm.count);
                    columns.push(<span className="badge" title="{title}">{itm.count}</span>);
                } else {
                    columns.push(<span></span>);
                }
                return (
                    <cockpitListing.ListingRow
                        columns={columns}
                        tabRenderers={tabRenderers}
                        listingDetail={listingDetail}
                        listingActions={ [dismissAction] } />
                );
            });

            var errorMessage;
            if (this.props.error) {
                errorMessage = (
                    <div className="alert alert-danger alert-dismissable alert-ct-top">
                        <span className="pficon pficon-error-circle-o" />
                        <span>{this.props.error}</span>
                        <button type="button" className="close" aria-hidden="true" onClick={this.handleDismissError}>
                            <span className="pficon pficon-close"/>
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
                    <cockpitListing.Listing
                            title={ _("SELinux Access Control Errors") }
                            emptyCaption={ _("No SELinux alerts.") }
                            >
                        {entries}
                    </cockpitListing.Listing>
                </div>
            );
        }
    }
});

module.exports = {
    SETroubleshootPage: SETroubleshootPage,
};
