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
import { Accordion, AccordionContent, AccordionItem, AccordionToggle } from "@patternfly/react-core/dist/esm/components/Accordion/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Tab, Tabs } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";
import { GalleryItem } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";

import { ListingTable } from 'cockpit-components-table.jsx';
import { ReportingTable } from "./reporting.jsx";
import { journal } from "journal";

const _ = cockpit.gettext;

const Table = ({ lines, delimiter, type }) => {
    return (
        <DescriptionList className="pf-m-horizontal-on-sm">
            { lines.map((line, idx) => {
                const group = typeof line === 'string' ? line.split(delimiter) : line;
                const term = group.shift();

                return (
                    <DescriptionListGroup key={term + idx}>
                        <DescriptionListTerm>{typeof term === 'string' ? term.trim() : term}</DescriptionListTerm>
                        <DescriptionListDescription>{group.length > 1 ? group.join(" ") : group[0]}</DescriptionListDescription>
                    </DescriptionListGroup>
                );
            })}
        </DescriptionList>
    );
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

    return (
        <ListingTable
                gridBreakPoint='grid-lg'
                variant="compact"
                columns={[
                    { title: _("Frame number") },
                    ...all_keys.map((key, i) => key.replace(/_/g, ' ')),
                ]}
                rows={thread.map((frame, i) => { return { columns: [i, ...all_keys.map(key => frame[key] || "")] } })} />
    );
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

    return <ListingTable
                gridBreakPoint='grid-md'
                className="table-hide-labels"
                variant="compact"
                showHeader={false}
                columns={new Array(rows[0].split(" ").length)}
                rows={rows.map((row, i) => { return { columns: row.split(" ") } })}
    />;
}

function render_m(val) {
    const rows = val.replace(/  +/g, ':').split("\n");

    return <ListingTable
                gridBreakPoint='grid-md'
                className="table-hide-labels"
                variant="compact"
                showHeader={false}
                columns={new Array(rows[0].split(" ").length)}
                rows={rows.map((row, i) => { return { columns: row.split(" ") } })}
    />;
}

function render_cgroups(val) {
    const rows = val.split("\n");
    const columns = [_("Hierarchy ID"), _("Controller"), _("Path")];

    return <ListingTable
                gridBreakPoint='grid-lg'
                variant="compact"
                showHeader={false}
                columns={columns}
                rows={rows.map((row, i) => { return { columns: row.split(":") } })}
    />;
}

function render_limits(val) {
    const rows = val.split('\n').map(row => row.replace(/  +/g, ':'));
    const columns = rows.shift();

    return <ListingTable aria-label={_("Limits")}
                gridBreakPoint='grid-lg'
                variant="compact"
                columns={columns.split(":")}
                rows={rows.map((row, i) => { return { columns: row.split(":") } })}
    />;
}

function render_open_fds(val) {
    // File descriptor is described by 5 lines, in each, except the first one,
    // we want to create an empty first column
    const rows = [];
    let term;
    let value;
    val.split('\n').forEach((line, i) => {
        if (i % 5 == 0) {
            if (term !== undefined && value !== undefined)
                rows.push([term, <Stack key={term}>{value.map(itm => itm ? <StackItem key={itm}>{itm}</StackItem> : null)}</Stack>]);

            term = line.split(":")[0];
            value = [line.split(":")[1]];
        } else {
            value.push(line);
        }
    });

    if (term !== undefined && value !== undefined)
        rows.push([term, <Stack key={term}>{value.map(itm => <StackItem key={itm}>{itm}</StackItem>)}</Stack>]);

    return <Table lines={rows} />;
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
    cgroup: render_cgroups,
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
        this.props.service.GetProblemData(this.props.problem.path).done(details => this.setState({ details }));
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
        this.props.service.DeleteProblems([this.props.problem.path]).then(() => this.props.reloadProblems(ev));
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
                        <CardHeader actions={{ actions: <><Button variant="danger" onClick={this.onDelete}>{_("Delete")}</Button></> }}>

                            <CardTitle><h2>{_("Extended information")}</h2></CardTitle>
                        </CardHeader>
                        <CardBody>
                            <Tabs activeKey={this.state.active_tab} onSelect={this.handleSelect}>
                                <Tab eventKey="general" title={_("General")}>
                                    <Table lines={general.map(key => [key, journal.printable(this.props.entry[key], key)])} />
                                </Tab>
                                <Tab eventKey="info" title={_("Problem info")}>
                                    <Table lines={info.map(key => [key, journal.printable(this.state.details[key][2], key)])} />
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
