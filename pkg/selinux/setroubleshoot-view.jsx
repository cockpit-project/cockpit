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

define([
    "react",
    "base1/cockpit",
    "base1/cockpit-components-listing",
], function(React, cockpit, cockpitListing) {

"use strict";

var _ = cockpit.gettext;

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
                    description={ waiting ? _('Waiting for details...') : _('Unable to get alert details.') }
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
                    {fixit}
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
                    description={ waiting ? _('Waiting for details...') : _('Unable to get alert details.') }
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

        var curtains = "curtains";
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

/* The listing only shows if we have a connection to the dbus API
 * Otherwise we have blank slate: trying to connect, error
 */
var SETroubleshootPage = React.createClass({
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
                description = _("Couldn't connect to SETroubleshoot daemon");
            }

            return (
                <EmptyState
                    icon={icon}
                    description={description}
                    message={this.props.error} />
            );
        } else {
            // if we don't have any entries, show a sane message instead of an empty page */
            if (this.props.entries.length === 0) {
                return (
                    <EmptyState
                        icon={ <i className="fa fa-check" /> }
                        description={ _("No SELinux alerts.") }
                        message={null} />
                );
            }
            var entries = this.props.entries.map(function(itm) {
                itm.runFix = self.props.runFix;
                var dismissAction = (
                    <button
                        title="Dismiss"
                        className="pficon pficon-delete btn btn-danger"
                        disabled />
                );
                var tabRenderers = [
                    {
                        name: _('Solutions'),
                        renderer: SELinuxEventDetails,
                        data: itm,
                    },
                    {
                        name: _('Audit log'),
                        renderer: SELinuxEventLog,
                        data: itm,
                    },
                ];
                var columns = [ { name: itm.description, 'header': true } ];
                if (itm.count > 1)
                    columns.push(<span className="badge">{itm.count}</span>);
                return (
                    <cockpitListing.ListingRow
                        columns={columns}
                        tabRenderers={tabRenderers}
                        listingActions={ [ dismissAction ] } />
                );
            });

            return (
                <div className="container-fluid setroubleshoot-page">
                    <cockpitListing.Listing title={ _("SELinux Access Control errors") }>
                        {entries}
                    </cockpitListing.Listing>
                </div>
            );
        }
    }
});

return {
    SETroubleshootPage: SETroubleshootPage,
};

});

