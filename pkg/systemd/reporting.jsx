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
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { ExternalLinkAltIcon } from "@patternfly/react-icons";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

import './reporting.scss';

const _ = cockpit.gettext;

const TaskState = Object.freeze({
    READY: 0,
    RUNNING: 1,
    COMPLETED: 2,
    ERROR: 3,
    CANCELED: 4,
});

const PromptType = Object.freeze({
    ASK: 0,
    ASK_YES_NO: 1,
    ASK_YES_NO_YESFOREVER: 2,
    ASK_YES_NO_SAVE: 3,
    ASK_PASSWORD: 4,
});

const ProblemState = Object.freeze({
    REPORTABLE: 0,
    REPORTING: 1,
    REPORTED: 2,
    UNREPORTABLE: 3,
});

const client = cockpit.dbus("org.freedesktop.problems", { superuser: "try" });

// For one-off fetches of properties to avoid setting up a cache for everything.
function get_problem_properties(problem) {
    function executor(resolve, reject) {
        client.wait().then(() => resolve(client));
    }

    return new Promise(executor)
            .then(() => client.call(problem,
                                    "org.freedesktop.DBus.Properties",
                                    "GetAll", ["org.freedesktop.Problems2.Entry"]));
}

class FAFWorkflowRow extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            problemState: ProblemState.REPORTABLE,
            process: null,
            reportLinks: [],
            message: "",
        };

        this._onCancelButtonClick = this._onCancelButtonClick.bind(this);
        this._onReportButtonClick = this._onReportButtonClick.bind(this);
        this.updateStatusFromBus = this.updateStatusFromBus.bind(this);

        this.updateStatusFromBus();
    }

    updateStatusFromBus() {
        get_problem_properties(this.props.problem.path)
                .catch(exception => {
                    this.setState({ problemState: ProblemState.UNREPORTABLE });

                    console.error(cockpit.format("Getting properties for problem $0 failed: $1", this.props.problem.path, exception));
                })
                .then((properties) => {
                    if (!properties) {
                        return;
                    }

                    if (!properties[0].CanBeReported.v) {
                        this.setState({ problemState: ProblemState.UNREPORTABLE });

                        return;
                    }

                    const reportLinks = [];
                    let reported = false;

                    for (const report of properties[0].Reports.v) {
                        if (report[0] === "ABRT Server") {
                            if ("URL" in report[1]) {
                                reportLinks.push(report[1].URL.v.v);
                            }
                            reported = true;
                        }
                    }

                    if (reported) {
                        this.setState({
                            problemState: ProblemState.REPORTED,
                            reportLinks,
                        });
                    }
                });
    }

    _onCancelButtonClick(event) {
        this.state.process.close("canceled");
    }

    _onReportButtonClick(event) {
        this.setState({ problemState: ProblemState.UNREPORTABLE });

        const process = cockpit.spawn(["reporter-ureport", "-d", this.props.problem.ID],
                                      {
                                          err: "out",
                                          superuser: "true",
                                      })
                .stream((data) => this.setState({ message: data, }))
                .then(() => this.setState({ problemState: ProblemState.REPORTED, }))
                .catch(exception => {
                    this.setState({ problemState: ProblemState.REPORTABLE, });

                    if (exception.exit_signal != null) {
                        console.error(cockpit.format("reporter-ureport was killed with signal $0", exception.exit_signal));
                    }
                })
                .finally(() => this.updateStatusFromBus());

        this.setState({
            problemState: ProblemState.REPORTING,
            process,
        });
    }

    render() {
        return <WorkflowRow label={_("Report to ABRT Analytics")}
                            message={this.state.message}
                            onCancelButtonClick={this._onCancelButtonClick}
                            onReportButtonClick={this._onReportButtonClick}
                            problemState={this.state.problemState}
                            reportLinks={this.state.reportLinks}
        />;
    }
}

class BusWorkflowRow extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            label: this.props.workflow[1],
            message: "",
            problemState: ProblemState.REPORTABLE,
            reportLinks: [],
            task: null,
        };

        this._createTask = this._createTask.bind(this);
        this._onCancelButtonClick = this._onCancelButtonClick.bind(this);
        this._onCreateTask = this._onCreateTask.bind(this);
        this._onReportButtonClick = this._onReportButtonClick.bind(this);
        this.updateStatusFromBus = this.updateStatusFromBus.bind(this);

        this.updateStatusFromBus();
    }

    _createTask(client) {
        return client.call("/org/freedesktop/reportd/Service",
                           "org.freedesktop.reportd.Service", "CreateTask",
                           [this.props.workflow[0], this.props.problem.path])
                .then(result => this._onCreateTask(result[0], client));
    }

    _onCancelButtonClick(event) {
        this.state.task.Cancel();
    }

    _onCreateTask(object_path, client) {
        const task_proxy = client.proxy("org.freedesktop.reportd.Task", object_path);

        task_proxy
                .wait()
                .then((object_path) => {
                    task_proxy.addEventListener("changed", (event, data) => {
                        switch (data.Status) {
                        case TaskState.RUNNING:
                            // To avoid a needless D-Bus round trip.
                            return;
                        case TaskState.CANCELED:
                            this.setState({ message: _("Reporting was canceled"), });
                            // falls through
                        case TaskState.ERROR:
                            this.setState({ problemState: ProblemState.REPORTABLE, });
                            break;
                        case TaskState.COMPLETED:
                            this.setState({ problemState: ProblemState.REPORTED, });
                            break;
                        default:
                            break;
                        }

                        this.updateStatusFromBus();
                    });
                    task_proxy.addEventListener("Prompt", (event, object_path, message, type) => {
                        this.setState({ message: _("Waiting for input…") });
                        const task_prompt = client.proxy("org.freedesktop.reportd.Task.Prompt", object_path);
                        const props = {
                            body: <p>{message}</p>,
                        };
                        const footerProps = {
                            actions: [],
                            cancel_clicked: () => {
                                task_proxy.Cancel();
                            },
                        };

                        switch (type) {
                        case PromptType.ASK:
                        case PromptType.ASK_PASSWORD:
                            props.body = (
                                <div>
                                    <p>{message}</p>
                                    <input className="full-width"
                                           ref={(input) => { this.input = input }}
                                           type={type == PromptType.ASK_PASSWORD ? "password" : "text"} />
                                </div>
                            );
                            footerProps.actions.push(
                                {
                                    caption: _("Send"),
                                    clicked: () => {
                                        return task_prompt.wait().then(() => {
                                            task_prompt.Input = this.input.value;
                                            task_prompt.Commit();
                                        });
                                    },
                                    style: "primary",
                                }
                            );
                            break;
                        case PromptType.ASK_YES_NO_YESFOREVER:
                        case PromptType.ASK_YES_NO:
                        case PromptType.ASK_YES_NO_SAVE:
                            footerProps.actions.push(
                                {
                                    caption: _("Yes"),
                                    clicked: () => {
                                        return task_prompt.wait().then(() => {
                                            task_prompt.Response = true;
                                            task_prompt.Commit();
                                        });
                                    },
                                },
                                {
                                    caption: _("No"),
                                    clicked: (callback) => {
                                        return task_prompt.wait().then(() => {
                                            task_prompt.Response = false;
                                            task_prompt.Commit();
                                        });
                                    },
                                },
                            );
                        }

                        show_modal_dialog(props, footerProps);
                    });
                    task_proxy.addEventListener("Progress", (event, message) => {
                        if (/^\.+$/.exec(message) === null) {
                            // abrt-retrace-client starts printing dots if the last message it receives is repeated
                            this.setState({ message, });
                        }
                    });

                    this.setState({ task: task_proxy, });

                    task_proxy.Start().catch(ex => {
                        /* GLib encodes errors for transport over the wire,
                         * but we don’t have a good way of decoding them without calling into GIO.
                         *
                         * https://developer-old.gnome.org/gio/stable/gio-GDBusError.html#g-dbus-error-encode-gerror
                         *
                         * 19 is G_IO_ERROR_CANCELLED. No need to handle user cancellations.
                         */
                        if (/Code19/.exec(ex.name) != null) {
                            return;
                        }

                        console.error(cockpit.format("reportd task for workflow $0 did not finish: $1", this.props.workflow[0], (ex.problem || ex.message)));
                        this.setState({ message: _("Reporting failed") });
                    });
                })
                .catch(ex => console.error(cockpit.format("Setting up a D-Bus proxy for $0 failed: $1", object_path, ex)));
    }

    _onReportButtonClick(event) {
        this.setState({ problemState: ProblemState.UNREPORTABLE });

        this.setState({
            message: _("Waiting to start…"),
            problemState: ProblemState.REPORTING,
        });

        this.props.client
                .wait()
                .catch(exception => console.error(cockpit.format("Channel for reportd D-Bus client closed: $0", exception.problem || exception.message)))
                .then(() => this._createTask(this.props.client))
                .catch(exception => {
                    const message = cockpit.format("reportd task could not be created: $0", (exception.problem || exception.message));

                    this.setState({
                        message,
                        problemState: ProblemState.REPORTABLE,
                    });
                    console.error(message);
                });
    }

    render() {
        return <WorkflowRow label={this.state.label}
                            message={this.state.message}
                            onCancelButtonClick={this._onCancelButtonClick}
                            onReportButtonClick={this._onReportButtonClick}
                            problemState={this.state.problemState}
                            reportLinks={this.state.reportLinks}
        />;
    }

    updateStatusFromBus() {
        const on_get_properties = properties => {
            if (!properties[0].CanBeReported.v) {
                this.setState({ problemState: ProblemState.UNREPORTABLE });

                return;
            }

            const reportLinks = [];
            let reported = false;

            for (const report of properties[0].Reports.v) {
                if (!("WORKFLOW" in report[1])) {
                    continue;
                }
                if (this.props.workflow[0] !== report[1].WORKFLOW.v.v) {
                    continue;
                }
                if (report[0] === "ABRT Server" || report[0] === "uReport") {
                    continue;
                }
                if ("URL" in report[1]) {
                    reportLinks.push(report[1].URL.v.v);
                }

                reported = true;
            }

            if (reported) {
                this.setState({
                    problemState: ProblemState.REPORTED,
                    reportLinks,
                });
            }
        };
        const on_get_properties_rejected = exception => {
            this.setState({ problemState: ProblemState.UNREPORTABLE });

            console.error(cockpit.format("Getting properties for problem $0 failed: $1", this.props.problem.path, exception));
        };

        get_problem_properties(this.props.problem.path).then(on_get_properties, on_get_properties_rejected);
    }
}

function WorkflowRow(props) {
    let status = props.message;

    if (props.problemState === ProblemState.REPORTED) {
        if (props.reportLinks.length === 1) {
            status = (
                <a href={props.reportLinks[0]} rel="noopener noreferrer" target="_blank">
                    <ExternalLinkAltIcon />{_("View report")}
                </a>
            );
        } else if (props.reportLinks.length > 1) {
            const reportLinks = props.reportLinks.map((reportLink, index) => [
                index > 0 && ", ",
                <a key={index.toString()} href={reportLink} rel="noopener noreferrer" target="_blank">
                    <ExternalLinkAltIcon /> {index + 1}
                </a>
            ]);
            status = <p>{_("Reports:")} {reportLinks}</p>;
        } else {
            status = _("Reported; no links available");
        }
    }

    let button = null;
    if (props.problemState === ProblemState.REPORTING) {
        button = (
            <Button key={"cancel_" + props.label}
                    variant="secondary"
                    onClick={props.onCancelButtonClick}>
                {_("Cancel")}
            </Button>
        );
    } else {
        button = (
            <Button key={"report_" + props.label}
                    variant="primary"
                    isDisabled={props.problemState !== ProblemState.REPORTABLE}
                    onClick={props.problemState === ProblemState.REPORTABLE ? props.onReportButtonClick : undefined}>
                {_("Report")}
            </Button>
        );
    }

    return (
        <Split hasGutter>
            <SplitItem>{props.label}</SplitItem>
            <SplitItem isFilled>
                {props.problemState === ProblemState.REPORTING && <Spinner size="md" /> }
                {status}
            </SplitItem>
            <SplitItem>{button}</SplitItem>
        </Split>
    );
}

const reportd_client = cockpit.dbus("org.freedesktop.reportd", { superuser: "try" });

export class ReportingTable extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            workflows: [],
        };

        reportd_client
                .wait()
                .then(() => this.getWorkflows(reportd_client),
                      exception => console.error(cockpit.format("Channel for reportd D-Bus client closed: $0", exception.problem || exception.message)));
    }

    getWorkflows(client) {
        client.call("/org/freedesktop/reportd/Service", "org.freedesktop.reportd.Service", "GetWorkflows", [this.props.problem.path])
                .then((args, options) => this.setState({ workflows: args[0] }),
                      exception => console.error(cockpit.format("Failed to get workflows for problem $0: $1", this.props.problem.path, (exception.problem || exception.message))));
    }

    render() {
        return (
            <Card>
                <CardTitle component="h2">{_("Crash reporting")}</CardTitle>
                <CardBody>
                    <FAFWorkflowRow problem={this.props.problem} />
                    {
                        this.state.workflows.map((workflow, index) => [
                            <BusWorkflowRow key={index.toString()}
                                            problem={this.props.problem}
                                            client={reportd_client}
                                            workflow={workflow} />
                        ])
                    }
                </CardBody>
            </Card>
        );
    }
}
