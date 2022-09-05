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

import React, { useState } from 'react';

import {
    Alert,
    Breadcrumb, BreadcrumbItem,
    Button,
    Card, CardTitle, CardBody, CardHeader, Gallery,
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
    Flex, FlexItem,
    Grid, GridItem,
    Modal,
    Page, PageSection, PageSectionVariants,
    Popover,
    Progress, ProgressVariant,
    Select, SelectOption,
    Switch,
    Text, TextContent, TextVariants,
    Tooltip,
} from '@patternfly/react-core';
import { Table, TableHeader, TableBody, TableGridBreakpoint, TableVariant, TableText, RowWrapper, cellWidth } from '@patternfly/react-table';
import { ExclamationTriangleIcon, ExclamationCircleIcon, CogIcon, ExternalLinkAltIcon } from '@patternfly/react-icons';

import cockpit from 'cockpit';
import * as machine_info from "../lib/machine-info.js";
import * as packagekit from "packagekit.js";
import * as service from "service";
import * as timeformat from "timeformat";
import { superuser } from "superuser";
import { journal } from "journal";
import { useObject, useEvent, useInit } from "hooks.js";
import { WithDialogs, useDialogs } from "dialogs.jsx";

import { EmptyStatePanel } from "../lib/cockpit-components-empty-state.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { JournalOutput } from "cockpit-components-logs-panel.jsx";
import { install_dialog } from "cockpit-components-install-dialog.jsx";
import { ModalError } from "cockpit-components-inline-notification.jsx";
import { FirewalldRequest } from "cockpit-components-firewalld-request.jsx";
import "journal.css";

const MSEC_PER_H = 3600000;
const INTERVAL = 5000;
const SAMPLES_PER_H = MSEC_PER_H / INTERVAL;
const SAMPLES_PER_MIN = SAMPLES_PER_H / 60;
const SVG_YMAX = (SAMPLES_PER_MIN - 1).toString();
const LOAD_HOURS = 12;
const _ = cockpit.gettext;

// format Date as YYYY-MM-DD HH:mm:ss UTC which is human friendly and systemd compatible
const formatUTC_ISO = t => `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()} ${t.getUTCHours()}:${t.getUTCMinutes()}:${t.getUTCSeconds()} UTC`;

// podman's containers cgroup
const podmanCgroupRe = /libpod-(?<containerid>[a-z|0-9]{64})\.scope$/;
// cgroup userid
const useridCgroupRe = /user-(?<userid>\d+).slice/;

// keep track of maximum values for unbounded data, so that we can normalize it properly
// pre-init them to avoid inflating noise
let scaleSatCPU = 4;
let scaleUseDisks = 10000; // KB/s
let scaleUseNetwork = 100000; // B/s

let numCpu = 1;
let memTotal; // bytes
let swapTotal; // bytes, can be undefined

const machine_info_promise = machine_info.cpu_ram_info();
machine_info_promise.then(info => {
    numCpu = info.cpus;
    memTotal = info.memory;
    swapTotal = info.swap;
});

// round up to the nearest number that has all zeroes except for the first digit
// avoids over-aggressive scaling, but needs scaling more often
const scaleForValue = x => {
    const scale = Math.pow(10, Math.floor(Math.log10(x)));
    // this can be tweaked towards "less rescaling" with an additional scalar, like "x * 1.5 / scale"
    return Math.ceil(x / scale) * scale;
};

const RESOURCES = {
    use_cpu: {
        name: _("CPU usage"),
        event_description: _("CPU spike"),
        // all in msec/s
        normalize: ([nice, user, sys]) => (nice + user + sys) / 1000 / numCpu,
        format: ([nice, user, sys]) => `${_("nice")}: ${Math.round(nice / 10)}%, ${_("user")}: ${Math.round(user / 10)}%, ${_("sys")}: ${Math.round(sys / 10)}%`,
    },
    sat_cpu: {
        name: _("Load"),
        event_description: _("Load spike"),
        // unitless, unbounded, dynamic scaling for normalization
        normalize: load => Math.min(load, scaleSatCPU) / scaleSatCPU,
        format: load => cockpit.format_number(load),
    },
    use_memory: {
        name: _("Memory usage"),
        event_description: _("Memory spike"),
        // assume used == total - available
        normalize: ([totalKiB, availKiB]) => 1 - (availKiB / totalKiB),
        format: ([totalKiB, availKiB]) => `${cockpit.format_bytes((totalKiB - availKiB) * 1024)} / ${cockpit.format_bytes(totalKiB * 1024)}`,
    },
    sat_memory: {
        name: _("Swap out"),
        event_description: _("Swap"),
        // page/s, unbounded, and mostly 0; just categorize into "nothing" (most of the time),
        // "a little" (< 1000 pages), and "a lot" (> 1000 pages)
        normalize: swapout => swapout > 1000 ? 1 : (swapout > 1 ? 0.3 : 0),
        format: swapout => cockpit.format(cockpit.ngettext("$0 page", "$0 pages", Math.floor(swapout)), Math.floor(swapout)),
    },
    use_disks: {
        name: _("Disk I/O"),
        event_description: _("Disk I/O spike"),
        // KiB/s, unbounded, dynamic scaling for normalization
        normalize: KiBps => KiBps / scaleUseDisks,
        format: KiBps => cockpit.format_bytes_per_sec(KiBps * 1024),
    },
    use_network: {
        name: _("Network I/O"),
        event_description: _("Network I/O spike"),
        // B/s, unbounded, dynamic scaling for normalization
        normalize: bps => bps / scaleUseNetwork,
        format: bps => cockpit.format_bytes_per_sec(bps),
    },
};

const CURRENT_METRICS = [
    { name: "cpu.basic.user", derive: "rate" },
    { name: "cpu.basic.system", derive: "rate" },
    { name: "cpu.basic.nice", derive: "rate" },
    { name: "memory.used" },
    { name: "memory.swap-used" },
    { name: "disk.all.read", units: "bytes", derive: "rate" },
    { name: "disk.all.written", units: "bytes", derive: "rate" },
    { name: "network.interface.rx", units: "bytes", derive: "rate" },
    { name: "network.interface.tx", units: "bytes", derive: "rate" },
    { name: "cgroup.cpu.usage", derive: "rate" },
    { name: "cgroup.memory.usage" },
    { name: "cpu.core.user", derive: "rate" },
    { name: "cpu.core.system", derive: "rate" },
    { name: "cpu.core.nice", derive: "rate" },
];

const CPU_TEMPERATURE_METRICS = [
    { name: "cpu.temperature" },
];

const HISTORY_METRICS = [
    // CPU utilization
    { name: "kernel.all.cpu.nice", derive: "rate" },
    { name: "kernel.all.cpu.user", derive: "rate" },
    { name: "kernel.all.cpu.sys", derive: "rate" },

    // CPU saturation
    { name: "kernel.all.load" },

    // memory utilization (unit: KiB)
    { name: "mem.physmem" },
    // mem.util.used is useless, it includes cache (unit: KiB)
    { name: "mem.util.available" },

    // memory saturation
    { name: "swap.pagesout", derive: "rate" },

    // disk utilization; despite the name, the unit is in KiB! (pminfo -d -F disk.all.total_bytes)
    { name: "disk.all.total_bytes", derive: "rate" },

    // network utilization
    { name: "network.interface.total.bytes", derive: "rate", "omit-instances": ["lo"] },
];

function debug() {
    if (window.debugging == "all" || window.debugging == "metrics")
        console.debug.apply(console, arguments);
}

// metrics channel samples are compressed, see
// https://github.com/cockpit-project/cockpit/blob/main/doc/protocol.md#payload-metrics1
// samples is the compressed metrics channel value, state the last valid values (initialize once to empty array)
function decompress_samples(samples, state) {
    samples.forEach((sample, i) => {
        if (sample instanceof Array) {
            if (!state[i]) // uninitialized, create empty array
                state[i] = [];
            sample.forEach((inst, k) => {
                if (typeof inst === 'number')
                    state[i][k] = inst;
            });
        } else if (typeof sample === 'number') {
            state[i] = sample;
        }
    });
}

class CurrentMetrics extends React.Component {
    constructor(props) {
        super(props);

        this.metrics_channel = null;
        this.temperature_channel = null;
        this.samples = [];
        this.temperatureSamples = [];
        this.netInterfacesNames = [];
        this.cgroupCPUNames = [];
        this.cgroupMemoryNames = [];
        this.cpuTemperatureColors = {
            textColor: "",
            iconColor: "",
            icon: null,
        };

        this.state = {
            userid: null,
            memUsed: 0, // bytes
            swapUsed: null, // bytes
            cpuUsed: 0, // percentage
            cpuCoresUsed: [], // [ percentage ]
            cpuTemperature: NaN, // degree Celsius
            loadAvg: null, // [ 1min, 5min, 15min ]
            disksRead: 0, // B/s
            disksWritten: 0, // B/s
            mounts: [], // [{ target (string), use (percent), avail (bytes) }]
            netInterfacesRx: [],
            netInterfacesTx: [],
            topServicesCPU: [], // [ { name, percent } ]
            topServicesMemory: [], // [ { name, bytes } ]
            podNameMapping: {}, // { uid -> containerid -> name }
        };

        this.onVisibilityChange = this.onVisibilityChange.bind(this);
        this.onMetricsUpdate = this.onMetricsUpdate.bind(this);
        this.onTemperatureUpdate = this.onTemperatureUpdate.bind(this);
        this.updateMounts = this.updateMounts.bind(this);
        this.updateLoad = this.updateLoad.bind(this);

        cockpit.addEventListener("visibilitychange", this.onVisibilityChange);
        this.onVisibilityChange();

        // regularly update info about filesystems
        this.updateMounts();

        // there is no internal metrics channel for load yet; see https://github.com/cockpit-project/cockpit/pull/14510
        this.updateLoad();
    }

    componentDidMount() {
        superuser.addEventListener("changed", () => this.setState({ podNameMapping: {} }));
        cockpit.user().then(user => this.setState({ userid: user.id }));
    }

    onVisibilityChange() {
        if (cockpit.hidden && this.temperature_channel !== null) {
            this.temperature_channel.removeEventListener("message", this.onTemperatureUpdate);
            this.temperature_channel.close();
            this.temperature_channel = null;
        }

        if (cockpit.hidden && this.metrics_channel !== null) {
            this.metrics_channel.removeEventListener("message", this.onMetricsUpdate);
            this.metrics_channel.close();
            this.metrics_channel = null;
            return;
        }

        if (!cockpit.hidden && (this.temperature_channel === null)) {
            this.temperature_channel = cockpit.channel({ payload: "metrics1", source: "internal", interval: 3000, metrics: CPU_TEMPERATURE_METRICS });
            this.temperature_channel.addEventListener("close", (ev, error) => console.error("CPU temperature metric closed:", error));
            this.temperature_channel.addEventListener("message", this.onTemperatureUpdate);
        }

        if (!cockpit.hidden && this.metrics_channel === null) {
            this.metrics_channel = cockpit.channel({ payload: "metrics1", source: "internal", interval: 3000, metrics: CURRENT_METRICS });
            this.metrics_channel.addEventListener("message", this.onMetricsUpdate);
        }
    }

    /* Return Set of mount points which should not be shown in Disks card */
    hideMounts(procMounts) {
        const result = new Set();
        procMounts.trim().split("\n")
                .forEach(line => {
                    // looks like this: /dev/loop1 /var/mnt iso9660 ro,relatime,nojoliet,check=s,map=n,blocksize=2048 0 0
                    const fields = line.split(' ');
                    const options = fields[3].split(',');

                    /* hide read-only loop mounts; these are often things like snaps or iso images
                     * which are always at 100% capacity, but are uninteresting for disk usage alerts */
                    if ((fields[0].indexOf("/loop") >= 0 && options.indexOf('ro') >= 0))
                        result.add(fields[1]);
                });
        return result;
    }

    updateMounts() {
        Promise.all([
            /* df often exits with non-zero if it encounters any filesystem it can't read;
               but that's fine, get info about all the others */
            cockpit.script("df --local --exclude-type=tmpfs --exclude-type=devtmpfs --block-size=1 --output=target,size,avail,pcent || true",
                           { err: "message" }),
            cockpit.file("/proc/mounts").read()
        ])
                .then(([df_out, mounts_out]) => {
                    const hide = this.hideMounts(mounts_out);

                    // skip first line with the headings
                    const mounts = [];
                    df_out.trim()
                            .split("\n")
                            .slice(1)
                            .forEach(s => {
                                const fields = s.split(/ +/);
                                if (fields.length != 4) {
                                    console.warn("Invalid line in df:", s);
                                    return;
                                }

                                if (hide.has(fields[0]))
                                    return;
                                mounts.push({
                                    target: fields[0],
                                    size: Number(fields[1]),
                                    avail: Number(fields[2]),
                                    use: Number(fields[3].slice(0, -1)), /* strip off '%' */
                                });
                            });

                    debug("df parsing done:", JSON.stringify(mounts));
                    this.setState({ mounts });

                    // update it again regularly
                    window.setTimeout(this.updateMounts, 10000);
                })
                .catch(ex => {
                    console.warn("Failed to run df or read /proc/mounts:", ex.toString());
                    this.setState({ mounts: [] });
                });
    }

    updateLoad() {
        cockpit.file("/proc/loadavg").read()
                .then(content => {
                    // format: three load averages, then process counters; e.g.: 0.67 1.00 0.78 2/725 87151
                    this.setState({ loadAvg: content.split(' ').slice(0, 3) });
                    // update it again regularly
                    window.setTimeout(this.updateLoad, 5000);
                })
                .catch(ex => {
                    console.warn("Failed to read /proc/loadavg:", ex.toString());
                    this.setState({ loadAvg: null });
                });
    }

    onTemperatureUpdate(event, message) {
        debug("current CPU temperature  message", message);
        const data = JSON.parse(message);

        if (!Array.isArray(data)) {
            return;
        }

        data.forEach(temperatureSamples => decompress_samples(temperatureSamples, this.temperatureSamples));

        this.cpuTemperature = parseInt(Math.max(...this.temperatureSamples[0]));

        if (this.cpuTemperature <= 80) {
            this.cpuTemperatureColors.textColor = "";
            this.cpuTemperatureColors.iconColor = "";
            this.cpuTemperatureColors.icon = null;
        } else if (this.cpuTemperature < 95) {
            this.cpuTemperatureColors.textColor = "text-color-warning";
            this.cpuTemperatureColors.iconColor = "icon-color-warning";
            this.cpuTemperatureColors.icon = <ExclamationTriangleIcon />;
        } else {
            this.cpuTemperatureColors.textColor = "text-color-critical";
            this.cpuTemperatureColors.iconColor = "icon-color-critical";
            this.cpuTemperatureColors.icon = <ExclamationCircleIcon />;
        }
    }

    onMetricsUpdate(event, message) {
        debug("current metrics message", message);
        const data = JSON.parse(message);

        // reset state on meta messages
        if (!Array.isArray(data)) {
            this.samples = [];
            console.assert(data.metrics[7].name === 'network.interface.rx');
            this.netInterfacesNames = data.metrics[7].instances.slice();
            console.assert(data.metrics[9].name === 'cgroup.cpu.usage');
            this.cgroupCPUNames = data.metrics[9].instances.slice();
            this.cgroupMemoryNames = data.metrics[10].instances.slice();
            debug("metrics message was meta, new net instance names", JSON.stringify(this.netInterfacesNames));
            return;
        }

        data.forEach(samples => decompress_samples(samples, this.samples));

        const newState = {};
        // CPU metrics are in ms/s; divide by 10 to get percentage
        if (typeof this.samples[0] === 'number') {
            const cpu = Math.round((this.samples[0] + this.samples[1] + this.samples[2]) / 10 / numCpu);
            newState.cpuUsed = cpu;
        }

        newState.memUsed = this.samples[3];
        newState.swapUsed = this.samples[4];

        if (typeof this.samples[5] === 'number')
            newState.disksRead = this.samples[5];
        if (typeof this.samples[6] === 'number')
            newState.disksWritten = this.samples[6];

        newState.netInterfacesRx = this.samples[7];
        newState.netInterfacesTx = this.samples[8];

        // Collect CPU cores
        newState.cpuCoresUsed = [];
        if (this.samples[11] && this.samples[11].length == this.samples[12].length && this.samples[12].length == this.samples[13].length) {
            for (let i = 0; i < this.samples[11].length; i++) {
                // CPU cores metrics are in ms/s; divide by 10 to get percentage
                newState.cpuCoresUsed[i] = Math.round((this.samples[11][i] + this.samples[12][i] + this.samples[13][i]) / 10);
            }
        }

        // return [ { [key, value, is_user, is_container, userid | cgroup] } ] list of the biggest n values
        const n_biggest = (names, values, n) => {
            const merged = [];
            names.forEach((k, i) => {
                const v = values[i];
                // filter out invalid values, the empty (root) cgroup, non-services
                if (k.endsWith('.service') && typeof v === 'number' && v != 0) {
                    const is_user = k.match(/^user.*user@\d+\.service.+/);
                    const label = k.replace(/.*\//, '').replace(/\.service$/, '');
                    // only keep cgroup basenames, and drop redundant .service suffix
                    merged.push([label, v, is_user, false, k]);
                }
                // filter out podman containers, but only for the logged in
                // user or root user if the user is privileged. Other users
                // containers will show up under the user@uid cgroup
                const matches = k.match(podmanCgroupRe);
                if (matches && v) {
                    let is_user = false;
                    let uid = 0;
                    const containerid = matches.groups.containerid;
                    const umatches = k.match(useridCgroupRe);
                    if (umatches) {
                        is_user = true;
                        uid = parseInt(umatches.groups.userid);
                    }

                    if (uid === 0 || this.state.userid == uid) {
                        merged.push([containerid, v, is_user, true, uid]);
                    }
                }
            });
            merged.sort((a, b) => b[1] - a[1]);
            return merged.slice(0, n);
        };

        const getCachedPodName = (uid, containerid) => this.state.podNameMapping[uid] && this.state.podNameMapping[uid][containerid];

        function cgroupClickHandler(name, is_user, is_container, uid) {
            if (is_container) {
                const container_name = getCachedPodName(uid, name);
                if (container_name) {
                    cockpit.jump("/podman#/?name=" + container_name);
                } else {
                    cockpit.jump("/podman");
                }
            } else {
                cockpit.jump("/system/services#/" + name + ".service" + (is_user ? "?owner=user" : ""));
            }
        }

        function cgroupRow(name, value, is_user, is_container, uid) {
            const podman_installed = cockpit.manifests && cockpit.manifests.podman;
            let name_text = (
                <Button variant="link" isInline component="a" key={name}
                        onClick={() => cgroupClickHandler(name, is_user, is_container, uid)}
                        isDisabled={is_container && !podman_installed}>
                    <TableText wrapModifier="truncate">
                        {is_container ? _("pod") + " " + (getCachedPodName(uid, name) || name.substr(0, 12)) : name}
                    </TableText>
                </Button>
            );
            if (is_container && !podman_installed) {
                name_text = (
                    <Tooltip content={_("cockpit-podman is not installed")} key={name + "_tooltip"}>
                        <div>
                            {name_text}
                        </div>
                    </Tooltip>);
            }
            const value_text = <TableText wrapModifier="nowrap">{value}</TableText>;
            return {
                cells: [{ title: name_text }, { title: value_text }]
            };
        }

        // top 5 CPU and memory consuming systemd units
        const topServicesCPU = n_biggest(this.cgroupCPUNames, this.samples[9], 5);
        newState.topServicesCPU = topServicesCPU.map(
            ([key, value, is_user, is_container, userid]) => cgroupRow(key, Number(value / 10 / numCpu).toFixed(1), is_user, is_container, userid) // usec/s → percent
        );

        const topServicesMemory = n_biggest(this.cgroupMemoryNames, this.samples[10], 5);
        newState.topServicesMemory = topServicesMemory.map(
            ([key, value, is_user, is_container, userid]) => cgroupRow(key, cockpit.format_bytes(value), is_user, is_container)
        );

        const notMappedContainers = topServicesMemory.concat(topServicesCPU).filter(([key, value, is_user, is_container, userid]) => is_container && getCachedPodName(userid, key) === undefined);
        if (notMappedContainers.length !== 0) {
            this.update_podman_name_mapping(notMappedContainers);
        }
        this.setState(newState);
    }

    /**
     * Look up the container names using podman ps for the given cgroups.
     */
    update_podman_name_mapping = cgroups => {
        // New mapping state
        const podNameMapping = {};

        const promises = cgroups.map(([containerid, value, is_user, is_container, userid]) => {
            if (!(userid in podNameMapping)) {
                podNameMapping[userid] = {};
            }
            // Always initialize the cache for when we hit an error.
            podNameMapping[userid][containerid] = null;

            if ((userid === 0 && !superuser.allowed) && userid !== this.state.userid) {
                return null;
            }
            return cockpit.spawn(["podman", "ps", "--format", "json"], { superuser: userid === 0 ? "required" : null })
                    .then(result => [result, userid]);
        }).filter(prom => prom !== null);

        Promise.all(promises).then(results => {
            for (const [output, uid] of results) {
                try {
                    const containers = JSON.parse(output);
                    for (const container of containers) {
                        podNameMapping[uid][container.Id] = container.Names[0];
                    }
                } catch (err) {
                    console.error("podman ps outputs invalid JSON", err.toString());
                }
            }
        })
                .catch(err => console.error("could not obtain podman names:", err))
                .finally(() => this.setState({ podNameMapping: { ...this.state.podNameMapping, ...podNameMapping } }));
    }

    render() {
        const memUsedFraction = memTotal ? this.state.memUsed / memTotal : 0;
        const memAvail = memTotal ? (memTotal - this.state.memUsed) : 0;
        const num_cpu_str = cockpit.format(cockpit.ngettext("$0 CPU", "$0 CPUs", numCpu), numCpu);
        const have_storage = cockpit.manifests && cockpit.manifests.storage;

        const netIO = this.netInterfacesNames.map((iface, i) => [
            iface,
            this.state.netInterfacesRx[i] >= 1 ? cockpit.format_bytes_per_sec(this.state.netInterfacesRx[i]) : "0",
            this.state.netInterfacesTx[i] >= 1 ? cockpit.format_bytes_per_sec(this.state.netInterfacesTx[i]) : "0",
        ]);

        let swapProgress;

        if (swapTotal) {
            const swapUsedFraction = this.state.swapUsed / swapTotal;
            const swapAvail = swapTotal - this.state.swapUsed;
            swapProgress = (
                <Tooltip content={ cockpit.format(_("$0 total"), cockpit.format_bytes(swapTotal)) } position="bottom">
                    <Progress
                        id="current-swap-usage"
                        title={ _("Swap") }
                        value={this.state.swapUsed}
                        className="pf-m-sm"
                        min={0} max={swapTotal}
                        variant={swapUsedFraction > 0.9 ? ProgressVariant.danger : null}
                        label={ cockpit.format(_("$0 available"), cockpit.format_bytes(swapAvail)) } />
                </Tooltip>);
        }

        let cores = null;
        let topCore = null;
        let allCpus = null;
        let cpu_label = null;
        if (this.state.cpuCoresUsed.length > 1) {
            const top_cores = this.state.cpuCoresUsed.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1])
                    .slice(0, 16);
            cores = (<Grid className='cpu-all' component='dl'>
                {top_cores.map(c =>
                    <React.Fragment key={c[0]}>
                        <GridItem component='dt'>{ cockpit.format(_("Core $0"), c[0]) }</GridItem>
                        <GridItem component='dd'>{c[1]}%</GridItem>
                    </React.Fragment>)
                }
            </Grid>);

            cpu_label = (
                <Flex spaceItems={{ default: 'spaceItemsNone' }} justifyContent={{ default: 'justifyContentFlexEnd' }}>
                    <FlexItem>&nbsp;{ cockpit.format(_("average: $0%"), this.state.cpuUsed) }</FlexItem>
                    <FlexItem>&nbsp;{ cockpit.format(_("max: $0%"), top_cores[0][1]) }</FlexItem>
                </Flex>);

            topCore = <Progress
                           aria-label={_("Current top CPU usage")}
                           id="current-top-cpu-usage"
                           value={top_cores[0][1]}
                           className="pf-m-sm"
                           min={0} max={100}
                           variant={ top_cores[0][1] > 90 ? ProgressVariant.danger : ProgressVariant.info }
                           measureLocation="none" />;

            allCpus = (
                <Popover minWidth={0} aria-label={ _("View all CPUs") } bodyContent={cores}>
                    <Button variant="link" className='pf-u-font-size-sm'>{ _("View all CPUs") }</Button>
                </Popover>);
        } else {
            cpu_label = this.state.cpuUsed + '%';
        }

        return (
            <Gallery className="current-metrics" hasGutter>
                <Card id="current-metrics-card-cpu">
                    <CardHeader className='align-baseline'>
                        <CardTitle>{ _("CPU") }</CardTitle>
                        { !isNaN(this.cpuTemperature) &&
                        <span className="temperature">
                            <span className={this.cpuTemperatureColors.iconColor}>
                                {this.cpuTemperatureColors.icon}
                            </span>
                            &nbsp;
                            <span className={this.cpuTemperatureColors.textColor}>
                                { cockpit.format("$0 °C", this.cpuTemperature) }
                            </span>
                        </span> }
                    </CardHeader>
                    <CardBody>
                        <div className="progress-stack-no-space">
                            <Progress
                                id="current-cpu-usage"
                                value={this.state.cpuUsed}
                                className="pf-m-sm"
                                min={0} max={100}
                                variant={ this.state.cpuUsed > 90 ? ProgressVariant.danger : null }
                                title={ num_cpu_str }
                                label={ cpu_label } />
                            {topCore}
                            {allCpus}
                        </div>

                        { this.state.loadAvg &&
                            <DescriptionList className="pf-m-horizontal-on-sm">
                                <DescriptionListGroup>
                                    <DescriptionListTerm>{ _("Load") }</DescriptionListTerm>
                                    <DescriptionListDescription id="load-avg">
                                        <Flex spaceItems={{ default: 'spaceItemsXs' }}>
                                            <FlexItem>{ _("1 min") }:&nbsp;{ this.state.loadAvg[0] },</FlexItem>
                                            <FlexItem>{ _("5 min") }:&nbsp;{ this.state.loadAvg[1] },</FlexItem>
                                            <FlexItem>{ _("15 min") }:&nbsp;{ this.state.loadAvg[2] }</FlexItem>
                                        </Flex>
                                    </DescriptionListDescription>
                                </DescriptionListGroup>
                            </DescriptionList> }

                        { this.state.topServicesCPU.length > 0 &&
                            <Table
                                variant={TableVariant.compact}
                                gridBreakPoint={TableGridBreakpoint.none}
                                borders={false}
                                aria-label={ _("Top 5 CPU services") }
                                cells={ [{ title: _("Service"), transforms: [cellWidth(80)] }, "%"] }
                                rows={this.state.topServicesCPU}>
                                <TableHeader />
                                <TableBody />
                            </Table> }
                    </CardBody>
                </Card>

                <Card>
                    <CardTitle>{ _("Memory") }</CardTitle>
                    <CardBody>
                        <div className="progress-stack">
                            <Tooltip
                                content={ cockpit.format(_("$0 total"), cockpit.format_bytes(memTotal)) }
                                position="bottom">
                                <Progress
                                    id="current-memory-usage"
                                    title={ _("RAM") }
                                    value={memTotal ? this.state.memUsed : undefined}
                                    className="pf-m-sm"
                                    min={0} max={memTotal}
                                    variant={memUsedFraction > 0.9 ? ProgressVariant.danger : null}
                                    label={ memAvail ? cockpit.format(_("$0 available"), cockpit.format_bytes(memAvail)) : "" } />
                            </Tooltip>
                            {swapProgress}
                        </div>

                        { this.state.topServicesMemory.length > 0 &&
                            <Table
                                variant={TableVariant.compact}
                                gridBreakPoint={TableGridBreakpoint.none}
                                borders={false}
                                aria-label={ _("Top 5 memory services") }
                                cells={ [{ title: _("Service"), transforms: [cellWidth(80)] }, _("Used")] }
                                rows={this.state.topServicesMemory}>
                                <TableHeader />
                                <TableBody />
                            </Table> }
                    </CardBody>
                </Card>

                <Card>
                    <CardTitle>{ _("Disks") }</CardTitle>
                    <CardBody>
                        <DescriptionList isHorizontal columnModifier={{ default: '2Col' }}>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("Read") }</DescriptionListTerm>
                                <DescriptionListDescription id="current-disks-read">{ this.state.disksRead >= 1 ? cockpit.format_bytes_per_sec(this.state.disksRead) : "0" }</DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{ _("Write") }</DescriptionListTerm>
                                <DescriptionListDescription id="current-disks-write">{ this.state.disksWritten >= 1 ? cockpit.format_bytes_per_sec(this.state.disksWritten) : "0" }</DescriptionListDescription>
                            </DescriptionListGroup>
                        </DescriptionList>

                        <div id="current-disks-usage" className="progress-stack"> {
                            this.state.mounts.map(info => {
                                let progress = (
                                    <Progress
                                        data-disk-usage-target={info.target}
                                        value={info.use} min={0} max={100}
                                        className="pf-m-sm"
                                        variant={info.use > 90 ? ProgressVariant.danger : null}
                                        title={info.target}
                                        label={ cockpit.format(_("$0 free"), cockpit.format_bytes(info.avail, 1000)) } />
                                );
                                if (have_storage)
                                    progress = <Button variant="link" isInline onClick={() => cockpit.jump("/storage") }>{progress}</Button>;

                                return (
                                    <Tooltip
                                        key={info.target}
                                        content={ cockpit.format(_("$0 total"), cockpit.format_bytes(info.size, 1000)) }
                                        position="bottom">
                                        {progress}
                                    </Tooltip>
                                );
                            })
                        }
                        </div>
                    </CardBody>
                </Card>

                <Card className="current-metrics-network">
                    <CardTitle>{ _("Network") }</CardTitle>
                    <CardBody>
                        <Table
                            variant={TableVariant.compact}
                            // FIXME: If we can make the table less wide, then we can switch from gridLg to none
                            // and (possibly) dropping (at least some of) the font size overrides
                            // this would require breaking out the units/s into its own row
                            gridBreakPoint={TableGridBreakpoint.gridLg}
                            borders={false}
                            aria-label={ _("Network usage") }
                            cells={ [_("Interface"), _("In"), _("Out")] } rows={netIO}
                            rowWrapper={ props => <RowWrapper data-interface={ props.row[0] } {...props} /> }>
                            <TableHeader />
                            <TableBody />
                        </Table>
                    </CardBody>
                </Card>
            </Gallery>
        );
    }
}

const SvgGraph = ({ data, resource, have_sat }) => {
    const dataPoints = key => (
        "0,0 " + // start polygon at (0, 0)
        data.map((samples, index) => (samples && typeof samples[key] === 'number') ? samples[key].toString() + "," + index.toString() : "").join(" ") +
        " 0," + (data.length - 1) // close polygon
    );

    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={ "0 0 2 " + SVG_YMAX } preserveAspectRatio="none">
            <polygon
                 transform={ have_sat ? "matrix(-1,0,0,-1,1," + SVG_YMAX + ")" : "matrix(-2,0,0,-1,2," + SVG_YMAX + ")" }
                 points={ dataPoints("use_" + resource) }
            />
            { have_sat && <polygon
                transform={ "matrix(1,0,0,-1,1," + SVG_YMAX + ")" }
                points={ dataPoints("sat_" + resource) }
                opacity="0.7"
            /> }
        </svg>
    );
};

class MetricsMinute extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            expanded: false,
            logs: null,
            logsUrl: null,
        };

        this.expand = this.expand.bind(this);
        this.onHover = this.onHover.bind(this);
        this.findLogs = this.findLogs.bind(this);
    }

    componentDidUpdate(_, prevState) {
        if (prevState.expanded === false && this.state.expanded === true)
            this.findLogs(this.props.events.start - 4, this.props.events.end + 4); // +- 20s
    }

    expand(isOpenCurrent) {
        this.setState({ expanded: isOpenCurrent });
    }

    onHover(ev) {
        // FIXME - throttle debounce this
        const bounds = ev.target.getBoundingClientRect();
        const offsetY = (ev.clientY - bounds.y) / bounds.height;
        const indexOffset = Math.floor((1 - offsetY) * SAMPLES_PER_MIN);
        const sample = this.props.rawData[indexOffset];
        if (!sample)
            return;

        const time = this.props.startTime + this.props.minute * 60000 + indexOffset * INTERVAL;
        let tooltip = timeformat.timeSeconds(time) + "\n\n";
        Object.entries(sample).forEach(([t, v]) => {
            if (v !== null && v !== undefined)
                tooltip += `${RESOURCES[t].name}: ${RESOURCES[t].format(v)}\n`;
        });
        ev.target.setAttribute("title", tooltip);
    }

    findLogs(start, end) {
        const timestamp = this.props.startTime + (this.props.minute * 60000);
        const start_minute = Math.floor(start / SAMPLES_PER_MIN);
        const start_second = (start - (start_minute * SAMPLES_PER_MIN)) * (60 / SAMPLES_PER_MIN);
        const end_minute = Math.floor(end / SAMPLES_PER_MIN);
        const end_second = (end - (end_minute * SAMPLES_PER_MIN)) * (60 / SAMPLES_PER_MIN);

        const time = new Date(timestamp);
        time.setUTCMinutes(start_minute);
        time.setUTCSeconds(start_second);
        const since = formatUTC_ISO(time);

        time.setUTCMinutes(end_minute);
        time.setUTCSeconds(end_second);
        const until = formatUTC_ISO(time);

        const match = { priority: "info", since: since, until: until, follow: false, count: 10 };
        const journalctl = journal.journalctl(match);

        const out = new JournalOutput(match);
        out.render_day_header = () => { return null };
        const render = journal.renderer(out);

        journalctl.stream(entries => {
            entries.forEach(entry => render.prepend(entry));
            render.prepend_flush();
        })
                .then(() => {
                    let logsUrl;
                    if (out.logs.length === 0) {
                        // without logs, increase verbosity and time range (-15 mins to + 1 min)
                        const since = formatUTC_ISO(new Date(timestamp - 15 * 60000));
                        const until = formatUTC_ISO(new Date(timestamp + 60000));
                        logsUrl = `/system/logs/#/?priority=debug&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&follow=false`;
                    } else {
                        // with logs, show the exact minute and same log level as on the metrics page
                        logsUrl = `/system/logs/#/?priority=info&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&follow=false`;
                    }

                    this.setState({ logs: out.logs, logsUrl });
                });
    }

    render() {
        const first = this.props.data.find(i => i !== null);

        const graphs = ['cpu', 'memory', 'disks', 'network'].map(resource => {
            // not all resources have a saturation metric
            let have_sat = !!RESOURCES["sat_" + resource];

            // If there is no swap, don't render it
            if (resource === "memory" && !swapTotal)
                have_sat = false;

            let graph = null;
            if (this.props.events) {
                // render full SVG graphs for "expanded" minutes with events
                graph = <SvgGraph key={resource} data={this.props.data} resource={resource} have_sat={have_sat} />;
            } else if (first) {
                // render simple bars for "compressed" minutes without events
                graph = <div key={resource} className="compressed" style={{ "--utilization": first["use_" + resource] || 0, "--saturation": first["sat_" + resource] || 0 }}>
                    <div className="utilization" />
                    { have_sat && <div className="saturation" /> }
                </div>;
            }

            return (
                <div
                    key={ resource + this.props.startTime + this.props.minute }
                    className={ ("metrics-data metrics-data-" + resource) + (first ? " valid-data" : " empty-data") + (have_sat ? " have-saturation" : "") }
                    aria-hidden="true"
                    onMouseMove={this.onHover}
                >
                    {graph}
                </div>
            );
        });

        let events = <div className="metrics-events" />;
        if (this.props.events) {
            const timestamp = this.props.startTime + (this.props.minute * 60000);
            const desc = <div className="description">
                { this.props.events.events.map(t => <span className="type" key={ t }>{ RESOURCES[t].event_description }</span>) }
                <div className="details">
                    <time>{ timeformat.time(timestamp) }</time>
                    {this.state.expanded && this.state.logsUrl &&
                        <Button variant="link" isInline onClick={e => cockpit.jump(this.state.logsUrl)}>
                            { _("View detailed logs") }
                        </Button>}
                </div>
            </div>;

            let body = " "; // Cannot be false-y, otherwise table does not show '>'
            if (this.state.expanded) {
                body = <div className="cockpit-log-panel">
                    {this.state.logs === null
                        ? _("Loading...")
                        : this.state.logs.length === 0
                            ? <span className="pf-u-py-sm">{ _("No logs found") }</span>
                            : this.state.logs
                    }
                </div>;
            }

            const entry = [{
                props: { key: timestamp, 'data-row-id': timestamp },
                columns: [{ title: desc }],
                hasPadding: false,
                expandedContent: body,
            }];

            events = <div className="metrics-events-wrapper">
                <ListingTable aria-label={ _("Event logs") }
                                      className="metrics-events"
                                      style={{ "--pf-c-table--BorderColor": "#fff" }}
                                      showHeader={false}
                                      variant="compact"
                                      afterToggle={this.expand}
                                      gridBreakPoint=''
                                      columns={[
                                          { title: _("Event") },
                                      ]}
                                      rows={entry} />
            </div>;
        }

        return (
            <div className="metrics-minute" data-minute={this.props.minute}>
                { events }
                <div className="metrics-graphs">
                    { graphs }
                </div>
            </div>
        );
    }
}

class MetricsHour extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            minuteGraphs: [],
            minutes: 0,
            dataItems: 0,
        };

        this.updateGraphs = this.updateGraphs.bind(this);
    }

    componentDidMount() {
        this.updateGraphs(this.props.data, this.props.startTime);
    }

    shouldComponentUpdate(nextProps, nextState) {
        if (this.state.dataItems !== nextProps.data.length || this.props.startTime !== nextProps.startTime) {
            this.updateGraphs(nextProps.data, nextProps.startTime);
            return false;
        }

        return true;
    }

    // data: type → SAMPLES_PER_H objects from startTime
    updateGraphs(data, startTime) {
        // Normalize data
        const normData = data.map(sample => {
            if (sample === null)
                return null;
            const n = {};
            for (const type in sample)
                n[type] = (sample[type] !== null && sample[type] !== undefined) ? RESOURCES[type].normalize(sample[type]) : null;
            return n;
        });

        // Count minutes to render
        let minutes = 60;
        if (this.props.clipLeading) {
            // When clipping of empty leading minutes is allowed, find the highest 5 minute interval with valid data
            let m = 55;
            for (; m >= 0; m = m - 5) {
                const dataOffset = m * SAMPLES_PER_MIN;
                const dataSlice = normData.slice(dataOffset, dataOffset + SAMPLES_PER_MIN * 5);
                if (dataSlice.some(i => i !== null && i !== undefined))
                    break;
            }
            minutes = m + 5;
        }

        // Compute spike events
        const minute_events = {};
        for (const type in RESOURCES) {
            let prev_val = data[0] ? data[0][type] : null;
            normData.forEach((samples, i) => {
                if (samples === null)
                    return;
                const value = samples[type];
                // either high enough slope, or crossing the 80% threshold
                if (prev_val !== null && (value - prev_val > 0.25 || (prev_val < 0.75 && value >= 0.8))) {
                    const minute = Math.floor(i / SAMPLES_PER_MIN);
                    if (minute_events[minute] === undefined)
                        minute_events[minute] = { events: [], start: i - 1 };

                    minute_events[minute].end = i;

                    // For every minute show each type of event max once
                    if (minute_events[minute].events.indexOf(type) === -1)
                        minute_events[minute].events.push(type);
                }
                prev_val = value;
            });
        }

        const minuteGraphs = [];

        for (let minute = minutes - 1; minute >= 0; --minute) {
            const dataOffset = minute * SAMPLES_PER_MIN;
            const dataSlice = normData.slice(dataOffset, dataOffset + SAMPLES_PER_MIN);
            const rawSlice = this.props.data.slice(dataOffset, dataOffset + SAMPLES_PER_MIN);
            minuteGraphs.push(<MetricsMinute key={minute} minute={minute} data={dataSlice} rawData={rawSlice} events={minute_events[minute]} startTime={this.props.startTime} />);
        }

        this.setState({ minuteGraphs: minuteGraphs, minutes: minutes, dataItems: this.props.data.length });
    }

    render() {
        return (
            <div id={ "metrics-hour-" + this.props.startTime.toString() } style={{ "--has-swap": swapTotal ? "var(--column-size)" : "var(--half-column-size)" }} className="metrics-hour">
                { this.state.minuteGraphs }
                <h3 className="metrics-time"><time>{ timeformat.dateTime(this.props.startTime) }</time></h3>
            </div>
        );
    }
}

// null means "not initialized yet"
const invalidService = proxy => proxy.state === null;
const runningService = proxy => ['running', 'starting'].indexOf(proxy.state) >= 0;

const wait_cond = (cond, objects) => {
    return new Promise((resolve, reject) => {
        const check = () => {
            if (cond()) {
                objects.forEach(o => o.removeEventListener("changed", check));
                resolve();
            }
        };
        objects.forEach(o => o.addEventListener("changed", check));
        check();
    });
};

const PCPConfigDialog = ({
    firewalldRequest,
    needsLogout, setNeedsLogout,
    s_pmlogger, s_pmproxy, s_redis, s_redis_server
}) => {
    const Dialogs = useDialogs();
    const dialogInitialProxyValue = runningService(s_pmproxy) && (runningService(s_redis) || runningService(s_redis_server));
    const [dialogError, setDialogError] = useState(null);
    const [dialogLoggerValue, setDialogLoggerValue] = useState(runningService(s_pmlogger));
    const [dialogProxyValue, setDialogProxyValue] = useState(dialogInitialProxyValue);
    const [pending, setPending] = useState(false);
    const [packagekitExists, setPackagekitExists] = useState(null);

    useInit(() => packagekit.detect().then(setPackagekitExists));

    const handleInstall = () => {
    // when enabling services, install missing packages on demand
        const missing = [];
        if (dialogLoggerValue && !s_pmlogger.exists)
            missing.push("cockpit-pcp");
        if (dialogProxyValue && !(s_redis.exists || s_redis_server.exists))
            missing.push("redis");
        if (missing.length > 0) {
            debug("PCPConfig: missing packages", JSON.stringify(missing), ", offering install");
            Dialogs.close();
            return install_dialog(missing)
                    .then(() => {
                        debug("PCPConfig: package installation successful");
                        if (missing.indexOf("cockpit-pcp") >= 0)
                            setNeedsLogout(true);
                        return wait_cond(() => (s_pmlogger.exists &&
                                                (!dialogProxyValue || (s_pmproxy.exists && (s_redis.exists || s_redis_server.exists)))),
                                         [s_pmlogger, s_pmproxy, s_redis, s_redis_server]);
                    });
        } else
            return Promise.resolve();
    };

    const handleSave = () => {
        debug("PCPConfig handleSave(): dialogLoggerValue", dialogLoggerValue, "dialogInitialProxyValue", dialogInitialProxyValue, "dialogProxyValue", dialogProxyValue);

        handleInstall()
                .then(() => {
                    setPending(true);

                    let real_redis;
                    let redis_name;
                    if (s_redis_server.exists) {
                        real_redis = s_redis_server;
                        redis_name = "redis-server.service";
                    } else {
                        real_redis = s_redis;
                        redis_name = "redis.service";
                    }

                    const redis_enable_cmd = `mkdir -p /etc/systemd/system/pmproxy.service.wants; ln -sf ../${redis_name} /etc/systemd/system/pmproxy.service.wants/${redis_name}`;
                    const redis_disable_cmd = `rm -f /etc/systemd/system/pmproxy.service.wants/${redis_name}; rmdir -p /etc/systemd/system/pmproxy.service.wants 2>/dev/null || true`;
                    let action;

                    // enable/disable does a daemon-reload, which interferes with start on some distros; so don't run them in parallel
                    if (dialogLoggerValue)
                        action = s_pmlogger.start().then(() => s_pmlogger.enable());
                    else
                        action = s_pmlogger.stop().finally(() => s_pmlogger.disable());

                    if (dialogProxyValue !== null && dialogInitialProxyValue !== dialogProxyValue) {
                        if (dialogProxyValue === true) {
                        // pmproxy.service needs to (re)start *after* redis to recognize it
                            action = action
                                    .then(() => real_redis.start())
                                    .then(() => s_pmproxy.restart())
                            // turn redis into a dependency, as the metrics API requires it
                                    .then(() => cockpit.script(redis_enable_cmd, { superuser: "require", err: "message" }))
                                    .then(() => s_pmproxy.enable());
                        } else {
                        // don't stop redis here -- it's a shared service, other things may be using it
                            action = action
                                    .then(() => s_pmproxy.stop())
                                    .then(() => cockpit.script(redis_disable_cmd, { superuser: "require", err: "message" }))
                                    .then(() => s_pmproxy.disable());
                        }
                    }

                    action
                            .then(() => {
                                Dialogs.close();
                                if (dialogProxyValue && !dialogInitialProxyValue && firewalldRequest)
                                    firewalldRequest({ service: "pmproxy", title: _("Open the pmproxy service in the firewall to share metrics.") });
                                else
                                    firewalldRequest(null);
                            })
                            .catch(err => { setPending(false); setDialogError(err.toString()) });
                })
                .catch(() => null); // ignore cancel in install dialog
    };

    return (
        <Modal position="top" variant="small" isOpen
          id="pcp-settings-modal"
          onClose={Dialogs.close}
          title={ _("Metrics settings") }
          description={
              <div className="pcp-settings-modal-text">
                  { _("Performance Co-Pilot collects and analyzes performance metrics from your system.") }

                  <Button component="a" variant="link" href="https://cockpit-project.org/guide/latest/feature-pcp.html"
                                isInline
                                target="_blank" rel="noopener noreferrer"
                                icon={<ExternalLinkAltIcon />}>
                      { _("Read more...") }
                  </Button>
              </div>
          }
                   footer={<>
                       { dialogError && <ModalError dialogError={ _("Failed to configure PCP") } dialogErrorDetail={dialogError} /> }

                       <Button variant='primary' onClick={handleSave} isDisabled={pending} isLoading={pending}>
                           { _("Save") }
                       </Button>
                       <Button variant='link' className='btn-cancel' onClick={Dialogs.close}>
                           {_("Cancel")}
                       </Button>
                   </>
                   }>

            <Switch id="switch-pmlogger"
                        isChecked={dialogLoggerValue}
                        isDisabled={!s_pmlogger.exists && !packagekitExists}
                        label={
                            <Flex spaceItems={{ modifier: 'spaceItemsXl' }}>
                                <FlexItem>{ _("Collect metrics") }</FlexItem>
                                <TextContent>
                                    <Text component={TextVariants.small}>(pmlogger.service)</Text>
                                </TextContent>
                            </Flex>
                        }
                        onChange={enable => {
                            // pmproxy needs pmlogger, auto-disable it
                            setDialogLoggerValue(enable);
                            if (!enable)
                                setDialogProxyValue(false);
                        }} />

            <Switch id="switch-pmproxy"
                        isChecked={dialogProxyValue}
                        label={
                            <Flex spaceItems={{ modifier: 'spaceItemsXl' }}>
                                <FlexItem>{ _("Export to network") }</FlexItem>
                                <TextContent>
                                    <Text component={TextVariants.small}>(pmproxy.service)</Text>
                                </TextContent>
                            </Flex>
                        }
                        isDisabled={ !dialogLoggerValue }
                        onChange={enable => setDialogProxyValue(enable)} />
        </Modal>);
};

const PCPConfig = ({ buttonVariant, firewalldRequest, needsLogout, setNeedsLogout }) => {
    const Dialogs = useDialogs();

    const s_pmlogger = useObject(() => service.proxy("pmlogger.service"), null, []);
    const s_pmproxy = useObject(() => service.proxy("pmproxy.service"), null, []);
    // redis.service on Fedora/RHEL, redis-server.service on Debian/Ubuntu with an Alias=redis
    const s_redis = useObject(() => service.proxy("redis.service"), null, []);
    const s_redis_server = useObject(() => service.proxy("redis-server.service"), null, []);

    useEvent(superuser, "changed");
    useEvent(s_pmlogger, "changed");
    useEvent(s_pmproxy, "changed");
    useEvent(s_redis, "changed");
    useEvent(s_redis_server, "changed");

    debug("PCPConfig s_pmlogger.state", s_pmlogger.state, "needs logout", needsLogout);
    debug("PCPConfig s_pmproxy state", s_pmproxy.state, "redis exists", s_redis.exists, "state", s_redis.state, "redis-server exists", s_redis_server.exists, "state", s_redis_server.state);

    if (!superuser.allowed)
        return null;

    function show_dialog() {
        Dialogs.show(<PCPConfigDialog firewalldRequest={firewalldRequest}
                                      needsLogout={needsLogout} setNeedsLogout={setNeedsLogout}
                                      s_pmlogger={s_pmlogger}
                                      s_pmproxy={s_pmproxy}
                                      s_redis={s_redis} s_redis_server={s_redis_server} />);
    }

    return (
        <Button variant={buttonVariant} icon={<CogIcon />}
                isDisabled={ invalidService(s_pmlogger) || invalidService(s_pmproxy) || invalidService(s_redis) || invalidService(s_redis_server) }
                onClick={show_dialog}>
            { _("Metrics settings") }
        </Button>);
};

class MetricsHistory extends React.Component {
    constructor(props) {
        super(props);
        // metrics data: hour timestamp → array of SAMPLES_PER_H objects of { type → value } or null
        this.data = {};
        // timestamp of the most recent sample that we got (for auto-refresh)
        this.most_recent = 0;
        // Oldest read data
        this.oldest_timestamp = 0;
        // Timestamp representing today midnight to calculate other days for date select
        this.today_midnight = null;

        this.state = {
            hours: [], // available hours for rendering in descending order
            loading: true, // show loading indicator
            metricsAvailable: true,
            pmLoggerState: null,
            error: null,
            isDatepickerOpened: false,
            selectedDate: null,
            packagekitExists: false,
        };

        this.handleMoreData = this.handleMoreData.bind(this);
        this.handleToggle = this.handleToggle.bind(this);
        this.handleSelect = this.handleSelect.bind(this);
        this.handleInstall = this.handleInstall.bind(this);

        /* supervise pmlogger.service, to diagnose missing history */
        this.pmlogger_service = service.proxy("pmlogger.service");
        this.pmlogger_service.addEventListener("changed", () => {
            if (!invalidService(this.pmlogger_service) && this.pmlogger_service.state !== this.state.pmLoggerState) {
                // when it got enabled while the page is running (e.g. through Settings dialog), start data collection
                if (!this.state.metricsAvailable && runningService(this.pmlogger_service))
                    this.initialLoadData();
                this.setState({ pmLoggerState: this.pmlogger_service.state });
            }
        });

        // FIXME: load less up-front, load more when scrolling
        machine_info_promise.then(() => this.initialLoadData());

        cockpit.addEventListener("visibilitychange", () => {
            // update history metrics when in auto-update mode
            if (!cockpit.hidden && this.history_refresh_timer)
                this.load_data(this.most_recent);
        });
    }

    // load and render the last 24 hours (plus current one) initially; this needs numCpu initialized for correct scaling
    initialLoadData() {
        cockpit.spawn(["date", "+%s"])
                .then(out => {
                    const now = parseInt(out.trim()) * 1000;
                    const current_hour = Math.floor(now / MSEC_PER_H) * MSEC_PER_H;
                    this.most_recent = current_hour;
                    this.today_midnight = new Date(current_hour).setHours(0, 0, 0, 0);

                    const selectedDate = parseInt(cockpit.location.options.date) || this.today_midnight;

                    if (selectedDate !== this.today_midnight)
                        this.load_data(selectedDate, 24 * SAMPLES_PER_H, true);
                    else
                        this.load_data(current_hour - LOAD_HOURS * MSEC_PER_H, undefined, true);

                    this.setState({
                        metricsAvailable: true,
                        selectedDate,
                    });
                })
                .catch(ex => this.setState({ error: ex.toString() }));
    }

    componentDidMount() {
        packagekit.detect().then(exists => {
            this.setState({ packagekitExists: exists });
        });
    }

    handleMoreData() {
        this.load_data(this.oldest_timestamp - (LOAD_HOURS * MSEC_PER_H), LOAD_HOURS * SAMPLES_PER_H, true);
    }

    handleToggle(isOpen) {
        this.setState({ isDatepickerOpened: isOpen });
    }

    handleSelect(e, sel) {
        // Stop fetching of new data
        if (this.history_refresh_timer !== null) {
            window.clearTimeout(this.history_refresh_timer);
            this.history_refresh_timer = null;
        }

        this.oldest_timestamp = 0;

        cockpit.location.go([], Object.assign(cockpit.location.options, { date: sel }));
        this.setState({
            selectedDate: sel,
            isDatepickerOpened: false,
            hours: [],
        }, () => this.load_data(sel, sel === this.today_midnight ? undefined : 24 * SAMPLES_PER_H, true));
    }

    handleInstall() {
        install_dialog("cockpit-pcp")
                .then(() => this.props.setNeedsLogout(true))
                .catch(() => null); // ignore cancel
    }

    load_data(load_timestamp, limit, show_spinner) {
        if (show_spinner)
            this.setState({ loading: true });

        this.oldest_timestamp = this.oldest_timestamp > load_timestamp || this.oldest_timestamp === 0 ? load_timestamp : this.oldest_timestamp;
        let current_hour; // hour of timestamp, from most recent meta message
        let hour_index; // index within data[current_hour] array
        const current_sample = []; // last valid value, for decompression
        const new_hours = new Set(); // newly seen hours during this load
        this.history_refresh_timer = null;

        const metrics = cockpit.channel({
            payload: "metrics1",
            interval: INTERVAL,
            source: "pcp-archive",
            timestamp: load_timestamp,
            limit: limit,
            metrics: HISTORY_METRICS,
        });

        metrics.addEventListener("message", (event, message) => {
            debug("history metrics message", message);
            message = JSON.parse(message);

            const init_current_hour = () => {
                if (!this.data[current_hour])
                    this.data[current_hour] = [];

                // When limit is considered only add hours in this time range
                if (!limit || load_timestamp + (limit * INTERVAL) >= current_hour)
                    new_hours.add(current_hour);
            };

            // meta message
            if (!Array.isArray(message)) {
                current_hour = Math.floor(message.timestamp / MSEC_PER_H) * MSEC_PER_H;
                init_current_hour();
                hour_index = Math.floor((message.timestamp - current_hour) / INTERVAL);
                console.assert(hour_index < SAMPLES_PER_H);

                debug("message is metadata; time stamp", message.timestamp, "=", timeformat.dateTime(message.timestamp), "for current_hour", current_hour, "=", timeformat.dateTime(current_hour), "hour_index", hour_index);
                return;
            }

            debug("message is", message.length, "samples data for current hour", current_hour, "=", timeformat.dateTime(current_hour));

            message.forEach((samples, i) => {
                decompress_samples(samples, current_sample);

                /* don't overwrite existing data with null data; this often happens at the first
                 * data point when "rate" metrics cannot be calculated yet */
                if (typeof current_sample[0] !== 'number' && this.data[current_hour][hour_index]) {
                    debug("load_data", load_timestamp, ": ignoring sample #", i, ":", JSON.stringify(current_sample), "current data sample", JSON.stringify(this.data[current_hour][hour_index]));
                    return;
                }

                // TODO: eventually track/display this by-interface?
                const use_network = current_sample[8].reduce((acc, cur) => acc + cur, 0);
                const sat_cpu = typeof current_sample[3][1] === 'number' ? current_sample[3][1] : null; // instances: (15min, 1min, 5min), pick 1min

                this.data[current_hour][hour_index] = {
                    use_cpu: typeof current_sample[2] === 'number' ? [current_sample[0], current_sample[1], current_sample[2]] : null,
                    sat_cpu,
                    use_memory: typeof current_sample[5] === 'number' ? [current_sample[4], current_sample[5]] : null,
                    sat_memory: current_sample[6],
                    use_disks: current_sample[7],
                    use_network,
                };

                // keep track of maximums of unbounded values, for dynamic scaling
                if (sat_cpu > scaleSatCPU)
                    scaleSatCPU = scaleForValue(sat_cpu);
                if (current_sample[7] > scaleUseDisks)
                    scaleUseDisks = scaleForValue(current_sample[7]);
                if (use_network > scaleUseNetwork)
                    scaleUseNetwork = scaleForValue(use_network);

                if (++hour_index === SAMPLES_PER_H) {
                    current_hour += MSEC_PER_H;
                    hour_index = 0;
                    init_current_hour();
                    debug("hour overflow, advancing to", current_hour, "=", timeformat.dateTime(current_hour));
                }
            });

            // update most recent sample timestamp
            this.most_recent = Math.max(this.most_recent, current_hour + (hour_index - 5) * INTERVAL);
            debug("most recent timestamp is now", this.most_recent, "=", timeformat.dateTime(this.most_recent));
        });

        metrics.addEventListener("close", (event, message) => {
            if (message.problem) {
                debug("could not load metrics:", message.problem);
                this.setState({
                    loading: false,
                    metricsAvailable: false,
                });
            } else {
                debug("loaded metrics for timestamp", timeformat.dateTime(load_timestamp), "new hours", JSON.stringify(Array.from(new_hours)));
                new_hours.forEach(hour => debug("hour", hour, "data", JSON.stringify(this.data[hour])));

                const hours = Array.from(new Set([...this.state.hours, ...new_hours]));
                // sort in descending order
                hours.sort((a, b) => b - a);
                // re-render
                this.setState({ hours, loading: false });

                // trigger automatic update every minute when visible
                if (!limit) {
                    this.history_refresh_timer = window.setTimeout(() => {
                        if (!cockpit.hidden)
                            this.load_data(this.most_recent);
                    }, 60000);
                }
            }

            metrics.close();
        });
    }

    render() {
        if (this.props.needsLogout)
            return <EmptyStatePanel
                        icon={ExclamationCircleIcon}
                        title={_("You need to relogin to be able to see metrics history")}
                        action={<Button onClick={() => cockpit.logout(true)}>{_("Log out")}</Button>}
            />;

        if (cockpit.manifests && !cockpit.manifests.pcp)
            return <EmptyStatePanel
                        icon={ExclamationCircleIcon}
                        title={_("Package cockpit-pcp is missing for metrics history")}
                        action={this.state.packagekitExists ? <Button onClick={() => this.handleInstall()}>{_("Install cockpit-pcp")}</Button> : null}
            />;

        if (!this.state.metricsAvailable) {
            let action;
            let paragraph;

            if (this.pmlogger_service.state === 'stopped') {
                paragraph = _("pmlogger.service is not running");
                action = <PCPConfig buttonVariant="primary"
                                    firewalldRequest={this.props.firewalldRequest}
                                    needsLogout={this.props.needsLogout}
                                    setNeedsLogout={this.props.setNeedsLogout} />;
            } else {
                if (this.pmlogger_service.state === 'failed')
                    paragraph = _("pmlogger.service has failed");
                else /* running, or initialization hangs */
                    paragraph = _("pmlogger.service is failing to collect data");
                action = <Button variant="link" onClick={() => cockpit.jump("/system/services#/pmlogger.service") }>{_("Troubleshoot")}</Button>;
            }

            return <EmptyStatePanel
                        icon={ExclamationCircleIcon}
                        title={_("Metrics history could not be loaded")}
                        paragraph={paragraph}
                        action={action}
            />;
        }

        if (this.state.error)
            return <EmptyStatePanel
                        icon={ExclamationCircleIcon}
                        title={_("Error has occurred")}
                        paragraph={this.state.error}
            />;

        let nodata_alert = null;
        if (!this.state.loading && this.state.hours.length > 0 && this.oldest_timestamp < this.state.hours[this.state.hours.length - 1]) {
            let t1, t2;
            if (this.state.hours[0] - this.oldest_timestamp < 24 * MSEC_PER_H) {
                t1 = timeformat.time(this.oldest_timestamp);
                t2 = timeformat.time(this.state.hours[0]);
            } else {
                t1 = timeformat.dateTime(this.oldest_timestamp);
                t2 = timeformat.dateTime(this.state.hours[0]);
            }
            nodata_alert = <Alert className="nodata" variant="info" isInline title={ cockpit.format(_("No data available between $0 and $1"), t1, t2) } />;
        }

        if (!this.state.loading && this.state.hours.length === 0)
            nodata_alert = <EmptyStatePanel icon={ExclamationCircleIcon} title={_("No data available")} />;

        // generate selection of last 14 days
        const options = Array(15).fill()
                .map((_undef, i) => {
                    const date = this.today_midnight - i * 86400000;
                    const text = i == 0 ? _("Today") : timeformat.weekdayDate(date);
                    return <SelectOption key={date} value={date}>{text}</SelectOption>;
                });

        function Label(props) {
            return (
                <div className={"metrics-label metrics-label-graph" + (props.items.length > 1 ? " have-saturation" : "")}>
                    <span>{props.label}</span>
                    <span className="metrics-sublabels">
                        { props.items.map(i => <span key={i}>{i}</span>) }
                    </span>
                </div>
            );
        }

        return (
            <div className="metrics">
                <div className="metrics-heading-sticky">
                    <section className="metrics-heading" style={{ "--has-swap": swapTotal ? "var(--column-size)" : "var(--half-column-size)" }}>
                        <Select
                            className="select-min metrics-label"
                            aria-label={_("Jump to")}
                            onToggle={this.handleToggle}
                            onSelect={this.handleSelect}
                            isOpen={this.state.isDatepickerOpened}
                            selections={this.state.selectedDate}
                            toggleId="date-picker-select-toggle"
                        >
                            {options}
                        </Select>
                        <div className="metrics-graphs">
                            <Label label={_("CPU")} items={[_("Usage"), _("Load")]} />
                            <Label label={_("Memory")} items={[_("Usage"), ...swapTotal ? [_("Swap")] : []]} />
                            <Label label={_("Disk I/O")} items={[_("Usage")]} />
                            <Label label={_("Network")} items={[_("Usage")]} />
                        </div>
                    </section>
                </div>
                { this.state.hours.length > 0 &&
                    <Card>
                        <CardBody className="metrics-history">
                            { this.state.hours.map((time, i) => <MetricsHour key={time} startTime={parseInt(time)}
                                                                             data={this.data[time]} clipLeading={i === 0}
                            />) }
                        </CardBody>
                    </Card> }
                {nodata_alert}
                <div className="bottom-panel">
                    { this.state.loading
                        ? <EmptyStatePanel loading title={_("Loading...")} />
                        : <Button onClick={this.handleMoreData}>{_("Load earlier data")}</Button> }
                </div>
            </div>
        );
    }
}

export const Application = () => {
    const [firewalldRequest, setFirewalldRequest] = useState(null);
    const [needsLogout, setNeedsLogout] = useState(false);

    return (
        <WithDialogs>
            <Page additionalGroupedContent={
                <PageSection id="metrics-header-section" variant={PageSectionVariants.light} type='breadcrumb'>
                    <Flex>
                        <FlexItem>
                            <Breadcrumb>
                                <BreadcrumbItem onClick={() => cockpit.jump("/system")} className="pf-c-breadcrumb__link">{_("Overview")}</BreadcrumbItem>
                                <BreadcrumbItem isActive>{_("Metrics and history")}</BreadcrumbItem>
                            </Breadcrumb>
                        </FlexItem>
                        <FlexItem align={{ default: 'alignRight' }}>
                            <PCPConfig buttonVariant="secondary"
                                             firewalldRequest={setFirewalldRequest}
                                             needsLogout={needsLogout}
                                             setNeedsLogout={setNeedsLogout} />
                        </FlexItem>
                    </Flex>
                </PageSection>
            }>
                { firewalldRequest &&
                <FirewalldRequest service={firewalldRequest.service} title={firewalldRequest.title} pageSection /> }
                <PageSection className="ct-pagesection-mobile">
                    <CurrentMetrics />
                </PageSection>
                <PageSection className="ct-pagesection-mobile">
                    <MetricsHistory firewalldRequest={setFirewalldRequest}
                                    needsLogout={needsLogout}
                                    setNeedsLogout={setNeedsLogout} />
                </PageSection>
            </Page>
        </WithDialogs>);
};
