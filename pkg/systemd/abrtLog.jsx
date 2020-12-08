/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import React from 'react';
import {
    Accordion, AccordionItem, AccordionContent, AccordionToggle,
    Card, CardActions, CardBody, CardHeader, CardTitle,
    Button, Tabs, Tab, GalleryItem
} from '@patternfly/react-core';

import { ReportingTable } from "./reporting.jsx";
import { journal } from "journal";

const _ = cockpit.gettext;

const Table = ({ lines, delimiter }) => {
    return (<table className="info-table-ct">
        <tbody>
            {lines.map((line, i) =>
                <tr key={i}>
                    {line.split(delimiter).map((cell, i) =>
                        <td key={i}>{(cell || "").trim()}</td>
                    )}
                </tr>)
            }
        </tbody>
    </table>);
};

function get_all_keys_from_frames(thread) {
    let all_keys = [];
    thread.forEach(t => { all_keys = all_keys.concat(Object.keys(t)) });
    const unique = [...new Set(all_keys)];

    const desired_ordered_of_keys = ['function_name', 'file_name', 'address', 'build_id', 'build_id_offset'];
    const all_ordered_keys = [];

    desired_ordered_of_keys.forEach(key => {
        if (unique.indexOf(key) !== -1)
            all_ordered_keys.push(key);
    });
    unique.forEach(key => {
        if (desired_ordered_of_keys.indexOf(key) === -1)
            all_ordered_keys.push(key);
    });

    return all_ordered_keys;
}

const CrashTable = ({ thread }) => {
    const all_keys = get_all_keys_from_frames(thread);

    return (<table className="info-table-ct">
        <thead>
            <tr>
                <th>{_("Frame number")}</th>
                {all_keys.map((key, i) => <th key={i}>{key.replace(/_/g, ' ')}</th>)}
            </tr>
        </thead>
        <tbody>
            {thread.map((frame, i) =>
                <tr key={i}>
                    <td>{i}</td>
                    {all_keys.map((key, i) => <td key={i}>{frame[key] || ""}</td>)}
                </tr>
            )}
        </tbody>
    </table>);
};

function render_table_eq(val) {
    const rows = val.split("\n");
    return <Table lines={rows} delimiter="=" />;
}

function render_table_co(val) {
    const rows = val.split("\n");
    return <Table lines={rows} delimiter=":" />;
}

function render_dso_list(val) {
    const rows = val.split("\n");
    return <Table lines={rows} delimiter=" " />;
}

function render_m(val) {
    const rows = val.replace(/  +/g, ':').split("\n");
    return <Table lines={rows} delimiter=" " />;
}

function render_limits(val) {
    const rows = val.split('\n').map(row => row.replace(/  +/g, ':'));
    return <Table lines={rows} delimiter=":" />;
}

function render_open_fds(val) {
    // File descriptor is described by 5 lines, in each, except the first one,
    // we want to create an empty first column
    const rows = val.split('\n').map((line, i) => {
        if (i % 5 !== 0)
            return ":" + line;
        return line;
    });
    return <Table lines={rows} delimiter=":" />;
}

function render_multiline(val) {
    return <span className="multiline">{val}</span>;
}

// ABRT details to ignore
const ignore_fields = ["journald_cursor", "cpuinfo"];

// A map of ABRT's problems items and it's callback for rendering
const problem_render_callbacks = {
    os_info: render_table_eq,
    environ: render_table_eq,
    cgroup: render_table_co,
    namespaces: render_table_co,
    maps: render_m,
    mountinfo: render_m,
    limits: render_limits,
    dso_list: render_dso_list,
    proc_pid_status: render_table_co,
    open_fds: render_open_fds,
    var_log_messages: render_multiline,
    'not-reportable': render_multiline,
    exploitable: render_multiline,
    suspend_stats: render_table_co,
    dmesg: render_multiline,
    container_rootfs: render_multiline,
    docker_inspect: render_multiline
};

export class AbrtLogDetails extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            active_acc: "",
            active_tab: "general",
            details: {},
            allThreads: false
        };

        this.handleSelect = this.handleSelect.bind(this);
        this.handleToggle = this.handleToggle.bind(this);
        this.onDelete = this.onDelete.bind(this);
        this.renderBacktrace = this.renderBacktrace.bind(this);
    }

    componentDidMount() {
        this.props.service.GetProblemData(this.props.problem.path).done(details => this.setState({ details: details }));
    }

    handleSelect(event, active_tab) {
        this.setState({ active_tab });
    }

    handleToggle(id) {
        if (id === this.state.active_acc)
            this.setState({ active_acc: '' });
        else
            this.setState({ active_acc: id });
    }

    onDelete(ev) {
        this.props.service.DeleteProblems([this.props.problem.path]);
        this.props.reloadProblems(ev);
    }

    renderBacktrace(val) {
        const content = [];
        const items = JSON.parse(val) || {};

        const threads = items.stacktrace;
        let crash_thread = null;
        const other_threads = [];
        Object.values(threads).forEach(thread => {
            if (thread.crash_thread && thread.frames)
                crash_thread = thread.frames;
            else if (thread.frames)
                other_threads.push(thread.frames);
        });

        delete items.stacktrace;
        const rows = Object.keys(items).map(k => k + ":" + items[k]);
        content.push(<Table key="info" lines={rows} delimiter=":" />);
        content.push(<CrashTable key="crash" thread={crash_thread} />);

        if (other_threads.length !== 0) {
            if (this.state.allThreads) {
                other_threads.forEach((thread, i) => {
                    content.push(<CrashTable key={i} thread={thread} />);
                });
            } else {
                content.push(<Button key="all-threads" variant="link" onClick={() => this.setState({ allThreads: true })}>{_("Show all threads")}</Button>);
            }
        }
        return content;
    }

    render() {
        const general = Object.keys(this.props.entry).filter(k => k !== 'MESSAGE' && k.indexOf('PROBLEM_') !== 0);
        general.sort();

        const detail_keys = Object.keys(problem_render_callbacks);
        detail_keys.push("core_backtrace");
        const info = Object.keys(this.state.details).filter(k => detail_keys.indexOf(k) < 0 && ignore_fields.indexOf(k) < 0);
        info.sort();

        const details = detail_keys.filter(d => this.state.details[d]);
        details.sort();

        return (
            <>
                <h1 id="entry-heading">{this.props.entry.PROBLEM_BINARY}</h1>
                <GalleryItem id="abrt-reporting">
                    <ReportingTable problem={this.props.problem} />
                </GalleryItem>
                <GalleryItem id="abrt-details">
                    <Card>
                        <CardHeader>
                            <CardActions>
                                <Button variant="danger" onClick={this.onDelete}>{_("Delete")}</Button>
                            </CardActions>
                            <CardTitle><h2>{_("Extended information")}</h2></CardTitle>
                        </CardHeader>
                        <CardBody>
                            <Tabs activeKey={this.state.active_tab} onSelect={this.handleSelect}>
                                <Tab eventKey="general" title={_("General")}>
                                    <table className="info-table-ct">
                                        <tbody>
                                            { general.map(key =>
                                                <tr key={key}>
                                                    <td>{key}</td>
                                                    <td>{journal.printable(this.props.entry[key])}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </Tab>
                                <Tab eventKey="info" title={_("Problem info")}>
                                    <table className="info-table-ct">
                                        <tbody>
                                            { info.map(key =>
                                                <tr key={key}>
                                                    <td>{key}</td>
                                                    <td>{journal.printable(this.state.details[key][2])}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </Tab>
                                <Tab eventKey="details" title={_("Problem details")}>
                                    <Accordion asDefinitionList>
                                        {details.map(d =>
                                            <AccordionItem key={d}>
                                                <AccordionToggle
                                                    onClick={() => this.handleToggle(d)}
                                                    isExpanded={this.state.active_acc === d}
                                                    id={d}
                                                >
                                                    {d}
                                                </AccordionToggle>
                                                <AccordionContent isHidden={this.state.active_acc !== d}>
                                                    { d === "core_backtrace"
                                                        ? this.renderBacktrace(this.state.details[d][2])
                                                        : problem_render_callbacks[d](this.state.details[d][2])
                                                    }
                                                </AccordionContent>
                                            </AccordionItem>
                                        )}
                                    </Accordion>
                                </Tab>
                            </Tabs>
                        </CardBody>
                    </Card>
                </GalleryItem>
            </>
        );
    }
}
