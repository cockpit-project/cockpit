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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { ExternalLinkAltIcon } from "@patternfly/react-icons";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { useInit } from "hooks";

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

const FAFWorkflowRow = ({ problem }) => {
    const [problemState, setProblemState] = React.useState(ProblemState.REPORTABLE);
    const [process, setProcess] = React.useState(null);
    const [reportLinks, setReportLinks] = React.useState([]);
    const [message, setMessage] = React.useState("");

    const updateStatusFromBus = () => {
        get_problem_properties(problem.path)
                .catch(exception => {
                    setProblemState(ProblemState.UNREPORTABLE);
                    console.error(cockpit.format("Getting properties for problem $0 failed: $1", problem.path, exception));
                })
                .then((properties) => {
                    if (!properties) {
                        return;
                    }

                    if (!properties[0].CanBeReported.v) {
                        setProblemState(ProblemState.UNREPORTABLE);

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
                        setProblemState(ProblemState.REPORTED);
                        setReportLinks(reportLinks);
                    }
                });
    };

    useInit(() => {
        updateStatusFromBus();
    });

    const onCancelButtonClick = _event => process.close("canceled");

    const onReportButtonClick = _event => {
        setMessage(_("Waiting to start…"));
        setProblemState(ProblemState.UNREPORTABLE);
        const process = cockpit.spawn(["reporter-ureport", "-d", problem.ID],
                                      {
                                          err: "out",
                                          superuser: "require",
                                      })
                .stream((data) => setMessage(data))
                .then(() => setProblemState(ProblemState.REPORTED))
                .catch(exception => {
                    setProblemState(ProblemState.REPORTABLE);

                    if (exception.exit_signal != null) {
                        console.error(cockpit.format("reporter-ureport was killed with signal $0", exception.exit_signal));
                    }
                })
                .finally(() => updateStatusFromBus());

        setProblemState(ProblemState.REPORTING);
        setProcess(process);
    };

    return <WorkflowRow label={_("Report to ABRT Analytics")}
                        message={message}
                        onCancelButtonClick={onCancelButtonClick}
                        onReportButtonClick={onReportButtonClick}
                        problemState={problemState}
                        reportLinks={reportLinks}
    />;
};

const BusWorkflowRow = ({ problem, client, workflow }) => {
    const [message, setMessage] = React.useState("");
    const [problemState, setProblemState] = React.useState(ProblemState.REPORTABLE);
    const [reportLinks, setReportLinks] = React.useState([]);
    const [task, setTask] = React.useState(null);
    const label = workflow[1];
    const inputRef = React.createRef();

    const updateStatusFromBus = () => {
        const on_get_properties = properties => {
            if (!properties[0].CanBeReported.v) {
                setProblemState(ProblemState.UNREPORTABLE);
                return;
            }

            const reportLinks = [];
            let reported = false;

            for (const report of properties[0].Reports.v) {
                if (!("WORKFLOW" in report[1])) {
                    continue;
                }
                if (workflow[0] !== report[1].WORKFLOW.v.v) {
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
                setProblemState(ProblemState.REPORTED);
                setReportLinks(reportLinks);
            }
        };
        const on_get_properties_rejected = exception => {
            setProblemState(ProblemState.UNREPORTABLE);

            console.error(cockpit.format("Getting properties for problem $0 failed: $1", problem.path, exception));
        };

        get_problem_properties(problem.path).then(on_get_properties, on_get_properties_rejected);
    };

    useInit(() => {
        updateStatusFromBus();
    });

    const createTask = client => {
        return client.call("/org/freedesktop/reportd/Service",
                           "org.freedesktop.reportd.Service", "CreateTask",
                           [workflow[0], problem.path])
                .then(result => onCreateTask(result[0], client));
    };

    const onCancelButtonClick = _event => task.Cancel();

    const onCreateTask = (object_path, client) => {
        const task_proxy = client.proxy("org.freedesktop.reportd.Task", object_path);

        task_proxy
                .wait()
                .then((_object_path) => {
                    task_proxy.addEventListener("changed", (_event, data) => {
                        switch (data.Status) {
                        case TaskState.RUNNING:
                            // To avoid a needless D-Bus round trip.
                            return;
                        case TaskState.CANCELED:
                            setMessage(_("Reporting was canceled"));
                            // falls through
                        case TaskState.ERROR:
                            setProblemState(ProblemState.REPORTABLE);
                            break;
                        case TaskState.COMPLETED:
                            setProblemState(ProblemState.REPORTED);
                            break;
                        default:
                            break;
                        }

                        updateStatusFromBus();
                    });
                    task_proxy.addEventListener("Prompt", (_event, object_path, message, type) => {
                        setMessage(_("Waiting for input…"));
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
                                           ref={inputRef}
                                           type={type == PromptType.ASK_PASSWORD ? "password" : "text"} />
                                </div>
                            );
                            footerProps.actions.push(
                                {
                                    caption: _("Send"),
                                    clicked: () => {
                                        return task_prompt.wait().then(() => {
                                            task_prompt.Input = inputRef.current.value;
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
                    task_proxy.addEventListener("Progress", (_event, message) => {
                        if (/^\.+$/.exec(message) === null) {
                            // abrt-retrace-client starts printing dots if the last message it receives is repeated
                            setMessage(message);
                        }
                    });

                    setTask(task_proxy);
                    task_proxy.Start().catch(ex => {
                        /* GLib encodes errors for transport over the wire,
                         * but we don’t have a good way of decoding them without calling into GIO.
                         *
                         * https://docs.gtk.org/gio/type_func.DBusError.encode_gerror.html
                         *
                         * 19 is G_IO_ERROR_CANCELLED. No need to handle user cancellations.
                         */
                        if (/Code19/.exec(ex.name) != null) {
                            return;
                        }

                        console.error(cockpit.format("reportd task for workflow $0 did not finish: $1", workflow[0], (ex.problem || ex.message)));
                        setMessage(_("Reporting failed"));
                    });
                })
                .catch(ex => console.error(cockpit.format("Setting up a D-Bus proxy for $0 failed: $1", object_path, ex)));
    };

    const onReportButtonClick = (_event) => {
        setMessage(_("Waiting to start…"));
        setProblemState(ProblemState.REPORTING);

        client.wait()
                .catch(exception => console.error(cockpit.format("Channel for reportd D-Bus client closed: $0", exception.problem || exception.message)))
                .then(() => createTask(client))
                .catch(exception => {
                    const newMessage = cockpit.format("reportd task could not be created: $0", (exception.problem || exception.message));
                    setMessage(newMessage);
                    setProblemState(ProblemState.REPORTABLE);
                    console.error(newMessage);
                });
    };

    return <WorkflowRow label={label}
                        message={message}
                        onCancelButtonClick={onCancelButtonClick}
                        onReportButtonClick={onReportButtonClick}
                        problemState={problemState}
                        reportLinks={reportLinks}
    />;
};

const WorkflowRow = ({ message, problemState, reportLinks, label, onReportButtonClick, onCancelButtonClick }) => {
    let status = message;

    if (problemState === ProblemState.REPORTED) {
        if (reportLinks.length === 1) {
            status = (
                <a href={reportLinks[0]} rel="noopener noreferrer" target="_blank">
                    <ExternalLinkAltIcon />{_("View report")}
                </a>
            );
        } else if (reportLinks.length > 1) {
            const reportLinksComps = reportLinks.map((reportLink, index) => [
                index > 0 && ", ",
                <a key={index.toString()} href={reportLink} rel="noopener noreferrer" target="_blank">
                    <ExternalLinkAltIcon /> {index + 1}
                </a>
            ]);
            status = <p>{_("Reports:")} {reportLinksComps}</p>;
        } else {
            status = _("Reported; no links available");
        }
    }

    let button = null;
    if (problemState === ProblemState.REPORTING) {
        button = (
            <Button key={"cancel_" + label}
                    variant="secondary"
                    onClick={onCancelButtonClick}>
                {_("Cancel")}
            </Button>
        );
    } else {
        button = (
            <Button key={"report_" + label}
                    variant="primary"
                    isDisabled={problemState !== ProblemState.REPORTABLE}
                    onClick={problemState === ProblemState.REPORTABLE ? onReportButtonClick : undefined}>
                {_("Report")}
            </Button>
        );
    }

    return (
        <Split hasGutter>
            <SplitItem>{label}</SplitItem>
            {problemState === ProblemState.REPORTING && (
                <SplitItem>
                    <Spinner size="md" />
                </SplitItem>
            )}
            <SplitItem isFilled>{status}</SplitItem>
            <SplitItem>{button}</SplitItem>
        </Split>
    );
};

const reportd_client = cockpit.dbus("org.freedesktop.reportd", { superuser: "try" });

export const ReportingTable = ({ problem }) => {
    const [workflows, setWorkflows] = React.useState([]);

    useInit(() => {
        reportd_client
                .wait()
                .then(() => getWorkflows(reportd_client),
                      exception => console.error(cockpit.format("Channel for reportd D-Bus client closed: $0", exception.problem || exception.message)));
    });

    const getWorkflows = client => {
        client.call("/org/freedesktop/reportd/Service", "org.freedesktop.reportd.Service", "GetWorkflows", [problem.path])
                .then((args, _options) => setWorkflows(args[0]),
                      exception => console.error(cockpit.format("Failed to get workflows for problem $0: $1", problem.path, (exception.problem || exception.message))));
    };

    return (
        <Card>
            <CardTitle component="h2">{_("Crash reporting")}</CardTitle>
            <CardBody>
                <FAFWorkflowRow problem={problem} />
                {
                    workflows.map((workflow, index) => [
                        <BusWorkflowRow key={index.toString()}
                                        problem={problem}
                                        client={reportd_client}
                                        workflow={workflow} />
                    ])
                }
            </CardBody>
        </Card>
    );
};
