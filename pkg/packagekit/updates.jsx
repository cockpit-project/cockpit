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
import '../lib/polyfills.js'; // once per application
import React from "react";
import ReactDOM from 'react-dom';

import moment from "moment";
import { Tooltip } from "cockpit-components-tooltip.jsx";
import Markdown from "react-remarkable";
import AutoUpdates from "./autoupdates.jsx";

import * as PK from "packagekit.es6";

require("listing.less");

const _ = cockpit.gettext;

// "available" heading is built dynamically
const STATE_HEADINGS = {
    "loading": _("Loading available updates, please wait..."),
    "locked": _("Some other program is currently using the package manager, please wait..."),
    "refreshing": _("Refreshing package information"),
    "uptodate": _("No updates pending"),
    "applying": _("Applying updates"),
    "updateSuccess": null,
    "updateError": _("Applying updates failed"),
    "loadError": _("Loading available updates failed"),
};

const PK_STATUS_STRINGS = {
    [PK.Enum.STATUS_DOWNLOAD]: _("Downloading"),
    [PK.Enum.STATUS_INSTALL]: _("Installing"),
    [PK.Enum.STATUS_UPDATE]: _("Updating"),
    [PK.Enum.STATUS_CLEANUP]: _("Setting up"),
    [PK.Enum.STATUS_SIGCHECK]: _("Verifying"),
};

const PK_STATUS_LOG_STRINGS = {
    [PK.Enum.STATUS_DOWNLOAD]: _("Downloaded"),
    [PK.Enum.STATUS_INSTALL]: _("Installed"),
    [PK.Enum.STATUS_UPDATE]: _("Updated"),
    [PK.Enum.STATUS_CLEANUP]: _("Set up"),
    [PK.Enum.STATUS_SIGCHECK]: _("Verified"),
};

var packageSummaries = {};

// parse CVEs from an arbitrary text (changelog) and return URL array
function parseCVEs(text) {
    if (!text)
        return [];

    var cves = text.match(/CVE-\d{4}-\d+/g);
    if (!cves)
        return [];
    return cves.map(n => "https://cve.mitre.org/cgi-bin/cvename.cgi?name=" + n);
}

function deduplicate(list) {
    var d = { };
    list.forEach(i => { if (i) d[i] = true; });
    var result = Object.keys(d);
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

class Expander extends React.Component {
    constructor() {
        super();
        this.state = {expanded: false};
    }

    componentDidUpdate(prevProps, prevState) {
        if (this.props.onExpand && !prevState.expanded && this.state.expanded)
            this.props.onExpand();
    }

    render() {
        let title = <a href="#">{this.props.title}</a>;
        let cls = "expander-caret fa " + (this.state.expanded ? "fa-angle-down" : "fa-angle-right");
        return (
            <React.Fragment>
                <div className="expander-title">
                    <hr />
                    <span onClick={() => this.setState({expanded: !this.state.expanded})} >
                        <i className={cls} />{title}
                    </span>
                    <hr />
                </div>
                {this.state.expanded ? this.props.children : null}
            </React.Fragment>);
    }
}

function count_security_updates(updates) {
    var num_security = 0;
    for (let u in updates)
        if (updates[u].severity === PK.Enum.INFO_SECURITY)
            ++num_security;
    return num_security;
}

function HeaderBar(props) {
    var num_updates = Object.keys(props.updates).length;
    var num_security = 0;
    var state;

    // unregistered & no available updates → blank slate, no header bar
    if (props.unregistered && props.state == "uptodate")
        return null;

    if (props.state == "available") {
        num_security = count_security_updates(props.updates);
        if (num_updates == num_security)
            state = cockpit.ngettext("$1 security fix", "$1 security fixes", num_security);
        else {
            state = cockpit.ngettext("$0 update", "$0 updates", num_updates);
            if (num_security > 0)
                state += cockpit.ngettext(", including $1 security fix", ", including $1 security fixes", num_security);
        }
        state = cockpit.format(state, num_updates, num_security);
    } else {
        state = STATE_HEADINGS[props.state];
    }

    if (!state)
        return null;

    var lastChecked;
    var actionButton;
    if (props.state == "uptodate" || props.state == "available") {
        if (!props.unregistered)
            actionButton = <button className="btn btn-default" onClick={props.onRefresh} >{_("Check for Updates")}</button>;
        if (props.timeSinceRefresh !== null)
            lastChecked = cockpit.format(_("Last checked: $0 ago"), moment.duration(props.timeSinceRefresh * 1000).humanize());
    } else if (props.state == "applying") {
        actionButton = <button className="btn btn-default" onClick={props.onCancel} disabled={!props.allowCancel} >{_("Cancel")}</button>;
    }

    return (
        <div className="content-header-extra">
            <div id="state" className="content-header-extra--state">{state}</div>
            <div className="content-header-extra--updated">{lastChecked}</div>
            <div className="content-header-extra--action">{actionButton}</div>
        </div>
    );
}

function getSeverityURL(urls) {
    if (!urls)
        return null;

    // in ascending severity
    const knownLevels = ["low", "moderate", "important", "critical"];
    var highestIndex = -1;
    var highestURL = null;

    // search URLs for highest valid severity; by all means we expect an update to have at most one, but for paranoia..
    urls.map(value => {
        if (value.startsWith("https://access.redhat.com/security/updates/classification/#")) {
            let i = knownLevels.indexOf(value.slice(value.indexOf("#") + 1));
            if (i > highestIndex) {
                highestIndex = i;
                highestURL = value;
            }
        }
    });
    return highestURL;
}

class UpdateItem extends React.Component {
    constructor() {
        super();
        this.state = {expanded: false};
    }

    render() {
        const info = this.props.info;

        var bugs = null;
        if (info.bug_urls && info.bug_urls.length) {
            // we assume a bug URL ends with a number; if not, show the complete URL
            bugs = insertCommas(info.bug_urls.map(url => (
                <a rel="noopener" referrerpolicy="no-referrer" target="_blank" href={url}>
                    {url.match(/[0-9]+$/) || url}
                </a>)
            ));
        }

        var cves = null;
        if (info.cve_urls && info.cve_urls.length) {
            cves = insertCommas(info.cve_urls.map(url => (
                <a href={url} rel="noopener" referrerpolicy="no-referrer" target="_blank">
                    {url.match(/[^/=]+$/)}
                </a>)
            ));
        }

        var errata = null;
        if (info.vendor_urls) {
            errata = insertCommas(info.vendor_urls.filter(url => url.indexOf("/errata/") > 0).map(url => (
                <a href={url} rel="noopener" referrerpolicy="no-referrer" target="_blank">
                    {url.match(/[^/=]+$/)}
                </a>)
            ));
            if (!errata.length)
                errata = null; // simpler testing below
        }

        var secSeverityURL = getSeverityURL(info.vendor_urls);
        var secSeverity = secSeverityURL ? secSeverityURL.slice(secSeverityURL.indexOf("#") + 1) : null;
        var iconClasses = PK.getSeverityIcon(info.severity, secSeverity);
        var type;
        if (info.severity === PK.Enum.INFO_SECURITY) {
            if (secSeverityURL)
                secSeverityURL = <a rel="noopener" referrerpolicy="no-referrer" target="_blank" href={secSeverityURL}>{secSeverity}</a>;
            type = (
                <React.Fragment>
                    <span className={iconClasses}>&nbsp;</span>
                    { (info.cve_urls && info.cve_urls.length > 0) ? info.cve_urls.length : "" }
                </React.Fragment>);
        } else {
            type = (
                <React.Fragment>
                    <span className={iconClasses}>&nbsp;</span>
                    { bugs ? info.bug_urls.length : "" }
                </React.Fragment>);
        }

        var pkgList = this.props.pkgNames.map(n => (<Tooltip tip={packageSummaries[n]}><span>{n}</span></Tooltip>));
        var pkgs = insertCommas(pkgList);
        var pkgsTruncated = pkgs;
        if (pkgList.length > 4)
            pkgsTruncated = insertCommas(pkgList.slice(0, 4).concat("…"));

        var descriptionFirstLine = (info.description || "").trim();
        if (descriptionFirstLine.indexOf("\n") >= 0)
            descriptionFirstLine = descriptionFirstLine.slice(0, descriptionFirstLine.indexOf("\n"));
        descriptionFirstLine = cleanupChangelogLine(descriptionFirstLine);
        var description;
        if (info.markdown) {
            descriptionFirstLine = <Markdown source={descriptionFirstLine} />;
            description = <Markdown source={info.description} />;
        } else {
            description = <div className="changelog">{info.description}</div>;
        }

        var details = null;
        if (this.state.expanded) {
            details = (
                <tr className="listing-ct-panel">
                    <td colSpan="5">
                        <div className="listing-ct-body">
                            <dl>
                                <dt>Packages:</dt>
                                <dd>{pkgs}</dd>
                                { cves ? <dt>CVE:</dt> : null }
                                { cves ? <dd>{cves}</dd> : null }
                                { secSeverityURL ? <dt>{_("Severity:")}</dt> : null }
                                { secSeverityURL ? <dd className="severity">{secSeverityURL}</dd> : null }
                                { errata ? <dt>{_("Errata:")}</dt> : null }
                                { errata ? <dd>{errata}</dd> : null }
                                { bugs ? <dt>{_("Bugs:")}</dt> : null }
                                { bugs ? <dd>{bugs}</dd> : null }
                            </dl>

                            <p />
                            <p className="changelog">{description}</p>
                        </div>
                    </td>
                </tr>
            );
        }

        return (
            <tbody className={ this.state.expanded ? "open" : null } >
                <tr className={ "listing-ct-item" + (info.severity === PK.Enum.INFO_SECURITY ? " security" : "") }
                    onClick={ () => this.setState({expanded: !this.state.expanded}) }>
                    <td className="listing-ct-toggle">
                        <i className="fa fa-fw" />
                    </td>
                    <th>{pkgsTruncated}</th>
                    <td className="version"><span className="truncating">{info.version}</span></td>
                    <td className="type">{type}</td>
                    <td className="changelog">{descriptionFirstLine}</td>
                </tr>
                {details}
            </tbody>
        );
    }
}

function UpdatesList(props) {
    var updates = [];

    // PackageKit doesn"t expose source package names, so group packages with the same version and changelog
    // create a reverse version+changes → [id] map on iteration
    var sameUpdate = {};
    var packageNames = {};
    Object.keys(props.updates).forEach(id => {
        let u = props.updates[id];
        // did we already see the same version and description? then merge
        let hash = u.version + u.description;
        let seenId = sameUpdate[hash];
        if (seenId) {
            packageNames[seenId].push(u.name);
        } else {
            // this is a new update
            sameUpdate[hash] = id;
            packageNames[id] = [u.name];
            updates.push(id);
        }
    });

    // sort security first
    updates.sort((a, b) => {
        if (props.updates[a].severity === PK.Enum.INFO_SECURITY && props.updates[b].severity !== PK.Enum.INFO_SECURITY)
            return -1;
        if (props.updates[a].severity !== PK.Enum.INFO_SECURITY && props.updates[b].severity === PK.Enum.INFO_SECURITY)
            return 1;
        return a.localeCompare(b);
    });

    return (
        <table className="listing-ct">
            <thead>
                <tr>
                    <th />
                    <th>{_("Name")}</th>
                    <th>{_("Version")}</th>
                    <th>{_("Severity")}</th>
                    <th>{_("Details")}</th>
                </tr>
            </thead>
            { updates.map(id => <UpdateItem pkgNames={packageNames[id].sort()} info={props.updates[id]} />) }
        </table>
    );
}

function UpdateHistory(props) {
    if (!props.history)
        return null;

    function formatHeading(time) {
        if (time)
            return cockpit.format(_("The following packages were updated $0:"), moment(time).fromNow());
        return _("The following packages were recently updated:");
    }

    function formatPkgs(pkgs) {
        let names = Object.keys(pkgs).filter(i => i != "_time");
        names.sort();
        return names.map(n => <Tooltip tip={ n + " " + pkgs[n] }><li>{n}</li></Tooltip>);
    }

    let history = props.history;
    if (props.limit)
        history = history.slice(0, props.limit);

    var paragraphs = history.map(pkgs => (
        <React.Fragment>
            <p>{formatHeading(pkgs["_time"])}</p>
            <ul className='flow-list'>{formatPkgs(pkgs)}</ul>
        </React.Fragment>
    ));

    return paragraphs;
}

class ApplyUpdates extends React.Component {
    constructor() {
        super();
        // actions is a chronological list of { status: PK_STATUS_*, package: "name version" } events
        // that happen during applying updates
        this.state = { percentage: 0, timeRemaining: null, actions: [] };
    }

    componentDidMount() {
        var transactionPath = this.props.transaction;

        PK.watchTransaction(transactionPath, {
            Package: (info, packageId) => {
                let pfields = packageId.split(";");

                // small timeout to avoid excessive overlaps from the next PackageKit progress signal
                PK.call(transactionPath, "org.freedesktop.DBus.Properties", "GetAll", [PK.transactionInterface], {timeout: 500})
                        .done(reply => {
                            let percent = reply[0].Percentage.v;
                            let remain = -1;
                            if ("RemainingTime" in reply[0])
                                remain = reply[0].RemainingTime.v;
                            // info: see PK_STATUS_* at https://github.com/hughsie/PackageKit/blob/master/lib/packagekit-glib2/pk-enum.h
                            let newActions = this.state.actions.slice();
                            newActions.push({ status: info, package: pfields[0] + " " + pfields[1] });

                            let log = document.getElementById("update-log");
                            let atBottom = false;
                            if (log) {
                                if (log.scrollHeight - log.clientHeight <= log.scrollTop + 2)
                                    atBottom = true;
                            }

                            this.setState({ actions: newActions,
                                            percentage: percent <= 100 ? percent : 0,
                                            timeRemaining: remain > 0 ? remain : null
                            });

                            // scroll update log to the bottom, if it already is (almost) at the bottom
                            if (log && atBottom)
                                log.scrollTop = log.scrollHeight;
                        });
            },
        });
    }

    render() {
        var actionHTML, logRows;

        if (this.state.actions.length > 0) {
            let lastAction = this.state.actions[this.state.actions.length - 1];
            actionHTML = (
                <React.Fragment>
                    <strong>{ PK_STATUS_STRINGS[lastAction.status] || PK_STATUS_STRINGS[PK.Enum.STATUS_UPDATE] }</strong>
                    &nbsp;{lastAction.package}
                </React.Fragment>);
            logRows = this.state.actions.slice(0, -1).map(action => (
                <tr>
                    <th>{PK_STATUS_LOG_STRINGS[action.status] || PK_STATUS_LOG_STRINGS[PK.Enum.STATUS_UPDATE]}</th>
                    <td>{action.package}</td>
                </tr>));
        } else {
            actionHTML = _("Initializing...");
        }

        return (
            <React.Fragment>
                <div className="progress-main-view">
                    <div className="progress-description">
                        <div className="spinner spinner-xs spinner-inline" />
                        {actionHTML}
                    </div>
                    <div className="progress progress-label-top-right">
                        <div className="progress-bar" role="progressbar" style={ {width: this.state.percentage + "%"} }>
                            { this.state.timeRemaining !== null ? <span>{moment.duration(this.state.timeRemaining * 1000).humanize()}</span> : null }
                        </div>
                    </div>
                </div>

                <div className="update-log">
                    <Expander title={_("Update Log")} onExpand={() => {
                        // always scroll down on expansion
                        let log = document.getElementById("update-log");
                        log.scrollTop = log.scrollHeight;
                    }}>
                        <div id="update-log" className="update-log-content">
                            <table>
                                {logRows}
                            </table>
                        </div>
                    </Expander>
                </div>
            </React.Fragment>
        );
    }
}

function AskRestart(props) {
    return (
        <div className="blank-slate-pf">
            <h1>{_("Restart Recommended")}</h1>
            <p>{_("Updated packages may require a restart to take effect.")}</p>
            <div className="blank-slate-pf-secondary-action">
                <button className="btn btn-default" onClick={props.onIgnore}>{_("Ignore")}</button>
                &nbsp;
                <button className="btn btn-primary" onClick={props.onRestart}>{_("Restart Now")}</button>
            </div>
            <div className="flow-list-blank-slate">
                <Expander title={_("Package information")}>
                    <UpdateHistory history={props.history} limit="1" />
                </Expander>
            </div>
        </div>
    );
}

class OsUpdates extends React.Component {
    constructor() {
        super();
        this.state = { state: "loading",
                       errorMessages: [],
                       updates: {},
                       timeSinceRefresh: null,
                       loadPercent: null,
                       cockpitUpdate: false,
                       allowCancel: null,
                       history: null,
                       unregistered: false,
                       autoUpdatesEnabled: null };
        this.handleLoadError = this.handleLoadError.bind(this);
        this.handleRefresh = this.handleRefresh.bind(this);
        this.handleRestart = this.handleRestart.bind(this);
        this.loadUpdates = this.loadUpdates.bind(this);
    }

    componentDidMount() {
        // check if there is an upgrade in progress already; if so, switch to "applying" state right away
        PK.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTransactionList", [])
                .done(result => {
                    let transactions = result[0];
                    let promises = transactions.map(transactionPath => PK.call(
                        transactionPath, "org.freedesktop.DBus.Properties", "Get", [PK.transactionInterface, "Role"]));

                    cockpit.all(promises)
                            .done(roles => {
                                // any transaction with UPDATE_PACKAGES role?
                                for (let idx = 0; idx < roles.length; ++idx) {
                                    if (roles[idx].v === PK.Enum.ROLE_UPDATE_PACKAGES) {
                                        this.watchUpdates(transactions[idx]);
                                        return;
                                    }
                                }

                                // no running updates found, proceed to showing available updates
                                this.initialLoadOrRefresh();
                            })
                            .fail(ex => {
                                console.warn("GetTransactionList: failed to read PackageKit transaction roles:", ex.message);
                                // be robust, try to continue with loading updates anyway
                                this.initialLoadOrRefresh();
                            });
                })
                .fail(this.handleLoadError);
    }

    handleLoadError(ex) {
        console.error("loading available updates failed:", JSON.stringify(ex));
        if (ex.problem === "not-found")
            ex = _("PackageKit is not installed");
        this.state.errorMessages.push(ex.detail || ex.message || ex);
        this.setState({state: "loadError"});
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
        PK.cancellableTransaction("GetUpdateDetail", [pkg_ids], null, {
            UpdateDetail: (packageId, updates, obsoletes, vendor_urls, bug_urls, cve_urls, restart,
                update_text, changelog /* state, issued, updated */) => {
                let u = this.state.updates[packageId];
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

                this.setState({ updates: this.state.updates });
            },
        })
                .then(() => this.setState({state: "available"}))
                .catch(ex => {
                    console.warn("GetUpdateDetail failed:", JSON.stringify(ex));
                    // still show available updates, with reduced detail
                    this.setState({state: "available"});
                });
    }

    loadUpdates() {
        var updates = {};
        var cockpitUpdate = false;

        PK.cancellableTransaction("GetUpdates", [0],
                                  data => this.setState({ state: data.waiting ? "locked" : "loading" }),
                                  {
                                      Package: (info, packageId, _summary) => {
                                          let id_fields = packageId.split(";");
                                          packageSummaries[id_fields[0]] = _summary;
                                          // HACK: dnf backend yields wrong severity (https://bugs.freedesktop.org/show_bug.cgi?id=101070)
                                          if (info < PK.Enum.INFO_LOW || info > PK.Enum.INFO_SECURITY)
                                              info = PK.Enum.INFO_NORMAL;
                                          updates[packageId] = { name: id_fields[0], version: id_fields[1], severity: info };
                                          if (id_fields[0] == "cockpit-ws")
                                              cockpitUpdate = true;
                                      },
                                  })
                .then(() => {
                    // get the details for all packages
                    let pkg_ids = Object.keys(updates);
                    if (pkg_ids.length) {
                        this.setState({ updates: updates, cockpitUpdate: cockpitUpdate });
                        this.loadUpdateDetails(pkg_ids);
                    } else {
                        this.setState({state: "uptodate"});
                    }
                    this.loadHistory();
                })
                .catch(this.handleLoadError);
    }

    loadHistory() {
        let history = [];

        // would be nice to filter only for "update-packages" role, but can't here
        PK.transaction("GetOldTransactions", [0], {
            Transaction: (objPath, timeSpec, succeeded, role, duration, data) => {
                if (role !== PK.Enum.ROLE_UPDATE_PACKAGES)
                    return;
                    // data looks like:
                    // downloading\tbash-completion;1:2.6-1.fc26;noarch;updates-testing
                    // updating\tbash-completion;1:2.6-1.fc26;noarch;updates-testing
                let pkgs = {"_time": Date.parse(timeSpec)};
                let empty = true;
                data.split("\n").forEach(line => {
                    let fields = line.trim().split("\t");
                    if (fields.length >= 2) {
                        let pkgId = fields[1].split(";");
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
                    this.setState({history: history});
            }
        })
                .catch(ex => console.warn("Failed to load old transactions:", ex));
    }

    initialLoadOrRefresh() {
        PK.watchRedHatSubscription(registered => this.setState({ unregistered: !registered }));

        PK.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTimeSinceAction",
                [PK.Enum.ROLE_REFRESH_CACHE])
                .done(seconds => {
                    this.setState({timeSinceRefresh: seconds});

                    // automatically trigger refresh for ≥ 1 day or if never refreshed
                    if (seconds >= 24 * 3600 || seconds < 0)
                        this.handleRefresh();
                    else
                        this.loadUpdates();
                })
                .fail(this.handleLoadError);
    }

    watchUpdates(transactionPath) {
        this.setState({ state: "applying", applyTransaction: transactionPath, allowCancel: false });

        PK.call(transactionPath, "DBus.Properties", "Get", [PK.transactionInterface, "AllowCancel"])
                .done(reply => this.setState({ allowCancel: reply[0].v }));

        return PK.watchTransaction(transactionPath,
                                   {
                                       ErrorCode: (code, details) => this.state.errorMessages.push(details),

                                       Finished: exit => {
                                           this.setState({ applyTransaction: null, allowCancel: null });

                                           if (exit === PK.Enum.EXIT_SUCCESS) {
                                               this.setState({ state: "updateSuccess", loadPercent: null });
                                               this.loadHistory();
                                           } else if (exit === PK.Enum.EXIT_CANCELLED) {
                                               this.setState({ state: "loading", loadPercent: null });
                                               this.loadUpdates();
                                           } else {
                                               // normally we get FAILED here with ErrorCodes; handle unexpected errors to allow for some debugging
                                               if (exit !== PK.Enum.EXIT_FAILED)
                                                   this.state.errorMessages.push(cockpit.format(_("PackageKit reported error code $0"), exit));
                                               this.setState({state: "updateError"});
                                           }
                                       },

                                       // not working/being used in at least Fedora
                                       RequireRestart: (type, packageId) => console.log("update RequireRestart", type, packageId),
                                   },

                                   notify => {
                                       if ("AllowCancel" in notify)
                                           this.setState({allowCancel: notify.AllowCancel});
                                   })
                .fail(ex => {
                    this.state.errorMessages.push(ex);
                    this.setState({state: "updateError"});
                });
    }

    applyUpdates(securityOnly) {
        var ids = Object.keys(this.state.updates);
        if (securityOnly)
            ids = ids.filter(id => this.state.updates[id].severity === PK.Enum.INFO_SECURITY);

        PK.transaction()
                .then(transactionPath => {
                    this.watchUpdates(transactionPath)
                            .then(() => {
                                PK.call(transactionPath, PK.transactionInterface, "UpdatePackages", [0, ids])
                                        .fail(ex => {
                                            // We get more useful error messages through ErrorCode or "PackageKit has crashed", so only
                                            // show this if we don't have anything else
                                            if (this.state.errorMessages.length === 0)
                                                this.state.errorMessages.push(ex.message);
                                            this.setState({state: "updateError"});
                                        });
                            });
                })
                .catch(ex => {
                    this.state.errorMessages.push(ex.message);
                    this.setState({state: "updateError"});
                });
    }

    renderContent() {
        var applySecurity, applyAll, unregisteredWarning;

        switch (this.state.state) {
        case "loading":
        case "refreshing":
        case "locked":
            if (this.state.loadPercent)
                return (
                    <div className="progress-main-view">
                        <div className="progress">
                            <div className="progress-bar" role="progressbar" style={ {width: this.state.loadPercent + "%"} } />
                        </div>
                    </div>
                );
            else
                return <div className="spinner spinner-lg progress-main-view" />;

        case "available":
            // when unregistered, hide the Apply buttons and show a warning
            if (this.state.unregistered) {
                unregisteredWarning = (
                    <React.Fragment>
                        <h2>{ _("Unregistered System") }</h2>
                        <div className="alert alert-warning">
                            <span className="pficon pficon-warning-triangle-o" />
                            <span>
                                <strong>{ _("Updates are disabled.") }</strong>
                                    &nbsp;
                                { _("You need to re-subscribe this system.") }
                            </span>
                            <button className="btn btn-primary pull-right"
                                onClick={ () => cockpit.jump("/subscriptions", cockpit.transport.host) }>
                                { _("View Registration Details") }
                            </button>
                        </div>
                    </React.Fragment>);
            } else {
                let num_updates = Object.keys(this.state.updates).length;
                let num_security_updates = count_security_updates(this.state.updates);

                applyAll = (
                    <button className="pk-update--all btn btn-primary" onClick={ () => this.applyUpdates(false) }>
                        { num_updates == num_security_updates
                            ? _("Install Security Updates") : _("Install All Updates") }
                    </button>);

                if (num_security_updates > 0 && num_updates > num_security_updates) {
                    applySecurity = (
                        <button className="pk-update--security btn btn-default" onClick={ () => this.applyUpdates(true) }>
                            {_("Install Security Updates")}
                        </button>);
                }
            }

            return (
                <div className="pk-updates">
                    {unregisteredWarning}
                    <AutoUpdates onInitialized={ enabled => this.setState({ autoUpdatesEnabled: enabled }) } />
                    <div id="available" className="pk-updates--header">
                        <h2 className="pk-updates--header--heading">{_("Available Updates")}</h2>
                        <div className="pk-updates--header--actions">
                            {applySecurity}
                            {applyAll}
                        </div>
                    </div>
                    { this.state.cockpitUpdate
                        ? <div className="alert alert-warning">
                            <span className="pficon pficon-warning-triangle-o" />
                            <span>
                                <strong>{_("This web console will be updated.")}</strong>
                                    &nbsp;
                                {_("Your browser will disconnect, but this does not affect the update process. You can reconnect in a few moments to continue watching the progress.")}
                            </span>
                        </div>
                        : null
                    }
                    <UpdatesList updates={this.state.updates} />

                    { /* Hide history with automatic updates, as they don't feed their history into PackageKit */
                        this.state.history && !this.state.autoUpdatesEnabled
                            ? <div id="history">
                                <h2>{_("Update History")}</h2>
                                <UpdateHistory history={this.state.history} limit="1" />
                            </div>
                            : null
                    }
                </div>
            );

        case "loadError":
        case "updateError":
            return this.state.errorMessages.map(m => <pre>{m}</pre>);

        case "applying":
            return <ApplyUpdates transaction={this.state.applyTransaction} />;

        case "updateSuccess":
            return <AskRestart onRestart={this.handleRestart} onIgnore={this.loadUpdates} history={this.state.history} />;

        case "restart":
            return (
                <div className="blank-slate-pf">
                    <div className="blank-slate-pf-icon">
                        <div className="spinner spinner-lg" />
                    </div>
                    <h1>{_("Restarting")}</h1>
                    <p>{_("Your server will close the connection soon. You can reconnect after it has restarted.")}</p>
                </div>);

        case "uptodate":
            if (this.state.unregistered) {
                return (
                    <div className="blank-slate-pf">
                        <div className="blank-slate-pf-icon">
                            <span className="fa fa-exclamation-circle" />
                        </div>
                        <h1>{_("This system is not registered")}</h1>
                        <p>{_("To get software updates, this system needs to be registered with Red Hat, either using the Red Hat Customer Portal or a local subscription server.")}</p>
                        <div className="blank-slate-pf-main-action">
                            <button className="btn btn-lg btn-primary"
                                onClick={ () => cockpit.jump("/subscriptions", cockpit.transport.host) }>
                                {_("Register…")}
                            </button>
                        </div>
                    </div>);
            }

            return (
                <React.Fragment>
                    <AutoUpdates onInitialized={ enabled => this.setState({ autoUpdatesEnabled: enabled }) } />
                    <div className="blank-slate-pf">
                        <div className="blank-slate-pf-icon">
                            <span className="fa fa-check" />
                        </div>
                        <p>{_("System is up to date")}</p>

                        { this.state.history && !this.state.autoUpdatesEnabled
                            ? <div className="flow-list-blank-slate"><UpdateHistory history={this.state.history} limit="1" /></div>
                            : null }
                    </div>
                </React.Fragment>);

        default:
            return null;
        }
    }

    handleRefresh() {
        this.setState({ state: "refreshing", loadPercent: null });
        PK.cancellableTransaction("RefreshCache", [true], data => this.setState({loadPercent: data.percentage}))
                .then(() => {
                    this.setState({timeSinceRefresh: 0});
                    this.loadUpdates();
                })
                .catch(this.handleLoadError);
    }

    handleRestart() {
        this.setState({state: "restart"});
        // give the user a chance to actually read the message
        window.setTimeout(() => {
            cockpit.spawn(["shutdown", "--reboot", "now"], { superuser: true, err: "message" })
                    .fail(ex => {
                        this.state.errorMessages.push(ex);
                        this.setState({state: "updateError"});
                    });
        }, 5000);
    }

    render() {
        return (
            <div>
                <HeaderBar state={this.state.state} updates={this.state.updates}
                           timeSinceRefresh={this.state.timeSinceRefresh} onRefresh={this.handleRefresh}
                           unregistered={this.state.unregistered}
                           allowCancel={this.state.allowCancel}
                           onCancel={ () => PK.call(this.state.applyTransaction, PK.transactionInterface, "Cancel", []) } />
                <div className="container-fluid">
                    {this.renderContent()}
                </div>
            </div>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);
    ReactDOM.render(<OsUpdates />, document.getElementById("app"));
});
