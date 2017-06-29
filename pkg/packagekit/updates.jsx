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

var dbus_pk = cockpit.dbus("org.freedesktop.PackageKit", {superuser: "try", "track": true});
var packageSummaries = {};

function pkTransaction() {
    var dfd = cockpit.defer();

    dbus_pk.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "CreateTransaction", [], {timeout: 5000})
        .done(result => {
            var transProxy = dbus_pk.proxy("org.freedesktop.PackageKit.Transaction", result[0]);
            transProxy.wait(() => dfd.resolve(transProxy));
        })
        .fail(ex => dfd.reject(ex));

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

function commaJoin(list) {
    return list.reduce((prev, cur) => [prev, ", ", cur])
}

function HeaderBar(props) {
    var num_updates = Object.keys(props.updates).length;
    var num_security = 0;
    var state;
    if (props.state == "available") {
        state = cockpit.ngettext("$0 update", "$0 updates", num_updates);
        for (var u in props.updates)
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
        actionButton = <button className="btn btn-default" onClick={() => props.onRefresh()} >{_("Check for updates")}</button>;
        if (props.timeSinceRefresh !== null) {
            lastChecked = (
                <span style={ {paddingRight: "3ex"} }>
                    {cockpit.format(_("Last checked: $0 ago"), moment.duration(props.timeSinceRefresh * 1000).humanize())}
                </span>
            );
        }
    } else if (props.state == "applying") {
        actionButton = <button className="btn btn-default" onClick={() => props.onCancel()} disabled={!props.allowCancel} >{_("Cancel")}</button>;
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

function UpdateItem(props) {
    const info = props.info;
    var bugs = null;
    var security_info = null;

    if (info.bug_urls && info.bug_urls.length) {
        // we assume a bug URL ends with a number; if not, show the complete URL
        bugs = commaJoin(info.bug_urls.map(u => <a rel="noopener" referrerpolicy="no-referrer" target="_blank" href={u}>{u.match(/[0-9]+$/) || u}</a>));
    }

    if (info.security) {
        security_info = (
            <p>
                <span className="fa fa-bug security-label"> </span>
                <span className="security-label-text">{_("Security Update") + (info.cve_urls.length ? ": " : "")}</span>
                {commaJoin(info.cve_urls.map(u => <a href={u} rel="noopener" referrerpolicy="no-referrer" target="_blank">{u.match(/[^/=]+$/)}</a>))}
            </p>
        );
    }

    return (
        <tbody>
            <tr className={"listing-ct-item" + (info.security ? " security" : "")}>
                <th>{commaJoin(props.pkgNames.map(n => (<Tooltip tip={packageSummaries[n]}><span>{n}</span></Tooltip>)))}</th>
                <td className="narrow">{info.version}</td>
                <td className="narrow">{bugs}</td>
                <td className="changelog">{security_info}{info.description}</td>
            </tr>
        </tbody>
    );
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
            {updates.map(id => <UpdateItem pkgNames={packageNames[id].sort()} info={props.updates[id]} />)}
        </table>
    );
}

class ApplyUpdates extends React.Component {
    constructor() {
        super();
        this.state = {percentage: 0, timeRemaining: null, curStatus: null, curPackage: null};
    }

    componentDidMount() {
        var transProxy = this.props.transaction;

        transProxy.addEventListener("Package", (event, info, packageId) => {
            var pfields = packageId.split(";");
            // info: see PK_STATUS_* at https://github.com/hughsie/PackageKit/blob/master/lib/packagekit-glib2/pk-enum.h
            this.setState({curPackage: pfields[0] + " " + pfields[1],
                           curStatus: info,
                           percentage: transProxy.Percentage <= 100 ? transProxy.Percentage : 0,
                           timeRemaining: transProxy.RemainingTime > 0 ? transProxy.RemainingTime : null});
        });
    }

    render() {
        var action;

        if (this.state.curPackage)
            action = (
                <span>
                    <strong>{PK_STATUS_STRINGS[this.state.curStatus || PK_STATUS_ENUM_UPDATE] || PK_STATUS_STRINGS[PK_STATUS_ENUM_UPDATE]}</strong>
                    &nbsp;{this.state.curPackage}
                </span>
            );
        else
            action = _("Initializing...");

        return (
            <div className="progress-main-view">
                <div className="progress-description">
                    <div className="spinner spinner-xs spinner-inline"></div>
                    {action}
                </div>
                <div className="progress progress-label-top-right">
                    <div className="progress-bar" role="progressbar" style={ {width: this.state.percentage + "%"} }>
                        {this.state.timeRemaining !== null ? <span>{moment.duration(this.state.timeRemaining * 1000).humanize()}</span> : null}
                    </div>
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
                <button className="btn btn-default" onClick={() => props.onIgnore()}>{_("Ignore")}</button>
                &nbsp;
                <button className="btn btn-primary" onClick={() => props.onRestart()}>{_("Restart Now")}</button>
            </div>
        </div>
    );
}

class OsUpdates extends React.Component {
    constructor() {
        super();
        this.state = {state: "loading", errorMessages: [], updates: {}, haveSecurity: false, timeSinceRefresh: null,
                      loadPercent: null, waiting: false, cockpitUpdate: false, allowCancel: null};
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
                let promises = transactions.map(transObj => dbus_pk.call(
                    transObj, "org.freedesktop.DBus.Properties", "Get",
                    ["org.freedesktop.PackageKit.Transaction", "Role"], {timeout: 5000}));

                cockpit.all(promises)
                    .done(roles => {
                        // any transaction with UPDATE_PACKAGES role?
                        for (let idx = 0; idx < roles.length; ++idx) {
                            if (roles[idx].v == PK_ROLE_ENUM_UPDATE_PACKAGES) {
                                var transProxy = dbus_pk.proxy("org.freedesktop.PackageKit.Transaction", transactions[idx]);
                                transProxy.wait(() => this.watchUpdates(transProxy));
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
        pkTransaction()
            .done(transProxy => {
                transProxy.addEventListener("UpdateDetail", (event, packageId, updates, obsoletes, vendor_urls,
                                                             bug_urls, cve_urls, restart, update_text, changelog
                                                             /* state, issued, updated */) => {
                    let u = this.state.updates[packageId];
                    u.vendor_urls = vendor_urls;
                    u.bug_urls = deduplicate(bug_urls);
                    u.description = this.formatDescription(update_text || changelog);
                    // many backends don"t support this; parse CVEs from description as a fallback
                    u.cve_urls = deduplicate(cve_urls && cve_urls.length > 0 ? cve_urls : parseCVEs(u.description));
                    if (u.cve_urls && u.cve_urls.length > 0)
                        u.security = true;
                    // u.restart = restart; // broken (always "1") at least in Fedora

                    this.setState({updates: this.state.updates, haveSecurity: this.state.haveSecurity || u.security});
                });

                transProxy.addEventListener("Finished", () => this.setState({state: "available"}));

                transProxy.addEventListener("ErrorCode", (event, code, details) => {
                    console.warn("UpdateDetail error:", code, details);
                    // still show available updates, with reduced detail
                    this.setState({state: "available"});
                });

                transProxy.GetUpdateDetail(pkg_ids)
                    .fail(ex => {
                        console.warn("GetUpdateDetail failed:", ex);
                        // still show available updates, with reduced detail
                        this.setState({state: "available"});
                    });
            });
    }

    loadUpdates() {
        var updates = {};
        var cockpitUpdate = false;

        pkTransaction()
            .done(transProxy => {
                transProxy.addEventListener("Package", (event, info, packageId, _summary) => {
                    let id_fields = packageId.split(";");
                    packageSummaries[id_fields[0]] = _summary;
                    updates[packageId] = {name: id_fields[0], version: id_fields[1], security: info == PK_INFO_ENUM_SECURITY};
                    if (id_fields[0] == "cockpit-ws")
                        cockpitUpdate = true;
                });

                transProxy.addEventListener("ErrorCode", (event, code, details) => {
                    this.state.errorMessages.push(details);
                    this.setState({state: "loadError"});
                });

                transProxy.addEventListener("changed", (event, data) => {
                    if ("Status" in data) {
                        let waiting = (data.Status == PK_STATUS_ENUM_WAIT || data.Status == PK_STATUS_ENUM_WAITING_FOR_LOCK);
                        if (waiting != this.state.waiting) {
                            // to avoid flicker, we only switch to "locked" after 1s, as we will get a WAIT state
                            // even if the package db is unlocked
                            if (waiting) {
                                this.setState({waiting: true});
                                window.setTimeout(() => {!this.state.waiting || this.setState({state: "locked"})}, 1000);
                            } else {
                                this.setState({state: "loading", waiting: false});
                            }
                        }
                    }
                });

                // when GetUpdates() finished, get the details for all packages
                transProxy.addEventListener("Finished", () => {
                    var pkg_ids = Object.keys(updates);
                    if (pkg_ids.length) {
                        this.setState({updates: updates, cockpitUpdate: cockpitUpdate});
                        this.loadUpdateDetails(pkg_ids);
                    } else {
                        this.setState({state: "uptodate"});
                    }
                });

                // read available updates; causes emission of Package and Error, doesn"t return anything by itself
                transProxy.GetUpdates(0)
                    .fail(this.handleLoadError);
            })
            .fail(ex => this.handleLoadError((ex.problem == "not-found") ? _("PackageKit is not installed") : ex));
    }

    initialLoadOrRefresh() {
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

    watchUpdates(transProxy) {
        this.setState({state: "applying", applyTransaction: transProxy, allowCancel: transProxy.AllowCancel});

        transProxy.addEventListener("ErrorCode", (event, code, details) => this.state.errorMessages.push(details));

        transProxy.addEventListener("Finished", (event, exit) => {
            this.setState({applyTransaction: null, allowCancel: null});

            if (exit == PK_EXIT_ENUM_SUCCESS)
                this.setState({state: "updateSuccess", haveSecurity: false, loadPercent: null});
            else if (exit == PK_EXIT_ENUM_CANCELLED) {
                this.setState({state: "loading", haveSecurity: false, loadPercent: null});
                this.loadUpdates();
            } else {
                // normally we get FAILED here with ErrorCodes; handle unexpected errors to allow for some debugging
                if (exit != PK_EXIT_ENUM_FAILED)
                    this.state.errorMessages.push(cockpit.format(_("PackageKit reported error code $0"), exit));
                this.setState({state: "updateError"});
            }
        });

        transProxy.addEventListener("changed", (event, data) => {
            if ("AllowCancel" in data)
                this.setState({allowCancel: data.AllowCancel});
        });

        // not working/being used in at least Fedora
        transProxy.addEventListener("RequireRestart", (event, type, packageId) => {
            console.log("update RequireRestart", type, packageId);
        });
    }

    applyUpdates(securityOnly) {
        pkTransaction()
            .done(transProxy =>  {
                this.watchUpdates(transProxy);

                var ids = Object.keys(this.state.updates);
                if (securityOnly)
                    ids = ids.filter(id => this.state.updates[id].security);

                // returns immediately without value
                transProxy.UpdatePackages(0, ids)
                          .fail(ex => {
                              this.state.errorMessages.push(ex.message);
                              this.setState({state: "updateError"});
                          });
            })
            // this Should Not Fail™, so don"t bother about the slightly mislabeled state here
            .fail(this.handleLoadError);
    }

    renderContent() {
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
                return (
                    <div>
                        <table width="100%">
                            <tr>
                                <td><h2>{_("Available Updates")}</h2></td>
                                <td className="text-right">
                                    { this.state.haveSecurity
                                      ? <button className="btn btn-default"
                                                 onClick={() => this.applyUpdates(true)}>
                                            {_("Install security updates")}
                                         </button>
                                      : null
                                    }
                                    &nbsp; &nbsp;
                                    <button className="btn btn-primary"
                                            onClick={() => this.applyUpdates(false)}>
                                        {_("Install all updates")}
                                    </button>
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
                    </div>
                );

            case "loadError":
            case "updateError":
                return this.state.errorMessages.map(m => <pre>{m}</pre>);

            case "applying":
                return <ApplyUpdates transaction={this.state.applyTransaction}/>

            case "updateSuccess":
                return <AskRestart onRestart={this.handleRestart} onIgnore={this.loadUpdates} />

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
                return (
                    <div className="blank-slate-pf">
                        <div className="blank-slate-pf-icon">
                            <span className="fa fa-check"></span>
                        </div>
                        <p>{_("System is up to date")}</p>
                    </div>);

            default:
                return null;
        }
    }

    handleRefresh() {
        this.setState({state: "refreshing", loadPercent: null});
        pkTransaction()
            .done(transProxy =>  {
                transProxy.addEventListener("ErrorCode", (event, code, details) => this.handleLoadError(details));
                transProxy.addEventListener("Finished", (event, exit) => {
                    if (exit == PK_EXIT_ENUM_SUCCESS) {
                        this.setState({timeSinceRefresh: 0});
                        this.loadUpdates();
                    } else {
                        this.setState({state: "loadError"});
                    }
                });

                transProxy.addEventListener("changed", (event, data) => {
                    if ("Percentage" in data && data.Percentage <= 100)
                        this.setState({loadPercent: data.Percentage});
                });

                transProxy.RefreshCache(true)
                    .fail(this.handleLoadError);
            })
            .fail(this.handleLoadError);
    }

    handleRestart() {
        this.setState({state: "restart"})
        // give the user a chance to actually read the message
        window.setTimeout(() => {
            cockpit.spawn(["shutdown", "--reboot", "now"], {superuser: true, err: "message"})
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
                           allowCancel={this.state.allowCancel} onCancel={() => this.state.applyTransaction.Cancel()} />
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
