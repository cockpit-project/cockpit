/* DO NOT EDIT. Automatically generated file
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
], function(React) {

"use strict";

/* Show details for an alert, including possible solutions */
  /* running solution entry.fix
                      plugin: analysis_id,
                    running: true,
                    result: null,
                    success: false,
  */
var SELinuxEventDetails = React.createClass({displayName: "SELinuxEventDetails",
    getInitialState: function() {
        var expanded;
        // all details are collapsed by default
        if (this.props.details)
            expanded = this.props.details.plugin_analysis.map(function() { return false; } );

        return {
            solution_expanded: expanded, // show details for solution
        };
    },
    handleSolutionDetailsClick: function(itm_idx, e) {
        var solution_expanded = this.state.solution_expanded;
        solution_expanded[itm_idx] = !solution_expanded[itm_idx];
        this.setState( { solution_expanded: solution_expanded } );
        e.stopPropagation();
        e.preventDefault();
    },
    run_fix: function(itm_idx, e) {
        // make sure the details for the solution are collapsed, or they can hide the progress and result
        var solution_expanded = this.state.solution_expanded;
        if (solution_expanded[itm_idx]) {
            solution_expanded[itm_idx] = false;
            this.setState( { solution_expanded: solution_expanded } );
        }
        var local_id = this.props.details.local_id;
        var analysis_id = this.props.details.plugin_analysis[itm_idx].analysis_id;
        this.props.run_fix(local_id, analysis_id);
    },
    render: function() {
        if (!this.props.details) {
            // details should be requested by default, so we just need to wait for them
            return (
                React.createElement(EmptyState, {
                    icon:  React.createElement("div", {className: "spinner spinner-lg"}),
                    description: "Waiting for details...",
                    message:  null })
            );
        }
        var self = this;
        var fix_entries = this.props.details.plugin_analysis.map(function(itm, itm_idx) {
            var fixit = null;
            var msg = null;
            if (itm.fixable) {
                if ((self.props.fix) && (self.props.fix.plugin == itm.analysis_id)) {
                    if (self.props.fix.running) {
                        msg = React.createElement("div", null,
                                  React.createElement("div", {className: "spinner setroubleshoot-progress-spinner"}),
                                  React.createElement("span", {className: "setroubleshoot-progress-message"}, " Applying solution...")
                              );
                    } else {
                        if (self.props.fix.success) {
                            msg = React.createElement("div", {className: "alert alert-success"},
                                      React.createElement("span", {className: "pficon pficon-ok"}),
                                      React.createElement("span", null, " Solution applied successfully: ",  self.props.fix.result)
                                  );
                        } else {
                            msg = React.createElement("div", {className: "alert alert-danger"},
                                      React.createElement("span", {className: "pficon pficon-error-circle-o"}),
                                      React.createElement("span", null, " Solution failed: ",  self.props.fix.result)
                                  );
                        }
                    }
                }
                fixit = (
                    React.createElement("div", {className: "setroubleshoot-listing-action"},
                        React.createElement("button", {className: "btn btn-default",
                                onClick:  self.run_fix.bind(self, itm_idx)
                            }, "Apply this solution"
                        )
                    )
                );
            } else {
                fixit = (
                    React.createElement("div", {className: "setroubleshoot-listing-action"},
                        React.createElement("span", null, "Unable to apply this solution automatically")
                    )
                  );
            }
            var details_link = React.createElement("a", {href: "#", onClick:  self.handleSolutionDetailsClick.bind(self, itm_idx) }, "solution details");
            var do_state;
            var do_elem;
            var caret;
            if (self.state.solution_expanded[itm_idx]) {
                caret = React.createElement("i", {className: "fa fa-angle-down"});
                do_state = React.createElement("div", null, caret, " ", details_link);
                do_elem =  React.createElement("div", null,
                                 itm.do_text
                          );
            } else {
                caret = React.createElement("i", {className: "fa fa-angle-right"});
                do_state = React.createElement("div", null, caret, " ", details_link);
                do_elem = null;
            }
            return (
                React.createElement("div", {className: "list-group-item", key:  itm.analysis_id},
                     fixit,
                    React.createElement("div", null,
                        React.createElement("div", null,
                            React.createElement("span", null,  itm.if_text)
                        ),
                        React.createElement("div", null,
                             itm.then_text
                        ),
                         do_state,
                         do_elem,
                         msg
                    )
                )
            );
        });
        return (
          React.createElement("div", {className: "list-group"},
               fix_entries
          )
        );
    }
});

/* Show the audit log events for an alert */
var SELinuxEventLog = React.createClass({displayName: "SELinuxEventLog",
    render: function() {
        var self = this;
        var log_entries = this.props.details.audit_event.map(function(itm, idx) {
            // use the alert id and index in the event log array as the data key for react
            // if the log becomes dynamic, the entire log line might need to be considered as the key
            return (React.createElement("div", {key:  self.props.details.local_id + "." + idx},  itm ));
        });
        return (
            React.createElement("div", {className: "setroubleshoot-log"},  log_entries )
        );
    }
});

/* entry for an alert in the listing, can be expanded (with details) or standard */
var SELinuxEvent = React.createClass({displayName: "SELinuxEvent",
    tab_renderers: [
        { name: "Solutions",
          renderer: SELinuxEventDetails,
        },
        { name: "Audit log",
          renderer: SELinuxEventLog,
        },
    ],
    getInitialState: function() {
        return {
            expanded: false, // show extended info, one line summary if false
            active_tab: 0, // currently active tab in expanded mode, defaults to first tab
        };
    },
    handleClick: function() {
        this.setState( {expanded: !this.state.expanded });
    },
    handleDismissClick: function(e) {
        e.stopPropagation();
    },
    handleTabClick: function(tab_idx, e) {
        this.setState( {active_tab: tab_idx } );
        e.stopPropagation();
        e.preventDefault();
    },
    render: function() {
        var self = this;
        var bodyProps = {className: '', onClick: this.handleClick};
        var count_display = null;
        if (this.state.expanded) {
            if (this.props.count > 1)
                count_display = React.createElement("span", {className: "pull-right"},  this.props.count + " occurrences");
            var links = this.tab_renderers.map(function(itm, idx) {
                return (
                    React.createElement("li", {key:  idx, className:  (idx === self.state.active_tab) ? "active" : ""},
                        React.createElement("a", {href: "#", onClick:  self.handleTabClick.bind(self, idx) },  itm.name)
                    )
                );
            });
            var active_renderer = this.tab_renderers[this.state.active_tab].renderer;
            return (
                React.createElement("tbody", {className: "open"},
                    React.createElement("tr", {className: "listing-item", onClick:  this.handleClick}),
                    React.createElement("tr", {className: "listing-panel"},
                        React.createElement("td", {colSpan: "2"},
                            React.createElement("div", {className: "listing-head", onClick:  this.handleClick},
                                React.createElement("div", {className: "listing-actions"},
                                     React.createElement("button", {title: "Dismiss",
                                            className: "pficon pficon-delete btn btn-danger",
                                            disabled: true,
                                            onClick:  this.handleDismissClick}
                                    )
                                ),
                                React.createElement("h3", null, this.props.description),
                                 count_display,
                                React.createElement("ul", {className: "nav nav-tabs nav-tabs-pf"},
                                     links
                                )
                            ),
                            React.createElement("div", {className: "listing-body"},
                                 React.createElement(active_renderer, this.props)
                            )
                        )
                    )
                )
            );
        } else {
            if (this.props.count > 1)
                count_display = React.createElement("span", {className: "badge"},  this.props.count);
            return (
                React.createElement("tbody", null,
                    React.createElement("tr", {className: "listing-item", onClick:  this.handleClick},
                        React.createElement("td", null,  this.props.description),
                        React.createElement("td", null,  count_display )
                    ),
                    React.createElement("tr", {className: "listing-panel", onClick:  this.handleClick})
                )
            );
        }
    }
});

/* Implements a subset of the PatternFly Empty State pattern
 * https://www.patternfly.org/patterns/empty-state/
 */
var EmptyState = React.createClass({displayName: "EmptyState",
    render: function() {
        var description = null;
        if (this.props.description)
            description = React.createElement("h1", null, this.props.description);

        var message = null;
        if (this.props.message)
            message = React.createElement("p", null, this.props.message);

        return (
            React.createElement("div", {className: "curtains blank-slate-pf"},
                React.createElement("div", {className: "blank-slate-pf-icon"},
                     this.props.icon
                ),
                 description,
                 message
            )
        );
    }
});

/* The listing only shows if we have a connection to the dbus API
 * Otherwise we have blank slate: trying to connect, error
 */
var SETroubleshootPage = React.createClass({displayName: "SETroubleshootPage",
    render: function() {
        var self = this;
        if (!this.props.connected) {
            var icon;
            var description;
            if (this.props.connecting) {
                icon = React.createElement("div", {className: "spinner spinner-lg"});
                description = "Connecting...";
            } else {
                icon = React.createElement("i", {className: "fa fa-exclamation-circle"});
                description = "Couldn't connect to SETroubleshoot daemon";
            }

            return (
                React.createElement(EmptyState, {
                    icon:  icon,
                    description:  description,
                    message:  this.props.error})
            );
        } else {
            // if we don't have any entries, show a sane message instead of an empty page */
            if (this.props.entries.length === 0) {
                return (
                    React.createElement(EmptyState, {
                        icon:  React.createElement("i", {className: "fa fa-check"}),
                        description: "No SELinux alerts.",
                        message:  null })
                );
            }
            var entries = this.props.entries.map(function(itm) {
                itm.run_fix = self.props.run_fix;
                return React.createElement(SELinuxEvent, React.__spread({},   itm ));
            });
            return (
                React.createElement("div", {className: "container-fluid setroubleshoot-page"},
                    React.createElement("table", {className: "listing setroubleshoot-listing"},
                        React.createElement("thead", null,
                            React.createElement("tr", null,
                                React.createElement("td", {colSpan: "2"},
                                    React.createElement("h3", null, "SELinux Access Control errors")
                                )
                            )
                        ),
                        entries
                    )
                )
            );
        }
    }
});

return {
    SETroubleshootPage: SETroubleshootPage,
};

});

