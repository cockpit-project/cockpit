/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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
import moment from "moment";
import * as python from "python.js";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import * as service from "service.js";
import * as PK from "packagekit.js";

import { client } from "./subscriptions-client";

import get_monotonic_start_py from "raw-loader!./get_monotonic_start.py";

const _ = cockpit.gettext;

moment.locale(cockpit.language);

const insights_timer = service.proxy("insights-client.timer", "Timer");
const insights_service = service.proxy("insights-client.service", "Service");

export function detect() {
    return cockpit.spawn([ "which", "insights-client" ], { err: "ignore" }).then(() => true, () => false);
}

function ensure_installed(update_progress) {
    return detect().then(installed => {
        if (!installed)
            return PK.check_missing_packages([ client.insightsPackage ], update_checking_progress(update_progress))
                    .then(data => {
                        if (data.unavailable_names.length > 0)
                            return Promise.reject(cockpit.format(_("The $0 package is not available from any repository."),
                                                                 data.unavailable_names[0]));
                        if (data.remove_names.length > 0)
                            return Promise.reject(cockpit.format(_("The system could not be connected to Insights because installing the $0 package requires the unexpected removal of other packages."),
                                                                 client.insightsPackage));
                        return PK.install_missing_packages(data, update_install_progress(update_progress));
                    });
        else
            return Promise.resolve();
    });
}

export function register(update_progress) {
    return ensure_installed(update_progress).then(() => {
        const proc = cockpit.spawn([ "insights-client", "--register" ], { superuser: true, err: "message" });
        if (update_progress)
            update_progress(_("Connecting to Insights"), () => { proc.close() });
        return proc;
    });
}

export function unregister() {
    if (insights_timer.enabled) {
        return cockpit.spawn([ "insights-client", "--unregister" ], { superuser: true, err: "message" });
    } else {
        return cockpit.resolve();
    }
}

export function fmt_to_fragments(fmt) {
    const args = Array.prototype.slice.call(arguments, 1);

    function replace(part) {
        if (part[0] == "$") {
            return args[parseInt(part.slice(1))];
        } else
            return part;
    }

    return React.createElement.apply(null, [ React.Fragment, { } ].concat(fmt.split(/(\$[0-9]+)/g).map(replace)));
}

function left(func) {
    return function (event) {
        if (!event || event.button !== 0)
            return;
        func();
        event.stopPropagation();
    };
}

export const blurb =
    _("Proactively identify and remediate threats to security, performance, availability, and stability with Red Hat Insights — with predictive analytics, avoid problems and unplanned downtime in your Red Hat environment.");

export const link =
    <a href="https://www.redhat.com/en/technologies/management/insights" target="_blank" rel="noopener">Red Hat Insights <i className="fa fa-external-link" /></a>;

function install_data_summary(data) {
    if (!data || data.missing_names.length == 0)
        return null;

    let summary;
    if (data.extra_names.length == 0)
        summary = fmt_to_fragments(_("The $0 package will be installed."), <strong>{data.missing_names[0]}</strong>);
    else
        summary = fmt_to_fragments(cockpit.ngettext(_("The $0 package and $1 other package will be installed."),
                                                    _("The $0 package and $1 other packages will be installed."),
                                                    data.extra_names.length), <strong>{data.missing_names[0]}</strong>, data.extra_names.length);
    if (data.remove_names.length > 0) {
        summary = <>
            {summary}
            <br />
            <span className="pficon pficon-warning-triangle-o" />{ "\n" }
            {cockpit.format(cockpit.ngettext(_("$0 package needs to be removed."),
                                             _("$0 packages need to be removed."),
                                             data.remove_names.length),
                            data.remove_names.length)}
        </>;
    }

    if (data.extra_names.length > 0 || data.remove_names.length > 0) {
        let extra_details = null;
        let remove_details = null;

        if (data.extra_names.length > 0)
            extra_details = (
                <div className="scale-up-ct">
                    {_("Additional packages:")}
                    <ul className="package-list-ct">{data.extra_names.map(id => <li key={id}>{id}</li>)}</ul>
                </div>
            );

        if (data.remove_names.length > 0)
            remove_details = (
                <div className="scale-up-ct">
                    {_("Removals:")}
                    <ul className="package-list">{data.remove_names.map(id => <li key={id}>{id}</li>)}</ul>
                </div>
            );

        summary = <><p>{summary}</p><Revealer summary={_("Details")}>{extra_details}{remove_details}</Revealer></>;
    }

    return summary;
}

function update_checking_progress(update_progress) {
    return p => {
        let pm = null;
        if (p.waiting)
            pm = _("Waiting for other software management operations to finish");
        else
            pm = _("Checking installed software");
        update_progress(pm, p.cancel);
    };
}

function update_install_progress(update_progress) {
    return p => {
        var text = null;
        if (p.waiting) {
            text = _("Waiting for other software management operations to finish");
        } else if (p.package) {
            var fmt;
            if (p.info == PK.Enum.INFO_DOWNLOADING)
                fmt = _("Downloading $0");
            else if (p.info == PK.Enum.INFO_REMOVING)
                fmt = _("Removing $0");
            else
                fmt = _("Installing $0");
            text = fmt_to_fragments(fmt, <strong>{p.package}</strong>);
        }
        update_progress(text, p.cancel);
    };
}

function show_connect_dialog() {
    let dialog = null;
    let cancel = null;
    let progress_message = null;
    let error_message = null;
    let checking_install = false;
    let install_data = null;

    function update() {
        const props = {
            title: _("Connect to Red Hat Insights"),
            body: (
                <div className="modal-body">
                    <strong>{fmt_to_fragments(_("This system is not connected to $0."), link)}</strong>
                    <p>{blurb}</p>
                    { install_data_summary(install_data) }
                </div>
            )
        };

        const footer = {
            actions: [
                {
                    caption: _("Connect"),
                    style: "primary",
                    clicked: (update_progress) => {
                        return PK.install_missing_packages(install_data, update_install_progress(update_progress)).then(() => register(update_progress));
                    },
                    disabled: checking_install,
                }
            ],
            idle_message: progress_message && <div><div className="spinner spinner-sm" /><span>{ progress_message }</span></div>,
            static_error: error_message,
            dialog_done: f => { if (!f && cancel) cancel(); }
        };

        if (dialog) {
            dialog.setProps(props);
            dialog.setFooterProps(footer);
        } else {
            dialog = show_modal_dialog(props, footer);
        }
    }

    update();
    return detect().then(installed => {
        if (!installed) {
            checking_install = true;
            update();
            PK.check_missing_packages([ client.insightsPackage ], p => {
                cancel = p.cancel;
                let pm = null;
                if (p.waiting)
                    pm = _("Waiting for other software management operations to finish");
                else
                    pm = _("Checking installed software");
                if (pm != progress_message) {
                    progress_message = pm;
                    update();
                }
            })
                    .then(data => {
                        if (data.unavailable_names.length > 0)
                            error_message = cockpit.format(_("The $0 package is not available from any repository."),
                                                           data.unavailable_names[0]);
                        else
                            install_data = data;
                        progress_message = null;
                        cancel = null;
                        checking_install = false;
                        update();
                    })
                    .catch(e => {
                        error_message = e.toString();
                        update();
                    });
        }
    });
}

class Revealer extends React.Component {
    constructor() {
        super();
        this.state = { revealed: false };
    }

    render() {
        return (
            <div>
                <a onClick={event => { if (event.button == 0) this.setState({ revealed: !this.state.revealed }); }}>
                    {this.props.summary}
                </a> <i className={this.state.revealed ? "fa fa-angle-down" : "fa fa-angle-right"} />
                <br />
                {this.state.revealed && this.props.children}
            </div>
        );
    }
}

const get_monotonic_start = python.spawn(get_monotonic_start_py).then(data => {
    return parseFloat(data);
});

function calc_next_elapse(monotonic_start, timer) {
    let next_mono = Infinity; let next_real = Infinity;
    if (monotonic_start) {
        if (timer.NextElapseUSecMonotonic)
            next_mono = timer.NextElapseUSecMonotonic / 1e6 + monotonic_start;
        if (timer.NextElapseUSecRealtime)
            next_real = timer.NextElapseUSecRealtime / 1e6;
    }
    let next = Math.min(next_mono, next_real);
    if (next !== Infinity)
        return moment(next * 1000).calendar();
    else
        return _("unknown");
}

function jump_to_service() {
    cockpit.jump("/system/services#/insights-client.service", cockpit.transport.host);
}

function jump_to_timer() {
    cockpit.jump("/system/services#/insights-client.timer", cockpit.transport.host);
}

function monitor_last_upload() {
    let self = {
        timestamp: 0,
        results: null,

        close: close
    };

    cockpit.event_target(self);

    let results_file = cockpit.file("/etc/insights-client/.last-upload.results", { syntax: JSON });
    results_file.watch(data => {
        self.results = data;
        cockpit.spawn([ "stat", "-c", "%Y", "/etc/insights-client/.last-upload.results" ], { err: "message" })
                .then(ts => {
                    self.timestamp = parseInt(ts);
                    self.dispatchEvent("changed");
                })
                .catch(() => {
                    self.timestamp = 0;
                    self.dispatchEvent("changed");
                });
    });

    function close() {
        results_file.close();
    }

    return self;
}

const last_upload_monitor = monitor_last_upload();

function show_status_dialog() {
    function show(monotonic_start) {
        let lastupload = last_upload_monitor.timestamp;
        let next_elapse = calc_next_elapse(monotonic_start, insights_timer.details);

        let failed_text = null;
        if (insights_service.unit.ActiveExitTimestamp &&
            insights_service.unit.ActiveExitTimestamp / 1e6 > lastupload) {
            lastupload = insights_service.unit.ActiveExitTimestamp / 1e6;
            failed_text = _("The last Insights data upload has failed.");
        }

        let dlg = show_modal_dialog(
            {
                title: _("Connected to Red Hat Insights"),
                body: (
                    <div className="modal-body">
                        <table>
                            <tbody>
                                <tr>
                                    <th style={{ textAlign: "right", paddingRight: "1em" }}>
                                        {_("Next Insights data upload")}
                                    </th>
                                    <td>{next_elapse}</td>
                                </tr>
                                { lastupload
                                    ? <tr>
                                        <th style={{ textAlign: "right", paddingRight: "1em" }}>
                                            {_("Last Insights data upload")}
                                        </th>
                                        <td>{moment(lastupload * 1000).calendar()}</td>
                                    </tr> : null
                                }
                            </tbody>
                        </table>
                        <br />
                        { insights_timer.state == "failed" &&
                        <div className="alert alert-warning">
                            <span className="pficon pficon-warning-triangle-o" />
                            {_("Next Insights data upload could not be scheduled.")}{" "}
                            <a onClick={left(jump_to_timer)}>{_("Details")}</a>
                        </div>
                        }
                        { insights_service.state == "failed" && failed_text &&
                            <div className="alert alert-warning">
                                <span className="pficon pficon-warning-triangle-o" />
                                {failed_text}{" "}
                                <a onClick={left(jump_to_service)}>{_("Details")}</a>
                            </div>
                        }
                        <Revealer summary={_("Disconnect from Insights")}>
                            <div className="alert alert-warning"
                                 style={{ "padding": "14px", "marginTop": "1ex", "marginBottom": "0px" }}>
                                <p>{_("If you disconnect this system from Insights, it will no longer report it's Insights status in Red Hat Cloud or Satellite.")}</p>
                                <br />
                                <button className="btn btn-danger" onClick={left(disconnect)}>
                                    {_("Disconnect from Insights")}
                                </button>
                            </div>
                        </Revealer>
                    </div>
                )
            },
            {
                cancel_caption: _("Close"),
                actions: [ ]
            }
        );

        function disconnect() {
            dlg.setFooterProps(
                {
                    cancel_caption: _("Cancel"),
                    actions: [ ],
                    idle_message: <div className="spinner spinner-sm" />
                });
            unregister().then(
                () => {
                    dlg.footerProps.dialog_done();
                },
                error => {
                    dlg.setFooterProps(
                        {
                            cancel_caption: _("Close"),
                            actions: [ ],
                            static_error: error.toString()
                        });
                });
        }
    }

    get_monotonic_start.then(show).catch(err => { console.warn(err); show(null) });
}

export class InsightsStatus extends React.Component {
    constructor() {
        super();
        this.state = { };
        this.on_changed = () => { this.setState({ }) };
    }

    componentDidMount() {
        insights_timer.addEventListener("changed", this.on_changed);
        insights_service.addEventListener("changed", this.on_changed);
        last_upload_monitor.addEventListener("changed", this.on_changed);
    }

    componentWillUnmount() {
        insights_timer.removeEventListener("changed", this.on_changed);
        insights_service.removeEventListener("changed", this.on_changed);
        last_upload_monitor.removeEventListener("changed", this.on_changed);
    }

    render() {
        let status;

        if (insights_timer.enabled) {
            let warn = (insights_service.state == "failed" &&
                        insights_service.unit.ActiveExitTimestamp &&
                        insights_service.unit.ActiveExitTimestamp / 1e6 > last_upload_monitor.timestamp);

            status = (
                <div style={{ display: "inline-block", verticalAlign: "top" }}>
                    <a onClick={left(show_status_dialog)}>{_("Connected to Insights")}</a>
                    { warn && <>{" "}<i className="pficon pficon-warning-triangle-o" /></> }
                    <br />
                    <a href="http://cloud.redhat.com/insights" target="_blank" rel="noopener">
                    View your Insights results <i className="fa fa-external-link" />
                    </a>
                </div>
            );
        } else {
            status = <a onClick={left(show_connect_dialog)}>{_("Not connected")}</a>;
        }

        return <div><label>Insights: {status}</label></div>;
    }
}
