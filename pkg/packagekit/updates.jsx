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

var cockpit = require("cockpit");
var React = require("react");
var moment = require("moment");
var Tooltip = require("cockpit-components-tooltip.jsx").Tooltip;
require("listing.less");

import AutoUpdates from "./autoupdates.jsx";

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
}

// see https://github.com/hughsie/PackageKit/blob/master/lib/packagekit-glib2/pk-enum.h
const PK_EXIT_ENUM_SUCCESS = 1;
const PK_EXIT_ENUM_FAILED = 2;
const PK_EXIT_ENUM_CANCELLED = 3;
const PK_ROLE_ENUM_REFRESH_CACHE = 13;
const PK_ROLE_ENUM_UPDATE_PACKAGES = 22;
const PK_INFO_ENUM_SECURITY = 8;
const PK_STATUS_ENUM_WAIT = 1;
const PK_STATUS_ENUM_UPDATE = 10;
const PK_STATUS_ENUM_WAITING_FOR_LOCK = 30;

const PK_STATUS_STRINGS = {
    8: _("Downloading"),
    9: _("Installing"),
    10: _("Updating"),
    11: _("Setting up"),
    14: _("Verifying"),
}

const PK_STATUS_LOG_STRINGS = {
    8: _("Downloaded"),
    9: _("Installed"),
    10: _("Updated"),
    11: _("Set up"),
    14: _("Verified"),
}

const transactionInterface = "org.freedesktop.PackageKit.Transaction";

// possible Red Hat subscription manager status values:
// https://github.com/candlepin/subscription-manager/blob/30c3b52320c3e73ebd7435b4fc8b0b6319985d19/src/rhsm_icon/rhsm_icon.c#L98
// we accept RHSM_VALID(0), RHN_CLASSIC(3), and RHSM_PARTIALLY_VALID(4)
const validSubscriptionStates = [0, 3, 4];

var dbus_pk = cockpit.dbus("org.freedesktop.PackageKit", { superuser: "try", "track": true });
var packageSummaries = {};

function pkWatchTransaction(transactionPath, signalHandlers, notifyHandler) {
    var subscriptions = [];

    for (let handler in signalHandlers) {
        subscriptions.push(dbus_pk.subscribe({ interface: transactionInterface, path: transactionPath, member: handler },
                           (path, iface, signal, args) => signalHandlers[handler](...args)));
    }

    if (notifyHandler) {
        subscriptions.push(dbus_pk.watch(transactionPath));
        dbus_pk.addEventListener("notify", reply => {
            if (transactionPath in reply.detail && transactionInterface in reply.detail[transactionPath])
                notifyHandler(reply.detail[transactionPath][transactionInterface]);
        });
    }

    // unsubscribe when transaction finished
    subscriptions.push(dbus_pk.subscribe({ interface: transactionInterface, path: transactionPath, member: "Finished" },
        () => subscriptions.map(s => s.remove())));
}

function pkTransaction(method, arglist, signalHandlers, notifyHandler, failHandler) {
    var dfd = cockpit.defer();

    dbus_pk.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "CreateTransaction", [], {timeout: 5000})
        .done(result => {
            let transactionPath = result[0];
            dfd.resolve(transactionPath);
            pkWatchTransaction(transactionPath, signalHandlers, notifyHandler);
            dbus_pk.call(transactionPath, transactionInterface, method, arglist)
                .fail(ex => failHandler(ex));
        })
        .fail(ex => failHandler(ex));

    return dfd.promise();
}

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
    list.forEach(i => {if (i) d[i] = true});
    var result = Object.keys(d);
    result.sort();
    return result;
}

// Insert comma strings in between elements of the list. Unlike list.join(",")
// this does not stringify the elements, which we need to keep as JSX objects.
function insertCommas(list) {
    return list.reduce((prev, cur) => [prev, ", ", cur])
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
            <div>
                <div className="expander-title">
                    <hr />
                    <span onClick={() => this.setState({expanded: !this.state.expanded})} >
                        <i className={cls} />{title}
                    </span>
                    <hr />
                </div>
                {this.state.expanded ? this.props.children : null}
            </div>);
    }
}

function HeaderBar(props) {
    var num_updates = Object.keys(props.updates).length;
    var num_security = 0;
    var state;

    // unregistered & no available updates → blank slate, no header bar
    if (props.unregistered && props.state == "uptodate")
        return null;

    if (props.state == "available") {
        state = cockpit.ngettext("$0 update", "$0 updates", num_updates);
        for (let u in props.updates)
            if (props.updates[u].security)
                ++num_security;
        if (num_security > 0)
            state += cockpit.ngettext(", including $1 security fix", ", including $1 security fixes",  num_security);
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
        if (props.timeSinceRefresh !== null) {
            lastChecked = (
                <span style={ {paddingRight: "3ex"} }>
                    { cockpit.format(_("Last checked: $0 ago"), moment.duration(props.timeSinceRefresh * 1000).humanize()) }
                </span>
            );
        }
    } else if (props.state == "applying") {
        actionButton = <button className="btn btn-default" onClick={props.onCancel} disabled={!props.allowCancel} >{_("Cancel")}</button>;
    }

    return (
        <div className="content-header-extra">
            <table width="100%">
                <tr>
                    <td id="state">{state}</td>
                    <td className="text-right">{lastChecked} {actionButton}</td>
                </tr>
            </table>
        </div>
    );
}

class UpdateItem extends React.Component {
    constructor() {
        super();
        this.state = {expanded: false};
    }

    render() {
        const info = this.props.info;
        var bugs = null;
        var security_info = null;

        if (info.bug_urls && info.bug_urls.length) {
            // we assume a bug URL ends with a number; if not, show the complete URL
            bugs = insertCommas(info.bug_urls.map(url => (
                <a rel="noopener" referrerpolicy="no-referrer" target="_blank" href={url}>
                    {url.match(/[0-9]+$/) || url}
                </a>)
            ));
        }

        if (info.security) {
            security_info = (
                <p>
                    <span className="fa fa-shield security-label">&nbsp;</span>
                    <span className="security-label-text">{ _("Security Update") + (info.cve_urls.length ? ": " : "") }</span>
                    { insertCommas(info.cve_urls.map(url => (
                        <a href={url} rel="noopener" referrerpolicy="no-referrer" target="_blank">
                            {url.match(/[^/=]+$/)}
                        </a>)
                      )) }
                </p>
            );
        }

        /* truncate long package list by default */
        var pkgList = this.props.pkgNames.map(n => (<Tooltip tip={packageSummaries[n]}><span>{n}</span></Tooltip>));
        var pkgs;
        if (!this.state.expanded && pkgList.length > 15) {
            pkgs = (
                <div onClick={ () => this.setState({expanded: true}) }>
                    {insertCommas(pkgList.slice(0, 15))}
                    <a className="info-expander">{ cockpit.format(_("$0 more…"), pkgList.length - 15) }</a>
                </div>);
        } else {
            pkgs = insertCommas(pkgList);
        }

        /* truncate long description by default */
        var descLines = (info.description || "").trim().split("\n");
        var desc;
        if (!this.state.expanded && descLines.length > 7) {
            desc = (
                <div onClick={ () => this.setState({expanded: true}) }>
                    {descLines.slice(0, 6).join("\n") + "\n"}
                    <a>{_("More information…")}</a>
                </div>);
        } else {
            desc = info.description;
        }

        return (
            <tbody>
                <tr className={ "listing-ct-item" + (info.security ? " security" : "") }>
                    <th>{pkgs}</th>
                    <td className="narrow">{info.version}</td>
                    <td className="narrow">{bugs}</td>
                    <td className="changelog">{security_info}{desc}</td>
                </tr>
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
        if (props.updates[a].security && !props.updates[b].security)
            return -1;
        if (!props.updates[a].security && props.updates[b].security)
            return 1;
        return a.localeCompare(b);
    });

    return (
        <table className="listing-ct">
            <thead>
                <tr>
                    <th>{_("Name")}</th>
                    <th>{_("Version")}</th>
                    <th>{_("Bugs")}</th>
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
        <div>
            <p>{formatHeading(pkgs["_time"])}</p>
            <ul className='flow-list'>{formatPkgs(pkgs)}</ul>
        </div>
    ));

    return <div>{paragraphs}</div>;
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

        pkWatchTransaction(transactionPath, {
            Package: (info, packageId) => {
                let pfields = packageId.split(";");

                // small timeout to avoid excessive overlaps from the next PackageKit progress signal
                dbus_pk.call(transactionPath, "org.freedesktop.DBus.Properties", "GetAll", [transactionInterface], {timeout: 500})
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
                <span>
                    <strong>{ PK_STATUS_STRINGS[lastAction.status] || PK_STATUS_STRINGS[PK_STATUS_ENUM_UPDATE] }</strong>
                    &nbsp;{lastAction.package}
                </span>);
            logRows = this.state.actions.slice(0, -1).map(action => (
                <tr>
                    <th>{PK_STATUS_LOG_STRINGS[action.status] || PK_STATUS_LOG_STRINGS[PK_STATUS_ENUM_UPDATE]}</th>
                    <td>{action.package}</td>
                </tr>));
        } else {
            actionHTML = _("Initializing...");
        }

        return (
            <div>
                <div className="progress-main-view">
                    <div className="progress-description">
                        <div className="spinner spinner-xs spinner-inline"></div>
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
            </div>
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
        this.state = { state: "loading", errorMessages: [], updates: {}, haveSecurity: false, timeSinceRefresh: null,
                       loadPercent: null, waiting: false, cockpitUpdate: false, allowCancel: null,
                       history: null, unregistered: false, autoUpdatesEnabled: null };
        this.handleLoadError = this.handleLoadError.bind(this);
        this.handleRefresh = this.handleRefresh.bind(this);
        this.handleRestart = this.handleRestart.bind(this);
        this.loadUpdates = this.loadUpdates.bind(this);
    }

    componentDidMount() {
        // check if there is an upgrade in progress already; if so, switch to "applying" state right away
        dbus_pk.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTransactionList", [], {timeout: 5000})
            .done(result => {
                let transactions = result[0];
                let promises = transactions.map(transactionPath => dbus_pk.call(
                    transactionPath, "org.freedesktop.DBus.Properties", "Get", [transactionInterface, "Role"], {timeout: 5000}));

                cockpit.all(promises)
                    .done(roles => {
                        // any transaction with UPDATE_PACKAGES role?
                        for (let idx = 0; idx < roles.length; ++idx) {
                            if (roles[idx].v === PK_ROLE_ENUM_UPDATE_PACKAGES) {
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

            });

        dbus_pk.addEventListener("close", (event, ex) => {
            console.log("close:", event, ex);
            var err;
            if (ex.problem == "not-found")
                err = _("PackageKit is not installed")
            else
                err = _("PackageKit crashed");
            if (this.state.state == "loading" || this.state.state == "refreshing") {
                this.handleLoadError(err);
            } else if (this.state.state == "applying") {
                this.state.errorMessages.push(err);
                this.setState({state: "updateError"});
            } else {
                console.log("PackageKit went away in state", this.state.state);
            }
        });
    }

    handleLoadError(ex) {
        this.state.errorMessages.push(ex.message || ex);
        this.setState({state: "loadError"});
    }

    formatDescription(text) {
        // on Debian they start with "== version ==" which is redundant; we
        // don"t want Markdown headings in the table
        return text.trim().replace(/^== .* ==\n/, "").trim();
    }

    loadUpdateDetails(pkg_ids) {
        pkTransaction("GetUpdateDetail", [pkg_ids], {
                UpdateDetail: (packageId, updates, obsoletes, vendor_urls, bug_urls, cve_urls, restart,
                               update_text, changelog /* state, issued, updated */) => {
                    let u = this.state.updates[packageId];
                    u.vendor_urls = vendor_urls;
                    u.bug_urls = deduplicate(bug_urls);
                    u.description = this.formatDescription(update_text || changelog);
                    // many backends don"t support this; parse CVEs from description as a fallback
                    u.cve_urls = deduplicate(cve_urls && cve_urls.length > 0 ? cve_urls : parseCVEs(u.description));
                    if (u.cve_urls && u.cve_urls.length > 0)
                        u.security = true;
                    // u.restart = restart; // broken (always "1") at least in Fedora

                    this.setState({ updates: this.state.updates, haveSecurity: this.state.haveSecurity || u.security });
                },

                Finished: () => this.setState({state: "available"}),

                ErrorCode: (code, details) => {
                    console.warn("UpdateDetail error:", code, details);
                    // still show available updates, with reduced detail
                    this.setState({state: "available"});
                }
            },
            null,
            ex => {
                console.warn("GetUpdateDetail failed:", ex);
                // still show available updates, with reduced detail
                this.setState({state: "available"});
            });
    }

    loadUpdates() {
        var updates = {};
        var cockpitUpdate = false;

        pkTransaction("GetUpdates", [0], {
                Package: (info, packageId, _summary) => {
                    let id_fields = packageId.split(";");
                    packageSummaries[id_fields[0]] = _summary;
                    updates[packageId] = { name: id_fields[0], version: id_fields[1], security: info === PK_INFO_ENUM_SECURITY };
                    if (id_fields[0] == "cockpit-ws")
                        cockpitUpdate = true;
                },

                ErrorCode: (code, details) => {
                    this.state.errorMessages.push(details);
                    this.setState({state: "loadError"});
                },

                // when GetUpdates() finished, get the details for all packages
                Finished: () => {
                    let pkg_ids = Object.keys(updates);
                    if (pkg_ids.length) {
                        this.setState({ updates: updates, cockpitUpdate: cockpitUpdate });
                        this.loadUpdateDetails(pkg_ids);
                    } else {
                        this.setState({state: "uptodate"});
                    }
                    this.loadHistory();
                },

            },  // end pkTransaction signalHandlers

            notify => {
                if ("Status" in notify) {
                    let waiting = (notify.Status === PK_STATUS_ENUM_WAIT || notify.Status === PK_STATUS_ENUM_WAITING_FOR_LOCK);
                    if (waiting != this.state.waiting) {
                        // to avoid flicker, we only switch to "locked" after 1s, as we will get a WAIT state
                        // even if the package db is unlocked
                        if (waiting) {
                            this.setState({waiting: true});
                            window.setTimeout(() => { !this.state.waiting || this.setState({state: "locked"}) }, 1000);
                        } else {
                            this.setState({ state: "loading", waiting: false });
                        }
                    }
                }
            },

            ex => this.handleLoadError((ex.problem == "not-found") ? _("PackageKit is not installed") : ex));
    }

    loadHistory() {
        let history = [];

        // would be nice to filter only for "update-packages" role, but can't here
        pkTransaction("GetOldTransactions", [0], {
                Transaction: (objPath, timeSpec, succeeded, role, duration, data) => {
                    if (role !== PK_ROLE_ENUM_UPDATE_PACKAGES)
                        return;
                    // data looks like:
                    // downloading	bash-completion;1:2.6-1.fc26;noarch;updates-testing
                    // updating	bash-completion;1:2.6-1.fc26;noarch;updates-testing
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
                        this.setState({history: history})
                }
            },
            null,
            ex => console.warn("Failed to load old transactions:", ex)
        );
    }

    watchRedHatSubscription() {
        // check if this is an unregistered RHEL system; if subscription-manager is not installed, ignore
        var sm = cockpit.dbus("com.redhat.SubscriptionManager");
        sm.subscribe(
            { path: "/EntitlementStatus",
              interface: "com.redhat.SubscriptionManager.EntitlementStatus",
              member: "entitlement_status_changed"
            },
            (path, iface, signal, args) => this.setState({ unregistered: validSubscriptionStates.indexOf(args[0]) < 0 })
        );
        sm.call(
            "/EntitlementStatus", "com.redhat.SubscriptionManager.EntitlementStatus", "check_status")
            .done(result => this.setState({ unregistered: validSubscriptionStates.indexOf(result[0]) < 0 }) )
            .fail(ex => {
                if (ex.problem != "not-found")
                    console.warn("Failed to query RHEL subscription status:", ex);
            }
        );
    }

    initialLoadOrRefresh() {
        this.watchRedHatSubscription();

        dbus_pk.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "GetTimeSinceAction",
                     [PK_ROLE_ENUM_REFRESH_CACHE], {timeout: 5000})
            .done(seconds => {
                this.setState({timeSinceRefresh: seconds});

                // automatically trigger refresh for ≥ 1 day or if never refreshed
                if (seconds >= 24 * 3600 || seconds < 0)
                    this.handleRefresh();
                else
                    this.loadUpdates();

            })
            .fail(ex => this.handleLoadError((ex.problem == "not-found") ? _("PackageKit is not installed") : ex));
    }

    watchUpdates(transactionPath) {
        this.setState({ state: "applying", applyTransaction: transactionPath, allowCancel: false });

        dbus_pk.call(transactionPath, "DBus.Properties", "Get", [transactionInterface, "AllowCancel"])
            .done(reply => this.setState({ allowCancel: reply[0].v }));

        pkWatchTransaction(transactionPath,
            {
                ErrorCode: (code, details) => this.state.errorMessages.push(details),

                Finished: exit => {
                    this.setState({ applyTransaction: null, allowCancel: null });

                    if (exit === PK_EXIT_ENUM_SUCCESS) {
                        this.setState({ state: "updateSuccess", haveSecurity: false, loadPercent: null });
                    } else if (exit === PK_EXIT_ENUM_CANCELLED) {
                        this.setState({ state: "loading", loadPercent: null });
                        this.loadUpdates();
                    } else {
                        // normally we get FAILED here with ErrorCodes; handle unexpected errors to allow for some debugging
                        if (exit !== PK_EXIT_ENUM_FAILED)
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
            });
    }

    applyUpdates(securityOnly) {
        var ids = Object.keys(this.state.updates);
        if (securityOnly)
            ids = ids.filter(id => this.state.updates[id].security);

        pkTransaction("UpdatePackages", [0, ids], {}, null, ex => {
                // We get more useful error messages through ErrorCode or "PackageKit has crashed", so only
                // show this if we don't have anything else
                if (this.state.errorMessages.length === 0)
                    this.state.errorMessages.push(ex.message);
                this.setState({state: "updateError"});
            })
            .done(transactionPath => this.watchUpdates(transactionPath));
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
                                <div className="progress-bar" role="progressbar" style={ {width: this.state.loadPercent + "%"} }></div>
                            </div>
                        </div>
                    );
                else
                    return <div className="spinner spinner-lg progress-main-view" />;

            case "available":
                // when unregistered, hide the Apply buttons and show a warning
                if (this.state.unregistered) {
                    unregisteredWarning = (
                        <div>
                            <h2>{ _("Unregistered System") }</h2>
                            <div className="alert alert-warning">
                                <span className="pficon pficon-warning-triangle-o"></span>
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
                        </div>);
                } else {
                    applyAll = (
                        <button className="btn btn-primary" onClick={ () => this.applyUpdates(false) }>
                            {_("Install All Updates")}
                        </button>);

                    if (this.state.haveSecurity) {
                        applySecurity = (
                            <button className="btn btn-default" onClick={ () => this.applyUpdates(true) }>
                                {_("Install Security Updates")}
                            </button>);
                    }
                }

                return (
                    <div>
                        {unregisteredWarning}
                        <AutoUpdates onInitialized={ enabled => this.setState({ autoUpdatesEnabled: enabled }) } />
                        <table id="available" width="100%">
                            <tr>
                                <td><h2>{_("Available Updates")}</h2></td>
                                <td className="text-right">
                                    {applySecurity}
                                    &nbsp; &nbsp;
                                    {applyAll}
                                </td>
                            </tr>
                        </table>
                        { this.state.cockpitUpdate
                          ? <div className="alert alert-warning">
                                <span className="pficon pficon-warning-triangle-o"></span>
                                <span>
                                    <strong>{_("Cockpit itself will be updated.")}</strong>
                                    &nbsp;
                                    {_("When you get disconnected, the updates will continue in the background. You can reconnect and resume watching the update progress.")}
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
                return <ApplyUpdates transaction={this.state.applyTransaction}/>

            case "updateSuccess":
                this.loadHistory();
                return <AskRestart onRestart={this.handleRestart} onIgnore={this.loadUpdates} history={this.state.history} />;

            case "restart":
                return (
                    <div className="blank-slate-pf">
                        <div class="blank-slate-pf-icon">
                            <div className="spinner spinner-lg"></div>
                        </div>
                        <h1>{_("Restarting")}</h1>
                        <p>{_("Your server will close the connection soon. You can reconnect after it has restarted.")}</p>
                    </div>);

            case "uptodate":
                if (this.state.unregistered) {
                    return (
                        <div className="blank-slate-pf">
                            <div className="blank-slate-pf-icon">
                                <span className="fa fa-exclamation-circle"></span>
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
                    <div>
                        <AutoUpdates onInitialized={ enabled => this.setState({ autoUpdatesEnabled: enabled }) } />
                        <div className="blank-slate-pf">
                            <div className="blank-slate-pf-icon">
                                <span className="fa fa-check"></span>
                            </div>
                            <p>{_("System is up to date")}</p>

                            { this.state.history && !this.state.autoUpdatesEnabled
                                ? <div className="flow-list-blank-slate"><UpdateHistory history={this.state.history} limit="1" /></div>
                                : null }
                        </div>
                    </div>);

            default:
                return null;
        }
    }

    handleRefresh() {
        this.setState({ state: "refreshing", loadPercent: null });
        pkTransaction("RefreshCache", [true], {
                ErrorCode: (code, details) => this.handleLoadError(details),

                Finished: exit => {
                    if (exit === PK_EXIT_ENUM_SUCCESS) {
                        this.setState({timeSinceRefresh: 0});
                        this.loadUpdates();
                    } else {
                        this.setState({state: "loadError"});
                    }
                },
            },

            notify => {
                if ("Percentage" in notify && notify.Percentage <= 100)
                    this.setState({loadPercent: notify.Percentage});
            },

            this.handleLoadError);
    }

    handleRestart() {
        this.setState({state: "restart"})
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
                           onCancel={ () => dbus_pk.call(this.state.applyTransaction, transactionInterface, "Cancel", []) } />
                <div className="container-fluid">
                    {this.renderContent()}
                </div>
            </div>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);
    React.render(<OsUpdates />, document.getElementById("app"));
});
